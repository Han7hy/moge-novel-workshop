/* ============ view-characters.js —— 人物卡 / 关系网 ============ */
window.Views = window.Views || {};

/* 道具类别色由 view-props.js 提供；脚本未加载时退回暖金色 */
function propDotColor(cat) {
  const map = (typeof PROP_CAT_MAP !== 'undefined') ? PROP_CAT_MAP : {};
  return (map[cat] && map[cat].color) || '#a97f2f';
}

/* 关系文字由作者自由填写：颜色按字面推断，同一种写法始终同色 */
const REL_BASE = {
  血缘: '#a63a2a', 亲属: '#b06a3b', 师徒: '#3d6a58', 主仆: '#5b6f8c',
  恋人: '#a44a6a', 敌对: '#6a4b7a', 盟友: '#a97f2f', 其他: '#8a8378'
};
const REL_EXTRA = ['#8a6d3b', '#4f7a8c', '#8c5a7a', '#4f7a5c', '#a4633c', '#6a6fa0', '#7d8256', '#9a6a6a'];
const REL_RULES = [
  [/恋|爱|情|婚|夫|妻|配偶|情人/, '恋人'],
  [/敌|仇|杀|宿|对手|对立|抗拒|危险|枷锁/, '敌对'],
  [/师|徒|弟子|门生|先生|学生/, '师徒'],
  [/主|仆|奴|侍|属下|随从/, '主仆'],
  [/盟|友|同伴|伙伴|结义|依存|同源/, '盟友'],
  [/血|亲|父|母|兄|弟|姐|妹|族|祖|子|女|爷|孙/, '血缘']
];
function relColor(s) {
  const k = String(s || '').trim();
  if (!k) return REL_BASE.其他;
  if (REL_BASE[k]) return REL_BASE[k];
  for (const [re, key] of REL_RULES) if (re.test(k)) return REL_BASE[key];
  let h = 0;
  for (const ch of k) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return REL_EXTRA[h % REL_EXTRA.length];
}
function relText(r) {
  return String((r && (r.kind || r.label)) || '').trim();
}
/* 关系网自定义坐标，持久化在 Store.data.relNet.pos */
function netPos() {
  const d = Store.data;
  if (!d.relNet || typeof d.relNet !== 'object') d.relNet = { pos: {} };
  if (!d.relNet.pos || typeof d.relNet.pos !== 'object') d.relNet.pos = {};
  return d.relNet.pos;
}

Views.characters = {
  title: '人物',
  sub: '性格锁 · 说话方式 · 关系网',
  _mode: 'cards', // cards | graph
  _folder: '',    // 当前所在分组：'' 根 | '__none' 未分组 | 分组 id
  _showAll: false, // 平铺全部人物（不按文件夹）
  _zoom: 1,        // 关系网缩放
  _view: { cx: 480, cy: 280 }, // 关系网视口中心（内容坐标）

  actions() {
    return `<button class="btn" id="btnGenChar">AI 生成人物</button>
            <button class="btn primary" id="btnNewChar">+ 新建人物</button>`;
  },

  /* ---------------- 视图骨架：左侧分组树 + 右侧目录内容 ---------------- */
  mount(el) {
    el.innerHTML = `
      <div class="char-toolbar">
        <div class="seg" id="charSeg">
          <button data-m="cards">人物卡</button>
          <button data-m="graph">关系网</button>
        </div>
        <div class="char-stat" id="charStat"></div>
      </div>
      <div class="folder-layout">
        <aside class="folder-tree" id="charTree"></aside>
        <div class="folder-main">
          <div class="folder-crumb" id="charCrumb"></div>
          <div id="charBody"></div>
        </div>
      </div>`;
    el.querySelectorAll('#charSeg button').forEach((b) => {
      b.onclick = () => { this._mode = b.dataset.m; this.refresh(); };
    });
    $('#btnNewChar').onclick = () => this.newChar();
    $('#btnGenChar').onclick = () => this.genChar();
    // 树与面包屑各挂一次委托，重画 innerHTML 不会丢监听
    el.querySelector('#charTree').addEventListener('click', (e) => {
      const it = e.target.closest('[data-folder]');
      if (it) { this._folder = it.dataset.folder; this._showAll = false; this.refresh(); }
    });
    el.querySelector('#charCrumb').addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) { this._folder = go.dataset.go; this._showAll = false; this.refresh(); return; }
      if (e.target.closest('#folderNew')) return this.quickAdd();
      if (e.target.closest('#folderManage')) return this.manageGroups();
      if (e.target.closest('#folderAll')) { this._showAll = !this._showAll; this.refresh(); }
    });
    this.refresh();
  },

  /** 局部刷新：树 / 面包屑 / 目录一起重画，不动顶栏与弹窗 */
  refresh() {
    const host = $('#charBody');
    if (!host) return;
    this.closeCatPicker();
    $$('#charSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === this._mode));
    if (this._folder && this._folder !== '__none' && !Store.charGroup(this._folder)) this._folder = '';
    const chars = Store.data.characters;
    const relCount = chars.reduce((a, c) => a + (c.relations || []).filter((r) => r && r.target).length, 0);
    const stat = $('#charStat');
    if (stat) stat.innerHTML = `<span><b>${chars.length}</b> 位人物</span><i></i><span><b>${relCount}</b> 段关系</span>`;
    this.renderTree();
    this.renderCrumb();
    if (this._mode === 'graph') this.renderGraph(host, this.graphChars());
    else this.renderCards(host, this.folderChars());
  },

  defaultGroup() {
    return (this._folder && this._folder !== '__none' && Store.charGroup(this._folder)) ? this._folder : '';
  },

  /** 卡片区显示的人：根目录只给文件夹，进组后才给本组人物 */
  folderChars() {
    if (this._showAll) return Store.data.characters;
    if (this._folder === '__none') return Store.ungroupedChars();
    if (this._folder) return Store.charGroupChars(this._folder, false);
    return [];
  },

  /** 关系网显示的人：含子分组，根目录看全图 */
  graphChars() {
    if (this._showAll) return Store.data.characters;
    if (this._folder === '__none') return Store.ungroupedChars();
    if (this._folder) return Store.charGroupChars(this._folder, true);
    return Store.data.characters;
  },

  renderTree() {
    const box = $('#charTree');
    if (!box) return;
    const rows = [];
    const walk = (pid, depth) => {
      Store.charGroupChildren(pid).forEach((g) => {
        const n = Store.charGroupChars(g.id, true).length;
        rows.push(`<button class="ft-item ${this._folder === g.id && !this._showAll ? 'on' : ''}" data-folder="${g.id}" style="--gc:${Store.charGroupColor(g)};--depth:${depth}">
          <i></i><span>${esc(g.name || '未命名')}</span><b>${n}</b></button>`);
        walk(g.id, depth + 1);
      });
    };
    walk('', 0);
    const none = Store.ungroupedChars().length;
    box.innerHTML = `<div class="ft-title">人物分组</div>
      <button class="ft-item root ${this._folder === '' && !this._showAll ? 'on' : ''}" data-folder=""><span>全部分组</span><b>${Store.data.characters.length}</b></button>
      ${rows.join('')}
      <button class="ft-item root ghost ${this._folder === '__none' && !this._showAll ? 'on' : ''}" data-folder="__none"><span>未分组</span><b>${none}</b></button>
      <div class="ft-foot"><button class="btn sm" id="treeAdd">＋ 新建分组</button><button class="btn sm" id="treeManage">管理</button></div>`;
    box.querySelector('#treeAdd').onclick = () => this.quickAdd();
    box.querySelector('#treeManage').onclick = () => this.manageGroups();
  },

  renderCrumb() {
    const box = $('#charCrumb');
    if (!box) return;
    const path = (this._folder && this._folder !== '__none') ? Store.charGroupPath(this._folder) : [];
    box.innerHTML = `<div class="fc-path">
        <button data-go="">全部分组</button>
        ${path.map((g) => `<span class="fc-sep">/</span><button data-go="${g.id}">${esc(g.name || '未命名')}</button>`).join('')}
        ${this._folder === '__none' ? '<span class="fc-sep">/</span><span>未分组</span>' : ''}
        ${this._showAll ? '<span class="fc-sep">/</span><span>平铺全部人物</span>' : ''}
      </div>
      <div class="fc-acts">
        <button class="btn sm ${this._showAll ? 'on' : ''}" id="folderAll">${this._showAll ? '← 回到分组' : '平铺全部人物'}</button>
        <button class="btn sm" id="folderNew">＋ 在此新建分组</button>
        <button class="btn sm" id="folderManage">管理分组</button>
      </div>`;
  },

  /** 新建分组：默认建在当前目录里，于是可以一层层套下去 */
  quickAdd(charId) {
    const pid = this.defaultGroup();
    const parent = pid ? Store.charGroup(pid) : null;
    const mask = Modal.open({
      title: parent ? `在「${parent.name}」里新建分组` : '新建人物分组', narrow: true,
      onClose: () => this.refresh(),
      body: `<label class="fld"><span>分组名</span>
          <input type="text" id="cgQuick" maxlength="20" placeholder="例：人族 / 北境 / 第一卷登场"></label>
        <div class="hint">${parent ? `会成为「${esc(Store.charGroupLabel(parent))}」的子分组，里面还能继续建。` : '建在根目录，里面可以继续建子分组。'}</div>`,
      footer: `<button class="btn" data-x>取消</button><button class="btn primary" id="cgQuickGo">添加</button>`
    });
    const input = mask.querySelector('#cgQuick');
    const go = () => {
      const g = Store.addCharGroup(input.value, pid);
      if (!g) return toast('先写个分组名', 'err');
      if (charId) Store.setCharGroup(charId, g.id);
      else { this._folder = g.id; this._showAll = false; }
      Modal.close();
      toast(charId ? `已加入「${g.name}」` : `分组「${g.name}」已建好`);
    };
    mask.querySelector('#cgQuickGo').onclick = go;
    input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    mask.querySelector('[data-x]').onclick = () => Modal.close();
    input.focus();
  },

  /** 管理分组：树形显示，可建子分组 / 升一级 / 同级排序 / 删除 */
  manageGroups() {
    const mask = Modal.open({
      title: '管理人物分组', narrow: true,
      onClose: () => this.refresh(),
      body: `<div class="hint" style="margin:0 0 10px">名字直接改；↑↓ 同级排序；＋ 选它当父级；⤴ 升一级；✕ 连同子分组一起删（人物不删，回「未分组」）。</div>
        <div id="cgList"></div>
        <div class="cg-add-row">
          <input type="text" id="cgNew" maxlength="20" placeholder="新分组名，回车添加">
          <select id="cgParent" title="建到哪个分组里"></select>
          <button class="btn sm" id="cgAddBtn">+ 添加</button>
        </div>`,
      footer: `<button class="btn primary" data-done>完成</button>`
    });
    bindInputs(mask);
    const listHost = mask.querySelector('#cgList');
    const parentSel = mask.querySelector('#cgParent');
    const drawParents = () => {
      const keep = parentSel.value;
      const opts = ['<option value="">根目录</option>'];
      const walk = (pid, depth) => Store.charGroupChildren(pid).forEach((g) => {
        opts.push(`<option value="${g.id}">${'　'.repeat(depth)}${'└ '}${esc(g.name || '未命名')}</option>`);
        walk(g.id, depth + 1);
      });
      walk('', 0);
      parentSel.innerHTML = opts.join('');
      if (keep && Store.charGroup(keep)) parentSel.value = keep;
    };
    const draw = () => {
      const all = Store.charGroups();
      const rows = [];
      const walk = (pid, depth) => {
        Store.charGroupChildren(pid).forEach((g, i, sibs) => {
          rows.push(`<div class="cg-row" style="--depth:${depth}">
            <span class="cg-dot" style="--gc:${Store.charGroupColor(g)}"></span>
            <input type="text" data-bind="charGroups.${all.indexOf(g)}.name" data-live value="${esc(g.name)}" maxlength="20" placeholder="分组名">
            <button class="rel-ctl" data-up="${g.id}" ${i === 0 ? 'disabled' : ''} title="同级上移">↑</button>
            <button class="rel-ctl" data-down="${g.id}" ${i === sibs.length - 1 ? 'disabled' : ''} title="同级下移">↓</button>
            <button class="rel-ctl" data-sub="${g.id}" title="在它里面建子分组">＋</button>
            <button class="rel-ctl" data-lift="${g.id}" ${g.parentId ? '' : 'disabled'} title="升一级">⤴</button>
            <button class="rel-x danger" data-del="${g.id}" title="删除分组">✕</button>
          </div>`);
          walk(g.id, depth + 1);
        });
      };
      walk('', 0);
      listHost.innerHTML = rows.length ? rows.join('') : '<div class="rel-empty">还没有分组，在下面加一个。</div>';
      drawParents();
    };
    draw();
    // 等通用表单把新名字写回数据后再刷新左侧树，避免显示旧名
    listHost.addEventListener('input', (e) => { if (e.target.dataset.bind) setTimeout(() => { this.refresh(); drawParents(); }, 0); });
    const add = () => {
      const inp = mask.querySelector('#cgNew');
      const g = Store.addCharGroup(inp.value, parentSel.value);
      if (!g) return toast('先写个分组名', 'err');
      inp.value = ''; draw(); this.refresh(); inp.focus();
    };
    mask.querySelector('#cgAddBtn').onclick = add;
    mask.querySelector('#cgNew').onkeydown = (e) => { if (e.key === 'Enter') add(); };
    listHost.addEventListener('click', (e) => {
      const t = e.target;
      const del = t.closest('[data-del]');
      if (del) {
        const g = Store.charGroup(del.dataset.del);
        if (!g) return;
        const subs = Store.charGroupDescendants(g.id).length;
        const n = Store.charGroupChars(g.id, true).length;
        if (!confirm(`删除分组「${g.name || '未命名'}」？${subs ? `\n连同 ${subs} 个子分组一起删。` : ''}${n ? `${n} 位人物会回到「未分组」，人物本身不删除。` : ''}`)) return;
        const kill = new Set([g.id].concat(Store.charGroupDescendants(g.id).map((x) => x.id)));
        Store.removeCharGroup(g.id);
        if (kill.has(this._folder)) this._folder = '';
        draw(); this.refresh(); return;
      }
      const up = t.closest('[data-up]');
      if (up) { Store.moveCharGroup(up.dataset.up, -1); draw(); this.refresh(); return; }
      const down = t.closest('[data-down]');
      if (down) { Store.moveCharGroup(down.dataset.down, 1); draw(); this.refresh(); return; }
      const lift = t.closest('[data-lift]');
      if (lift) {
        const g = Store.charGroup(lift.dataset.lift);
        if (g) { const p = Store.charGroup(g.parentId); Store.moveCharGroupTo(g.id, p ? p.parentId : ''); }
        draw(); this.refresh(); return;
      }
      const sub = t.closest('[data-sub]');
      if (sub) { parentSel.value = sub.dataset.sub; mask.querySelector('#cgNew').focus(); }
    });
    mask.querySelector('[data-done]').onclick = () => Modal.close();
  },

  /* 卡片上的分类小标签：点一下弹出选择，不进档案、不打断浏览 */
  closeCatPicker() {
    const old = $('.cat-picker');
    if (old) old.remove();
    if (this._pickerOutside) {
      document.removeEventListener('pointerdown', this._pickerOutside, true);
      this._pickerOutside = null;
    }
  },

  openCatPicker(anchor, charId) {
    this.closeCatPicker();
    const c = Store.char(charId);
    if (!c) return;
    // 组按文件夹层级缩进，子分组也能直接选
    const rows = [];
    const walk = (pid, depth) => {
      Store.charGroupChildren(pid).forEach((g) => { rows.push({ g, depth }); walk(g.id, depth + 1); });
    };
    walk('', 0);
    const item = (gid, label, color, on, depth) =>
      `<button class="cat-pick-item ${on ? 'on' : ''}" data-g="${gid}" style="--depth:${depth || 0}"><i style="--gc:${color}"></i>${label}${on ? '<em>✓</em>' : ''}</button>`;
    const menu = document.createElement('div');
    menu.className = 'cat-picker';
    menu.innerHTML = `<div class="cat-pick-title">把「${esc(c.name || '未命名')}」放到</div>
      ${item('', '未分组', '#b9b2a6', !c.groupId, 0)}
      ${rows.map(({ g, depth }) => item(g.id, esc(g.name || '未命名'), Store.charGroupColor(g), c.groupId === g.id, depth)).join('')}
      <div class="cat-pick-sep"></div>
      <button class="cat-pick-item" data-new="1"><i class="plus">＋</i>新建分组…</button>
      <button class="cat-pick-item" data-manage="1"><i class="plus">⚙</i>管理分组…</button>`;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth || 196, h = menu.offsetHeight || 220;
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    menu.style.top = (r.bottom + 6 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6) + 'px';
    menu.addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.hasAttribute('data-new')) { this.closeCatPicker(); this.quickAdd(charId); return; }
      if (t.hasAttribute('data-manage')) { this.closeCatPicker(); this.manageGroups(); return; }
      if (t.hasAttribute('data-g')) {
        Store.setCharGroup(charId, t.dataset.g);
        this.closeCatPicker();
        this.refresh();
      }
    });
    const outside = (e) => {
      if (menu.contains(e.target) || anchor.contains(e.target)) return;
      this.closeCatPicker();
    };
    this._pickerOutside = outside;
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  },

  renderCards(host, list) {
    const chars = Store.data.characters;
    if (!chars.length && !Store.charGroups().length) {
      host.innerHTML = `<div class="empty">
        <h3>还没有人物</h3>
        <p class="small">先建几个角色，把性格锁死。他们之后会自己演完整场戏。</p>
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:center">
          <button class="btn primary" onclick="Views.characters.newChar()">新建人物</button>
          <button class="btn" onclick="Views.characters.genChar()">AI 生成</button>
        </div>
      </div>`;
      return;
    }

    /* 目录里先摆子分组（文件夹），点进去才是人物 */
    const folders = [];
    if (!this._showAll && this._folder !== '__none') {
      const pid = this._folder || '';
      Store.charGroupChildren(pid).forEach((g) => folders.push({
        g, n: Store.charGroupChars(g.id, true).length, subs: Store.charGroupDescendants(g.id).length
      }));
      if (!pid) {
        const none = Store.ungroupedChars().length;
        if (none) folders.push({ none: true, n: none });
      }
    }
    const folderHtml = folders.length ? `<div class="folder-grid">${folders.map((f) => f.none
      ? `<div class="folder-card none" data-open="__none" title="点进去看没分组的人物">
           <div class="folder-ic">▤</div><div class="folder-name">未分组</div>
           <div class="folder-meta">${f.n} 位人物</div></div>`
      : `<div class="folder-card" data-open="${f.g.id}" style="--gc:${Store.charGroupColor(f.g)}" title="点进去看这个分组">
           <div class="folder-ic">▤</div><div class="folder-name">${esc(f.g.name || '未命名')}</div>
           <div class="folder-meta">${f.n} 位人物${f.subs ? ' · ' + f.subs + ' 个子分组' : ''}</div></div>`).join('')}</div>` : '';

    const peopleHtml = list.length ? `<div class="grid-chars">${list.map((c) => {
      const color = c.color || pickColor(chars.indexOf(c));
      const g = Store.charGroupOf(c);
      const rels = (c.relations || []).filter((r) => r && r.target);
      const preview = rels.slice(0, 2).map((r) => {
        const o = Store.char(r.target);
        return `<div class="cc-rel"><span class="cc-rel-dot" style="--c:${relColor(relText(r))}"></span>${esc(o ? o.name : '？')}<em>${esc(relText(r))}</em></div>`;
      }).join('');
      return `
      <div class="char-card" style="--c:${color}" data-id="${c.id}">
        <div class="cc-head">
          <div class="avatar" style="--c:${color}">${esc((c.name || '?').slice(0, 1))}</div>
          <div style="min-width:0">
            <div class="cc-name">${esc(c.name)}</div>
            <div class="cc-role">${esc(c.role || '未定身份')}</div>
          </div>
          <button class="cc-cat ${g ? '' : 'none'}" data-catbtn="${c.id}" style="--gc:${g ? Store.charGroupColor(g) : '#b9b2a6'}" title="点这里换分组">${esc(g ? (g.name || '未命名') : '未分组')}<span>▾</span></button>
        </div>
        <div class="cc-traits">${esc((c.lock && c.lock.traits ? c.lock.traits.join(' · ') : '尚未设定性格锁'))}</div>
        <div class="cc-rels">${preview || '<div class="cc-rel muted">尚未登记关系</div>'}</div>
        <div class="cc-foot">
          ${c.state && c.state.placeId ? `<span class="chip jade">${esc(Store.placeName(c.state.placeId))}</span>` : ''}
          ${c.aliases && c.aliases.length ? `<span class="chip">${esc(c.aliases.join('、'))}</span>` : ''}
          ${c.drive && c.drive.secret ? '<span class="chip accent">有秘密</span>' : ''}
          ${c.futureItems && c.futureItems.length ? `<span class="chip jade">未来：${esc(c.futureItems.join('、'))}</span>` : ''}
          ${(c.items || []).length ? `<span class="chip">${c.items.length} 件道具</span>` : ''}
          <span class="chip">${rels.length} 段关系${rels.length > 2 ? ' +' + (rels.length - 2) : ''}</span>
        </div>
      </div>`;
    }).join('')}</div>` : '';

    if (!folderHtml && !peopleHtml) {
      host.innerHTML = `<div class="empty">
        <h3>${this._folder && this._folder !== '__none' ? '这个分组还是空的' : '还没有人物'}</h3>
        <p class="small">在里面建个子分组，或把人物归到这个分组里。</p>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:center">
          <button class="btn" id="emptyNewGroup">＋ 新建子分组</button>
          <button class="btn primary" id="emptyNewChar">＋ 新建人物</button>
        </div></div>`;
      host.querySelector('#emptyNewGroup').onclick = () => this.quickAdd();
      host.querySelector('#emptyNewChar').onclick = () => this.newChar();
      return;
    }
    host.innerHTML = folderHtml + (folderHtml && peopleHtml ? '<div class="folder-sec-title">本组人物</div>' : '') + peopleHtml;
    host.querySelectorAll('[data-open]').forEach((f) => {
      f.onclick = () => { this._folder = f.dataset.open; this._showAll = false; this.refresh(); };
    });
    host.querySelectorAll('.char-card').forEach((card) => {
      card.onclick = (e) => {
        const btn = e.target.closest('[data-catbtn]');
        if (btn) { e.stopPropagation(); this.openCatPicker(btn, btn.dataset.catbtn); return; }
        this.edit(card.dataset.id);
      };
    });
  },

  /* ---------------- 关系网（节点可自由拖动，位置自动保存） ---------------- */
  renderGraph(host, list) {
    const chars = list || Store.data.characters;
    const inFolder = this._folder && !this._showAll;
    if (chars.length < 2) {
      host.innerHTML = `<div class="empty"><h3>${inFolder ? '这个分组里的人物不足两位' : '至少两位人物才能织网'}</h3>
        <p class="small">${inFolder ? '回到「全部分组」就能看到整张关系网。' : '在人物档案的「关系」里登记对象并写下关系，这里会立刻长出连线。'}</p>
        ${inFolder ? '<div style="margin-top:12px"><button class="btn" id="clearCatFilter">查看全部分组</button></div>' : ''}</div>`;
      const clr = host.querySelector('#clearCatFilter');
      if (clr) clr.onclick = () => { this._folder = ''; this._showAll = false; this.refresh(); };
      return;
    }
    const W = 960, H = 560, cx = W / 2, cy = H / 2 + 8;
    const R = Math.min(230, 120 + chars.length * 12);
    const saved = netPos();
    const clamp = (x, y) => ({ x: clampNum(x, 42, W - 42), y: clampNum(y, 42, H - 72) });
    const pos = {};
    chars.forEach((c, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / chars.length;
      let x = cx + Math.cos(a) * R * 1.28, y = cy + Math.sin(a) * R;
      const s = saved[c.id];
      if (s && Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y))) {
        x = Number(s.x); y = Number(s.y);
      }
      pos[c.id] = clamp(x, y);
    });

    /* 同一对人物（不分方向）只生成一条边：A 写「父女」、B 也写「父女」不会再画成两条线 */
    const pairMap = new Map();
    chars.forEach((c) => {
      (c.relations || []).forEach((r) => {
        if (!r || !r.target || !pos[r.target] || !pos[c.id]) return;
        const key = [c.id, r.target].sort().join('|');
        if (!pairMap.has(key)) pairMap.set(key, { a: c.id, b: r.target, kinds: [], future: true });
        const e = pairMap.get(key);
        const t = relText(r);
        if (t && !e.kinds.includes(t)) e.kinds.push(t);
        if (r.time !== '未来') e.future = false;
      });
    });
    const edges = Array.from(pairMap.values());

    /* 连线按当前坐标实时重画：端点退到圆外，控制点走法向偏移，拖动时始终贴着节点 */
    const edgeHtml = () => edges.map((e, i) => {
      const p = pos[e.a], q = pos[e.b];
      const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len, rr = 28;
      const sx = p.x + ux * rr, sy = p.y + uy * rr;
      const ex = q.x - ux * rr, ey = q.y - uy * rr;
      const mx = (sx + ex) / 2, my = (sy + ey) / 2;
      const bend = (i % 2 ? 1 : -1) * Math.min(48, 14 + Math.floor(i / 2) * 11 + len * 0.03);
      const kx = mx - uy * bend, ky = my + ux * bend;
      const lx = (sx + 2 * kx + ex) / 4, ly = (sy + 2 * ky + ey) / 4;
      const txt = e.kinds.join(' · ');
      const col = relColor(txt);
      const dash = e.future ? ' stroke-dasharray="5 4"' : '';
      const d = `M${sx.toFixed(1)},${sy.toFixed(1)} Q${kx.toFixed(1)},${ky.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
      return `<g class="rel-net-edge">
        <path d="${d}" fill="none" stroke="${col}" stroke-width="1.7" opacity=".68" stroke-linecap="round" vector-effect="non-scaling-stroke"${dash}/>
        ${txt ? `<text class="rel-net-label" data-fs="11" x="${lx.toFixed(1)}" y="${(ly - 6).toFixed(1)}" text-anchor="middle" fill="${col}">${esc(txt)}</text>` : ''}
      </g>`;
    }).join('');

    const nodes = chars.map((c) => {
      const p = pos[c.id];
      const col = c.color || pickColor(chars.indexOf(c));
      const nRel = (c.relations || []).filter((r) => r && r.target).length;
      return `<g class="rel-net-node" data-id="${c.id}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
        <circle class="rel-net-halo" r="30" fill="${col}" opacity=".10"/>
        <circle class="rel-net-core" r="23" style="fill:var(--surface)" stroke="${col}" stroke-width="2"/>
        <text class="rel-net-initial" data-fs="17" data-y="6" y="6" text-anchor="middle" fill="${col}">${esc((c.name || '?').slice(0, 1))}</text>
        <text data-fs="13" data-y="43" y="43" text-anchor="middle" class="rel-net-name">${esc(c.name || '未命名')}</text>
        ${nRel ? `<text data-fs="10" data-y="57" y="57" text-anchor="middle" class="rel-net-count">${nRel} 段关系</text>` : ''}
        <circle class="rel-net-hit" r="34" fill="transparent"/>
      </g>`;
    }).join('');

    const fg = this._showAll ? '平铺全部' : (this._folder === '__none' ? '未分组' : ((Store.charGroup(this._folder) || {}).name || ''));
    const used = [];
    edges.forEach((e) => e.kinds.forEach((k) => { if (k && !used.includes(k)) used.push(k); }));
    const legend = used.length
      ? used.slice(0, 12).map((k) => `<span><i style="background:${relColor(k)}"></i>${esc(k)}</span>`).join('')
      : '<span>连线上的文字就是你填的关系</span>';

    if (this._view.cx === 480 && this._view.cy === 280) { this._view.cx = cx; this._view.cy = cy; }
    host.innerHTML = `<div class="rel-net card">
      <div class="rel-net-tools">
        <span class="rel-net-tip">按住人物圆点拖到任意位置 · 滚轮缩放 · 空白处拖动平移${fg ? ` · 当前：${esc(fg)}` : ''}</span>
        <div class="fg-zoom">
          <button class="btn sm" id="relZoomOut" title="缩小">−</button>
          <span id="relZoomVal">${Math.round(this._zoom * 100)}%</span>
          <button class="btn sm" id="relZoomIn" title="放大">＋</button>
          <button class="btn sm" id="relZoomFit" title="恢复视图">适应</button>
          <button class="btn sm" id="relNetReset">自动排版</button>
        </div>
      </div>
      <svg id="relNetSvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <g id="relNetCenter" transform="translate(${cx},${cy})">
          <circle class="rel-net-ring" r="${(R * 0.52).toFixed(1)}" fill="none" style="stroke:var(--line)" stroke-width="1" stroke-dasharray="3 7" opacity=".38" vector-effect="non-scaling-stroke"/>
        </g>
        <g id="relNetEdges">${edgeHtml()}</g>
        ${nodes}
      </svg>
      <div class="rel-net-legend">${legend}<em>${chars.length} 位人物 · ${edges.length} 条连线 · 虚线 = 未来关系</em></div>
    </div>`;

    const reset = host.querySelector('#relNetReset');
    if (reset) reset.onclick = () => {
      const p = netPos();
      Object.keys(p).forEach((k) => delete p[k]);
      Store.touch();
      this.renderGraph(host, list);
      toast('已恢复自动排版');
    };

    const svg = host.querySelector('#relNetSvg');
    const centerG = svg && svg.querySelector('#relNetCenter');
    const edgesG = svg && svg.querySelector('#relNetEdges');
    const toUser = (e) => {
      if (!svg) return null;
      const m = svg.getScreenCTM();
      if (!m) return null;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(m.inverse());
    };

    /* 缩放只改 viewBox；节点 / 文字 / 线宽按 1/zoom 补偿，保持屏幕大小恒定 */
    const apply = () => {
      if (!svg) return;
      const z = this._zoom, v = this._view;
      const vw = W / z, vh = H / z;
      svg.setAttribute('viewBox', `${(v.cx - vw / 2).toFixed(2)} ${(v.cy - vh / 2).toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`);
      const val = host.querySelector('#relZoomVal');
      if (val) val.textContent = Math.round(z * 100) + '%';
      svg.querySelectorAll('[data-fs]').forEach((t) => {
        t.style.fontSize = (Number(t.dataset.fs) / z).toFixed(2) + 'px';
        if (t.dataset.y !== undefined) t.setAttribute('y', (Number(t.dataset.y) / z).toFixed(2));
      });
      svg.querySelectorAll('.rel-net-halo').forEach((c) => c.setAttribute('r', (30 / z).toFixed(2)));
      svg.querySelectorAll('.rel-net-core').forEach((c) => c.setAttribute('r', (23 / z).toFixed(2)));
      svg.querySelectorAll('.rel-net-hit').forEach((c) => c.setAttribute('r', (34 / z).toFixed(2)));
      const ring = centerG && centerG.querySelector('.rel-net-ring');
      if (ring) ring.setAttribute('r', (Number(ring.dataset.r || 0) / z).toFixed(2));
      if (centerG) centerG.setAttribute('transform', `translate(${v.cx.toFixed(2)},${v.cy.toFixed(2)})`);
    };
    const ring = centerG && centerG.querySelector('.rel-net-ring');
    if (ring) ring.dataset.r = ring.getAttribute('r');
    apply();

    const zoomBy = (factor, ax, ay) => {
      const old = this._zoom;
      const nz = Math.max(0.5, Math.min(2.8, old * factor));
      if (nz === old) return;
      const A = (ax === undefined) ? this._view.cx : ax;
      const B = (ay === undefined) ? this._view.cy : ay;
      this._view.cx = A - (A - this._view.cx) * (old / nz);
      this._view.cy = B - (B - this._view.cy) * (old / nz);
      this._zoom = nz;
      apply();
    };
    host.querySelector('#relZoomIn').onclick = () => zoomBy(1.2);
    host.querySelector('#relZoomOut').onclick = () => zoomBy(1 / 1.2);
    host.querySelector('#relZoomFit').onclick = () => { this._zoom = 1; this._view = { cx, cy }; apply(); };
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = toUser(e);
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, p ? p.x : undefined, p ? p.y : undefined);
    }, { passive: false });

    /* 空白处拖动 = 平移视图 */
    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.rel-net-node')) return;
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

    const repaintEdges = () => { if (edgesG) edgesG.innerHTML = edgeHtml(); apply(); };

    host.querySelectorAll('.rel-net-node').forEach((g) => {
      const id = g.dataset.id;
      let drag = null;
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        g.classList.remove('dragging');
      };
      const onMove = (e) => {
        if (!drag) return;
        const p = toUser(e);
        if (!p) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
        drag.moved = true;
        const np = clamp(p.x - drag.dx, p.y - drag.dy);
        pos[id] = np;
        g.setAttribute('transform', `translate(${np.x.toFixed(1)},${np.y.toFixed(1)})`);
        repaintEdges();
      };
      const onUp = () => {
        if (!drag) return;
        const moved = drag.moved;
        drag = null;
        cleanup();
        if (moved) {
          netPos()[id] = { x: Math.round(pos[id].x), y: Math.round(pos[id].y) };
          Store.touch();
        } else {
          this.edit(id); // 没拖动 = 单击打开人物档案
        }
      };
      const onCancel = () => { drag = null; cleanup(); };
      g.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const p = toUser(e);
        if (!p) return;
        drag = { dx: p.x - pos[id].x, dy: p.y - pos[id].y, sx: e.clientX, sy: e.clientY, moved: false };
        g.classList.add('dragging');
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        e.preventDefault();
      });
    });
  },

  /* ---------------- 新建 / AI ---------------- */
  newChar() {
    const c = {
      id: uid('ch'), name: '', role: '', color: pickColor(Store.data.characters.length),
      groupId: this.defaultGroup(),
      aliases: [], appearance: '',
      lock: { traits: [], speech: '', taboo: '', values: '' },
      drive: { goal: '', fear: '', secret: '', arc: '' },
      knowledge: { knows: '', unknown: '' },
      relations: [], futureItems: [], items: [],
      state: { placeId: '', mood: '', note: '' }
    };
    Store.data.characters.push(c);
    Store.touch();
    this.refresh();
    this.edit(c.id);
  },

  async genChar() {
    AIUndo.label('人物 · AI 生成人物');
    const mask = Modal.open({
      title: 'AI 生成人物', narrow: true,
      body: `<label class="fld"><span>一句话构想</span>
          <textarea id="gcIdea" rows="3" placeholder="例：一个在码头卖茶的女人，什么都知道，什么都不说"></textarea>
          <div class="hint">会结合你的世界观和已有人物生成完整设定。</div></label>`,
      footer: `<button class="btn" data-x>取消</button><button class="btn primary" id="gcGo">生成</button>`
    });
    mask.querySelector('[data-x]').onclick = () => Modal.close();
    mask.querySelector('#gcGo').onclick = async () => {
      const idea = mask.querySelector('#gcIdea').value.trim();
      if (!idea) return toast('先写一句构想', 'err');
      const btn = mask.querySelector('#gcGo');
      btn.disabled = true; btn.textContent = '生成中…';
      try {
        const o = await LLM.json({
          messages: Prompts.genCharacter({ idea, existing: Store.data.characters }),
          temperature: 0.95
        });
        const c = {
          id: uid('ch'), name: o.name || '无名', role: o.role || '',
          color: pickColor(Store.data.characters.length), groupId: this.defaultGroup(),
          aliases: [], appearance: '',
          lock: {
            traits: Store.toArr(o.lock?.traits), speech: o.lock?.speech || '',
            taboo: o.lock?.taboo || '', values: o.lock?.values || ''
          },
          drive: { goal: '', fear: '', secret: '', arc: '', ...(o.drive || {}) },
          knowledge: { knows: '', unknown: '', ...(o.knowledge || {}) },
          relations: [], futureItems: [], items: [],
          state: { placeId: '', mood: o.state?.mood || '', note: o.state?.note || '' }
        };
        Store.data.characters.push(c);
        Store.touch();
        Modal.close();
        this.refresh();
        toast('人物已生成，可以再手动微调');
        this.edit(c.id);
      } catch (e) {
        toast(e.message, 'err');
        btn.disabled = false; btn.textContent = '生成';
      }
    };
  },

  /* ---------------- 关系行：自由填写 + 拖动 / 上下排序 ---------------- */
  _relHtml(c, others) {
    const n = (c.relations || []).length;
    return (c.relations || []).map((r, ri) => {
      const o = Store.char(r.target);
      const col = o ? (o.color || '#8a8378') : '#b9b2a6';
      return `<div class="rel-row" data-ri="${ri}">
        <span class="rel-dot" style="--c:${col}" title="${esc(o ? o.name : '未选择对象')}">${esc(o ? o.name.slice(0, 1) : '？')}</span>
        <select data-rel="${ri}" data-k="target">
          <option value="">选择对象…</option>
          ${others.map((x) => `<option value="${x.id}" ${r.target === x.id ? 'selected' : ''}>${esc(x.name || '未命名')}</option>`).join('')}
        </select>
        <input type="text" data-rel="${ri}" data-k="kind" value="${esc(r.kind || '')}" placeholder="关系自己填，如：父女 / 师兄 / 宿敌">
        <select data-rel="${ri}" data-k="time">
          <option value="初始" ${(r.time || '初始') === '初始' ? 'selected' : ''}>初始</option>
          <option value="未来" ${(r.time || '初始') === '未来' ? 'selected' : ''}>未来</option>
        </select>
        <input type="text" data-rel="${ri}" data-k="attitude" value="${esc(r.attitude || '')}" placeholder="心里真实的态度">
        <button class="rel-ctl rel-grip" data-grip="${ri}" draggable="true" title="按住拖动排序">⠿</button>
        <button class="rel-ctl" data-up="${ri}" title="上移一位" ${ri === 0 ? 'disabled' : ''}>↑</button>
        <button class="rel-ctl" data-down="${ri}" title="下移一位" ${ri === n - 1 ? 'disabled' : ''}>↓</button>
        <button class="rel-x" data-mirror="${ri}" title="在对方档案里也记一条">↔</button>
        <button class="rel-x danger" data-delrel="${ri}" title="删除这条关系">✕</button>
      </div>`;
    }).join('') || '<div class="rel-empty">还没有关系。点下面「+ 添加关系」，选好对象并写下关系就会立刻出现在这里。</div>';
  },

  /** 把第 from 条关系挪到第 to 条，数组顺序即最终顺序，即时落盘 */
  moveRel(c, from, to, after) {
    const arr = c.relations || (c.relations = []);
    if (from < 0 || from >= arr.length) return;
    const dest = Math.max(0, Math.min(arr.length - 1, to));
    if (dest !== from) {
      const [r] = arr.splice(from, 1);
      arr.splice(dest, 0, r);
      Store.touch();
    }
    if (after) after();
    this.refresh();
  },

  _fiHtml(c) {
    return (c.futureItems || []).map((s, ri) => `
      <div class="rel-row fi" data-ri="${ri}">
        <span class="rel-dot" style="--c:#a97f2f">具</span>
        <input type="text" data-fi="${ri}" value="${esc(s)}" placeholder="道具名">
        <button class="rel-x danger" data-delfi="${ri}">✕</button>
      </div>`).join('') || '<div class="rel-empty">暂无</div>';
  },

  /** 随身道具行：就地改名 / 改描述，不用退出重进 */
  _propHtml(c) {
    const list = c.items || [];
    if (!list.length) return '<div class="prop-empty-line">还没有随身道具。点「+ 添加道具」手动登记，或从「书源」导入自动按首次出现归属。</div>';
    return list.map((it, i) => `
      <div class="prop-row" data-pi="${i}">
        <span class="pr-dot" style="--c:${propDotColor(it.category)}" title="${esc(it.category || '未分类')}">${esc(it.category ? it.category.slice(0, 1) : '具')}</span>
        <input type="text" data-prop="${i}" data-k="name" value="${esc(it.name || '')}" placeholder="道具名">
        <input type="text" data-prop="${i}" data-k="desc" value="${esc(it.desc || '')}" placeholder="一句话描述（会进写作提示词）">
        <button class="pr-x" data-editprop="${i}" title="在道具库里编辑类别 / 归属 / 出处">✎</button>
        <button class="pr-x danger" data-delprop="${i}" title="删除这件道具">✕</button>
      </div>`).join('');
  },

  /* ---------------- 人物档案 ---------------- */
  edit(id) {
    const idx = Store.data.characters.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const c = Store.data.characters[idx];
    const B = (p) => `characters.${idx}.${p}`;
    const others = () => Store.data.characters.filter((x) => x.id !== id);

    const mask = Modal.open({
      title: '人物设定',
      wide: true,
      // 无论 ✕ / 点遮罩 / Esc / 完成，都即时刷新卡片与关系网
      onClose: () => this.refresh(),
      body: `
      <div class="row" style="margin-bottom:14px;flex-wrap:wrap">
        <label class="fld" style="flex:1 1 130px"><span>姓名</span>
          <input type="text" data-bind="${B('name')}" data-live value="${esc(c.name)}"></label>
        <label class="fld" style="flex:2 1 200px"><span>身份 / 年龄</span>
          <input type="text" data-bind="${B('role')}" data-live value="${esc(c.role)}"></label>
        <label class="fld" style="flex:0 0 170px"><span>所在分组</span>
          <select id="charGroupSel" data-bind="${B('groupId')}">
            <option value="">未分组</option>
            ${Store.charGroups().map((g) => `<option value="${g.id}" ${c.groupId === g.id ? 'selected' : ''}>${esc(Store.charGroupLabel(g))}</option>`).join('')}
          </select></label>
        <label class="fld" style="flex:0 0 90px"><span>标识色</span>
          <input type="color" data-bind="${B('color')}" data-live value="${c.color || '#a63a2a'}" style="height:38px;padding:3px"></label>
      </div>

      <div class="row" style="margin-bottom:14px">
        <label class="fld" style="flex:1"><span>称号 / 别名</span>
          <input type="text" data-bind="${B('aliases')}" data-type="comma" data-live value="${esc((c.aliases || []).join('、'))}" placeholder="多个用、隔开，如：血海老祖、阿修罗"></label>
        <label class="fld" style="flex:1"><span>外貌 / 气质</span>
          <input type="text" data-bind="${B('appearance')}" data-live value="${esc(c.appearance || '')}" placeholder="一句话可辨识的特征"></label>
      </div>

      <div class="sec-title">性格锁 <span class="small muted" style="font-family:var(--sans);letter-spacing:0">（最重要，越具体人物越不跑偏）</span></div>
      <label class="fld"><span>核心性格（每行一条，写成行为倾向而非形容词）</span>
        <textarea data-bind="${B('lock.traits')}" data-type="lines" data-live rows="4" placeholder="克制到近乎冷漠&#10;习惯性怀疑一切&#10;绝不欠人情">${esc((c.lock.traits || []).join('\n'))}</textarea>
        <div class="hint">例：「宁可自己扛也不开口求人」比「要强」有效十倍。</div>
      </label>
      <label class="fld"><span>说话方式</span>
        <textarea data-bind="${B('lock.speech')}" data-live rows="3" placeholder="语速、句长、口头禅、回避什么">${esc(c.lock.speech)}</textarea>
      </label>
      <div class="row">
        <label class="fld"><span>绝对不做的事</span>
          <textarea data-bind="${B('lock.taboo')}" data-live rows="2" placeholder="例：不会当众示弱">${esc(c.lock.taboo)}</textarea>
        </label>
        <label class="fld"><span>价值排序</span>
          <textarea data-bind="${B('lock.values')}" data-live rows="2" placeholder="例：真相高于体面">${esc(c.lock.values)}</textarea>
        </label>
      </div>

      <div class="divider"></div>
      <div class="sec-title">欲望与秘密</div>
      <div class="row">
        <label class="fld"><span>当前欲望</span>
          <textarea data-bind="${B('drive.goal')}" data-live rows="2">${esc(c.drive.goal)}</textarea></label>
        <label class="fld"><span>恐惧</span>
          <textarea data-bind="${B('drive.fear')}" data-live rows="2">${esc(c.drive.fear)}</textarea></label>
      </div>
      <div class="row">
        <label class="fld"><span>秘密</span>
          <textarea data-bind="${B('drive.secret')}" data-live rows="2">${esc(c.drive.secret)}</textarea></label>
        <label class="fld"><span>人物弧光</span>
          <textarea data-bind="${B('drive.arc')}" data-live rows="2" placeholder="从…到…">${esc(c.drive.arc)}</textarea></label>
      </div>

      <div class="divider"></div>
      <div class="sec-title">知识边界 <span class="small muted" style="font-family:var(--sans);letter-spacing:0">（防止角色变全知）</span></div>
      <div class="row">
        <label class="fld"><span>知道的事</span>
          <textarea data-bind="${B('knowledge.knows')}" data-live rows="2">${esc(c.knowledge.knows)}</textarea></label>
        <label class="fld"><span>不知道的事</span>
          <textarea data-bind="${B('knowledge.unknown')}" data-live rows="2">${esc(c.knowledge.unknown)}</textarea></label>
      </div>

      <div class="divider"></div>
      <div class="sec-title">关系 <span class="rel-hint">关系自己填 · 按住 ⠿ 拖动或用 ↑↓ 排序</span></div>
      <div id="relList">${this._relHtml(c, others())}</div>
      <button class="btn sm" id="addRel">+ 添加关系</button>

      <div class="divider"></div>
      <div class="sec-title">未来将获得的道具 <span class="small muted" style="font-family:var(--sans);letter-spacing:0">（仅记录后续重要归属，不进初始持有）</span></div>
      <div id="fiList">${this._fiHtml(c)}</div>
      <button class="btn sm" id="addFi">+ 添加</button>

      <div class="divider"></div>
      <div class="sec-title">随身道具（<span id="propCount">${(c.items || []).length}</span>） <span class="rel-hint">改动即时生效，不用退出重进</span></div>
      <div id="propList">${this._propHtml(c)}</div>
      <div style="display:flex;gap:6px;margin-top:4px">
        <button class="btn sm" id="addProp">+ 添加道具</button>
        <button class="btn sm" id="openPropLib">在道具库中管理 →</button>
      </div>

      <div class="divider"></div>
      <div class="sec-title">当前状态</div>
      <div class="row">
        <label class="fld"><span>所在地点</span>
          <select data-bind="${B('state.placeId')}" data-place-ref title="可选章节场景，也可直接引用地图上的地名">
            ${Store.placeSelectOptions(c.state.placeId)}
          </select></label>
        <label class="fld"><span>情绪</span>
          <input type="text" data-bind="${B('state.mood')}" data-live value="${esc(c.state.mood)}" placeholder="例：疲惫，警惕"></label>
      </div>
      <label class="fld" style="margin-bottom:0"><span>补充状态</span>
        <input type="text" data-bind="${B('state.note')}" data-live value="${esc(c.state.note)}" placeholder="例：左手受伤，衣角有泥"></label>
      `,
      footer: `<button class="btn danger" id="delChar">删除人物</button>
               <div style="flex:1"></div>
               <button class="btn primary" id="doneChar">完成</button>`
    });

    bindInputs(mask);
    const groupSel = mask.querySelector('#charGroupSel');
    if (groupSel) groupSel.addEventListener('change', () => setTimeout(() => this.refresh(), 0));
    const relList = mask.querySelector('#relList');
    const fiList = mask.querySelector('#fiList');
    const redrawRel = () => { relList.innerHTML = this._relHtml(c, others()); };
    const redrawFi = () => { fiList.innerHTML = this._fiHtml(c); };

    // 事件委托：重绘行不会丢监听
    const onRelEdit = (e) => {
      const t = e.target;
      if (t.dataset.rel === undefined) return;
      c.relations[Number(t.dataset.rel)][t.dataset.k] = t.value;
      Store.touch();
      if (t.dataset.k === 'target') redrawRel();
      this.refresh();
    };
    relList.addEventListener('input', onRelEdit);
    relList.addEventListener('change', onRelEdit);
    relList.addEventListener('click', (e) => {
      const del = e.target.closest('[data-delrel]');
      if (del) {
        c.relations.splice(Number(del.dataset.delrel), 1);
        Store.touch(); redrawRel(); this.refresh(); return;
      }
      const mir = e.target.closest('[data-mirror]');
      if (mir) { this.mirrorRel(id, Number(mir.dataset.mirror), redrawRel); return; }
      const up = e.target.closest('[data-up]');
      if (up) { const i = Number(up.dataset.up); this.moveRel(c, i, i - 1, redrawRel); return; }
      const down = e.target.closest('[data-down]');
      if (down) { const i = Number(down.dataset.down); this.moveRel(c, i, i + 1, redrawRel); }
    });

    /* 拖动排序：只从 ⠿ 手柄发起来，避免影响输入框选字 */
    let dragFrom = -1;
    const clearDropMarks = () => relList.querySelectorAll('.rel-row').forEach(
      (r) => r.classList.remove('drop-before', 'drop-after', 'dragging'));
    relList.addEventListener('dragstart', (e) => {
      const grip = e.target.closest('[data-grip]');
      if (!grip) { e.preventDefault(); return; }
      dragFrom = Number(grip.dataset.grip);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragFrom));
      const row = grip.closest('.rel-row');
      if (row) row.classList.add('dragging');
    });
    relList.addEventListener('dragover', (e) => {
      if (dragFrom < 0) return;
      const row = e.target.closest('.rel-row');
      if (!row) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropMarks();
      const rect = row.getBoundingClientRect();
      row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
    });
    relList.addEventListener('drop', (e) => {
      if (dragFrom < 0) return;
      const row = e.target.closest('.rel-row');
      if (!row) return;
      e.preventDefault();
      const to = Number(row.dataset.ri);
      const rect = row.getBoundingClientRect();
      let dest = e.clientY >= rect.top + rect.height / 2 ? to + 1 : to;
      if (dest > dragFrom) dest--; // 先摘掉自己，后面的索引会前移一位
      const from = dragFrom;
      dragFrom = -1;
      clearDropMarks();
      this.moveRel(c, from, dest, redrawRel);
    });
    relList.addEventListener('dragend', () => { dragFrom = -1; clearDropMarks(); });

    mask.querySelector('#addRel').onclick = () => {
      c.relations = c.relations || [];
      c.relations.push({ id: uid('rel'), target: '', kind: '', attitude: '', time: '初始' });
      Store.touch();
      redrawRel();
      const rows = relList.querySelectorAll('.rel-row');
      const last = rows[rows.length - 1];
      if (last) { last.querySelector('select').focus(); last.scrollIntoView({ block: 'nearest' }); }
      this.refresh();
    };

    c.futureItems = c.futureItems || [];
    fiList.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.fi === undefined) return;
      c.futureItems[Number(t.dataset.fi)] = t.value;
      Store.touch();
    });
    fiList.addEventListener('click', (e) => {
      const b = e.target.closest('[data-delfi]');
      if (!b) return;
      c.futureItems.splice(Number(b.dataset.delfi), 1);
      Store.touch(); redrawFi();
    });
    mask.querySelector('#addFi').onclick = () => {
      c.futureItems.push('');
      Store.touch(); redrawFi();
      const ins = fiList.querySelectorAll('input');
      if (ins.length) ins[ins.length - 1].focus();
    };

    /* 随身道具：局部重绘 + 即时落盘，输入时不打断打字 */
    c.items = c.items || [];
    const propList = mask.querySelector('#propList');
    const propCount = mask.querySelector('#propCount');
    const redrawProps = () => {
      propList.innerHTML = this._propHtml(c);
      if (propCount) propCount.textContent = c.items.length;
    };
    propList.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.prop === undefined) return;
      const it = c.items[Number(t.dataset.prop)];
      if (!it) return;
      it[t.dataset.k] = t.value;
      Store.rebuildInventory();
      Store.touch();
      this.refresh();
    });
    propList.addEventListener('click', (e) => {
      const del = e.target.closest('[data-delprop]');
      if (del) {
        const it = c.items[Number(del.dataset.delprop)];
        if (!it) return;
        if (!confirm(`删除道具「${it.name || '未命名'}」？`)) return;
        Store.propRemove(it.id);
        redrawProps(); this.refresh();
        return;
      }
      const ed = e.target.closest('[data-editprop]');
      if (ed) {
        const it = c.items[Number(ed.dataset.editprop)];
        if (it && Views.props) Views.props.edit(it.id);
      }
    });
    mask.querySelector('#addProp').onclick = () => {
      Store.propAdd({}, 'char', id);
      redrawProps(); this.refresh();
      const rows = propList.querySelectorAll('input[data-k="name"]');
      const last = rows[rows.length - 1];
      if (last) { last.focus(); last.scrollIntoView({ block: 'nearest' }); }
    };
    mask.querySelector('#openPropLib').onclick = () => { Modal.close(); App.go('props'); };

    mask.querySelector('#doneChar').onclick = () => Modal.close();
    mask.querySelector('#delChar').onclick = () => {
      if (!confirm(`删除「${c.name || '未命名'}」？`)) return;
      Store.data.characters.forEach((x) => {
        if (x.id !== id) x.relations = (x.relations || []).filter((r) => r.target !== id);
      });
      Store.data.characters.splice(idx, 1);
      delete netPos()[id];
      Store.touch();
      Modal.close();
    };
  },

  /** 在对方档案里补一条镜像关系 */
  mirrorRel(id, ri, after) {
    const c = Store.char(id);
    const r = c && c.relations[ri];
    if (!r || !r.target) return toast('先选好关系对象', 'err');
    const other = Store.char(r.target);
    if (!other) return toast('对象不存在', 'err');
    const txt = relText(r);
    const dup = (other.relations || []).some((x) => x.target === id && relText(x) === txt);
    if (dup) return toast('对方档案里已经记过这条了');
    other.relations = other.relations || [];
    other.relations.push({
      id: uid('rel'), target: id, kind: txt, time: r.time || '初始', attitude: ''
    });
    Store.touch();
    this.refresh();
    if (after) after();
    toast(`已在「${other.name || '未命名'}」档案里记一条`);
  }
};
