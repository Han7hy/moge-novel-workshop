/* ============ view-outline.js —— 卷 · 情节画布 ============ */
window.Views = window.Views || {};

/* 线类型（颜色同时用于 SVG 箭头与图例） */
const OL_TYPES = [
  { key: 'main', label: '明线', color: '#b8452f' },
  { key: 'dark', label: '暗线', color: '#8a6bc0' },
  { key: 'char', label: '人物线', color: '#4a917e' },
  { key: 'sub', label: '支线', color: '#c39a3a' }
];
const OL_TYPE = {};
OL_TYPES.forEach((t) => (OL_TYPE[t.key] = t));
const OL_STAGE_W = 5000;
const OL_STAGE_H = 4000;

Views.outline = {
  title: '大纲',
  sub: '卷 · 情节点 · 线',

  _cur: '',        // 当前打开的卷 id（空 = 卷列表）
  _sel: '',        // 选中的情节点
  _selEdge: '',    // 选中的连线
  _pen: 'main',    // 新建连线用的线类型
  _hide: {},       // 隐藏的线类型
  _drawer: false,  // 本卷/章节抽屉
  _link: false,    // 点击连线模式
  _linkFrom: '',   // 连线模式起点
  _editId: '',     // 正在卡片上直接编辑的情节点
  _editBackup: null,
  _geom: new Map(),

  actions() {
    const vol = this.vol();
    if (vol) return `<button class="btn" id="btnBackVol">← 卷列表</button>`;
    return `<button class="btn" id="btnGenOutline">AI 生成大纲</button>
            <button class="btn primary" id="btnAddVol">+ 新卷</button>`;
  },

  vol() {
    const vols = (Store.data && Store.data.outline && Store.data.outline.volumes) || [];
    return vols.find((v) => v.id === this._cur) || null;
  },

  mount(el) {
    const vol = this.vol();
    if (!vol) {
      this._cur = '';
      this.renderList(el);
      return;
    }
    this.renderCanvas(el, vol);
  },

  /* ================= 卷列表 ================= */
  renderList(el) {
    const vols = Store.data.outline.volumes || [];
    if (!vols.length) {
      el.innerHTML = `<div class="empty">
        <h3>还没有大纲</h3>
        <p class="small">先建一卷，进去画你的情节网络：加点、连线，明线暗线人物线各走各的。</p>
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:center">
          <button class="btn primary" onclick="Views.outline.genOutline()">AI 生成大纲</button>
          <button class="btn" onclick="Views.outline.addVol()">手动新建一卷</button>
        </div>
      </div>`;
      return;
    }

    el.innerHTML = `<div class="ol-list">
      ${vols.map((v, vi) => {
        const cv = v.canvas || { nodes: [], edges: [] };
        const lines = cv.edges.length;
        const byType = {};
        cv.edges.forEach((e) => { byType[e.type] = (byType[e.type] || 0) + 1; });
        const types = OL_TYPES.filter((t) => byType[t.key]).map((t) =>
          `<span class="ol-dot-wrap"><i style="background:${t.color}"></i>${t.label} ${byType[t.key]}</span>`).join('');
        return `<div class="ol-card" data-vol="${esc(v.id)}">
          <div class="ol-card-top">
            <span class="ol-card-no">第${vi + 1}卷</span>
            <button class="btn sm ghost danger" data-delvol="${esc(v.id)}" title="删除这一卷">✕</button>
          </div>
          <h3 class="ol-card-title">${esc(v.title || '未命名卷')}</h3>
          <p class="ol-card-sum${v.summary ? '' : ' ol-card-empty-sum'}">${esc((v.summary || '').slice(0, 68) || '本卷还没有概要')}</p>
          <div class="ol-card-meta">
            <span>${cv.nodes.length} 个情节点</span>
            <span>${(v.chapters || []).length} 章</span>
          </div>
          ${types ? `<div class="ol-card-types">${types}</div>` : ''}
          <div class="ol-card-go">进入画布 →</div>
        </div>`;
      }).join('')}
      <div class="ol-card ol-card-new" id="olNewCard">
        <div class="ol-new-plus">＋</div>
        <div class="small muted">新建一卷</div>
      </div>
    </div>`;

    el.querySelectorAll('[data-vol]').forEach((c) => {
      c.onclick = (e) => {
        if (e.target.closest('[data-delvol]')) return;
        this._cur = c.dataset.vol;
        this._sel = ''; this._selEdge = ''; this._linkFrom = ''; this._drawer = false;
        App.rerender();
      };
    });
    el.querySelectorAll('[data-delvol]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const v = Store.data.outline.volumes.find((x) => x.id === b.dataset.delvol);
        if (!v) return;
        if (!confirm('删除「' + (v.title || '未命名卷') + '」？这一卷的情节点和连线都会一起删掉。')) return;
        Store.data.outline.volumes = Store.data.outline.volumes.filter((x) => x.id !== v.id);
        Store.touch();
        App.rerender();
      };
    });
    const nc = $('#olNewCard');
    if (nc) nc.onclick = () => this.addVol();
    const a = $('#btnAddVol');
    if (a) a.onclick = () => this.addVol();
    const g = $('#btnGenOutline');
    if (g) g.onclick = () => this.genOutline();
  },

  backToList() {
    this._cur = ''; this._sel = ''; this._selEdge = '';
    this._link = false; this._linkFrom = ''; this._drawer = false;
    this._editId = ''; this._editBackup = null;
    App.rerender();
  },

  /* ================= 卷内画布 ================= */
  renderCanvas(el, vol) {
    const vi = Store.data.outline.volumes.indexOf(vol);
    const cv = vol.canvas;
    const v = cv.view;
    const chapters = vol.chapters || [];

    el.innerHTML = `
    <div class="olc">
      <div class="olc-bar">
        <button class="btn sm" id="olcBack">← 卷列表</button>
        <input class="bare olc-title" id="olcTitle" value="${esc(vol.title)}" placeholder="本卷标题">
        <span class="chip" id="olcStat">${cv.nodes.length} 点 · ${cv.edges.length} 线</span>
        <div class="olc-tools">
          <button class="btn sm" id="olcAdd">＋ 情节点</button>
          <button class="btn sm${this._link ? ' primary' : ''}" id="olcLinkBtn" title="点两个情节点，连成一条线">⇢ 连线</button>
          <label class="olc-pen"><span>新线</span>
            <select id="olcPen">
              ${OL_TYPES.map((t) => `<option value="${t.key}" ${this._pen === t.key ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </label>
          <button class="btn sm" id="olcLayout">整理</button>
          <button class="btn sm" id="olcFit">适应</button>
          <button class="btn sm" id="olcAi">✦ AI 铺这一卷</button>
          <button class="btn sm" id="olcDrawerBtn">本卷 · 章节</button>
        </div>
      </div>

      <div class="olc-legend">
        <span class="olc-lg-t">线</span>
        ${OL_TYPES.map((t) => `<button class="olc-lg${this._hide[t.key] ? ' off' : ''}" data-lg="${t.key}"><i style="background:${t.color}"></i>${t.label}</button>`).join('')}
        <span class="olc-hint-t">拖动空白平移 · 滚轮缩放 · 双击空白加情节 · 拖节点右侧小圆点到另一个节点连线</span>
      </div>

      <div class="olc-view" id="olcView">
        <div class="olc-stage" id="olcStage" style="transform:translate(${v.x}px,${v.y}px) scale(${v.zoom});width:${OL_STAGE_W}px;height:${OL_STAGE_H}px">
          <svg class="olc-svg" id="olcSvg" width="${OL_STAGE_W}" height="${OL_STAGE_H}">
            <defs>
              ${OL_TYPES.map((t) => `<marker id="olm-${t.key}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1 L9,5 L0,9 z" fill="${t.color}"></path></marker>`).join('')}
            </defs>
            <g id="olcEdges"></g>
            <path id="olcTemp" class="olc-temp" d=""></path>
          </svg>
          <div class="olc-nodes" id="olcNodes"></div>
        </div>

        <div class="olc-zoom">
          <button id="olcZin" title="放大">＋</button>
          <span id="olcZval">${Math.round(v.zoom * 100)}%</span>
          <button id="olcZout" title="缩小">－</button>
          <button id="olcZreset" title="适应画布">⟲</button>
        </div>

        <div id="olcIns"></div>

        <div class="olc-drawer${this._drawer ? ' open' : ''}" id="olcDrawer">
          <div class="olc-dw-head">
            <span>本卷 · 章节</span>
            <button class="btn sm ghost" id="olcDrawerClose">✕</button>
          </div>
          <div class="olc-dw-body">
            <label class="fld"><span>本卷概要</span>
              <textarea data-bind="outline.volumes.${vi}.summary" data-live rows="3" placeholder="这一卷从哪开始、到哪结束、主角得到/失去了什么">${esc(vol.summary || '')}</textarea>
            </label>
            <div class="olc-dw-sec">
              <span>章节</span>
              <button class="btn sm" id="olcAddCh">＋ 章</button>
            </div>
            ${(chapters.length ? chapters.map((c, ci) => `
              <div class="olc-ch">
                <div class="olc-ch-h">
                  <input class="bare" data-bind="outline.volumes.${vi}.chapters.${ci}.title" data-live value="${esc(c.title)}" style="flex:1;font-size:12.5px">
                  <button class="btn sm ghost" data-addsc="${ci}" title="加场景">＋场</button>
                  <button class="btn sm ghost danger" data-delch="${ci}" title="删这一章">✕</button>
                </div>
                ${(c.scenes || []).map((s, si) => `<div class="olc-sc" data-scene="${ci}.${si}">
                  <span class="st">${esc(s.title || '未命名场景')}</span>
                  <span class="small muted">${(s.cast || []).length}人</span>
                </div>`).join('') || '<div class="small muted" style="padding:2px 4px 6px">还没有场景</div>'}
              </div>`).join('') : '<div class="small muted" style="padding:4px 0">这一卷还没有章节</div>')}
            <div class="hint" style="margin-top:10px">情节点可以挂到某一章；章节与场景仍然供「角色对话」「写作」调用。</div>
          </div>
        </div>

        ${!cv.nodes.length ? `<div class="olc-empty" id="olcEmpty">
          <h3>这块画布还是空的</h3>
          <p class="small">双击空白处落一个情节点；把点右侧的小圆点拖到另一个点，就连成一条线。明线、暗线、人物线分开画。</p>
          <button class="btn primary sm" id="olcEmptyAi">✦ AI 先铺一版</button>
        </div>` : ''}
      </div>
    </div>`;

    $('#olcBack').onclick = () => this.backToList();
    const topBack = $('#btnBackVol');
    if (topBack) topBack.onclick = () => this.backToList();
    $('#olcTitle').oninput = (e) => { vol.title = e.target.value; Store.touch(); };
    $('#olcAdd').onclick = () => this.addNode(vol);
    $('#olcLinkBtn').onclick = () => {
      this._link = !this._link;
      this._linkFrom = '';
      if (this._link) toast('连线模式：依次点两个情节点');
      App.rerender();
    };
    $('#olcPen').onchange = (e) => { this._pen = e.target.value; };
    $('#olcLayout').onclick = () => {
      this.layout(vol);
      vol.canvas.view = { x: 0, y: 0, zoom: 1 }; // 重置视口 → 重挂载后自动适应
      Store.touch();
      this.renderCanvas(el, vol);
    };
    $('#olcFit').onclick = () => this.fit(vol);
    $('#olcZreset').onclick = () => this.fit(vol);
    $('#olcAi').onclick = () => this.genCanvas(vol);
    $('#olcDrawerBtn').onclick = () => { this._drawer = !this._drawer; $('#olcDrawer').classList.toggle('open', this._drawer); };
    $('#olcDrawerClose').onclick = () => { this._drawer = false; $('#olcDrawer').classList.remove('open'); };
    const ea = $('#olcEmptyAi');
    if (ea) ea.onclick = () => this.genCanvas(vol);

    // 图例：点一下隐藏/显示该类线
    el.querySelectorAll('[data-lg]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.lg;
        this._hide[k] = !this._hide[k];
        b.classList.toggle('off', !!this._hide[k]);
        this.drawEdges(vol);
      };
    });

    // 抽屉里的章节/场景
    const drawer = $('#olcDrawer');
    if (drawer) {
      bindInputs(drawer);
      drawer.querySelectorAll('[data-addsc]').forEach((b) => {
        b.onclick = () => {
          const ci = Number(b.dataset.addsc);
          const ch = vol.chapters[ci];
          ch.scenes = ch.scenes || [];
          ch.scenes.push({
            id: uid('sc'),
            title: '新场景',
            placeId: Store.data.map.nodes[0] ? Store.data.map.nodes[0].id : '',
            cast: Store.data.characters.slice(0, 2).map((c) => c.id),
            goal: '', conflict: '', beats: []
          });
          Store.touch();
          this.renderCanvas(el, vol);
        };
      });
      drawer.querySelectorAll('[data-delch]').forEach((b) => {
        b.onclick = () => {
          const ci = Number(b.dataset.delch);
          if (!confirm('删除这一章？（这一章的场景也会删掉）')) return;
          vol.chapters.splice(ci, 1);
          Store.touch();
          this.renderCanvas(el, vol);
        };
      });
      drawer.querySelectorAll('[data-scene]').forEach((row) => {
        row.onclick = () => {
          const [ci, si] = row.dataset.scene.split('.').map(Number);
          this.editScene(vi, ci, si);
        };
      });
      const ac = drawer.querySelector('#olcAddCh');
      if (ac) ac.onclick = () => {
        vol.chapters.push({ id: uid('chp'), title: '第' + (vol.chapters.length + 1) + '章', summary: '', scenes: [] });
        Store.touch();
        this.renderCanvas(el, vol);
      };
    }

    this.paintNodes(vol);
    this.bindCanvas(vol, el);
    requestAnimationFrame(() => {
      this.measure(vol);
      this.drawEdges(vol);
      const vv = vol.canvas.view;
      if (!vol.canvas.nodes.length) { this.applyView(vol); return; }
      // 首次进入（视口还是原始值）自动适应内容
      if (vv.x === 0 && vv.y === 0 && vv.zoom === 1) this.fit(vol);
      else this.applyView(vol);
      this.renderInspector(vol);
    });
  },

  /* ---------- 节点绘制 ---------- */
  paintNodes(vol) {
    const box = $('#olcNodes');
    if (!box) return;
    const deg = {};
    vol.canvas.edges.forEach((e) => { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; });
    box.innerHTML = vol.canvas.nodes.map((n) => {
      const cls = 'olc-node' + (n.id === this._sel ? ' sel' : '') + (n.id === this._linkFrom ? ' linking' : '')
        + (n.id === this._editId ? ' editing' : '');
      const meta = `${n.ch >= 0 && vol.chapters[n.ch] ? '第' + (n.ch + 1) + '章 · ' : ''}${deg[n.id] || 0} 线`;
      if (n.id === this._editId) {
        return `<div class="${cls}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px">
          <input class="olc-p-t" data-p="t" type="text" value="${esc(n.title)}" placeholder="这个情节点叫什么" spellcheck="false">
          <textarea class="olc-p-d" data-p="d" rows="2" placeholder="这里发生了什么（可空）" spellcheck="false">${esc(n.desc)}</textarea>
          <div class="olc-n-m">${meta}<span class="olc-p-hint">Esc 取消 · Ctrl+↵ 完成</span></div>
        </div>`;
      }
      return `<div class="${cls}" data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px" title="双击直接编辑">
        <div class="olc-n-t">${esc(n.title || '未命名情节点')}</div>
        ${n.desc ? `<div class="olc-n-d">${esc(n.desc)}</div>` : ''}
        <div class="olc-n-m">${meta}<button type="button" class="olc-n-edit" data-edit="${esc(n.id)}" title="编辑这个情节点">✎ 编辑</button></div>
        <span class="olc-n-dot" data-dot="${esc(n.id)}" title="拖到另一个情节点连线"></span>
      </div>`;
    }).join('');
    const ed = this._editId ? box.querySelector('.olc-node.editing') : null;
    if (ed) this.bindInlineEdit(vol, ed);
  },

  /* ---------- 卡片上直接编辑 ---------- */
  bindInlineEdit(vol, el) {
    const self = this;
    const node = vol.canvas.nodes.find((n) => n.id === el.dataset.id);
    if (!node) return;
    const t = el.querySelector('[data-p="t"]');
    const d = el.querySelector('[data-p="d"]');
    if (!t || !d) return;

    const grow = () => {
      d.style.height = 'auto';
      d.style.height = Math.max(30, d.scrollHeight) + 'px';
      self.measure(vol);
      self.drawEdges(vol);
    };

    t.oninput = () => { node.title = t.value; Store.touch(); };
    d.oninput = () => { node.desc = d.value; Store.touch(); grow(); };

    const onKey = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); self.cancelEdit(vol); return; }
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); self.commitEdit(vol); return; }
      // 标题里回车：跳到描述
      if (ev.key === 'Enter' && !ev.shiftKey && ev.target === t) { ev.preventDefault(); d.focus(); }
    };
    t.onkeydown = onKey;
    d.onkeydown = onKey;

    const onBlur = () => {
      setTimeout(() => {
        const a = document.activeElement;
        if (a && el.contains(a)) return;           // 两个框之间切换不算离开
        if (self._editId !== node.id) return;      // 已经提交/取消过
        if (!document.body.contains(el)) return;   // 卡片已被重绘
        self.commitEdit(vol);
      }, 0);
    };
    t.onblur = onBlur;
    d.onblur = onBlur;

    t.onpointerdown = (ev) => ev.stopPropagation();
    d.onpointerdown = (ev) => ev.stopPropagation();
    grow();
  },

  startEdit(vol, id) {
    const node = vol.canvas.nodes.find((n) => n.id === id);
    if (!node) return;
    this._editId = id;
    this._editBackup = { title: node.title, desc: node.desc };
    this._sel = id;
    this._selEdge = '';
    this.paintNodes(vol);
    this.measure(vol);
    this.drawEdges(vol);
    this.renderInspector(vol);
    const t = document.querySelector(`.olc-node[data-id="${id}"] [data-p="t"]`);
    if (t) {
      t.focus();
      if (!String(node.title || '').trim() || node.title === '新情节点') t.select();
      else t.setSelectionRange(t.value.length, t.value.length);
    }
  },

  commitEdit(vol) {
    const id = this._editId;
    if (!id) return;
    const node = vol.canvas.nodes.find((n) => n.id === id);
    this._editId = '';
    this._editBackup = null;
    if (node && !String(node.title || '').trim()) node.title = '未命名情节点';
    Store.touch();
    // 如果焦点已经挪到右侧面板，就不要重绘面板，免得把用户刚点中的输入框冲掉
    const a = document.activeElement;
    const inIns = !!(a && a.closest && a.closest('#olcIns'));
    this.paintNodes(vol);
    this.measure(vol);
    this.drawEdges(vol);
    if (!inIns) this.renderInspector(vol);
  },

  cancelEdit(vol) {
    const id = this._editId;
    if (!id) return;
    const node = vol.canvas.nodes.find((n) => n.id === id);
    const bk = this._editBackup || {};
    this._editId = '';
    this._editBackup = null;
    if (node) {
      if (bk.title != null) node.title = bk.title;
      if (bk.desc != null) node.desc = bk.desc;
    }
    Store.touch();
    this.paintNodes(vol);
    this.measure(vol);
    this.drawEdges(vol);
    this.renderInspector(vol);
  },

  measure(vol) {
    this._geom = new Map();
    const box = $('#olcNodes');
    if (!box) return;
    box.querySelectorAll('.olc-node').forEach((el) => {
      const id = el.dataset.id;
      this._geom.set(id, {
        x: parseFloat(el.style.left) || 0,
        y: parseFloat(el.style.top) || 0,
        w: el.offsetWidth || 210,
        h: el.offsetHeight || 72
      });
    });
  },

  /* ---------- 连线绘制 ---------- */
  drawEdges(vol) {
    const g = $('#olcEdges');
    const svg = $('#olcSvg');
    if (!g || !svg) return;
    const self = this;
    const paths = [];
    vol.canvas.edges.forEach((e) => {
      if (this._hide[e.type]) return;
      const a = this._geom.get(e.from);
      const b = this._geom.get(e.to);
      if (!a || !b) return;
      const t = OL_TYPE[e.type] || OL_TYPES[0];
      const p = curve(a, b, e.id);
      const sel = e.id === this._selEdge;
      paths.push(`<path class="olc-edge t-${t.key}${sel ? ' sel' : ''}" data-edge="${esc(e.id)}" d="${p.d}" stroke="${t.color}"
        stroke-width="${sel ? 3 : 2}" fill="none" marker-end="url(#olm-${t.key})" style="pointer-events:stroke"></path>`);
      if (e.label) {
        paths.push(`<text class="olc-elabel t-${t.key}" x="${p.mx}" y="${p.my}" fill="${t.color}">${esc(e.label)}</text>`);
      }
    });
    g.innerHTML = paths.join('');
    g.querySelectorAll('path[data-edge]').forEach((p) => {
      p.onclick = (ev) => {
        ev.stopPropagation();
        self._selEdge = p.dataset.edge;
        self._sel = '';
        self.paintNodes(vol);
        self.drawEdges(vol);
        self.renderInspector(vol);
      };
    });
  },

  /* ---------- 视口 ---------- */
  applyView(vol) {
    const stage = $('#olcStage');
    const v = vol.canvas.view;
    if (stage) stage.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.zoom})`;
    const zl = $('#olcZval');
    if (zl) zl.textContent = Math.round(v.zoom * 100) + '%';
  },

  saveView(vol) { Store.touch(); },

  fit(vol) {
    const view = $('#olcView');
    const v = vol.canvas.view;
    this.measure(vol);
    if (!vol.canvas.nodes.length) {
      v.x = 60; v.y = 60; v.zoom = 1;
      this.applyView(vol); this.saveView(vol);
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    vol.canvas.nodes.forEach((n) => {
      const g = this._geom.get(n.id) || { x: n.x, y: n.y, w: 210, h: 72 };
      minX = Math.min(minX, g.x); minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.w); maxY = Math.max(maxY, g.y + g.h);
    });
    const cw = view.clientWidth, chh = view.clientHeight;
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const pad = 70;
    const z = Math.max(0.3, Math.min(1.1, Math.min((cw - pad * 2) / bw, (chh - pad * 2) / bh)));
    v.zoom = z;
    v.x = (cw - bw * z) / 2 - minX * z;
    v.y = (chh - bh * z) / 2 - minY * z;
    this.applyView(vol);
    this.saveView(vol);
  },

  zoomAt(vol, mx, my, factor) {
    const view = $('#olcView');
    if (!view) return;
    const v = vol.canvas.view;
    const nz = Math.max(0.25, Math.min(2.5, v.zoom * factor));
    if (Math.abs(nz - v.zoom) < 0.0001) return;
    const gx = (mx - v.x) / v.zoom, gy = (my - v.y) / v.zoom;
    v.zoom = nz;
    v.x = mx - gx * nz;
    v.y = my - gy * nz;
    this.applyView(vol);
    this.saveView(vol);
  },

  /* ---------- 交互 ---------- */
  bindCanvas(vol, el) {
    const self = this;
    const view = $('#olcView');
    const nodesBox = $('#olcNodes');
    if (!view || !nodesBox) return;

    view.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = view.getBoundingClientRect();
      self.zoomAt(vol, ev.clientX - r.left, ev.clientY - r.top, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    /* 平移 / 空白双击 */
    let panning = false, panStart = null, startView = null;
    view.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.olc-node') || ev.target.closest('path[data-edge]')) return;
      if (ev.target.closest('.olc-bar') || ev.target.closest('.olc-zoom') || ev.target.closest('.olc-drawer') || ev.target.closest('#olcIns')) return;
      if (ev.button !== 0) return;
      // 点空白处：先把正在编辑的卡片落笔
      if (self._editId) { self.commitEdit(vol); return; }
      panning = true;
      panStart = { x: ev.clientX, y: ev.clientY };
      startView = Object.assign({}, vol.canvas.view);
      view.setPointerCapture(ev.pointerId);
    });
    view.addEventListener('pointermove', (ev) => {
      if (!panning || !panStart) return;
      const v = vol.canvas.view;
      v.x = startView.x + (ev.clientX - panStart.x);
      v.y = startView.y + (ev.clientY - panStart.y);
      self.applyView(vol);
    });
    const endPan = () => {
      if (!panning) return;
      panning = false; panStart = null;
      const v = vol.canvas.view;
      v.x = Math.max(-OL_STAGE_W + 200, Math.min(OL_STAGE_W - 200, v.x));
      v.y = Math.max(-OL_STAGE_H + 200, Math.min(OL_STAGE_H - 200, v.y));
      self.applyView(vol);
      self.saveView(vol);
    };
    view.addEventListener('pointerup', endPan);
    view.addEventListener('pointercancel', endPan);

    view.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('.olc-node') || ev.target.closest('.olc-bar') || ev.target.closest('.olc-drawer') || ev.target.closest('#olcIns') || ev.target.closest('.olc-zoom')) return;
      const r = view.getBoundingClientRect();
      const v = vol.canvas.view;
      const wx = (ev.clientX - r.left - v.x) / v.zoom;
      const wy = (ev.clientY - r.top - v.y) / v.zoom;
      self.addNode(vol, wx, wy);
    });

    /* 节点拖动 / 拉线 */
    let drag = null, link = null;
    nodesBox.addEventListener('pointerdown', (ev) => {
      // 正在卡片上打字，交给输入框
      if (ev.target.closest('.olc-node.editing')) return;
      // 卡片上的铅笔：直接进编辑
      const pen = ev.target.closest('[data-edit]');
      if (pen) {
        ev.preventDefault();
        ev.stopPropagation();
        if (self._editId) self.commitEdit(vol);
        self.startEdit(vol, pen.dataset.edit);
        return;
      }
      // 点别的卡片就先落笔，避免旧编辑态残留
      if (self._editId) {
        const anyNode = ev.target.closest('.olc-node');
        const nid = anyNode ? anyNode.dataset.id : '';
        self.commitEdit(vol);
        if (nid) {
          self._sel = nid;
          self._selEdge = '';
          self.paintNodes(vol);
          self.renderInspector(vol);
        }
        return;
      }
      const dot = ev.target.closest('[data-dot]');
      if (dot) {
        ev.preventDefault();
        ev.stopPropagation();
        view.setPointerCapture(ev.pointerId);
        const g = self._geom.get(dot.dataset.dot);
        link = { from: dot.dataset.dot, g };
        return;
      }
      const node = ev.target.closest('.olc-node');
      if (!node) return;
      ev.preventDefault();
      ev.stopPropagation();
      const id = node.dataset.id;
      if (self._link) { self.clickLink(vol, id); return; }
      const n = vol.canvas.nodes.find((x) => x.id === id);
      if (!n) return;
      view.setPointerCapture(ev.pointerId);
      drag = {
        id, node,
        startX: ev.clientX, startY: ev.clientY,
        ox: n.x, oy: n.y, moved: false
      };
      node.classList.add('dragging');
    });

    view.addEventListener('pointermove', (ev) => {
      if (drag) {
        const z = vol.canvas.view.zoom || 1;
        const dx = (ev.clientX - drag.startX) / z;
        const dy = (ev.clientY - drag.startY) / z;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
        const n = vol.canvas.nodes.find((x) => x.id === drag.id);
        if (!n) return;
        n.x = Math.round(Math.max(0, Math.min(OL_STAGE_W - 220, drag.ox + dx)));
        n.y = Math.round(Math.max(0, Math.min(OL_STAGE_H - 120, drag.oy + dy)));
        drag.node.style.left = n.x + 'px';
        drag.node.style.top = n.y + 'px';
        self.measure(vol);
        self.drawEdges(vol);
        return;
      }
      if (link) {
        const r = view.getBoundingClientRect();
        const v = vol.canvas.view;
        const wx = (ev.clientX - r.left - v.x) / v.zoom;
        const wy = (ev.clientY - r.top - v.y) / v.zoom;
        const a = link.g;
        if (!a) return;
        const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
        const temp = $('#olcTemp');
        if (temp) temp.setAttribute('d', `M${ax},${ay} L${wx},${wy}`);
      }
    });

    view.addEventListener('pointerup', (ev) => {
      if (drag) {
        const moved = drag.moved;
        const dragId = drag.id;
        drag.node.classList.remove('dragging');
        drag = null;
        Store.touch();
        if (!moved) {
          // 卡片上拖拽时 pointerdown 会 preventDefault，浏览器不再派发 dblclick，
          // 所以这里自己判双击（同一张卡 340ms 内连点两下）
          const now = Date.now();
          const last = self._lastTap;
          if (!self._link && last && last.id === dragId && now - last.t < 340) {
            self._lastTap = null;
            self.startEdit(vol, dragId);
            return;
          }
          self._lastTap = { id: dragId, t: now };
          self._sel = dragId;
          self._selEdge = '';
          self.paintNodes(vol);
          self.drawEdges(vol);
          self.renderInspector(vol);
        }
        return;
      }
      if (link) {
        const temp = $('#olcTemp');
        if (temp) temp.setAttribute('d', '');
        const targetEl = document.elementFromPoint(ev.clientX, ev.clientY);
        const nodeEl = targetEl && targetEl.closest ? targetEl.closest('.olc-node') : null;
        const from = link.from;
        link = null;
        if (nodeEl && nodeEl.dataset.id !== from) self.addEdge(vol, from, nodeEl.dataset.id);
      }
    });

    view.addEventListener('pointercancel', () => {
      drag = null; link = null;
      const temp = $('#olcTemp');
      if (temp) temp.setAttribute('d', '');
    });
  },

  clickLink(vol, id) {
    if (!this._linkFrom) {
      this._linkFrom = id;
      this.paintNodes(vol);
      this.renderInspector(vol);
      toast('起点已选中，再点另一个情节点');
      return;
    }
    if (this._linkFrom === id) {
      this._linkFrom = '';
      this.paintNodes(vol);
      return;
    }
    const from = this._linkFrom;
    this._linkFrom = '';
    this.addEdge(vol, from, id);
  },

  addEdge(vol, from, to) {
    if (!from || !to || from === to) return;
    const dup = vol.canvas.edges.find((e) =>
      (e.from === from && e.to === to) || (e.from === to && e.to === from));
    if (dup) {
      this._selEdge = dup.id;
      this._sel = '';
      toast('这两个点之间已经有一条线了');
      this.drawEdges(vol);
      this.renderInspector(vol);
      return;
    }
    const e = { id: uid('oe'), from, to, type: this._pen, label: '' };
    vol.canvas.edges.push(e);
    this._selEdge = e.id;
    this._sel = '';
    Store.touch();
    this.drawEdges(vol);
    this.paintNodes(vol);
    this.renderInspector(vol);
  },

  /* ---------- 增删改 ---------- */
  addNode(vol, x, y) {
    const view = $('#olcView');
    let wx = x, wy = y;
    if (wx == null || wy == null) {
      const v = vol.canvas.view;
      const cw = view ? view.clientWidth : 900;
      const chh = view ? view.clientHeight : 600;
      wx = (cw / 2 - v.x) / v.zoom - 105;
      wy = (chh / 2 - v.y) / v.zoom - 40;
    }
    const n = {
      id: uid('oc'),
      title: '新情节点',
      desc: '',
      ch: -1,
      x: Math.round(Math.max(20, Math.min(OL_STAGE_W - 240, wx))),
      y: Math.round(Math.max(20, Math.min(OL_STAGE_H - 140, wy)))
    };
    vol.canvas.nodes.push(n);
    this._sel = n.id;
    this._selEdge = '';
    const empty = $('#olcEmpty');
    if (empty) empty.remove();
    Store.touch();
    this.paintNodes(vol);
    this.measure(vol);
    this.drawEdges(vol);
    this.renderInspector(vol);
    // 新建的点直接进入卡片编辑，省得再去右边面板改名
    this.startEdit(vol, n.id);
  },

  removeNode(vol, id) {
    vol.canvas.nodes = vol.canvas.nodes.filter((n) => n.id !== id);
    vol.canvas.edges = vol.canvas.edges.filter((e) => e.from !== id && e.to !== id);
    if (this._sel === id) this._sel = '';
    Store.touch();
    this.paintNodes(vol);
    this.measure(vol);
    this.drawEdges(vol);
    this.renderInspector(vol);
  },

  removeEdge(vol, id) {
    vol.canvas.edges = vol.canvas.edges.filter((e) => e.id !== id);
    if (this._selEdge === id) this._selEdge = '';
    Store.touch();
    this.drawEdges(vol);
    this.paintNodes(vol);
    this.renderInspector(vol);
  },

  /* ---------- 侧边小面板 ---------- */
  renderInspector(vol) {
    const box = $('#olcIns');
    if (!box) return;
    const node = vol.canvas.nodes.find((n) => n.id === this._sel);
    const edge = vol.canvas.edges.find((e) => e.id === this._selEdge);

    if (!node && !edge) {
      box.innerHTML = '';
      return;
    }

    if (node) {
      const opts = ['<option value="-1"' + (node.ch < 0 ? ' selected' : '') + '>未分章</option>']
        .concat(vol.chapters.map((c, i) => `<option value="${i}" ${node.ch === i ? 'selected' : ''}>第${i + 1}章 · ${esc(c.title)}</option>`));
      box.innerHTML = `<div class="olc-ins">
        <div class="olc-ins-h"><span>情节点</span><button class="btn sm ghost" id="insClose">✕</button></div>
        <label class="fld"><span>标题</span><input type="text" id="insTitle" value="${esc(node.title)}" placeholder="一句话说清这个情节点"></label>
        <label class="fld"><span>这里发生了什么</span><textarea id="insDesc" rows="3" placeholder="谁做了什么，改变了什么">${esc(node.desc)}</textarea></label>
        <label class="fld"><span>挂在</span><select id="insCh">${opts.join('')}</select></label>
        <div class="olc-ins-ops">
          <button class="btn sm" id="insLink">从这里连线</button>
          <button class="btn sm danger" id="insDel">删除</button>
        </div>
      </div>`;
      const t = box.querySelector('#insTitle');
      const d = box.querySelector('#insDesc');
      const syncNode = () => {
        const el = document.querySelector(`.olc-node[data-id="${node.id}"]`);
        if (!el) return;
        const tt = el.querySelector('.olc-n-t');
        if (tt) tt.textContent = node.title || '未命名情节点';
        let dd = el.querySelector('.olc-n-d');
        if (node.desc) {
          if (!dd) {
            dd = document.createElement('div');
            dd.className = 'olc-n-d';
            el.insertBefore(dd, el.querySelector('.olc-n-m'));
          }
          dd.textContent = node.desc;
        } else if (dd) dd.remove();
        this.measure(vol);
        this.drawEdges(vol);
      };
      t.oninput = () => { node.title = t.value; Store.touch(); syncNode(); };
      d.oninput = () => { node.desc = d.value; Store.touch(); syncNode(); };
      box.querySelector('#insCh').onchange = (e) => {
        node.ch = Number(e.target.value);
        Store.touch();
        this.paintNodes(vol);
        this.measure(vol);
        this.drawEdges(vol);
      };
      box.querySelector('#insClose').onclick = () => { this._sel = ''; this.paintNodes(vol); this.renderInspector(vol); };
      box.querySelector('#insDel').onclick = () => {
        if (!confirm('删掉这个情节点？连着它的线也会删掉。')) return;
        this.removeNode(vol, node.id);
      };
      box.querySelector('#insLink').onclick = () => {
        this._link = true;
        this._linkFrom = node.id;
        this.paintNodes(vol);
        toast('已从这个点起笔，点另一个情节点完成连线');
        App.rerender();
      };
      return;
    }

    // 连线
    box.innerHTML = `<div class="olc-ins">
      <div class="olc-ins-h"><span>这条线</span><button class="btn sm ghost" id="insClose">✕</button></div>
      <label class="fld"><span>类型</span>
        <select id="insType">${OL_TYPES.map((t) => `<option value="${t.key}" ${edge.type === t.key ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
      </label>
      <label class="fld"><span>备注（可空）</span><input type="text" id="insLabel" value="${esc(edge.label)}" placeholder="这条线在干什么"></label>
      <div class="olc-ins-ops">
        <button class="btn sm danger" id="insDel">删除这条线</button>
      </div>
    </div>`;
    box.querySelector('#insClose').onclick = () => { this._selEdge = ''; this.drawEdges(vol); this.renderInspector(vol); };
    box.querySelector('#insType').onchange = (e) => {
      edge.type = e.target.value;
      this._pen = edge.type;
      Store.touch();
      this.drawEdges(vol);
    };
    box.querySelector('#insLabel').oninput = (e) => {
      edge.label = e.target.value;
      Store.touch();
      this.drawEdges(vol);
    };
    box.querySelector('#insDel').onclick = () => this.removeEdge(vol, edge.id);
  },

  /* ---------- 排版 ---------- */
  layout(vol) {
    const nodes = vol.canvas.nodes;
    if (!nodes.length) return;
    const cols = new Map();
    const useCh = vol.chapters.length > 0 && nodes.some((n) => n.ch >= 0 && vol.chapters[n.ch]);

    if (useCh) {
      // 有章节：按章节分列，没挂章节的甩到最后一列
      const chMax = vol.chapters.length - 1;
      nodes.forEach((n) => {
        const key = n.ch >= 0 && vol.chapters[n.ch] ? n.ch : chMax + 1;
        if (!cols.has(key)) cols.set(key, []);
        cols.get(key).push(n);
      });
    } else {
      // 没章节：按连线做 BFS 分层，从左到右推进，避免排成一条竖线
      const indeg = new Map(nodes.map((n) => [n.id, 0]));
      const outs = new Map(nodes.map((n) => [n.id, []]));
      vol.canvas.edges.forEach((e) => {
        if (outs.has(e.from) && indeg.has(e.to)) {
          outs.get(e.from).push(e.to);
          indeg.set(e.to, indeg.get(e.to) + 1);
        }
      });
      const layer = new Map();
      let frontier = nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
      let depth = 0;
      const seen = new Set();
      while (frontier.length && depth < 24) {
        frontier.forEach((id) => { if (!seen.has(id)) { seen.add(id); layer.set(id, depth); } });
        const next = [];
        frontier.forEach((id) => (outs.get(id) || []).forEach((to) => { if (!seen.has(to)) next.push(to); }));
        frontier = next;
        depth++;
      }
      nodes.forEach((n) => { if (!layer.has(n.id)) layer.set(n.id, depth); });
      nodes.forEach((n) => {
        const k = layer.get(n.id);
        if (!cols.has(k)) cols.set(k, []);
        cols.get(k).push(n);
      });
    }

    const keys = Array.from(cols.keys()).sort((a, b) => a - b);
    keys.forEach((k, ci) => {
      cols.get(k).forEach((n, i) => {
        n.x = 80 + ci * 320;
        n.y = 90 + i * 168;
      });
    });
    toast(useCh ? '已按章节整理成列' : '已按连线先后整理成列');
  },

  /* ---------- AI 铺这一卷 ---------- */
  async genCanvas(vol) {
    if (vol.canvas.nodes.length && !confirm('这一卷画布上已有内容，AI 会整块替换（可撤销）。继续？')) return;
    AIUndo.label('大纲 · AI 铺这一卷');
    const btn = $('#olcAi');
    if (btn) { btn.disabled = true; btn.textContent = '铺线中…'; }
    try {
      const o = await LLM.json({
        messages: Prompts.genVolumeCanvas({ volume: vol, chapters: vol.chapters }),
        temperature: 0.92,
        maxTokens: 4200
      });
      const raw = Array.isArray(o.nodes) ? o.nodes : [];
      if (!raw.length) throw new Error('模型没有给出情节点');
      const nodes = raw.slice(0, 18).map((n, i) => {
        const chNum = Number(n.ch);
        const ch = chNum >= 1 && chNum <= vol.chapters.length ? chNum - 1 : -1;
        return {
          id: uid('oc'),
          title: String(n.title || '情节点').slice(0, 40),
          desc: String(n.desc || ''),
          ch,
          x: 80 + (ch >= 0 ? ch : 0) * 320,
          y: 80 + i * 40
        };
      });
      const idx = (v) => {
        const k = Number(v);
        return k >= 1 && k <= nodes.length ? k - 1 : -1;
      };
      const edges = [];
      (Array.isArray(o.edges) ? o.edges : []).forEach((e) => {
        const a = idx(e.from), b = idx(e.to);
        if (a < 0 || b < 0 || a === b) return;
        if (edges.some((x) => (x.from === nodes[a].id && x.to === nodes[b].id) || (x.from === nodes[b].id && x.to === nodes[a].id))) return;
        edges.push({
          id: uid('oe'),
          from: nodes[a].id,
          to: nodes[b].id,
          type: ['main', 'dark', 'char', 'sub'].includes(e.type) ? e.type : 'main',
          label: String(e.label || '').slice(0, 20)
        });
      });
      vol.canvas.nodes = nodes;
      vol.canvas.edges = edges;
      this.layout(vol);
      vol.canvas.view = { x: 0, y: 0, zoom: 1 };
      this._sel = ''; this._selEdge = '';
      Store.touch();
      toast('铺好了：' + nodes.length + ' 个情节点、' + edges.length + ' 条线');
      App.rerender();
    } catch (e) {
      toast(e.message || '生成失败', 'err');
      if (btn) { btn.disabled = false; btn.textContent = '✦ AI 铺这一卷'; }
    }
  },

  /* ================= 卷管理 ================= */
  addVol() {
    const vols = Store.data.outline.volumes;
    const v = {
      id: uid('vol'),
      title: '第' + (vols.length + 1) + '卷',
      summary: '',
      chapters: [],
      canvas: { nodes: [], edges: [], view: { x: 0, y: 0, zoom: 1 } }
    };
    vols.push(v);
    Store.touch();
    this._cur = v.id;
    this._sel = ''; this._selEdge = '';
    App.rerender();
  },

  /* ================= 场景设计（沿用） ================= */
  editScene(vi, ci, si) {
    const vol = Store.data.outline.volumes[vi];
    const ch = vol.chapters[ci];
    const s = ch.scenes[si];
    const idxPath = `outline.volumes.${vi}.chapters.${ci}.scenes.${si}`;
    const chars = Store.data.characters;

    const mask = Modal.open({
      title: '场景设计',
      wide: true,
      body: `
        <div class="row">
          <label class="fld" style="flex:1.4"><span>场景标题</span>
            <input type="text" data-bind="${idxPath}.title" data-live value="${esc(s.title || '')}"></label>
          <label class="fld" style="flex:1"><span>地点</span>
            <select data-bind="${idxPath}.placeId" data-place-ref title="可选章节场景，也可直接引用地图上的地名">
              ${Store.placeSelectOptions(s.placeId)}
            </select></label>
        </div>
        <label class="fld"><span>在场人物</span>
          <div class="cast-pick" id="castPick">
            ${chars.map((c) => `<span class="pick ${(s.cast || []).includes(c.id) ? 'on' : ''}" data-cid="${c.id}" style="--c:${c.color || '#a63a2a'}">${esc(c.name)}</span>`).join('') || '<span class="small muted">还没有人物</span>'}
          </div>
        </label>
        <div class="row">
          <label class="fld"><span>场景目标（这场戏要改变什么）</span>
            <textarea data-bind="${idxPath}.goal" data-live rows="2">${esc(s.goal || '')}</textarea></label>
          <label class="fld"><span>核心冲突</span>
            <textarea data-bind="${idxPath}.conflict" data-live rows="2">${esc(s.conflict || '')}</textarea></label>
        </div>
        <label class="fld" style="margin-bottom:8px"><span>情节点（每行一拍，会作为导演的路标）</span>
          <textarea data-bind="${idxPath}.beats" data-live data-type="lines" rows="5">${esc((s.beats || []).join('\n'))}</textarea>
        </label>
        <div style="display:flex;gap:8px">
          <button class="btn sm" id="aiExpand">AI 细化这一场</button>
          <span class="small muted" style="align-self:center">根据标题和地点补全目标、冲突与情节点</span>
        </div>`,
      footer: `<button class="btn danger" id="delScene">删除场景</button><div style="flex:1"></div>
               <button class="btn primary" id="playScene">开演这场戏 →</button>`
    });

    bindInputs(mask);
    mask.querySelectorAll('.pick').forEach((p) => {
      p.onclick = () => {
        p.classList.toggle('on');
        s.cast = Array.from(mask.querySelectorAll('.pick.on')).map((x) => x.dataset.cid);
        Store.touch();
      };
    });
    mask.querySelector('#delScene').onclick = () => {
      if (!confirm('删除这个场景？')) return;
      ch.scenes.splice(si, 1);
      Store.touch();
      Modal.close();
      App.rerender();
    };
    mask.querySelector('#playScene').onclick = () => {
      Modal.close();
      App.go('write', { scenePath: [vi, ci, si] });
    };
    mask.querySelector('#aiExpand').onclick = async () => {
      AIUndo.label('大纲 · AI 细化这一场');
      const btn = mask.querySelector('#aiExpand');
      btn.disabled = true;
      btn.textContent = '推演中…';
      try {
        const o = await LLM.json({ messages: Prompts.expandScene({ scene: s, chapterSummary: ch.summary }), temperature: 0.9 });
        if (o.title && !s.title) s.title = o.title;
        s.goal = o.goal || s.goal;
        s.conflict = o.conflict || s.conflict;
        s.beats = Array.isArray(o.beats) ? o.beats : s.beats;
        Store.touch();
        Modal.close();
        this.editScene(vi, ci, si);
        App.rerender();
      } catch (e) {
        toast(e.message, 'err');
        btn.disabled = false;
        btn.textContent = 'AI 细化这一场';
      }
    };
  },

  /* ================= AI 生成整本大纲 ================= */
  async genOutline() {
    AIUndo.label('大纲 · AI 生成大纲');
    if ((Store.data.outline.volumes || []).length && !confirm('将覆盖现有大纲（含各卷画布），继续？')) return;
    const btn = $('#btnGenOutline');
    if (btn) { btn.disabled = true; btn.textContent = '构思中…'; }
    try {
      const o = await LLM.json({ messages: Prompts.genOutline({ volumes: 2, chaptersPer: 4 }), temperature: 0.9, maxTokens: 4000 });
      const placeByName = {};
      Store.data.map.nodes.forEach((n) => (placeByName[n.name] = n.id));
      Store.placeOptions().forEach((o2) => { if (o2.label && !placeByName[o2.label]) placeByName[o2.label] = o2.value; });
      const charByName = {};
      Store.data.characters.forEach((c) => (charByName[c.name] = c.id));

      const vols = (o.volumes || []).map((v) => ({
        id: uid('vol'),
        title: v.title || '未命名卷',
        summary: v.summary || '',
        chapters: (v.chapters || []).map((c) => ({
          id: uid('chp'),
          title: c.title || '未命名章',
          summary: c.summary || '',
          scenes: (c.scenes || []).map((s) => ({
            id: uid('sc'),
            title: s.title || '场景',
            placeId: placeByName[s.placeId] || (Store.data.map.nodes[0] ? Store.data.map.nodes[0].id : ''),
            cast: (s.cast || []).map((n) => charByName[n]).filter(Boolean),
            goal: s.goal || '',
            conflict: s.conflict || '',
            beats: Array.isArray(s.beats) ? s.beats : []
          }))
        })),
        canvas: { nodes: [], edges: [], view: { x: 0, y: 0, zoom: 1 } }
      }));
      Store.data.outline.volumes = vols;
      Store.touch();
      this._cur = '';
      App.rerender();
      toast('大纲已生成，点进每一卷画情节');
    } catch (e) {
      toast(e.message, 'err');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'AI 生成大纲'; }
  }
};

/* 两点之间的弧线：端点退到卡片边缘，控制点带一点垂直偏移，避免压住卡片 */
function curve(a, b, seed) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x, dy = bc.y - ac.y;
  const p1 = edgePoint(a, dx, dy);
  const p2 = edgePoint(b, -dx, -dy);
  const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const sign = (h % 2 === 0) ? 1 : -1;
  const off = Math.min(36, len * 0.16) * sign;
  const cx = mx - ((p2.y - p1.y) / len) * off;
  const cy = my + ((p2.x - p1.x) / len) * off;
  // 标签放在弧线中点外侧一点，别压在线身上
  const tmx = p1.x * 0.25 + cx * 0.5 + p2.x * 0.25;
  const tmy = p1.y * 0.25 + cy * 0.5 + p2.y * 0.25;
  let bx = cx - mx, by = cy - my;
  const bl = Math.hypot(bx, by);
  if (bl > 0.5) { bx = (bx / bl) * 12; by = (by / bl) * 12; } else { bx = 0; by = -12; }
  return {
    d: `M${p1.x.toFixed(1)},${p1.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`,
    mx: (tmx + bx).toFixed(1),
    my: (tmy + by).toFixed(1)
  };
}

function edgePoint(rect, dx, dy) {
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = dx ? (rect.w / 2 + 4) / Math.abs(dx) : Infinity;
  const sy = dy ? (rect.h / 2 + 4) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}
