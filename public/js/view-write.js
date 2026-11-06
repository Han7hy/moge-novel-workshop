/* ============ view-write.js ============ */
window.Views = window.Views || {};

/* 作者访谈：把回答清成「纯台词」——去掉动作、神态、旁白、名字前缀。
   提示词已经约束过，这里兜底，保证气泡里像微信一样只有话。 */
function cleanInterviewSpeech(raw, name) {
  let s = String(raw == null ? '' : raw).replace(/\r/g, '').trim();
  if (!s) return '';
  const escRe = (x) => String(x || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const prefix = name
    ? new RegExp('^[\\[「『]?\\s*' + escRe(name) + '\\s*[\\]」』]?\\s*[:：]\\s*')
    : null;
  const lines = s.split('\n').map((line) => {
    let t = line.trim();
    if (!t) return '';
    // 整行都是舞台提示：（抬眼打量了一下） / (笑) / *沉默* / 【旁白】
    if (/^[（(【\[*][\s\S]*[）)】\]*]$/.test(t)) return '';
    if (prefix) t = t.replace(prefix, '');
    t = t.replace(/[（(][^）)]{0,120}[）)]/g, '');   // 中文台词里的全角括号基本都是动作
    t = t.replace(/\*[^*\n]{1,120}\*/g, '');
    t = t.replace(/【[^】\n]{1,120}】/g, '');
    return t.replace(/^[ \t]+|[ \t]+$/g, '');
  }).filter(Boolean);
  s = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (prefix) s = s.replace(prefix, '').trim();
  s = s.replace(/^(答|回复|回答)\s*[:：]\s*/, '').trim();
  if (/^[「“][\s\S]*[”」]$/.test(s)) s = s.slice(1, -1).trim();
  return s.replace(/[ \t]{2,}/g, ' ').trim();
}
window.cleanInterviewSpeech = cleanInterviewSpeech;

Views.write = {
  title: '角色对话',
  sub: '给一句情节，让他们自己演',
  st: null,
  _path: null,
  immersive: false,

  actions() {
    return `<button class="btn" id="btnGoWriter">✒ 沉浸式写作 ↗</button>
            <button class="btn" id="btnLoadScene">从大纲选场景</button>
            <button class="btn" id="btnManu">章节目录</button>`;
  },

  mount(el, params) {
    el.classList.add('no-pad');
    // 离开沉浸模式时清理计时器与快捷键监听
    if (this._immTimer) { clearInterval(this._immTimer); this._immTimer = null; }
    if (this._immKey) { document.removeEventListener('keydown', this._immKey); this._immKey = null; }

    if (!this.st) this.st = this.blankState();

    // 沉浸模式：全屏专注写作
    if (this.immersive) { this.renderImmersive(el); return; }

    if (params && params.scenePath && params !== this._lastParams) {
      this._lastParams = params;
      const [vi, ci, si] = params.scenePath;
      const s = Store.data.outline.volumes[vi]?.chapters?.[ci]?.scenes?.[si];
      if (s) {
        this.st.scene = s;
        this._path = params.scenePath;
        this.st.lines = [];
        this.st.prose = '';
      }
    }

    el.innerHTML = `
      <div class="theater">
        <div class="th-col" style="background:var(--surface)">
          <div class="th-head"><span>场景调度</span><span class="muted small" id="pathHint"></span></div>
          <div class="th-body" id="ctrl"></div>
        </div>

        <div class="th-col">
          <div class="th-head">
            <span>对话台</span>
            <span class="muted small" id="turnInfo"></span>
          </div>
          <div class="th-body" id="feed"></div>
          <div style="border-top:1px solid var(--line);padding:10px;display:flex;gap:6px;background:var(--surface-2)">
            <input type="text" id="authorSay" placeholder="作者插话 / 临时指令（例：让他把刀放下）" style="flex:1">
            <button class="btn sm" id="btnInject">插入</button>
            <button class="btn sm ghost" id="btnClearFeed" title="清空对话">清空</button>
          </div>
        </div>

        <div class="th-col">
          <div class="th-head">
            <span>正文</span>
            <div style="display:flex;gap:6px">
              <button class="btn sm ghost" id="btnCopy">复制</button>
              <button class="btn sm" id="btnSaveCh">存入正文库</button>
            </div>
          </div>
          <div class="th-body flush" style="background:var(--paper)">
            <textarea class="prose-area" id="prose" placeholder="点「开演」让角色先吵起来，再点「成文」把这场戏写成小说正文。&#10;也可以直接在这里手写。"></textarea>
          </div>
        </div>
      </div>`;

    this.renderCtrl();
    this.renderFeed();
    $('#prose').value = this.st.prose || '';
    $('#prose').addEventListener('input', (e) => {
      this.st.prose = e.target.value;
    });

    $('#btnInject').onclick = () => this.inject();
    $('#authorSay').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.inject();
    });
    $('#btnClearFeed').onclick = () => {
      this.st.lines = [];
      this.st.turn = 0;
      this.renderFeed();
    };
    $('#btnCopy').onclick = () => {
      navigator.clipboard.writeText(this.st.prose || '').then(() => toast('已复制'));
    };
    $('#btnSaveCh').onclick = () => this.saveChapter();
    $('#btnManu').onclick = () => this.showManuscripts();
    $('#btnLoadScene').onclick = () => this.pickScene();
    $('#btnGoWriter').onclick = () => App.go('writer');
    this.updateBtns();
  },

  blankState() {
    const places = Store.data.map.nodes;
    return {
      scene: {
        id: uid('sc'),
        title: '自由场景',
        placeId: places[0] ? places[0].id : '',
        cast: Store.data.characters.slice(0, 3).map((c) => c.id),
        goal: '',
        conflict: '',
        beats: []
      },
      lines: [],
      prose: '',
      turn: 0,
      maxTurns: 6,
      directive: '',
      running: false,
      busy: false
    };
  },

  /* ---------- 沉浸模式 ---------- */
  exitImmersive() {
    this.immersive = false;
    if (this._immTimer) { clearInterval(this._immTimer); this._immTimer = null; }
    if (this._immKey) { document.removeEventListener('keydown', this._immKey); this._immKey = null; }
    App.rerender();
  },

  renderImmersive(el) {
    const target = this.st.target || 3000;
    el.innerHTML = `
      <div class="imm">
        <div class="imm-bar">
          <div class="imm-title">${esc(Store.data.meta.title || '未命名')} · ${esc(this.st.scene.title || '自由场景')}</div>
          <div class="imm-stats">
            <span id="immWords">0</span><span class="imm-unit">字</span>
            <span class="imm-sep">/</span>
            <span id="immTarget" title="点击修改目标字数" style="cursor:pointer;text-decoration:underline dotted">${target}</span>
            <span class="imm-dot"></span>
            <span id="immTime">00:00</span>
          </div>
          <div class="imm-tools">
            <button class="imm-tbtn" id="immRef">参考 ☰</button>
            <button class="imm-tbtn danger" id="immExit">✕ 退出</button>
          </div>
        </div>

        <div class="imm-stage">
          <textarea class="imm-prose" id="prose" placeholder="沉浸下来，只写这一场。&#10;左侧参考随时呼出（参考 ☰），按 Esc 退出沉浸。">${esc(this.st.prose || '')}</textarea>
        </div>

        <div class="imm-drawer" id="immDrawer">
          <div class="imm-drawer-head">
            <span>写作参考</span>
            <button class="imm-tbtn ghost" id="immDrawerCls">收起 ✕</button>
          </div>
          <div class="imm-drawer-body">${this.buildRef()}</div>
        </div>
      </div>`;

    const ta = $('#prose');
    ta.addEventListener('input', (e) => {
      this.st.prose = e.target.value;
      const w = (e.target.value || '').replace(/\s/g, '').length;
      const wEl = $('#immWords');
      if (wEl) {
        wEl.textContent = w;
        wEl.style.color = w >= (this.st.target || 3000) ? 'var(--jade)' : 'var(--ink)';
      }
    });
    const w0 = (this.st.prose || '').replace(/\s/g, '').length;
    const wEl0 = $('#immWords');
    if (wEl0) {
      wEl0.textContent = w0;
      wEl0.style.color = w0 >= target ? 'var(--jade)' : 'var(--ink)';
    }

    $('#immExit').onclick = () => this.exitImmersive();
    $('#immRef').onclick = () => $('#immDrawer').classList.toggle('open');
    $('#immDrawerCls').onclick = () => $('#immDrawer').classList.remove('open');
    $('#immTarget').onclick = () => {
      const v = prompt('这一场的目标字数', this.st.target || 3000);
      if (v == null) return;
      const n = Math.max(200, Number(v) || 3000);
      this.st.target = n;
      $('#immTarget').textContent = n;
    };

    // 计时器
    this._immStart = Date.now();
    if (this._immTimer) clearInterval(this._immTimer);
    this._immTimer = setInterval(() => {
      const s = Math.floor((Date.now() - this._immStart) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      const t = $('#immTime');
      if (t) t.textContent = mm + ':' + ss;
    }, 1000);

    // Esc 退出
    this._immKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.exitImmersive(); } };
    document.addEventListener('keydown', this._immKey);
  },

  buildRef() {
    const s = this.st.scene;
    const cast = this.castChars();
    const core = (Store.data.world.entries || []).filter((e) => Number(e.weight) >= 3);
    const sums = (Store.data.memory.summaries || []).slice(-4).reverse();

    const goalHtml =
      s.goal || s.conflict
        ? `<div class="imm-sec">
            <div class="imm-sec-h">本场任务</div>
            ${s.goal ? `<div class="small"><b>要发生什么：</b>${esc(s.goal)}</div>` : ''}
            ${s.conflict ? `<div class="small" style="margin-top:4px"><b>核心冲突：</b>${esc(s.conflict)}</div>` : ''}
          </div>`
        : '';

    const castHtml = cast.length
      ? cast
          .map(
            (c) => `<div class="imm-cc" style="--c:${c.color || '#a63a2a'}">
              <div class="imm-cc-av">${esc((c.name || '?').slice(0, 1))}</div>
              <div class="imm-cc-info">
                <div class="imm-cc-name">${esc(c.name)} <span class="imm-cc-role">${esc(c.role || '')}</span></div>
                <div class="imm-cc-traits">${esc(c.lock && c.lock.traits && c.lock.traits.length ? c.lock.traits.join(' · ') : '尚未设定性格锁')}</div>
              </div>
            </div>`
          )
          .join('')
      : '<div class="muted small">本场没有在场人物</div>';

    const coreHtml = core.length
      ? core
          .map(
            (e) => `<div class="imm-rule">
              <span class="imm-rule-star">★★★</span>
              <div><b>${esc(e.name)}</b><span class="muted small"> ${esc(e.cat || '')}</span>
              <div class="small">${esc(e.desc || '')}</div></div>
            </div>`
          )
          .join('')
      : '<div class="muted small">还没有核心设定（去世界观给重要条目标 ★★★）</div>';

    const sumHtml = sums.length
      ? sums.map((m) => `<div class="imm-sum">${esc(m.text)}</div>`).join('')
      : '<div class="muted small">还没有存过正文，前文提要会在你「存入正文库」后出现</div>';

    return `
      ${goalHtml}
      <div class="imm-sec">
        <div class="imm-sec-h">本场人物（${cast.length}）</div>
        <div class="imm-cc-list">${castHtml}</div>
      </div>
      <div class="imm-sec">
        <div class="imm-sec-h">核心设定 · ★★★ 不可违背</div>
        ${coreHtml}
      </div>
      <div class="imm-sec">
        <div class="imm-sec-h">前文提要</div>
        ${sumHtml}
      </div>`;
  },

  /* ---------- 左栏 ---------- */
  renderCtrl() {
    const box = $('#ctrl');
    if (!box) return;
    const s = this.st.scene;
    const chars = Store.data.characters;
    const place = s.placeId ? Store.place(s.placeId) : null;
    const items = place && Array.isArray(place.items) ? place.items : [];
    const pathHint = $('#pathHint');
    if (pathHint) pathHint.textContent = this._path ? '来自大纲' : '自由场景';

    box.innerHTML = `
      <label class="fld"><span>场景名</span>
        <input type="text" id="scTitle" value="${esc(s.title || '')}" placeholder="这一场叫什么"></label>

      <label class="fld"><span>地点</span>
        <select id="scPlace" data-place-ref title="可选章节场景，也可直接引用地图上的地名">
          ${Store.placeSelectOptions(s.placeId)}
        </select></label>

      ${
        items.length
          ? `<label class="fld"><span>此地道具（点一下写进目标）</span>
              <div class="chips" id="scItems">
                ${items
                  .map((m) => `<span class="chip" data-item="${esc(m.id || m.name)}" title="${esc(m.desc || '')}" style="cursor:pointer;--c:#a97f2f">物 ${esc(m.name)}</span>`)
                  .join('')}
              </div></label>`
          : ''
      }

      <label class="fld"><span>在场人物</span>
        <div class="cast-pick" id="scCast">
          ${chars.map((c) => `<span class="pick ${(s.cast || []).includes(c.id) ? 'on' : ''}" data-cid="${c.id}" style="--c:${c.color || '#a63a2a'}">${esc(c.name)}</span>`).join('') || '<span class="small muted">还没有人物</span>'}
        </div></label>

      <div class="ask-entry">
        <button class="btn sm" id="btnAskChar" title="以作者身份向人物提问">✎ 问一个人物</button>
        <span class="small muted">按性格锁与知识边界作答</span>
      </div>

      <label class="fld"><span>这场戏要发生什么（一句就够）</span>
        <textarea id="scGoal" rows="3" placeholder="例：沈砚来问第二个失踪者的下落，阿苏不肯说">${esc(s.goal || '')}</textarea></label>

      <label class="fld"><span>核心冲突</span>
        <textarea id="scConflict" rows="2" placeholder="谁和谁在争什么">${esc(s.conflict || '')}</textarea></label>

      <label class="fld"><span>对话轮数</span>
        <input type="number" id="scTurns" min="2" max="30" value="${this.st.maxTurns}"></label>

      <div class="divider"></div>

      <div style="display:flex;flex-direction:column;gap:7px">
        <button class="btn primary" id="btnRun">▶ 开演</button>
        <div style="display:flex;gap:7px">
          <button class="btn" id="btnStep" style="flex:1">下一轮</button>
          <button class="btn jade" id="btnNarrate" style="flex:1">✎ 成文</button>
        </div>
        <button class="btn ghost" id="btnStop" style="display:none">■ 停止</button>
      </div>
      <div class="small muted" style="margin-top:10px;line-height:1.7">
        开演＝导演点名 → 角色自己反应，循环 ${this.st.maxTurns} 轮。<br>
        成文＝叙事者把对话改写成小说正文。
      </div>`;

    const s2 = this.st.scene;
    $('#scTitle').oninput = (e) => {
      s2.title = e.target.value;
      if (this._path) Store.touch();
    };
    $('#scPlace').onchange = (e) => {
      s2.placeId = e.target.value;
      if (this._path) Store.touch();
      this.renderCtrl();
    };
    $('#btnAskChar').onclick = () => this.askChar();
    const itBox = box.querySelector('#scItems');
    if (itBox) {
      itBox.querySelectorAll('[data-item]').forEach((chip) => {
        chip.onclick = () => {
          const p = Store.place(s2.placeId);
          const m = p && (p.items || []).find((x) => (x.id || x.name) === chip.dataset.item);
          if (!m) return;
          const piece = `【道具：${m.name}】`;
          if ((s2.goal || '').includes(piece)) return toast('这条已经在目标里了');
          s2.goal = (s2.goal ? s2.goal.replace(/\s*$/, '') + ' ' : '') + piece + (m.desc ? m.desc : '');
          const ta = $('#scGoal');
          if (ta) ta.value = s2.goal;
          if (this._path) Store.touch();
          toast('已写入场景目标');
        };
      });
    }
    $('#scGoal').oninput = (e) => {
      s2.goal = e.target.value;
      if (this._path) Store.touch();
    };
    $('#scConflict').oninput = (e) => {
      s2.conflict = e.target.value;
      if (this._path) Store.touch();
    };
    $('#scTurns').onchange = (e) => {
      this.st.maxTurns = Math.max(2, Number(e.target.value) || 6);
      this.updateBtns();
    };
    box.querySelectorAll('#scCast .pick').forEach((p) => {
      p.onclick = () => {
        p.classList.toggle('on');
        s2.cast = Array.from(box.querySelectorAll('#scCast .pick.on')).map((x) => x.dataset.cid);
        if (this._path) Store.touch();
      };
    });
    $('#btnRun').onclick = () => this.runAll();
    $('#btnStep').onclick = () => this.step();
    $('#btnNarrate').onclick = () => this.narrate();
    $('#btnStop').onclick = () => {
      this.st.running = false;
      toast('本轮结束后停止');
    };
  },

  updateBtns() {
    const run = $('#btnRun');
    if (!run) return;
    const st = this.st;
    const busy = st.running || st.busy;
    run.disabled = busy;
    $('#btnStep').disabled = busy;
    $('#btnNarrate').disabled = busy;
    $('#btnStop').style.display = st.running ? 'block' : 'none';
    const ti = $('#turnInfo');
    if (ti) ti.textContent = `第 ${st.turn} / ${st.maxTurns} 轮`;
  },

  /* ---------- 中栏 ---------- */
  renderFeed() {
    const feed = $('#feed');
    if (!feed) return;
    if (!this.st.lines.length) {
      feed.innerHTML = `<div class="empty" style="padding:40px 16px">
        <h3 style="font-size:15px">还没有人开口</h3>
        <p class="small">填好左边的「这场戏要发生什么」，然后点开演。<br>角色会按各自的性格锁互相反应。</p>
      </div>`;
      return;
    }
    feed.innerHTML = this.st.lines.map((l, i) => this.lineHtml(l, i)).join('');
    feed.scrollTop = feed.scrollHeight;
  },

  lineHtml(l, i) {
    if (l.kind === 'dir') return `<div class="line dir"><div class="bubble"><div class="txt">${esc(l.text)}</div></div></div>`;
    if (l.kind === 'author') return `<div class="line author"><div class="bubble"><div class="txt">作者：${esc(l.text)}</div></div></div>`;
    return `<div class="line" data-i="${i}">
      <div class="bubble">
        <div class="who" style="--c:${l.color || 'var(--accent)'}"><span class="dot"></span>${esc(l.speaker)}</div>
        <div class="txt">${esc(l.text)}</div>
      </div>
    </div>`;
  },

  pushLine(l) {
    this.st.lines.push(l);
    const feed = $('#feed');
    if (!feed) return null;
    if (this.st.lines.length === 1) feed.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.innerHTML = this.lineHtml(l, this.st.lines.length - 1);
    const node = wrap.firstElementChild;
    feed.appendChild(node);
    feed.scrollTop = feed.scrollHeight;
    return node.querySelector('.txt');
  },

  /* ---------- 引擎 ---------- */
  /** 作者访谈：人物知道自己是书中人，与作者合作把设定聊清楚；纯台词、不编造、不加戏 */
  askChar(prefId) {
    const chars = Store.data.characters;
    if (!chars.length) return toast('先建几个人物，才有人可问', 'err');
    const cast = (this.st.scene.cast || []).filter((id) => Store.char(id));
    const def = (prefId && Store.char(prefId)) ? prefId : (cast[0] || chars[0].id);
    let showLegacy = false;

    const mask = Modal.open({
      title: '问人物 · 作者访谈',
      wide: true,
      body: `<div class="ask-wrap">
        <div class="ask-bar">
          <label class="fld"><span>问谁</span>
            <select id="askWho">${chars.map((c) => `<option value="${c.id}" ${c.id === def ? 'selected' : ''}>${esc(c.name || '未命名')}${c.role ? ' · ' + esc(c.role) : ''}</option>`).join('')}</select></label>
          <span class="small muted">他知道自己是书里的人物，和你一起把设定聊清楚；只回台词，不编没写过的事</span>
          <button class="btn sm ghost" id="askClear">清空这段问答</button>
        </div>
        <div class="ask-log" id="askLog"></div>
        <div class="ask-input">
          <textarea id="askQ" rows="2" placeholder="问一个设定，例：你们当初是怎么认识的？"></textarea>
          <button class="btn primary" id="askSend">提问</button>
        </div>
        <div class="hint">像微信一样聊天，他只输出台词，没有动作、神态和旁白。没写进设定里的，他会说「你还没写」，不会自己编，也不会加戏。Enter 发送，Shift + Enter 换行。</div>
      </div>`,
      footer: `<button class="btn" data-done>关闭</button>`
    });

    const sel = mask.querySelector('#askWho');
    const logBox = mask.querySelector('#askLog');
    const input = mask.querySelector('#askQ');
    const btn = mask.querySelector('#askSend');
    const draw = (pending) => {
      const c = Store.char(sel.value);
      const name = c ? (c.name || '未命名') : '角色';
      const col = c ? (c.color || '#a63a2a') : '#8a8378';
      const log = Store.interviewLog(sel.value);
      const legacy = log.filter((h) => !h || h.v !== 2);
      const current = log.filter((h) => h && h.v === 2);
      const one = (text, who, cls, wait) => `<div class="ask-msg ${cls} ${wait ? 'ask-pending' : ''}" style="--c:${col}">
          <span class="ask-who">${esc(who)}</span>
          <div class="ask-bubble">${esc(text || (wait ? '……' : ''))}</div>
        </div>`;
      let html = '';
      if (legacy.length) {
        html += `<div class="ask-legacy">有 ${legacy.length} 条旧版问答（旧规则下产生，含动作与临场发挥），已不再参与之后的对话。
          <button class="btn sm ghost" id="askLegacyToggle">${showLegacy ? '收起旧问答' : '查看旧问答'}</button>
          <button class="btn sm ghost" id="askLegacyDrop">清空重来</button></div>`;
      }
      const shown = showLegacy ? log : current;
      html += shown.map((h) => one(h.q, '作者', 'q') + one(cleanInterviewSpeech(h.a, name), name, 'a')).join('');
      if (!shown.length && !pending) {
        html += `<div class="ask-empty">${legacy.length
          ? '旧版问答已收起。点「清空重来」开始新访谈，或直接在下面提问。'
          : '还没有问过。挑一个人，写下你想问的事。'}</div>`;
      }
      if (pending) html += one(pending.q, '作者', 'q') + one('', name, 'a', true);
      logBox.innerHTML = html;
      logBox.scrollTop = logBox.scrollHeight;
    };
    draw();

    logBox.addEventListener('click', (e) => {
      if (e.target.closest('#askLegacyToggle')) { showLegacy = !showLegacy; draw(); return; }
      if (e.target.closest('#askLegacyDrop')) {
        Store.interviews()[sel.value] = Store.interviewLog(sel.value).filter((h) => h && h.v === 2);
        Store.touch();
        showLegacy = false;
        draw();
        toast('旧版问答已清空');
      }
    });
    sel.onchange = () => { showLegacy = false; draw(); input.focus(); };
    mask.querySelector('#askClear').onclick = () => {
      if (!Store.interviewLog(sel.value).length) return;
      if (!confirm('清空与这位人物的全部问答？')) return;
      Store.clearInterview(sel.value);
      showLegacy = false;
      draw();
    };

    const send = async () => {
      const q = input.value.trim();
      if (!q) return;
      if (!Store.settings.baseUrl) return toast('还没配置 API，请到「设置」里填', 'err');
      const c = Store.char(sel.value);
      if (!c) return;
      const history = Store.interviewContext(c.id);
      input.value = '';
      btn.disabled = true;
      btn.textContent = '正在回…';
      draw({ q });
      try {
        const messages = Prompts.askCharacter({ char: c, scene: this.st.scene, history, question: q });
        const a = await LLM.chat({ messages, temperature: 0.5, maxTokens: 300, usage: 'interview' });
        const clean = cleanInterviewSpeech(a, c.name || '') || String(a || '').trim();
        Store.pushInterview(c.id, q, clean);
        draw();
      } catch (e) {
        input.value = q;
        toast(e.message || '提问失败', 'err');
        draw();
      } finally {
        btn.disabled = false;
        btn.textContent = '提问';
        input.focus();
      }
    };
    btn.onclick = send;
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    mask.querySelector('[data-done]').onclick = () => Modal.close();
    input.focus();
  },

  castChars() {
    return (this.st.scene.cast || []).map((id) => Store.char(id)).filter(Boolean);
  },

  async step() {
    AIUndo.label('写作 · AI 演出');
    const st = this.st;
    if (st.busy) return false;
    const cast = this.castChars();
    if (cast.length < 1) {
      toast('先选在场人物', 'err');
      st.running = false;
      return false;
    }
    if (!Store.settings.baseUrl) {
      toast('还没配置 API，请到「设置」里填', 'err');
      st.running = false;
      return false;
    }

    st.busy = true;
    this.updateBtns();
    try {
      // 1. 导演点名
      let d = { speaker: cast[0].name, goal: '', note: '' };
      try {
        const o = await LLM.json({
          messages: Prompts.director({
            scene: st.scene,
            transcript: st.lines,
            turns: st.turn,
            maxTurns: st.maxTurns,
            directive: st.directive
          }),
          temperature: 0.75,
          maxTokens: 260,
          usage: 'interview'
        });
        const hit = cast.find((c) => c.name === o.speaker) || cast.find((c) => o.speaker && o.speaker.includes(c.name));
        d = { speaker: (hit || cast[0]).name, goal: o.goal || '', note: o.note || '' };
      } catch (e) {
        d.speaker = cast[Math.floor(Math.random() * cast.length)].name;
      }
      const ch = cast.find((c) => c.name === d.speaker) || cast[0];
      this.pushLine({ kind: 'dir', text: `导演：让${ch.name}${d.goal ? '——' + d.goal : '开口'}` });

      // 2. 角色反应
      const txtEl = this.pushLine({ kind: 'line', speaker: ch.name, text: '', color: ch.color });
      if (txtEl) txtEl.classList.add('typing');
      let acc = '';
      const content = await LLM.chat({
        messages: Prompts.characterSpeak({
          char: ch,
          scene: st.scene,
          transcript: st.lines.filter((l) => l.kind !== 'dir'),
          directive: st.directive,
          note: d.note
        }),
        temperature: 0.92,
        maxTokens: 420,
        stream: true,
        usage: 'interview',
        onDelta: (piece, full) => {
          acc = full;
          if (txtEl) txtEl.textContent = full;
          const feed = $('#feed');
          if (feed) feed.scrollTop = feed.scrollHeight;
        }
      });
      if (txtEl) txtEl.classList.remove('typing');
      const finalText = (content || acc || '').trim();
      st.lines[st.lines.length - 1].text = finalText;
      if (txtEl) txtEl.textContent = finalText;
      st.turn++;
      this.updateBtns();
      return true;
    } catch (e) {
      toast(e.message, 'err');
      st.running = false;
      return false;
    } finally {
      st.busy = false;
      this.updateBtns();
    }
  },

  async runAll() {
    const st = this.st;
    if (st.running) return;
    st.running = true;
    this.updateBtns();
    while (st.running && st.turn < st.maxTurns) {
      const ok = await this.step();
      if (!ok) break;
    }
    st.running = false;
    this.updateBtns();
    if (st.turn >= st.maxTurns) toast('演完了，可以点「成文」');
  },

  inject() {
    const inp = $('#authorSay');
    const v = inp.value.trim();
    if (!v) return;
    this.pushLine({ kind: 'author', text: v });
    this.st.directive = v;
    inp.value = '';
  },

  async narrate() {
    const st = this.st;
    if (st.busy) return;
    if (!st.lines.filter((l) => l.kind === 'line').length) return toast('还没有对话可以成文', 'err');
    st.busy = true;
    this.updateBtns();
    const ta = $('#prose');
    const head = st.prose && !st.prose.endsWith('\n') ? st.prose + '\n\n' : st.prose;
    const base = st.prose ? head : '';
    if (ta) ta.value = base;
    try {
      const full = await LLM.chat({
        messages: Prompts.narrator({ scene: st.scene, transcript: st.lines, previous: st.prose, directive: st.directive }),
        temperature: 0.9,
        maxTokens: 2600,
        stream: true,
        usage: 'polish',
        onDelta: (piece, all) => {
          if (ta) {
            ta.value = base + all;
            ta.scrollTop = ta.scrollHeight;
          }
        }
      });
      st.prose = base + full;
      if (ta) ta.value = st.prose;
      toast('正文已生成');
    } catch (e) {
      toast(e.message, 'err');
    }
    st.busy = false;
    this.updateBtns();
  },

  /* ---------- 正文库 ---------- */
  saveChapter() {
    const text = this.st.prose.trim();
    if (!text) return toast('正文还是空的', 'err');
    const title = this.st.scene.title || '未命名章节';
    Store.data.manuscript.push({
      id: uid('ms'),
      title,
      sceneId: this.st.scene.id || '',
      text,
      words: text.replace(/\s/g, '').length,
      createdAt: new Date().toISOString()
    });
    // 生成记忆摘要
    LLM.chat({ messages: Prompts.summarize({ scene: this.st.scene, prose: text }), temperature: 0.5, maxTokens: 300 })
      .then((sum) => {
        Store.data.memory.summaries.push({ text: sum.trim(), sceneId: this.st.scene.id, at: new Date().toISOString() });
        Store.touch();
      })
      .catch(() => {});
    Store.touch();
    toast('已存入正文库（' + text.replace(/\s/g, '').length + ' 字）');
  },

  showManuscripts() {
    const list = Store.data.manuscript;
    const mask = Modal.open({
      title: '正文库',
      wide: true,
      body: list.length
        ? `<div>${list
            .map(
              (m, i) => `<div class="manu-item" data-i="${i}">
              <h4>${esc(m.title)}</h4>
              <p>${esc((m.text || '').slice(0, 90))}…</p>
              <div class="small muted" style="margin-top:5px">${m.words || 0} 字 · ${new Date(m.createdAt).toLocaleString('zh-CN')}</div>
            </div>`
            )
            .join('')}</div>`
        : '<div class="empty"><h3>还没有存过正文</h3><p class="small">在写作台点「存入正文库」</p></div>',
      footer: `<button class="btn" id="exportTxt">导出全书 TXT</button><div style="flex:1"></div><button class="btn" data-x>关闭</button>`
    });
    mask.querySelector('[data-x]').onclick = () => Modal.close();
    mask.querySelector('#exportTxt').onclick = () => {
      const all = list.map((m) => '## ' + m.title + '\n\n' + m.text).join('\n\n\n');
      const blob = new Blob([`《${Store.data.meta.title}》\n\n` + all], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = Store.data.meta.title + '.txt';
      a.click();
    };
    mask.querySelectorAll('.manu-item').forEach((it) => {
      it.onclick = () => {
        const m = list[Number(it.dataset.i)];
        this.st.prose = m.text;
        const ta = $('#prose');
        if (ta) ta.value = m.text;
        Modal.close();
        toast('已载入：' + m.title);
      };
    });
  },

  pickScene() {
    const vols = Store.data.outline.volumes || [];
    const rows = [];
    vols.forEach((v, vi) =>
      (v.chapters || []).forEach((c, ci) =>
        (c.scenes || []).forEach((s, si) => rows.push({ v: v.title, c: c.title, s, path: [vi, ci, si] }))
      )
    );
    const mask = Modal.open({
      title: '选择场景',
      body: rows.length
        ? rows
            .map(
              (r, i) => `<div class="manu-item" data-i="${i}">
            <h4>${esc(r.s.title || '未命名场景')}</h4>
            <p>${esc(r.v)} / ${esc(r.c)} · ${esc(Store.placeName(r.s.placeId))} · ${(r.s.cast || []).length}人</p>
          </div>`
            )
            .join('')
        : '<div class="empty"><h3>大纲里还没有场景</h3><p class="small">先去「大纲」建一个，或直接用自由场景</p></div>',
      footer: `<button class="btn" data-x>关闭</button>`
    });
    mask.querySelector('[data-x]').onclick = () => Modal.close();
    mask.querySelectorAll('.manu-item').forEach((it) => {
      it.onclick = () => {
        const r = rows[Number(it.dataset.i)];
        this.st.scene = r.s;
        this._path = r.path;
        this.st.lines = [];
        this.st.turn = 0;
        this.st.prose = '';
        Modal.close();
        App.params = null;
        App.rerender();
      };
    });
  }
};
