/* ============ view-props.js —— 全书道具库 ============
   道具实体分散存于：人物 items / 地点 items / 无主池 props。
   本页是统一入口：新建、改名、改类别、改归属、写来历、删除，改动即时落盘。
   ==================================================== */
window.Views = window.Views || {};

const PROP_CATS = [
  { key: '法宝', color: '#7a4b8c' },
  { key: '兵器', color: '#a63a2a' },
  { key: '信物', color: '#a97f2f' },
  { key: '丹药', color: '#3d8a6b' },
  { key: '材料', color: '#5b6f8c' },
  { key: '典籍', color: '#4a6b4a' },
  { key: '财货', color: '#b06a3b' },
  { key: '器物', color: '#6a5a4a' },
  { key: '其他', color: '#8a8378' }
];
const PROP_CAT_MAP = {};
PROP_CATS.forEach((c) => (PROP_CAT_MAP[c.key] = c));
const propColor = (k) => (PROP_CAT_MAP[k] || { color: '#b9b2a6' }).color;

Views.props = {
  title: '道具',
  sub: '全书道具库 · 归属 / 来历 / 出处',
  _q: '',
  _cat: '__all',
  _holder: '__all',

  actions() {
    return `<button class="btn" id="btnPropHint" title="道具会进入写作提示词，写场景时角色不会凭空多出东西">道具会进提示词</button>
            <button class="btn primary" id="btnNewProp">+ 新建道具</button>`;
  },

  mount(el) {
    el.innerHTML = `
      <div class="prop-toolbar">
        <input type="search" id="propQ" placeholder="搜道具名、描述、出处…" autocomplete="off" value="${esc(this._q)}">
        <select id="propCat">
          <option value="__all">全部类别</option>
          <option value="__none">未分类</option>
          ${PROP_CATS.map((c) => `<option value="${c.key}">${c.key}</option>`).join('')}
        </select>
        <select id="propHolder">
          <option value="__all">全部归属</option>
          <option value="none">未定位 / 无主</option>
          <option value="char">人物持有</option>
          <option value="place">地点存放</option>
        </select>
        <div class="prop-stat" id="propStat"></div>
      </div>
      <div id="propBody"></div>`;
    el.querySelector('#propCat').value = this._cat;
    el.querySelector('#propHolder').value = this._holder;
    el.querySelector('#propQ').addEventListener('input', (e) => { this._q = e.target.value; this.refresh(); });
    el.querySelector('#propCat').addEventListener('change', (e) => { this._cat = e.target.value; this.refresh(); });
    el.querySelector('#propHolder').addEventListener('change', (e) => { this._holder = e.target.value; this.refresh(); });
    const nb = $('#btnNewProp');
    if (nb) nb.onclick = () => this.create();
    const hb = $('#btnPropHint');
    if (hb) hb.onclick = () => toast('道具会随人物与地点一起进入写作提示词');
    this.refresh();
  },

  /** 局部重绘列表：不动工具条、不丢焦点 */
  refresh() {
    const host = $('#propBody');
    if (!host) return;
    const all = Store.propList();
    const q = String(this._q || '').trim().toLowerCase();
    const list = all.filter((e) => {
      const it = e.item || {};
      if (this._holder !== '__all' && e.holderType !== this._holder) return false;
      if (this._cat === '__none' ? !!it.category : (this._cat !== '__all' && it.category !== this._cat)) return false;
      if (!q) return true;
      const hay = [it.name, it.desc, it.source, it.note, it.context, it.category, e.holderName].join(' ').toLowerCase();
      return hay.includes(q);
    });
    const stat = $('#propStat');
    if (stat) {
      const none = all.filter((e) => e.holderType === 'none').length;
      const cats = new Set(all.map((e) => e.item.category).filter(Boolean)).size;
      stat.innerHTML = `<span>共 <b>${all.length}</b> 件道具</span><i></i><span><b>${none}</b> 件无主</span><i></i><span><b>${cats}</b> 类</span>${list.length !== all.length ? `<i></i><span>筛出 <b>${list.length}</b> 件</span>` : ''}`;
    }

    if (!all.length) {
      host.innerHTML = `<div class="empty prop-empty">
        <div class="pe-seal">具</div>
        <h3>还没有登记道具</h3>
        <p class="small">法器、信物、丹药、典籍……在这里建卡，指定谁持有或放在哪个地点。<br>也可以从「书源」导入小说，自动按首次出现登记。</p>
        <div style="margin-top:16px;display:flex;gap:8px;justify-content:center">
          <button class="btn primary" id="peNew">+ 新建道具</button>
          <button class="btn" id="peImport">去书源导入</button>
        </div></div>`;
      host.querySelector('#peNew').onclick = () => this.create();
      host.querySelector('#peImport').onclick = () => App.go('import');
      return;
    }
    if (!list.length) {
      host.innerHTML = `<div class="empty"><h3>没有匹配的道具</h3><p class="small">换个关键词，或把筛选调回「全部」。</p></div>`;
      return;
    }

    host.innerHTML = `<div class="prop-grid">${list.map((e) => {
      const it = e.item;
      const col = propColor(it.category);
      const holderText = e.holderType === 'char' ? '在 ' + e.holderName + ' 身上'
        : e.holderType === 'place' ? '在 ' + e.holderName : '未定位 / 无主';
      return `<div class="prop-card" style="--c:${col}" data-id="${esc(it.id)}">
        <div class="pc-top">
          <span class="pc-cat">${esc(it.category || '未分类')}</span>
          <span class="pc-holder ${e.holderType}">${esc(holderText)}</span>
        </div>
        <div class="pc-name">${esc(it.name || '未命名道具')}</div>
        <div class="pc-desc">${esc(it.desc || '还没有写它是什么、谁会用、有什么来历。')}</div>
        <div class="pc-foot">
          ${it.source ? `<span class="pc-meta">出处 · ${esc(it.source)}</span>` : ''}
          ${it.context ? `<span class="pc-meta">原文 · ${esc(it.context)}</span>` : ''}
          ${it.note ? `<span class="pc-meta">备注 · ${esc(it.note)}</span>` : ''}
          ${it.manual ? '<span class="pc-manual">手动登记</span>' : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
    host.querySelectorAll('.prop-card').forEach((card) => {
      card.onclick = () => this.edit(card.dataset.id);
    });
  },

  /* ---------------- 新建 / 编辑 ---------------- */
  create(preset) { this.editor(null, preset || null); },

  edit(id) {
    const e = Store.propGet(id);
    if (!e) return toast('没找到这件道具，可能已被删除', 'err');
    this.editor(e);
  },

  holderOptions(sel) {
    const cur = sel || 'none';
    const chars = Store.data.characters || [];
    const places = Store.data.map.nodes || [];
    return `<option value="none" ${cur === 'none' ? 'selected' : ''}>未定位 / 无主</option>
      ${chars.length ? `<optgroup label="人物持有">${chars.map((c) => `<option value="char:${c.id}" ${cur === 'char:' + c.id ? 'selected' : ''}>${esc(c.name || '未命名')}</option>`).join('')}</optgroup>` : ''}
      ${places.length ? `<optgroup label="地点存放">${places.map((n) => `<option value="place:${n.id}" ${cur === 'place:' + n.id ? 'selected' : ''}>${esc(n.name || '未命名地点')}</option>`).join('')}</optgroup>` : ''}`;
  },

  editor(entry, preset) {
    const isNew = !entry;
    const it = isNew ? { name: '', category: '', desc: '', source: '', context: '', note: '' } : entry.item;
    const holderSel = isNew
      ? (preset ? preset.type + ':' + (preset.id || '') : 'none')
      : entry.holderType + ':' + (entry.holderId || '');
    const mask = Modal.open({
      title: isNew ? '新建道具' : '道具设定',
      wide: true,
      onClose: () => this.refresh(),
      body: `
        <div class="row" style="margin-bottom:14px">
          <label class="fld" style="flex:1.4"><span>名称 <em class="req">*</em></span>
            <input type="text" data-k="name" value="${esc(it.name || '')}" placeholder="例：东皇钟、断锋剑、青玉令牌" autocomplete="off"></label>
          <label class="fld" style="flex:1"><span>类别</span>
            <select data-k="category">
              <option value="">未分类</option>
              ${PROP_CATS.map((c) => `<option value="${c.key}" ${it.category === c.key ? 'selected' : ''}>${c.key}</option>`).join('')}
            </select></label>
          <label class="fld" style="flex:1.2"><span>归属 / 存放位置</span>
            <select data-k="holder">${this.holderOptions(holderSel === 'none:' ? 'none' : holderSel)}</select></label>
        </div>
        <label class="fld"><span>描述（会进写作提示词）</span>
          <textarea data-k="desc" rows="3" placeholder="它是什么、长什么样、谁会用、有什么来历与限制">${esc(it.desc || '')}</textarea></label>
        <div class="row">
          <label class="fld"><span>首次出现 / 出处</span>
            <input type="text" data-k="source" value="${esc(it.source || '')}" placeholder="例：第三章 · 不周山深处"></label>
          <label class="fld"><span>原文依据</span>
            <input type="text" data-k="context" value="${esc(it.context || '')}" placeholder="原文短句，可留空"></label>
        </div>
        <label class="fld" style="margin-bottom:0"><span>备注（伏笔、限制、后续去向）</span>
          <textarea data-k="note" rows="2" placeholder="例：只有血脉相符者能催动，结局前不可现世">${esc(it.note || '')}</textarea></label>
        <div class="prop-editor-hint">${isNew
          ? '填好点「创建道具」。也可以在人物档案 / 地点卡片里就地登记，两边数据互通。'
          : '改动即时保存，不用退出重进；换归属会自动把它从原持有者移到新位置。'}</div>
      `,
      footer: isNew
        ? `<button class="btn" id="peCancel">取消</button><div style="flex:1"></div><button class="btn primary" id="peGo">创建道具</button>`
        : `<button class="btn danger" id="peDel">删除道具</button><div style="flex:1"></div><button class="btn primary" id="peGo">完成</button>`
    });

    const fields = {};
    mask.querySelectorAll('[data-k]').forEach((el) => (fields[el.dataset.k] = el));
    const read = () => {
      const h = String(fields.holder.value || 'none').split(':');
      return {
        patch: {
          name: fields.name.value.trim(),
          category: fields.category.value,
          desc: fields.desc.value.trim(),
          source: fields.source.value.trim(),
          context: fields.context.value.trim(),
          note: fields.note.value.trim()
        },
        type: h[0] === 'char' || h[0] === 'place' ? h[0] : 'none',
        hid: h[1] || ''
      };
    };
    const parseHolder = (v) => {
      const h = String(v || 'none').split(':');
      return { type: h[0] === 'char' || h[0] === 'place' ? h[0] : 'none', id: h[1] || '' };
    };

    if (isNew) {
      mask.querySelector('#peCancel').onclick = () => Modal.close();
      mask.querySelector('#peGo').onclick = () => {
        const r = read();
        if (!r.patch.name) return toast('先给道具起个名字', 'err');
        const created = Store.propAdd(r.patch, r.type, r.hid);
        Modal.close();
        this.refresh();
        toast('已登记「' + (created ? created.name : r.patch.name) + '」');
      };
      fields.name.focus();
      return;
    }

    // 编辑：文字字段即时保存；归属单独处理（需要移动实体）
    const onField = (e) => {
      const t = e.target;
      if (!t.dataset.k || t.dataset.k === 'holder') return;
      const r = read();
      Store.propSet(entry.item.id, r.patch);
      this.refresh();
    };
    mask.addEventListener('input', onField);
    mask.addEventListener('change', (e) => {
      if (e.target.dataset.k === 'holder') {
        const h = parseHolder(fields.holder.value);
        Store.propMove(entry.item.id, h.type, h.id);
        this.refresh();
        return;
      }
      onField(e);
    });
    mask.querySelector('#peGo').onclick = () => Modal.close();
    mask.querySelector('#peDel').onclick = () => {
      if (!confirm(`删除道具「${it.name || '未命名'}」？`)) return;
      Store.propRemove(entry.item.id);
      Modal.close();
      this.refresh();
      toast('已删除');
    };
  }
};
