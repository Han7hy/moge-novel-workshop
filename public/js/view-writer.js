/* ============ view-writer.js —— 沉浸式写作 ============
   一个只用来「写」的页面：左侧章节目录自己安排，中间一整张纸，
   右下角一个能拖来拖去的人物小窗，陪你聊这一章怎么写。 */
window.Views = window.Views || {};

const WR_COACH_POS = 'moge-writer-coach-ui';
const WR_QUICK = [
  '这一章怎么开头比较好',
  '帮我看看逻辑有没有漏洞',
  '这个人物此刻会怎么反应',
  '给我三个可能的走向',
  '这段节奏是不是太慢了'
];

const WP_MODES = {
  draft: { label: '想法成章', hint: '把几句想法铺成一章' },
  expand: { label: '扩写选段', hint: '只补表达层，不加情节' },
  polish: { label: '保真润色', hint: '不改原意，只顺句去 AI 味' },
  advice: { label: '只提建议', hint: '不动笔，只说怎么改' }
};
const WP_BUDGET = {
  draft: { short: [0.72, 1400], medium: [0.72, 2600], long: [0.75, 4600] },
  expand: { short: [0.7, 1200], medium: [0.7, 2200], long: [0.72, 3600] },
  polish: { short: [0.45, 1400], medium: [0.45, 2600], long: [0.5, 4000] },
  advice: { short: [0.4, 700], medium: [0.4, 1100], long: [0.45, 1600] }
};

/** 模型偶尔会加客套话、代码块或「注：」，采用前先清掉，避免混进小说正文 */
function cleanPolishOutput(raw, mode) {
  let t = String(raw || '').trim();
  t = t.replace(/^```[\w-]*\s*/i, '').replace(/\s*```\s*$/, '').trim();
  t = t.replace(/^(好的|明白|以下是|这是|已按)[^\n]{0,50}[:：]\s*\n+/, '');
  if (mode !== 'advice') {
    t = t.split('\n')
      .filter((line) => !/^\s*(注[:：]|说明[:：]|备注[:：]|#{1,6}\s|【[^】]{1,12}】\s*$|-{3,}\s*$)/.test(line))
      .join('\n');
  }
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

Views.writer = {
  title: '写作',
  sub: '沉浸式 · 章节由你安排 · 角色在旁边陪写',
  _zen: false,
  _railOpen: false, // 写作页内手动展开最左侧主导航（离开本页即复位）
  _side: true,
  _coachOpen: true,
  _coachMin: false,
  _charId: '',
  _saveT: null,
  _dirty: false,   // 纸上有还没同步到正文库 / 服务端的字
  _timer: null,
  _key: null,
  _start: 0,
  _polish: null,      // 当前润色面板状态；关闭即清空
  _discardDraft: false, // 全局 AI 撤销替换 Store.data 期间：旧输入框的任何事件都不许再写数据

  actions() {
    return `<button class="btn" id="wrTopPolish">✦ AI 润色</button>
            <button class="btn" id="wrTopNew">＋ 新章节</button>
            <button class="btn" id="wrTopCoach">✦ 角色辅导</button>
            <button class="btn" id="wrTopExport">导出本章</button>`;
  },

  /* ---------------- 挂载 ---------------- */
  mount(el) {
    el.classList.add('no-pad');
    // 记住这张纸属于哪本书：换书后不能再把旧 textarea 的字写进新书
    this._bookId = Store.currentBookId;
    // 窄屏第一次进来默认收起章节目录，把整张纸留给正文
    if (this._sideInited === undefined) {
      this._side = window.innerWidth >= 900;
      this._sideInited = true;
    }
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._saveT) { clearTimeout(this._saveT); this._saveT = null; }
    if (this._key) { document.removeEventListener('keydown', this._key); this._key = null; }

    this.ensureChapters();
    const w = Store.writer();
    if (!this._charId || !Store.char(this._charId)) {
      this._charId = (Store.data.characters[0] || {}).id || '';
    }

    el.innerHTML = `
      <div class="wr ${this._side ? '' : 'no-side'}" id="wrRoot">
        <aside class="wr-side" id="wrSide">
          <div class="wr-side-head">
            <span>章节目录</span>
            <button class="wr-sbtn" id="wrAdd" title="新建章节">＋</button>
          </div>
          <div class="wr-chaps" id="wrChapList"></div>
          <div class="wr-side-foot">
            <button class="wr-sbtn wide" id="wrImportOutline">从大纲导入章节</button>
            <div class="wr-side-tip">拖动 ⠿ 或点 ↑↓ 调整顺序</div>
          </div>
        </aside>

        <main class="wr-main">
          <div class="wr-bar">
            <button class="wr-icon" id="wrToggleSide" title="显示 / 隐藏章节目录">☰</button>
            <input class="wr-title" id="wrTitle" maxlength="60" spellcheck="false" title="点这里改章节名">
            <div class="wr-meta">
              <b id="wrWords">0</b><span>字</span>
              <span class="wr-dot"></span>
              <span id="wrClock">00:00</span>
              <span class="wr-save" id="wrSave">已保存</span>
            </div>
            <div class="wr-bar-tools">
              <button class="wr-tbtn" id="wrPolishBtn" title="把想法写成一章 / 润色 / 扩写 / 提建议">✦ AI 润色</button>
              <button class="wr-tbtn" id="wrRailBtn" title="显示 / 收起最左侧主侧栏">▤ 显示侧栏</button>
              <button class="wr-tbtn" id="wrCoachBtn" title="打开 / 收起角色辅导小窗">✦ 角色</button>
              <button class="wr-tbtn" id="wrZen">${this._zen ? '退出专注' : '专注'}</button>
            </div>
          </div>

          <div class="wr-stage">
            <div class="wr-paper">
              <textarea class="wr-prose" id="wrProse" spellcheck="false"
                placeholder="这一章，从第一个字开始。&#10;&#10;左侧是章节，右下角有人陪你聊。写不下去的时候问她一句，不必自己硬扛。"></textarea>
            </div>
          </div>

          <div class="wr-foot">
            <div class="wr-progress"><i id="wrProgress"></i></div>
            <span>目标 <b id="wrTarget">${w.target}</b> 字<span class="wr-foot-dim">（点击可改）</span></span>
            <span class="wr-foot-tip">自动保存已开启 · Ctrl+S 立即保存 · Esc 退出专注</span>
          </div>
        </main>

        <button class="wr-rail-peek" id="wrRailPeek" title="展开最左侧主侧栏">›</button>

        <div class="wr-coach ${this._coachMin ? 'mini' : ''}" id="wrCoach" style="display:${this._coachOpen ? 'flex' : 'none'}">
          <div class="wr-coach-head" id="wrCoachHead">
            <span class="wrc-av" id="wrCoachAv">墨</span>
            <div class="wrc-head-t">
              <b>写作辅导</b>
              <select id="wrCoachWho" title="换一个陪写的人物"></select>
            </div>
            <button class="wrc-hbtn" id="wrCoachClear" title="清空与这个人物的对话">⌫</button>
            <button class="wrc-hbtn" id="wrCoachMin" title="最小化">${this._coachMin ? '▢' : '—'}</button>
            <button class="wrc-hbtn" id="wrCoachClose" title="关闭小窗">✕</button>
          </div>
          <div class="wr-coach-body">
            <div class="wrc-ctx" id="wrCoachCtx"></div>
            <div class="wrc-quick" id="wrCoachQuick">
              ${WR_QUICK.map((q) => `<button class="wrc-chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
            </div>
            <div class="wrc-log" id="wrCoachLog"></div>
          </div>
          <div class="wr-coach-foot">
            <textarea id="wrCoachInput" rows="2" placeholder="问她这一章怎么写…（Enter 发送，Shift+Enter 换行）"></textarea>
            <button class="btn primary sm" id="wrCoachSend">发送</button>
          </div>
        </div>
      </div>`;

    this.renderSide();
    this.loadChapter();
    this.syncRail();
    this.registerExitHooks();
    this.bindPage(el);
    this.bindCoach();
    this.renderCoachLog();

    document.body.classList.toggle('zen-on', this._zen);
    // 撤销流程里的重挂载已完成，旧输入框也已被销毁，恢复正常写入
    this._discardDraft = false;
    this._start = Date.now();
    this._timer = setInterval(() => {
      const t = $('#wrClock');
      if (!t) return;
      const s = Math.floor((Date.now() - this._start) / 1000);
      t.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 1000);
    this._key = (e) => {
      if (e.key === 'Escape' && App.current === 'writer' && this._zen) {
        e.preventDefault();
        this.toggleZen();
      }
    };
    document.addEventListener('keydown', this._key);
  },

  /** 第一次进来：大纲里已有章节就顺手带过来，否则给一张空白纸 */
  ensureChapters() {
    const w = Store.writer();
    if (w.chapters.length) return;
    const seeds = [];
    (Store.data.outline.volumes || []).forEach((v) => {
      (v.chapters || []).forEach((c) => {
        if (c && c.title) seeds.push({ title: c.title, note: String(c.summary || '') });
      });
    });
    if (seeds.length) {
      seeds.forEach((s) => {
        const c = Store.writerAddChapter(s.title);
        c.note = s.note;
      });
    } else {
      Store.writerAddChapter('第一章');
    }
    w.activeId = w.chapters[0].id;
    Store.touch();
  },

  /* ---------------- 章节目录 ---------------- */
  renderSide() {
    const host = $('#wrChapList');
    if (!host) return;
    const w = Store.writer();
    const active = Store.writerActive();
    host.innerHTML = w.chapters.length ? w.chapters.map((c, i) => {
      const words = String(c.text || '').replace(/\s/g, '').length;
      return `<div class="wr-chap ${active && active.id === c.id ? 'on' : ''}" data-id="${c.id}" draggable="true" title="${esc(c.title || '未命名章节')} · ${words} 字（悬停可改名 / 排序 / 删除）">
        <span class="wr-grip" title="拖动排序">⠿</span>
        <div class="wr-chap-t">
          <b>${i + 1}. ${esc(c.title || '未命名章节')}</b>
          <small>${words} 字${c.note ? ' · ' + esc(String(c.note).slice(0, 16)) : ''}</small>
        </div>
        <div class="wr-chap-acts">
          <button data-act="up" ${i === 0 ? 'disabled' : ''} title="上移">↑</button>
          <button data-act="down" ${i === w.chapters.length - 1 ? 'disabled' : ''} title="下移">↓</button>
          <button data-act="rename" title="改名 / 备注">✎</button>
          <button data-act="del" title="删除章节">✕</button>
        </div>
      </div>`;
    }).join('') : '<div class="wr-chap-empty">还没有章节，点右上角 ＋ 建一个。</div>';
  },

  loadChapter() {
    const c = Store.writerActive();
    const ta = $('#wrProse');
    const ti = $('#wrTitle');
    if (ti) ti.value = c ? (c.title || '') : '';
    if (ta) ta.value = c ? (c.text || '') : '';
    this.updateWords(ta ? ta.value : '');
    this._dirty = false;
    const t = $('#wrTarget');
    if (t) t.textContent = Store.writer().target;
    this.syncCoachCtx();
  },

  updateWords(text) {
    const n = String(text || '').replace(/\s/g, '').length;
    const el = $('#wrWords');
    if (el) {
      el.textContent = n;
      el.style.color = n >= Store.writer().target ? 'var(--jade)' : 'var(--ink)';
    }
    const bar = $('#wrProgress');
    if (bar) bar.style.width = Math.min(100, (n / Store.writer().target) * 100) + '%';
  },

  /** 定时提交：写回章节 + 同步正文库。textarea 已被销毁时也能用内存里的字 */
  commitEdit() {
    if (this._discardDraft) return;
    this._saveT = null;
    const c = Store.writerActive();
    const box = $('#wrProse');
    if (c) Store.writerSaveText(c.id, box ? box.value : c.text);
    this._dirty = false;
    this.renderSide();
    this.syncCoachCtx();
    const s = $('#wrSave');
    if (s) s.textContent = '已保存';
  },

  /** 切章 / 切页 / 导出 / 关标签页之前：立刻提交 + 立刻写服务端 */
  flush(opts) {
    if (this._discardDraft) return;
    const o = opts || {};
    if (this._saveT) { clearTimeout(this._saveT); this._saveT = null; }
    const ta = $('#wrProse');
    const c = Store.writerActive();
    if (c) Store.writerSaveText(c.id, ta ? ta.value : c.text);
    this._dirty = false;
    const s = $('#wrSave');
    if (s) s.textContent = '已保存';
    // pagehide 里异步 fetch 可能来不及，改由 sendBeacon 兜底
    if (o.now !== false) { try { Store.save(true); } catch (e) {} }
  },
  beforeLeave() { this.flush(); },

  /** 切浏览器标签页 / 最小化 / 刷新 / 关闭时再兜一层 */
  registerExitHooks() {
    if (this._exitHook) return;
    this._exitHook = (reason) => {
      if (this._discardDraft) return;
      if (!$('#wrProse')) return; // 写作页已经卸载，App.render 之前已提交过
      try { this.flush({ now: reason !== 'pagehide' }); } catch (e) {}
      if (reason === 'pagehide' && typeof navigator.sendBeacon === 'function') {
        try {
          navigator.sendBeacon(
            '/api/book/' + encodeURIComponent(Store.currentBookId),
            new Blob([JSON.stringify(Store.data)], { type: 'application/json' })
          );
        } catch (e) {}
      }
    };
    window.addEventListener('pagehide', () => this._exitHook('pagehide'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this._exitHook('hidden');
    });
  },

  openChapter(id) {
    const cur = Store.writerActive();
    if (cur && cur.id === id) return;
    this.flush();
    Store.writer().activeId = id;
    Store.touch();
    this.renderSide();
    this.loadChapter();
    this.syncCoachCtx();
  },

  chapterDialog(id) {
    const c = id ? Store.writerChapter(id) : null;
    const list = Store.writerChapters();
    const mask = Modal.open({
      title: c ? '修改章节' : '新建章节',
      narrow: true,
      body: `<label class="fld"><span>章节名</span>
          <input type="text" id="wrChName" maxlength="60" value="${esc(c ? c.title : '第 ' + (list.length + 1) + ' 章')}"></label>
        <label class="fld" style="margin-top:10px"><span>本章要写什么（只有你自己看得到，会带给陪写角色）</span>
          <textarea id="wrChNote" rows="3" placeholder="例：她第一次怀疑他，但不能说出来">${esc(c ? c.note : '')}</textarea></label>
        <div class="hint" style="margin-top:8px">顺序在左侧目录用 ⠿ 拖动或 ↑↓ 调整。</div>`,
      footer: `<button class="btn" data-x>取消</button><button class="btn primary" id="wrChGo">${c ? '保存' : '创建'}</button>`
    });
    const name = mask.querySelector('#wrChName');
    const note = mask.querySelector('#wrChNote');
    const go = () => {
      const v = name.value.trim();
      if (!v) return toast('先写个章节名', 'err');
      if (c) {
        Store.writerRenameChapter(c.id, v);
        c.note = note.value;
        Store.touch();
      } else {
        this.flush(); // 建新章前先把当前章写完
        const nc = Store.writerAddChapter(v);
        nc.note = note.value;
        Store.touch();
      }
      Modal.close();
      this.renderSide();
      this.loadChapter();
      this.syncCoachCtx();
      toast(c ? '章节已更新' : '新章节已建好');
    };
    mask.querySelector('#wrChGo').onclick = go;
    mask.querySelector('[data-x]').onclick = () => Modal.close();
    name.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    name.focus();
    name.select();
  },

  removeChapter(id) {
    const c = Store.writerChapter(id);
    if (!c) return;
    const n = String(c.text || '').replace(/\s/g, '').length;
    if (!confirm(`删除章节「${c.title}」？${n ? '\n这一章的 ' + n + ' 字正文也会一起删掉，且无法撤销。' : ''}`)) return;
    this.flush(); // 先把纸上的字提交，别把别的章节的草稿一起弄丢
    Store.writerRemoveChapter(id);
    if (!Store.writerChapters().length) this.ensureChapters();
    this.renderSide();
    this.loadChapter();
    this.syncCoachCtx();
    toast('章节已删除');
  },

  importOutline() {
    this.flush();
    const seeds = [];
    (Store.data.outline.volumes || []).forEach((v) => {
      (v.chapters || []).forEach((c) => { if (c && c.title) seeds.push({ title: c.title, note: String(c.summary || '') }); });
    });
    if (!seeds.length) return toast('大纲里还没有章节，先去「大纲」页建几章', 'err');
    const have = new Set(Store.writerChapters().map((c) => c.title));
    let n = 0;
    seeds.forEach((s) => {
      if (have.has(s.title)) return;
      const c = Store.writerAddChapter(s.title);
      c.note = s.note;
      have.add(s.title);
      n++;
    });
    Store.touch();
    this.renderSide();
    toast(n ? `已从大纲导入 ${n} 章` : '大纲里的章节都已在目录中');
  },

  exportChapter() {
    this.flush();
    const c = Store.writerActive();
    if (!c || !String(c.text || '').trim()) return toast('这一章还没有正文', 'err');
    const blob = new Blob([`《${Store.data.meta.title || '未命名'}》\n\n${c.title}\n\n${c.text}\n`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = c.title + '.txt';
    a.click();
    toast('已导出本章');
  },

  /** 进写作页默认收起最左侧主导航；想换书 / 换页时随时展开 */
  syncRail() {
    document.body.classList.toggle('rail-collapsed', !this._railOpen);
    const b = $('#wrRailBtn');
    if (b) {
      b.textContent = window.innerWidth < 620 ? '▤' : (this._railOpen ? '▤ 收起侧栏' : '▤ 显示侧栏');
      b.title = this._railOpen ? '收起最左侧主侧栏' : '展开最左侧主侧栏';
      b.classList.toggle('on', this._railOpen);
    }
  },
  toggleRail(force) {
    this._railOpen = force == null ? !this._railOpen : !!force;
    // 专注模式连顶栏一起收，和展开主侧栏互斥
    if (this._railOpen && this._zen) this.toggleZen();
    this.syncRail();
  },

  toggleZen() {
    this._zen = !this._zen;
    if (this._zen) this._railOpen = false;
    document.body.classList.toggle('zen-on', this._zen);
    const b = $('#wrZen');
    if (b) { b.textContent = this._zen ? '退出专注' : '专注'; b.classList.toggle('on', this._zen); }
    this.syncRail();
  },

  /* ---------------- 页面事件 ---------------- */
  bindPage(el) {
    $('#wrTopNew').onclick = () => this.chapterDialog('');
    $('#wrTopPolish').onclick = () => this.openPolish();
    $('#wrPolishBtn').onclick = () => this.openPolish();
    $('#wrTopExport').onclick = () => this.exportChapter();
    $('#wrTopCoach').onclick = () => this.toggleCoach();
    $('#wrAdd').onclick = () => this.chapterDialog('');
    $('#wrImportOutline').onclick = () => this.importOutline();
    $('#wrToggleSide').onclick = () => {
      this._side = !this._side;
      $('#wrRoot').classList.toggle('no-side', !this._side);
    };
    $('#wrZen').onclick = () => this.toggleZen();
    $('#wrCoachBtn').onclick = () => this.toggleCoach();
    $('#wrRailBtn').onclick = () => this.toggleRail();
    $('#wrRailPeek').onclick = () => this.toggleRail(true);

    const title = $('#wrTitle');
    title.onchange = () => {
      const c = Store.writerActive();
      if (!c) return;
      const v = title.value.trim();
      if (!v) { title.value = c.title; return; }
      Store.writerRenameChapter(c.id, v);
      this.renderSide();
      this.syncCoachCtx();
    };
    title.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } };

    const target = $('#wrTarget');
    target.onclick = () => {
      const v = prompt('这一章的目标字数', Store.writer().target);
      if (v == null) return;
      const n = Math.max(100, Number(v) || 3000);
      Store.writer().target = n;
      Store.touch();
      target.textContent = n;
      this.updateWords($('#wrProse') ? $('#wrProse').value : '');
    };

    const ta = $('#wrProse');
    const onEdit = () => {
      // 撤销刚替换过整书数据：旧输入框的 blur / input 一律丢弃，否则会把 AI 稿写回去
      if (this._discardDraft) return;
      const c = Store.writerActive();
      if (!c) return;
      // 关键：每敲一个字先写进内存。切页时哪怕 500ms 的定时器还没跑，字也在数据里
      c.text = ta.value;
      c.words = ta.value.replace(/\s/g, '').length;
      c.updatedAt = new Date().toISOString();
      this._dirty = true;
      this.updateWords(ta.value);
      const s = $('#wrSave');
      if (s) s.textContent = '输入中…';
      clearTimeout(this._saveT);
      this._saveT = setTimeout(() => this.commitEdit(), 500);
    };
    ta.addEventListener('input', onEdit);
    ta.addEventListener('compositionend', onEdit); // 中文输入法选字完成
    ta.addEventListener('change', onEdit);        // 失焦 / 粘贴
    ta.addEventListener('blur', onEdit);

    const list = $('#wrChapList');
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      const row = e.target.closest('.wr-chap');
      if (!row) return;
      const id = row.dataset.id;
      const chapters = Store.writerChapters();
      const i = chapters.findIndex((c) => c.id === id);
      if (btn) {
        const act = btn.dataset.act;
        if (act === 'up' || act === 'down') {
          Store.writerMoveChapter(id, i + (act === 'up' ? -1 : 1));
          this.renderSide();
        } else if (act === 'rename') this.chapterDialog(id);
        else if (act === 'del') this.removeChapter(id);
        return;
      }
      this.openChapter(id);
    });

    // 拖动调整章节顺序
    let dragId = '';
    list.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.wr-chap');
      if (!row) return;
      dragId = row.dataset.id;
      row.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed = 'move'; } catch (err) {}
    });
    list.addEventListener('dragover', (e) => {
      const row = e.target.closest('.wr-chap');
      if (!row || !dragId) return;
      e.preventDefault();
      $$('#wrChapList .wr-chap').forEach((r) => r.classList.remove('drop-on'));
      row.classList.add('drop-on');
    });
    list.addEventListener('drop', (e) => {
      const row = e.target.closest('.wr-chap');
      if (!row || !dragId) return;
      e.preventDefault();
      const chapters = Store.writerChapters();
      const to = chapters.findIndex((c) => c.id === row.dataset.id);
      if (to >= 0) Store.writerMoveChapter(dragId, to);
      dragId = '';
      $$('#wrChapList .wr-chap').forEach((r) => r.classList.remove('dragging', 'drop-on'));
      this.renderSide();
    });
    list.addEventListener('dragend', () => {
      dragId = '';
      $$('#wrChapList .wr-chap').forEach((r) => r.classList.remove('dragging', 'drop-on'));
    });
  },

  /* ---------------- 角色辅导小窗 ---------------- */
  coachUI() {
    try { return JSON.parse(localStorage.getItem(WR_COACH_POS) || '{}') || {}; }
    catch (e) { return {}; }
  },
  saveCoachUI(patch) {
    const o = Object.assign(this.coachUI(), patch);
    try { localStorage.setItem(WR_COACH_POS, JSON.stringify(o)); } catch (e) {}
  },

  restoreCoachPos(box) {
    const o = this.coachUI();
    if (typeof o.open === 'boolean') this._coachOpen = o.open;
    if (typeof o.min === 'boolean') this._coachMin = o.min;
    if (o.charId && Store.char(o.charId)) this._charId = o.charId;
    box.style.display = this._coachOpen ? 'flex' : 'none';
    box.classList.toggle('mini', this._coachMin);
    const minBtn = $('#wrCoachMin');
    if (minBtn) minBtn.textContent = this._coachMin ? '▢' : '—';
    const x = Number(o.x), y = Number(o.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      box.style.left = Math.max(0, Math.min(window.innerWidth - 90, x)) + 'px';
      box.style.top = Math.max(0, Math.min(window.innerHeight - 42, y)) + 'px';
      box.style.right = 'auto';
      box.style.bottom = 'auto';
    }
  },

  toggleCoach(force) {
    this._coachOpen = force == null ? !this._coachOpen : !!force;
    const box = $('#wrCoach');
    if (box) box.style.display = this._coachOpen ? 'flex' : 'none';
    this.saveCoachUI({ open: this._coachOpen });
    if (this._coachOpen) this.renderCoachLog();
  },

  bindCoach() {
    const box = $('#wrCoach');
    const head = $('#wrCoachHead');
    if (!box || !head) return;
    this.restoreCoachPos(box);

    const who = $('#wrCoachWho');
    who.innerHTML = Store.data.characters.length
      ? Store.data.characters.map((c) => `<option value="${c.id}">${esc(c.name || '未命名')}${c.role ? ' · ' + esc(c.role) : ''}</option>`).join('')
      : '<option value="">（还没有人物）</option>';
    who.value = this._charId;
    who.onchange = () => {
      this._charId = who.value;
      this.saveCoachUI({ charId: this._charId });
      this.renderCoachLog();
    };

    $('#wrCoachClose').onclick = () => this.toggleCoach(false);
    $('#wrCoachMin').onclick = () => {
      this._coachMin = !this._coachMin;
      box.classList.toggle('mini', this._coachMin);
      $('#wrCoachMin').textContent = this._coachMin ? '▢' : '—';
      this.saveCoachUI({ min: this._coachMin });
    };
    $('#wrCoachClear').onclick = () => {
      if (!this._charId || !Store.writerChat(this._charId).length) return;
      if (!confirm('清空与这位人物的辅导对话？章节正文不受影响。')) return;
      Store.writerClearChat(this._charId);
      this.renderCoachLog();
    };

    $('#wrCoachQuick').onclick = (e) => {
      const b = e.target.closest('[data-q]');
      if (b) this.sendCoach(b.dataset.q);
    };
    $('#wrCoachLog').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ins]');
      if (!b) return;
      const log = Store.writerChat(this._charId);
      const h = log[Number(b.dataset.ins)];
      if (h) this.insertToProse(h.a);
    });

    const input = $('#wrCoachInput');
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendCoach(input.value); }
    };
    $('#wrCoachSend').onclick = () => this.sendCoach(input.value);

    // 按住标题栏拖到屏幕上任意位置
    let dragging = false, dx = 0, dy = 0;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button,select,input,textarea,option')) return;
      dragging = true;
      const r = box.getBoundingClientRect();
      dx = e.clientX - r.left;
      dy = e.clientY - r.top;
      box.classList.add('dragging');
      try { head.setPointerCapture(e.pointerId); } catch (err) {}
    });
    head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(window.innerWidth - 90, e.clientX - dx));
      const y = Math.max(0, Math.min(window.innerHeight - 42, e.clientY - dy));
      box.style.left = x + 'px';
      box.style.top = y + 'px';
      box.style.right = 'auto';
      box.style.bottom = 'auto';
    });
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      box.classList.remove('dragging');
      const r = box.getBoundingClientRect();
      this.saveCoachUI({ x: Math.round(r.left), y: Math.round(r.top) });
    };
    head.addEventListener('pointerup', stop);
    head.addEventListener('pointercancel', stop);
  },

  syncCoachCtx() {
    const el = $('#wrCoachCtx');
    if (!el) return;
    const c = Store.writerActive();
    const n = String((c && c.text) || '').replace(/\s/g, '').length;
    el.textContent = c ? `正在写：${c.title} · ${n} 字` : '还没有章节';
  },

  renderCoachLog(pending) {
    const host = $('#wrCoachLog');
    if (!host) return;
    const c = Store.char(this._charId);
    const name = c ? (c.name || '未命名') : '角色';
    const col = c ? (c.color || '#a63a2a') : '#8a8378';
    const av = $('#wrCoachAv');
    if (av) {
      av.textContent = (name || '墨').slice(0, 1);
      av.style.background = col;
    }
    const who = $('#wrCoachWho');
    if (who && who.value !== this._charId) who.value = this._charId;

    const log = this._charId ? Store.writerChat(this._charId) : [];
    const one = (text, cls, wait, ins) => `<div class="wrc-msg ${cls} ${wait ? 'pending' : ''}" style="--c:${col}">
        <span class="wrc-who">${esc(cls === 'q' ? '作者' : name)}</span>
        <div class="wrc-bubble">${esc(text || (wait ? '……正在想' : ''))}</div>
        ${ins == null ? '' : `<button class="wrc-insert" data-ins="${ins}">插入正文 ↘</button>`}
      </div>`;
    let html = log.map((h, i) => one(h.q, 'q') + one(h.a, 'a', false, i)).join('');
    if (pending) html += one(pending.q, 'q') + one('', 'a', true);
    if (!html) {
      html = `<div class="wrc-empty">${c
        ? '写不下去的时候，问她一句。<br>她知道这本书已经写定的设定，也看得到你这一章。'
        : '先在「人物」页建一个角色，<br>她就会坐到这里陪你写。'}</div>`;
    }
    host.innerHTML = html;
    host.scrollTop = host.scrollHeight;
    this.syncCoachCtx();
  },

  async sendCoach(question) {
    const q = String(question || '').trim();
    if (!q) return;
    if (!this._coachOpen) this.toggleCoach(true);
    if (!this._charId || !Store.char(this._charId)) return toast('先在「人物」页建一个角色', 'err');
    if (!Store.settings.baseUrl) return toast('还没配置 API，请到「设置」里填', 'err');

    const input = $('#wrCoachInput');
    const btn = $('#wrCoachSend');
    if (input) input.value = '';
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    this.renderCoachLog({ q });
    const cid = this._charId;
    const c = Store.char(cid);
    try {
      const messages = Prompts.writeCoach({
        char: c,
        chapter: Store.writerActive() || {},
        prose: (Store.writerActive() || {}).text || '',
        history: Store.writerChat(cid).slice(-4),
        question: q
      });
      const raw = String(await LLM.chat({ messages, temperature: 0.7, maxTokens: 500, noUndo: true, usage: 'polish' }) || '').trim();
      // 和「问人物」一样：辅导窗里也只要话，不要动作 / 神态 / 名字前缀
      const clean = (typeof window.cleanInterviewSpeech === 'function')
        ? window.cleanInterviewSpeech(raw, c.name) : raw;
      Store.writerPushChat(cid, q, clean || raw);
      this.renderCoachLog();
    } catch (e) {
      if (input) input.value = q;
      toast(e.message || '提问失败', 'err');
      this.renderCoachLog();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '发送'; }
      if (input) input.focus();
    }
  },

  /* ---------------- AI 润色：把一句想法写成合格章节 ---------------- */
  openPolish() {
    const ta = $('#wrProse');
    if (!ta) return;
    this.flush(); // 先提交纸上的字，AI 留档才是干净的「生成前」状态
    const start = ta.selectionStart == null ? 0 : ta.selectionStart;
    const end = ta.selectionEnd == null ? start : ta.selectionEnd;
    const selText = ta.value.slice(start, end).trim();
    const fullText = ta.value;
    const scope = selText ? 'selection' : 'chapter';
    const src = selText || fullText;

    const mask = Modal.open({
      title: 'AI 润色 · 把你的想法写成一章',
      wide: true,
      onClose: () => { this._polish = null; },
      body: `<div class="wp">
        <div class="wp-modes" id="wpModes">
          ${Object.keys(WP_MODES).map((k) => `<button class="wp-mode" data-m="${k}"><b>${WP_MODES[k].label}</b><small>${WP_MODES[k].hint}</small></button>`).join('')}
        </div>

        <div class="wp-row">
          <span class="wp-lab">作用范围</span>
          <div class="seg" id="wpScope">
            <button data-s="chapter">整章</button>
            <button data-s="selection" id="wpSelBtn">选中文字</button>
          </div>
          <span class="wp-lab">篇幅</span>
          <select id="wpStrength">
            <option value="short">短</option><option value="medium" selected>中</option><option value="long">长</option>
          </select>
          <span class="wp-tip" id="wpTip"></span>
        </div>

        <div class="wp-src">
          <div class="wp-labline"><span>你的想法 / 待处理正文（可直接在这里改）</span>
            <button class="wp-link" id="wpFromNote">用本章备注当想法</button></div>
          <textarea id="wpSrc" rows="5" spellcheck="false" placeholder="随手写一句就行：两人在废墟里吵了一架，第三人转身走了……"></textarea>
        </div>

        <div class="wp-extra">
          <label class="wp-f"><span>这次特别要求</span>
            <input type="text" id="wpReq" placeholder="例：开头要抓人、别写太多心理、多写点对话"></label>
          <label class="wp-f"><span>文风参考（贴一段你喜欢的文字，可留空）
              <button class="wp-link" id="wpSaveStyle">存为本书文风参考</button></span>
            <textarea id="wpStyle" rows="2" placeholder="留空就用项目里设定的笔调"></textarea></label>
        </div>

        <div class="wp-gen">
          <button class="btn primary" id="wpGo">✦ 生成</button>
          <span class="wp-state" id="wpState">结果先给你看，采用之前不会动正文。</span>
        </div>

        <div class="wp-compare" id="wpCompare" style="display:none">
          <div class="wp-col">
            <div class="wp-col-h">原文 · 你的想法 <b id="wpSrcN">0</b> 字</div>
            <pre id="wpOld"></pre>
          </div>
          <div class="wp-col">
            <div class="wp-col-h">AI 稿 · 可以直接改 <b id="wpOutN">0</b> 字</div>
            <textarea id="wpOut" rows="10" spellcheck="false"></textarea>
          </div>
        </div>
      </div>`,
      footer: `<button class="btn sm" id="wpCopy">复制 AI 稿</button>
               <button class="btn sm" id="wpAgain">重新生成</button>
               <span style="flex:1"></span>
               <button class="btn" data-x>放弃</button>
               <button class="btn" id="wpInsert">插到光标后</button>
               <button class="btn primary" id="wpAdopt">采用替换</button>`
    });

    this._polish = {
      mask, mode: 'draft', scope, strength: 'medium',
      start, end, selText, fullText, srcTouched: false, result: '', busy: false
    };
    mask.querySelector('#wpSrc').value = src;
    mask.querySelector('#wpStyle').value = ((Store.data.style || {}).sample) || '';
    this.bindPolish(mask);
    this.syncPolishUI();
    this.updatePolishCount();
  },

  bindPolish(mask) {
    mask.querySelector('#wpModes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (!b || !this._polish) return;
      const P = this._polish;
      P.mode = b.dataset.m;
      // 换模式后旧稿不再允许直接采用，必须重新生成
      if (P.result) {
        P.resultMode = null;
        const st = P.mask.querySelector('#wpState');
        if (st) st.textContent = '模式换了，点「重新生成」出新稿；右侧旧稿仍可复制。';
      }
      this.syncPolishUI();
    });
    mask.querySelector('#wpScope').addEventListener('click', (e) => {
      const b = e.target.closest('[data-s]');
      if (!b || !this._polish || b.disabled) return;
      const P = this._polish;
      if (b.dataset.s === 'selection' && !P.selText) return;
      P.scope = b.dataset.s;
      const box = mask.querySelector('#wpSrc');
      if (box && !P.srcTouched) box.value = P.scope === 'selection' ? P.selText : P.fullText;
      this.syncPolishUI();
      this.updatePolishCount();
    });
    const src = mask.querySelector('#wpSrc');
    src.addEventListener('input', () => {
      if (this._polish) this._polish.srcTouched = true;
      this.syncPolishUI();
      this.updatePolishCount();
    });
    mask.querySelector('#wpFromNote').onclick = () => {
      const note = (Store.writerActive() || {}).note || '';
      if (!note.trim()) return toast('这一章还没写备注，点左侧 ✎ 可以补一句', 'err');
      src.value = note;
      if (this._polish) this._polish.srcTouched = true;
      this.syncPolishUI();
      this.updatePolishCount();
    };
    mask.querySelector('#wpSaveStyle').onclick = () => {
      const v = mask.querySelector('#wpStyle').value.trim();
      if (!v) return toast('先贴一段你喜欢的文字', 'err');
      if (!Store.data.style) Store.data.style = {};
      Store.data.style.sample = v.slice(0, 3000);
      Store.touch();
      toast('已存为本书文风参考，之后所有 AI 成文都会照着它写');
    };
    mask.querySelector('#wpGo').onclick = () => this.generatePolish();
    mask.querySelector('#wpAgain').onclick = () => this.generatePolish();
    mask.querySelector('#wpOut').addEventListener('input', () => this.updatePolishCount());
    mask.querySelector('#wpCopy').onclick = () => this.adoptPolish('copy');
    mask.querySelector('#wpInsert').onclick = () => this.adoptPolish('insert');
    mask.querySelector('#wpAdopt').onclick = () => this.adoptPolish('replace');
    mask.querySelector('[data-x]').onclick = () => Modal.close();
  },

  syncPolishUI() {
    const P = this._polish;
    if (!P || !P.mask) return;
    const m = P.mask;
    m.querySelectorAll('#wpModes [data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === P.mode));
    m.querySelectorAll('#wpScope [data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === P.scope));
    const selBtn = m.querySelector('#wpSelBtn');
    selBtn.disabled = !P.selText;
    selBtn.textContent = P.selText ? `选中文字（${P.selText.replace(/\s/g, '').length} 字）` : '选中文字（未选）';

    const srcLen = String(m.querySelector('#wpSrc').value || '').replace(/\s/g, '').length;
    let tip = WP_MODES[P.mode].hint;
    if (P.mode === 'draft' && srcLen > 300) tip = '这段已超过 300 字，「想法成章」会整段重写；想保真请切「保真润色」。';
    m.querySelector('#wpTip').textContent = tip;

    const advice = P.mode === 'advice';
    const adopt = m.querySelector('#wpAdopt');
    const insert = m.querySelector('#wpInsert');
    adopt.disabled = advice;
    insert.disabled = advice;
    adopt.textContent = advice ? '建议不写入正文' : (P.scope === 'selection' ? '替换选中文字' : '替换整章正文');
  },

  updatePolishCount() {
    const P = this._polish;
    if (!P || !P.mask) return;
    const m = P.mask;
    const a = m.querySelector('#wpSrc');
    const b = m.querySelector('#wpOut');
    const s = m.querySelector('#wpSrcN');
    const o = m.querySelector('#wpOutN');
    if (s) s.textContent = String(a && a.value ? a.value.replace(/\s/g, '').length : 0);
    if (o) o.textContent = String(b && b.value ? b.value.replace(/\s/g, '').length : 0);
  },

  async generatePolish() {
    const P = this._polish;
    if (!P || P.busy) return;
    const m = P.mask;
    const src = m.querySelector('#wpSrc').value.trim();
    if (!src && P.mode !== 'draft') return toast('先写点想法，或选中一段文字', 'err');
    if (!Store.settings.baseUrl) return toast('还没配置 API，请到「设置」里填', 'err');

    const c = Store.writerActive() || {};
    const ta = $('#wrProse');
    const full = ta ? ta.value : (c.text || '');
    const before = P.scope === 'selection' ? full.slice(0, P.start) : '';
    const after = P.scope === 'selection' ? full.slice(P.end) : '';
    const strength = m.querySelector('#wpStrength').value;
    const budget = (WP_BUDGET[P.mode] || {})[strength] || WP_BUDGET.draft.medium;
    const messages = Prompts.polishChapter({
      mode: P.mode,
      chapter: c,
      source: src,
      before, after, strength,
      requirement: m.querySelector('#wpReq').value,
      styleSample: m.querySelector('#wpStyle').value
    });

    const btn = m.querySelector('#wpGo');
    const state = m.querySelector('#wpState');
    P.busy = true;
    btn.disabled = true;
    btn.textContent = '正在写…';
    state.textContent = '正在按这本书的设定和文风写…';
    try {
      AIUndo.label('写作 · AI 润色（' + WP_MODES[P.mode].label + '）');
      const raw = await LLM.chat({ messages, temperature: budget[0], maxTokens: budget[1], usage: 'polish' });
      const out = cleanPolishOutput(raw, P.mode);
      if (!out) throw new Error('模型没有返回可用内容');
      P.result = out;
      P.resultMode = P.mode;
      m.querySelector('#wpOld').textContent = src || '（还没写字，按本章备注与大纲落笔）';
      m.querySelector('#wpOut').value = out;
      const cmp = m.querySelector('#wpCompare');
      cmp.style.display = 'grid';
      this.updatePolishCount();
      // 结果在弹窗下半部，生成完直接滚到对照区，别让用户再找一遍
      try { cmp.scrollIntoView({ block: 'end' }); } catch (e) {}
      state.textContent = P.mode === 'advice'
        ? '建议只供参考，不会写进正文；可以复制带走。'
        : '看一眼再决定：只有「采用」才会动正文，右下角随时能撤销。';
    } catch (e) {
      state.textContent = '生成失败，想法与正文都没有改动。';
      toast(e.message || '生成失败', 'err');
    } finally {
      P.busy = false;
      btn.disabled = false;
      btn.textContent = '✦ 生成';
    }
  },

  adoptPolish(kind) {
    const P = this._polish;
    if (!P) return;
    const box = P.mask.querySelector('#wpOut');
    const out = String(box && box.value ? box.value : '').trim();
    if (!out) return toast('先生成一版，再决定要不要用', 'err');
    if (kind === 'copy') {
      try { navigator.clipboard.writeText(out); } catch (e) {}
      return toast('AI 稿已复制');
    }
    if (P.mode === 'advice' || P.resultMode === 'advice') {
      return toast('「只提建议」不写入正文，请用「复制 AI 稿」带走', 'err');
    }
    if (P.resultMode !== P.mode) return toast('换过模式了，先点「重新生成」再采用', 'err');
    const ta = $('#wrProse');
    if (!ta) return;
    if (kind === 'replace') {
      if (P.scope === 'selection') {
        const full = ta.value;
        ta.value = full.slice(0, P.start) + out + full.slice(P.end);
        const pos = P.start + out.length;
        ta.setSelectionRange(pos, pos);
      } else {
        ta.value = out;
        ta.setSelectionRange(out.length, out.length);
      }
    } else {
      const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
      const e = ta.selectionEnd == null ? s : ta.selectionEnd;
      const head = ta.value.slice(0, s), tail = ta.value.slice(e);
      const glue = head && !/\n$/.test(head) ? '\n\n' : '';
      ta.value = head + glue + out + tail;
      const pos = s + glue.length + out.length;
      ta.setSelectionRange(pos, pos);
    }
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    this.flush();      // 立刻同步正文库并写服务端，切页也不会丢
    this.renderSide();
    Modal.close();
    toast('已写入正文 · 右下角可一键撤销');
  },

  insertToProse(text) {
    const ta = $('#wrProse');
    if (!ta) return;
    const t = String(text || '').trim();
    if (!t) return;
    const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const e = ta.selectionEnd == null ? s : ta.selectionEnd;
    const before = ta.value.slice(0, s);
    const after = ta.value.slice(e);
    const glue = before && !/\n$/.test(before) ? '\n\n' : '';
    ta.value = before + glue + t + after;
    ta.focus();
    ta.setSelectionRange(s + glue.length + t.length, s + glue.length + t.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    toast('已插入正文');
  }
};
