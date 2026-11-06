/* ============ view-factions.js —— 势力分类 / 所属地 / 相互关系 ============ */
window.Views = window.Views || {};

const FACTION_COLORS = ['#a63a2a', '#3d6a58', '#5b6f8c', '#a97f2f', '#8c5a7a', '#4f7a8c', '#7d8256', '#a4633c'];
const FACTION_REL_COLORS = ['#a63a2a', '#3d6a58', '#5b6f8c', '#a97f2f', '#8c5a7a', '#4f7a8c', '#7d8256', '#a4633c'];
function facColor(i) { return FACTION_COLORS[i % FACTION_COLORS.length]; }
function facRelColor(s) {
  const k = String(s || '').trim();
  if (!k) return '#8a8378';
  let h = 0;
  for (const ch of k) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return FACTION_REL_COLORS[h % FACTION_REL_COLORS.length];
}
const fClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

Views.factions = {
  title: '势力',
  sub: '分类 · 所属地 · 相互关系',
  _sel: '',
  _mode: 'detail', // detail | graph
  _group: '',      // '' 全部 | '__none' 未分组 | 分类 id
  _zoom: 1,
  _view: { cx: 480, cy: 270 },
  _g: null,        // 关系图本次渲染的状态（坐标 / 连线 / 节点表）

  actions() {
    return `<button class="btn primary" id="btnNewFaction">+ 新建势力</button>`;
  },

  mount(el) {
    // 所属地要读当前这本书的地图地名；地图页可能还没打开过
    if (window.Atlas && typeof Atlas.init === 'function') {
      if (Atlas.book() !== Store.currentBookId) Atlas.init(Store.currentBookId);
      Atlas.ready().then(() => { if ($('#facMain')) this.refresh(); });
    }
    const list = Store.factions();
    if (!this._sel || !Store.faction(this._sel)) this._sel = list.length ? list[0].id : '';
    el.innerHTML = `<div class="fac-layout">
        <aside class="fac-side" id="facSide"></aside>
        <div class="fac-main" id="facMain"></div>
      </div>`;
    $('#btnNewFaction').onclick = () => this.create();
    el.querySelector('#facSide').addEventListener('click', (e) => {
      const c = e.target.closest('[data-fid]');
      if (c) { this._sel = c.dataset.fid; this._mode = 'detail'; this.refresh(); return; }
      const g = e.target.closest('[data-grp]');
      if (g) { this._group = g.dataset.grp; this.refresh(); return; }
      if (e.target.closest('#facSideAdd')) return this.create();
      if (e.target.closest('#facGroupManage')) return this.manageGroups();
      if (e.target.closest('#facGraphBtn')) { this._mode = 'graph'; this.refresh(); }
    });
    this.refresh();
  },

  /** 当前分类下可见的势力；关系图也用这份，保证两边一致 */
  visibleFactions() {
    const all = Store.factions();
    if (!this._group) return all;
    if (this._group === '__none') return all.filter((f) => !Store.factionGroupOf(f));
    return all.filter((f) => f.groupId === this._group);
  },
  defaultGroup() {
    return (this._group && this._group !== '__none' && Store.factionGroup(this._group)) ? this._group : '';
  },

  refresh() {
    const side = $('#facSide'), main = $('#facMain');
    if (!side || !main) return;
    const all = Store.factions();
    if (!this._sel || !Store.faction(this._sel)) this._sel = all.length ? all[0].id : '';
    if (this._group && this._group !== '__none' && !Store.factionGroup(this._group)) this._group = '';
    const groups = Store.factionGroups();
    const counts = {};
    let none = 0;
    all.forEach((f) => {
      const g = Store.factionGroupOf(f);
      if (g) counts[g.id] = (counts[g.id] || 0) + 1;
      else none++;
    });
    const chip = (val, label, n, color) =>
      `<button class="fg-chip ${this._group === val ? 'on' : ''}" data-grp="${val}" ${color ? `style="--gc:${color}"` : ''}>${color ? '<i></i>' : ''}${label}<b>${n}</b></button>`;
    const item = (f) => {
      const i = all.indexOf(f);
      const places = (f.places || []).length, rels = (f.relations || []).length;
      return `<div class="fs-item ${this._sel === f.id ? 'on' : ''}" data-fid="${f.id}" style="--c:${facColor(i)}">
          <i></i><div style="min-width:0">
            <div class="fs-name">${esc(f.name || '未命名势力')}</div>
            <div class="fs-meta">${places} 处属地 · ${rels} 段关系 · ${((f.links && f.links.chars) || []).length} 位成员</div>
          </div></div>`;
    };
    const section = (gid, label, color, arr) => {
      if (!arr.length && this._group === '') return '';
      if (!arr.length && this._group !== gid) return '';
      return `<div class="fg-sec">
          <button class="fg-sec-t ${this._group === gid ? 'on' : ''}" data-grp="${gid}" ${color ? `style="--gc:${color}"` : ''}>
            ${color ? '<i></i>' : ''}${label}<b>${arr.length}</b></button>
          <div class="fg-sec-body">${arr.map(item).join('') || '<div class="fg-sec-empty">这一组还没有势力</div>'}</div>
        </div>`;
    };
    const showAll = this._group === '';
    side.innerHTML = `<div class="fs-head"><span>势力划分</span><button class="btn sm" id="facSideAdd" title="新建势力">＋</button></div>
      <div class="fg-bar">
        ${chip('', '全部', all.length, '')}
        ${groups.map((g) => chip(g.id, esc(g.name || '未命名'), counts[g.id] || 0, Store.factionGroupColor(g))).join('')}
        ${none ? chip('__none', '未分组', none, '') : ''}
        <button class="fg-act" id="facGroupManage" title="改名 / 排序 / 删除分类">管理分类</button>
      </div>
      <div class="fs-list">
        ${all.length ? [
          ...(showAll ? groups.map((g) => section(g.id, esc(g.name || '未命名'), Store.factionGroupColor(g), all.filter((f) => f.groupId === g.id))) : []),
          ...(showAll || this._group === '__none' ? [section('__none', '未分组', '', all.filter((f) => !Store.factionGroupOf(f)))] : []),
          ...(!showAll && this._group !== '__none'
            ? [section(this._group, esc((Store.factionGroup(this._group) || {}).name || '未命名'),
                Store.factionGroupColor(Store.factionGroup(this._group)),
                all.filter((f) => f.groupId === this._group))]
            : [])
        ].join('') : '<div class="small muted" style="padding:10px 4px">还没有势力。<br>点右上角 ＋ 开第一个。</div>'}
      </div>
      <div class="fs-foot"><button class="btn sm" id="facGraphBtn">势力关系图 →</button></div>`;

    if (!this._sel) {
      main.innerHTML = `<div class="empty"><h3>先划分一个势力</h3>
        <p class="small">门派、族群、家族、朝堂……建好后再补所属地、成员和与其他势力的关系。</p>
        <div style="margin-top:14px"><button class="btn primary" id="facEmptyAdd">+ 新建势力</button></div></div>`;
      main.querySelector('#facEmptyAdd').onclick = () => this.create();
      return;
    }
    const f = Store.faction(this._sel);
    main.innerHTML = this._mode === 'graph' ? this.graphHtml() : this.detailHtml(f);
    if (this._mode === 'graph') this.bindGraph(main);
    else this.bindDetail(main, f);
  },

  /* ---------------- 分类管理：一行一个，改名 / 排序 / 删除 ---------------- */
  manageGroups() {
    const mask = Modal.open({
      title: '管理势力分类', narrow: true,
      onClose: () => this.refresh(),
      body: `<div class="hint" style="margin:0 0 10px">名字直接改，↑↓ 调顺序，✕ 删除。删分类不会删势力，它们只回到「未分组」。</div>
        <div id="fgList"></div>
        <div class="cg-add-row"><input type="text" id="fgNew" maxlength="20" placeholder="新分类名，回车添加"><button class="btn sm" id="fgAddBtn">+ 添加</button></div>`,
      footer: `<button class="btn primary" data-done>完成</button>`
    });
    const listHost = mask.querySelector('#fgList');
    const draw = () => {
      const gs = Store.factionGroups();
      listHost.innerHTML = gs.length ? gs.map((g, i) => `
        <div class="cg-row">
          <span class="cg-dot" style="--gc:${Store.factionGroupColor(g)}"></span>
          <input type="text" data-fg="${g.id}" value="${esc(g.name)}" maxlength="20" placeholder="分类名">
          <button class="rel-ctl" data-up="${i}" ${i === 0 ? 'disabled' : ''} title="上移">↑</button>
          <button class="rel-ctl" data-down="${i}" ${i === gs.length - 1 ? 'disabled' : ''} title="下移">↓</button>
          <button class="rel-x danger" data-del="${g.id}" title="删除分类">✕</button>
        </div>`).join('') : '<div class="rel-empty">还没有分类，在下面加一个。</div>';
    };
    draw();
    listHost.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.fg) Store.renameFactionGroup(t.dataset.fg, t.value);
    });
    const add = () => {
      const inp = mask.querySelector('#fgNew');
      const g = Store.addFactionGroup(inp.value);
      if (!g) return toast('先写个分类名', 'err');
      inp.value = ''; draw(); inp.focus();
    };
    mask.querySelector('#fgAddBtn').onclick = add;
    mask.querySelector('#fgNew').onkeydown = (e) => { if (e.key === 'Enter') add(); };
    listHost.addEventListener('click', (e) => {
      const gs = Store.factionGroups();
      const del = e.target.closest('[data-del]');
      if (del) {
        const g = Store.factionGroup(del.dataset.del);
        if (!g) return;
        const n = Store.factions().filter((f) => f.groupId === g.id).length;
        if (!confirm(`删除分类「${g.name || '未命名'}」？${n ? `\n${n} 个势力会回到「未分组」，势力本身不删除。` : ''}`)) return;
        Store.removeFactionGroup(g.id);
        if (this._group === g.id) this._group = '';
        draw(); return;
      }
      const up = e.target.closest('[data-up]');
      if (up) { const i = Number(up.dataset.up); if (gs[i]) Store.moveFactionGroup(gs[i].id, -1); draw(); return; }
      const down = e.target.closest('[data-down]');
      if (down) { const i = Number(down.dataset.down); if (gs[i]) Store.moveFactionGroup(gs[i].id, 1); draw(); }
    });
    mask.querySelector('[data-done]').onclick = () => Modal.close();
  },

  create() {
    const mask = Modal.open({
      title: '新建势力', narrow: true,
      body: `<label class="fld"><span>势力名</span>
          <input type="text" id="fcName" maxlength="30" placeholder="例：青丘妖族 / 北境巫部 / 归墟海市"></label>
        <div class="hint">建好后再补所属地、成员和与其他势力的关系。</div>`,
      footer: `<button class="btn" data-x>取消</button><button class="btn primary" id="fcGo">创建</button>`
    });
    const input = mask.querySelector('#fcName');
    const go = () => {
      if (!input.value.trim()) return toast('先写个势力名', 'err');
      const f = Store.addFaction(input.value, this.defaultGroup());
      this._sel = f.id;
      this._mode = 'detail';
      Modal.close();
      this.refresh();
      toast(`势力「${f.name}」已建好`);
    };
    mask.querySelector('#fcGo').onclick = go;
    input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    mask.querySelector('[data-x]').onclick = () => Modal.close();
    input.focus();
  },

  /* ---------------- 势力档案 ---------------- */
  detailHtml(f) {
    const idx = Store.worldEntries().indexOf(f);
    const B = (p) => `world.entries.${idx}.${p}`;
    const chars = Store.data.characters;
    const pool = Store.factionPlaces();
    (f.places || []).forEach((n) => { if (n && !pool.includes(n)) pool.push(n); });
    const links = f.links || (f.links = { chars: [], places: [] });
    const groups = Store.factionGroups();
    return `<div class="fac-detail card pad">
      <div class="fd-head">
        <div style="min-width:0;flex:1">
          <div class="fd-eyebrow">势力档案</div>
          <input class="fd-name" data-bind="${B('name')}" data-live value="${esc(f.name || '')}" placeholder="给这个势力起个名字">
        </div>
        <label class="fld" style="flex:0 0 148px;margin:0"><span>所属分类</span>
          <select id="facGroupSel">
            <option value="">未分组</option>
            ${groups.map((g) => `<option value="${g.id}" ${f.groupId === g.id ? 'selected' : ''}>${esc(g.name || '未命名')}</option>`).join('')}
          </select></label>
        <button class="btn sm" id="facToGraph">关系图 →</button>
        <button class="btn danger sm" id="facDel">删除</button>
      </div>

      <div class="row" style="margin-bottom:12px">
        <label class="fld" style="flex:1"><span>一句话（会进写作提示词）</span>
          <textarea data-bind="${B('desc')}" data-live rows="2" placeholder="这个势力是什么、要什么">${esc(f.desc || '')}</textarea></label>
        <label class="fld" style="flex:0 0 100px"><span>权重</span>
          <select data-bind="${B('weight')}" data-type="num">
            ${[1, 2, 3].map((w) => `<option value="${w}" ${Number(f.weight) === w ? 'selected' : ''}>${'★'.repeat(w)}</option>`).join('')}
          </select></label>
      </div>
      <label class="fld"><span>详述</span>
        <textarea data-bind="${B('detail')}" data-live rows="3" placeholder="内部结构、规矩、忌讳、实力来源…">${esc(f.detail || '')}</textarea></label>

      <div class="sec-title">所属地 <span class="small muted" style="font-family:var(--sans);letter-spacing:0">（点地名选中，地图上的名字已列好，也能自己加）</span></div>
      <div class="fac-places" id="facPlaces">${pool.length
        ? pool.map((n) => `<button class="fac-place ${(f.places || []).includes(n) ? 'on' : ''}" data-place="${esc(n)}">${esc(n)}</button>`).join('')
        : '<span class="small muted">地图里还没有地名，可以直接在下面自定义。</span>'}</div>
      <div class="fac-addrow"><input type="text" id="facPlaceNew" maxlength="30" placeholder="自定义地名，回车添加"><button class="btn sm" id="facPlaceAdd">+ 添加</button></div>

      <div class="sec-title">成员 <span class="small muted" style="font-family:var(--sans);letter-spacing:0">（点人物名选中 / 取消）</span></div>
      <div class="cast-pick" id="facMembers">
        ${chars.map((c) => `<span class="pick ${(links.chars || []).includes(c.id) ? 'on' : ''}" data-cid="${c.id}" style="--c:${c.color || '#a63a2a'}">${esc(c.name || '未命名')}</span>`).join('') || '<span class="small muted">还没有人物，去「人物」页添加。</span>'}
      </div>

      <div class="sec-title">与其他势力的关系 <span class="small muted" style="font-family:var(--sans);letter-spacing:0">（关系自己填；同一对势力在关系图里只画一条线）</span></div>
      <div id="facRels"></div>
      <button class="btn sm" id="facRelAdd" style="margin-top:4px">+ 添加关系</button>
    </div>`;
  },

  bindDetail(host, f) {
    bindInputs(host);
    const others = () => Store.factions().filter((x) => x.id !== f.id);
    host.querySelector('#facGroupSel').onchange = (e) => {
      Store.setFactionGroup(f.id, e.target.value);
      this.refresh();
    };

    /* 所属地 */
    const placeBox = host.querySelector('#facPlaces');
    const pool = () => {
      const all = Store.factionPlaces();
      (f.places || []).forEach((n) => { if (n && !all.includes(n)) all.push(n); });
      return all;
    };
    const drawPlaces = () => {
      const a = pool();
      placeBox.innerHTML = a.length
        ? a.map((n) => `<button class="fac-place ${(f.places || []).includes(n) ? 'on' : ''}" data-place="${esc(n)}">${esc(n)}</button>`).join('')
        : '<span class="small muted">地图里还没有地名，可以直接在下面自定义。</span>';
    };
    placeBox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-place]');
      if (!b) return;
      const n = b.dataset.place;
      f.places = f.places || [];
      const i = f.places.indexOf(n);
      if (i >= 0) f.places.splice(i, 1); else f.places.push(n);
      Store.touch();
      drawPlaces();
    });
    const addPlace = () => {
      const inp = host.querySelector('#facPlaceNew');
      const n = inp.value.trim();
      if (!n) return;
      f.places = f.places || [];
      if (!f.places.includes(n)) { f.places.push(n); Store.touch(); }
      inp.value = '';
      drawPlaces();
    };
    host.querySelector('#facPlaceAdd').onclick = addPlace;
    host.querySelector('#facPlaceNew').onkeydown = (e) => { if (e.key === 'Enter') addPlace(); };

    /* 成员 */
    host.querySelector('#facMembers').addEventListener('click', (e) => {
      const p = e.target.closest('[data-cid]');
      if (!p) return;
      f.links = f.links || { chars: [], places: [] };
      f.links.chars = f.links.chars || [];
      const i = f.links.chars.indexOf(p.dataset.cid);
      if (i >= 0) f.links.chars.splice(i, 1); else f.links.chars.push(p.dataset.cid);
      p.classList.toggle('on', i < 0);
      Store.touch();
    });

    /* 势力关系：两端各一条但共享 pairId，改名同步、删除同步 */
    const relBox = host.querySelector('#facRels');
    const drawRels = () => {
      const list = f.relations || [];
      relBox.innerHTML = list.length ? list.map((r) => `
        <div class="fac-rel-row" data-rid="${r.id}">
          <select data-k="target">
            <option value="">选择势力…</option>
            ${others().map((o) => `<option value="${o.id}" ${r.target === o.id ? 'selected' : ''}>${esc(o.name || '未命名势力')}</option>`).join('')}
          </select>
          <input type="text" data-k="kind" value="${esc(r.kind || '')}" placeholder="关系自己填：盟友 / 世仇 / 名义臣属">
          <input type="text" data-k="note" value="${esc(r.note || '')}" placeholder="备注（可选）">
          <button class="rel-x danger" data-delrel="${r.id}" title="删除这条关系">✕</button>
        </div>`).join('') : '<div class="rel-empty">还没有登记势力关系。点下面「+ 添加关系」，或在关系图里拖一条线。</div>';
    };
    drawRels();
    const onRel = (e) => {
      const t = e.target;
      if (t.dataset.k === undefined) return;
      const row = t.closest('[data-rid]');
      const r = row && (f.relations || []).find((x) => x.id === row.dataset.rid);
      if (!r) return;
      r[t.dataset.k] = t.value;
      if (t.dataset.k === 'kind' && r.pairId) {
        Store.factions().forEach((x) => (x.relations || []).forEach((y) => {
          if (y.pairId === r.pairId) y.kind = t.value;
        }));
      }
      Store.touch();
    };
    relBox.addEventListener('input', onRel);
    relBox.addEventListener('change', onRel);
    relBox.addEventListener('click', (e) => {
      const d = e.target.closest('[data-delrel]');
      if (!d) return;
      Store.removeFactionRelation(f.id, d.dataset.delrel);
      drawRels();
    });
    host.querySelector('#facRelAdd').onclick = () => {
      f.relations = f.relations || [];
      f.relations.push({ id: uid('fr'), target: '', kind: '', note: '', pairId: '' });
      Store.touch();
      drawRels();
      const sels = relBox.querySelectorAll('select');
      if (sels.length) sels[sels.length - 1].focus();
    };

    host.querySelector('#facToGraph').onclick = () => { this._mode = 'graph'; this.refresh(); };
    host.querySelector('#facDel').onclick = () => {
      if (!confirm(`删除势力「${f.name || '未命名'}」？\n其它势力指向它的关系也会一并清掉，人物和地点不受影响。`)) return;
      Store.removeFaction(f.id);
      this._sel = (Store.factions()[0] || {}).id || '';
      this._mode = 'detail';
      this.refresh();
    };
  },

  /* ---------------- 势力关系图：缩放 / 平移 / 拖动 / 拖线 / 合并去重 ---------------- */
  graphHtml() {
    const list = this.visibleFactions();
    const total = Store.factions().length;
    if (list.length < 2) {
      this._g = null;
      return `<div class="empty"><h3>${this._group ? '这个分类下至少需要两个势力' : '至少两个势力才能织网'}</h3>
        <p class="small">在势力档案的「与其他势力的关系」里登记对象，或直接从节点上的小圆点拖出一条线。</p>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:center">
          ${this._group ? '<button class="btn" id="facNetAll">查看全部分类</button>' : ''}
          <button class="btn" id="facNetBack">返回档案</button></div></div>`;
    }
    const W = 960, H = 540, cx = W / 2, cy = H / 2;
    const R = Math.min(210, 110 + list.length * 16);
    const saved = Store.factionNetPos();
    const clamp = (x, y) => ({ x: fClamp(x, 54, W - 54), y: fClamp(y, 54, H - 74) });
    const pos = {}, byId = {};
    list.forEach((f, i) => { byId[f.id] = f; });
    list.forEach((f, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / list.length;
      let x = cx + Math.cos(a) * R * 1.32, y = cy + Math.sin(a) * R * 0.92;
      const s = saved[f.id];
      if (s && Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y))) { x = Number(s.x); y = Number(s.y); }
      pos[f.id] = clamp(x, y);
    });

    /* 同一对势力（不分方向）只生成一条边：A→B 与 B→A 的「父女」不会画成两条线 */
    const pairMap = new Map();
    list.forEach((f) => (f.relations || []).forEach((r) => {
      if (!r || !r.target || !byId[r.target] || r.target === f.id) return;
      const key = [f.id, r.target].sort().join('|');
      if (!pairMap.has(key)) pairMap.set(key, { key, a: f.id, b: r.target, kinds: [], refs: [] });
      const e = pairMap.get(key);
      const k = String(r.kind || '').trim();
      if (k && !e.kinds.includes(k)) e.kinds.push(k);
      e.refs.push({ factionId: f.id, relId: r.id });
    }));
    const edges = Array.from(pairMap.values());
    const legendKinds = [];
    edges.forEach((e) => e.kinds.forEach((k) => { if (!legendKinds.includes(k)) legendKinds.push(k); }));

    const NODE_R = 26;
    const edgeHtml = () => edges.map((e, i) => {
      const p = pos[e.a], q = pos[e.b];
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      // 端点退到圆的边缘，线不会插进节点里
      const rr = NODE_R + 5;
      const sx = p.x + ux * rr, sy = p.y + uy * rr;
      const ex = q.x - ux * rr, ey = q.y - uy * rr;
      const mx = (sx + ex) / 2, my = (sy + ey) / 2;
      // 法向偏移，多对关系彼此错开；短边弯得小一点，长边弯得舒展
      const bend = (i % 2 ? 1 : -1) * Math.min(48, 14 + Math.floor(i / 2) * 11 + len * 0.035);
      const kx = mx - uy * bend, ky = my + ux * bend;
      const lx = (sx + 2 * kx + ex) / 4, ly = (sy + 2 * ky + ey) / 4;
      const col = facRelColor(e.kinds.join(' '));
      const d = `M${sx.toFixed(1)},${sy.toFixed(1)} Q${kx.toFixed(1)},${ky.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
      const label = e.kinds.join(' · ');
      return `<g class="fac-net-edge">
        <path d="${d}" fill="none" stroke="${col}" stroke-width="1.9" opacity=".78" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        ${label ? `<text class="fac-net-label" data-fs="11" x="${lx.toFixed(1)}" y="${(ly - 6).toFixed(1)}" text-anchor="middle" fill="${col}">${esc(label)}</text>` : ''}
        <path class="fac-net-edge-hit" data-pair="${e.key}" d="${d}" fill="none" stroke="transparent" stroke-width="16" vector-effect="non-scaling-stroke"/>
      </g>`;
    }).join('');

    const nodes = list.map((f) => {
      const p = pos[f.id];
      const i = Store.factions().indexOf(f);
      const col = facColor(i < 0 ? 0 : i);
      return `<g class="fac-net-node" data-fid="${f.id}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
        <circle class="fac-net-halo" r="33" fill="${col}" opacity=".10"/>
        <circle class="fac-net-core" r="${NODE_R}" style="fill:var(--surface)" stroke="${col}" stroke-width="2"/>
        <text class="fac-net-initial" data-fs="16" data-y="6" y="6" text-anchor="middle" fill="${col}">${esc((f.name || '?').slice(0, 1))}</text>
        <text class="fac-net-name" data-fs="13" data-y="46" y="46" text-anchor="middle">${esc(f.name || '未命名势力')}</text>
        <circle class="fac-net-hit" r="36" fill="transparent"/>
        <circle class="fac-net-port" data-port="${f.id}" r="6" cy="-31" fill="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      </g>`;
    }).join('');

    const legend = legendKinds.length
      ? legendKinds.slice(0, 12).map((k) => `<span><i style="background:${facRelColor(k)}"></i>${esc(k)}</span>`).join('')
      : '<span>从节点上方的小圆点拖到另一个势力，就能连一条关系</span>';

    this._g = { W, H, cx, cy, list, pos, edges, byId, edgeHtml, NODE_R };
    if (this._view.cx === 480 && this._view.cy === 270) { this._view.cx = cx; this._view.cy = cy; }
    return `<div class="fac-net card">
      <div class="fac-net-tools">
        <span class="rel-net-tip">拖节点摆位置 · 拖小圆点连关系 · 滚轮缩放 · 空白处拖动平移${this._group ? ' · 已按分类筛选' : ''}</span>
        <div class="fg-zoom">
          <button class="btn sm" id="facZoomOut" title="缩小">−</button>
          <span id="facZoomVal">${Math.round(this._zoom * 100)}%</span>
          <button class="btn sm" id="facZoomIn" title="放大">＋</button>
          <button class="btn sm" id="facZoomFit" title="恢复视图">适应</button>
          <button class="btn sm" id="facNetReset" title="清空自定义坐标">自动排版</button>
          <button class="btn sm" id="facNetBack">← 返回档案</button>
        </div>
      </div>
      <svg id="facNetSvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <g id="facNetEdges">${edgeHtml()}</g>
        <g id="facNetNodes">${nodes}</g>
        <g id="facNetCenter" transform="translate(${cx},${cy})">
          <circle class="fac-net-ring" r="${(R * 0.42).toFixed(1)}" fill="none" style="stroke:var(--line)" stroke-width="1" stroke-dasharray="3 7" opacity=".38" vector-effect="non-scaling-stroke"/>
        </g>
        <path id="facNetDraft" fill="none" stroke-width="2" stroke-dasharray="6 5" stroke-linecap="round" vector-effect="non-scaling-stroke" style="display:none"/>
      </svg>
      <div class="rel-net-legend">${legend}<em>${list.length} 个势力 · ${edges.length} 条连线${total > list.length ? ` · 全书 ${total} 个` : ''} · 同一对只画一条线</em></div>
    </div>`;
  },

  bindGraph(host) {
    const back = host.querySelector('#facNetBack');
    if (back) back.onclick = () => { this._mode = 'detail'; this.refresh(); };
    const allBtn = host.querySelector('#facNetAll');
    if (allBtn) allBtn.onclick = () => { this._group = ''; this.refresh(); };
    const g = this._g;
    const svg = host.querySelector('#facNetSvg');
    if (!g || !svg) return;
    const edgesG = host.querySelector('#facNetEdges');
    const centerG = host.querySelector('#facNetCenter');
    const draft = host.querySelector('#facNetDraft');

    /* 缩放只改 viewBox；节点大小、字号、线宽都按 1/zoom 补偿，保持恒定 */
    const apply = () => {
      const z = this._zoom, v = this._view;
      const vw = g.W / z, vh = g.H / z;
      svg.setAttribute('viewBox', `${(v.cx - vw / 2).toFixed(2)} ${(v.cy - vh / 2).toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`);
      const val = host.querySelector('#facZoomVal');
      if (val) val.textContent = Math.round(z * 100) + '%';
      svg.querySelectorAll('[data-fs]').forEach((t) => {
        t.style.fontSize = (Number(t.dataset.fs) / z).toFixed(2) + 'px';
        if (t.dataset.y !== undefined) t.setAttribute('y', (Number(t.dataset.y) / z).toFixed(2));
      });
      svg.querySelectorAll('.fac-net-core').forEach((c) => c.setAttribute('r', (g.NODE_R / z).toFixed(2)));
      svg.querySelectorAll('.fac-net-halo').forEach((c) => c.setAttribute('r', (33 / z).toFixed(2)));
      svg.querySelectorAll('.fac-net-hit').forEach((c) => c.setAttribute('r', (36 / z).toFixed(2)));
      svg.querySelectorAll('.fac-net-port').forEach((c) => {
        c.setAttribute('r', (6 / z).toFixed(2));
        c.setAttribute('cy', (-31 / z).toFixed(2));
      });
      const ring = centerG && centerG.querySelector('.fac-net-ring');
      if (ring) ring.setAttribute('r', (Number(ring.dataset.r || 0) / z).toFixed(2));
      if (centerG) centerG.setAttribute('transform', `translate(${v.cx.toFixed(2)},${v.cy.toFixed(2)})`);
    };
    const ring = centerG && centerG.querySelector('.fac-net-ring');
    if (ring) ring.dataset.r = ring.getAttribute('r');
    apply();

    const toUser = (e) => {
      const m = svg.getScreenCTM();
      if (!m) return null;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(m.inverse());
    };
    const zoomBy = (factor, ax, ay) => {
      const old = this._zoom;
      const nz = fClamp(old * factor, 0.5, 2.8);
      if (nz === old) return;
      const A = (ax === undefined) ? this._view.cx : ax;
      const B = (ay === undefined) ? this._view.cy : ay;
      this._view.cx = A - (A - this._view.cx) * (old / nz);
      this._view.cy = B - (B - this._view.cy) * (old / nz);
      this._zoom = nz;
      apply();
    };
    host.querySelector('#facZoomIn').onclick = () => zoomBy(1.2);
    host.querySelector('#facZoomOut').onclick = () => zoomBy(1 / 1.2);
    host.querySelector('#facZoomFit').onclick = () => {
      this._zoom = 1; this._view = { cx: g.cx, cy: g.cy }; apply();
    };
    host.querySelector('#facNetReset').onclick = () => {
      const p = Store.factionNetPos();
      g.list.forEach((f) => delete p[f.id]);
      Store.touch();
      this.refresh();
      toast('已恢复自动排版');
    };
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = toUser(e);
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, p ? p.x : undefined, p ? p.y : undefined);
    }, { passive: false });

    const repaintEdges = () => { if (edgesG) edgesG.innerHTML = g.edgeHtml(); apply(); };
    const inNode = (p) => {
      let best = null, dist = 1e9;
      g.list.forEach((f) => {
        const q = g.pos[f.id];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < dist) { dist = d; best = f.id; }
      });
      return dist < 40 / this._zoom ? best : null;
    };

    /* 空白处拖动 = 平移视图 */
    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.fac-net-node') || e.target.closest('.fac-net-edge-hit')) return;
      const m = svg.getScreenCTM();
      if (!m) return;
      const sx = e.clientX, sy = e.clientY, cx0 = this._view.cx, cy0 = this._view.cy;
      const move = (ev) => {
        this._view.cx = cx0 - (ev.clientX - sx) / m.a;
        this._view.cy = cy0 - (ev.clientY - sy) / m.d;
        apply();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        svg.classList.remove('panning');
      };
      svg.classList.add('panning');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      e.preventDefault();
    });

    /* 节点：拖动改坐标并实时重画连线；单击打开档案 */
    host.querySelectorAll('.fac-net-node').forEach((node) => {
      const id = node.dataset.fid;
      node.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const isPort = !!e.target.closest('[data-port]');
        const p = toUser(e);
        if (!p) return;
        e.stopPropagation();
        if (isPort) { this.dragLink(e, id, { svg, draft, toUser, inNode, pos: g.pos, apply }); return; }
        const q = g.pos[id];
        let drag = { dx: p.x - q.x, dy: p.y - q.y, sx: e.clientX, sy: e.clientY, moved: false };
        const move = (ev) => {
          if (!drag) return;
          const u = toUser(ev);
          if (!u) return;
          if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 3) return;
          drag.moved = true;
          const np = { x: fClamp(u.x - drag.dx, 54, g.W - 54), y: fClamp(u.y - drag.dy, 54, g.H - 74) };
          g.pos[id] = np;
          node.setAttribute('transform', `translate(${np.x.toFixed(1)},${np.y.toFixed(1)})`);
          repaintEdges();
        };
        const up = () => {
          if (!drag) return;
          const moved = drag.moved;
          drag = null;
          cleanup();
          if (moved) {
            Store.factionNetPos()[id] = { x: Math.round(g.pos[id].x), y: Math.round(g.pos[id].y) };
            Store.touch();
          } else {
            this._sel = id; this._mode = 'detail'; this.refresh();
          }
        };
        const cleanup = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', cancel);
          node.classList.remove('dragging');
        };
        const cancel = () => { drag = null; cleanup(); };
        node.classList.add('dragging');
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', cancel);
        e.preventDefault();
      });
    });

    /* 点连线：改关系文字 / 删掉这一段 */
    edgesG.addEventListener('click', (e) => {
      const hit = e.target.closest('[data-pair]');
      if (!hit) return;
      const edge = g.edges.find((x) => x.key === hit.dataset.pair);
      if (edge) this.editEdge(edge, g.byId);
    });
  },

  /** 从节点上方的小圆点拖一条线到另一个势力，松手写关系 */
  dragLink(e, from, ctx) {
    const { svg, draft, toUser, inNode, pos, apply } = ctx;
    const start = pos[from];
    if (!start) return;
    let target = null;
    const move = (ev) => {
      const p = toUser(ev);
      if (!p) return;
      target = inNode(p);
      const end = target && target !== from ? pos[target] : p;
      draft.setAttribute('d', `M${start.x.toFixed(1)},${start.y.toFixed(1)} L${end.x.toFixed(1)},${end.y.toFixed(1)}`);
      draft.style.display = '';
    };
    const up = (ev) => {
      cleanup();
      const p = ev && toUser(ev);
      const to = p ? inNode(p) : target;
      draft.style.display = 'none';
      if (!to || to === from) return;
      const a = Store.faction(from), b = Store.faction(to);
      if (!a || !b) return;
      const mask = Modal.open({
        title: '建立势力关系', narrow: true,
        body: `<div class="fg-link-head"><b>${esc(a.name || '未命名势力')}</b><span>──</span><b>${esc(b.name || '未命名势力')}</b></div>
          <label class="fld"><span>关系（自己填，如：盟友 / 世仇 / 父女 / 名义臣属）</span>
            <input type="text" id="fgLinkKind" maxlength="30" placeholder="例：世仇"></label>
          <div class="hint">两端档案各存一条，关系图上只画一条线；之后点线可以改或删。</div>`,
        footer: `<button class="btn" data-x>取消</button><button class="btn primary" id="fgLinkGo">连接</button>`
      });
      const input = mask.querySelector('#fgLinkKind');
      const go = () => {
        const k = input.value.trim();
        if (!k) return toast('先写个关系', 'err');
        Store.addFactionRelation(from, to, k);
        Modal.close();
        this.refresh();
        toast('关系已连上');
      };
      mask.querySelector('#fgLinkGo').onclick = go;
      input.onkeydown = (ev2) => { if (ev2.key === 'Enter') go(); };
      mask.querySelector('[data-x]').onclick = () => Modal.close();
      input.focus();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      svg.classList.remove('linking');
    };
    const cancel = () => { cleanup(); draft.style.display = 'none'; };
    svg.classList.add('linking');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    move(e);
    e.preventDefault();
  },

  editEdge(edge, byId) {
    const a = byId[edge.a], b = byId[edge.b];
    if (!a || !b) return;
    const mask = Modal.open({
      title: '这段势力关系', narrow: true,
      body: `<div class="fg-link-head"><b>${esc(a.name || '未命名势力')}</b><span>──</span><b>${esc(b.name || '未命名势力')}</b></div>
        <label class="fld"><span>关系文字</span><input type="text" id="fgEdgeKind" maxlength="30" value="${esc(edge.kinds.join(' · '))}"></label>
        <div class="hint">同一对势力只画一条线，多个方向的关系文字会合在一起显示。</div>`,
      footer: `<button class="btn danger" id="fgEdgeDel">删除这段关系</button><button class="btn primary" id="fgEdgeSave">保存</button>`
    });
    const input = mask.querySelector('#fgEdgeKind');
    mask.querySelector('#fgEdgeSave').onclick = () => {
      const k = input.value.trim();
      Store.factions().forEach((f) => (f.relations || []).forEach((r) => {
        if ((r.target === edge.b && f.id === edge.a) || (r.target === edge.a && f.id === edge.b)) r.kind = k;
      }));
      Store.touch();
      Modal.close();
      this.refresh();
    };
    mask.querySelector('#fgEdgeDel').onclick = () => {
      if (!confirm('删除这两个势力之间的全部关系？')) return;
      const ref = edge.refs[0];
      if (ref) Store.removeFactionRelation(ref.factionId, ref.relId);
      // 老数据可能没有 pairId，按方向再清一遍
      Store.factions().forEach((f) => {
        if (!Array.isArray(f.relations)) return;
        f.relations = f.relations.filter((r) =>
          !((f.id === edge.a && r.target === edge.b) || (f.id === edge.b && r.target === edge.a)));
      });
      Store.touch();
      Modal.close();
      this.refresh();
    };
    input.focus();
  }
};
