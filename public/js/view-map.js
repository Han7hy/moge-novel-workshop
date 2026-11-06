/* ============ view-map.js —— 世界地图 + 建筑图（人物 / 道具） ============ */
window.Views = window.Views || {};

const NODE_COLORS = { 要地: '#a63a2a', 官署: '#5b6f8c', 市井: '#a97f2f', 暗处: '#7a4b6b', 荒野: '#3d6a58' };
const WORLD_W = 1000, WORLD_H = 640;

Views.map = {
  get title() { return this._mode === 'atlas' ? '地图' : '地图 · 地点网络'; },
  get sub() { return this._mode === 'atlas' ? '大陆层 · 宇宙层 · 地势地貌' : '场景 · 通行 · 谁在哪里 · 有什么'; },
  _sel: null,
  _link: null,
  _dragging: false,
  _mode: 'atlas', // atlas(世界总图) | network(原地点网络)

  actions() {
    if (this._mode === 'atlas') return '';
    return `<button class="btn" id="btnBackAtlas">← 世界总图</button>
            <button class="btn" id="btnGenMap">AI 生成地图</button>
            <button class="btn" id="btnLink">连线</button>
            <button class="btn primary" id="btnAddNode">+ 地点</button>`;
  },

  setMode(m) {
    this._mode = m;
    App.render();
  },

  mount(el) {
    el.classList.add('no-pad');
    if (this._mode === 'atlas') { AtlasView.mount(el); return; }
    this.mountWorld(el);
  },

  /* ================= 世界地图 ================= */
  mountWorld(el) {
    el.innerHTML = `
      <div class="map-wrap" style="padding:16px">
        <div class="map-canvas" id="canvas">
          <svg id="msvg" viewBox="0 0 ${WORLD_W} ${WORLD_H}" preserveAspectRatio="xMidYMid meet"></svg>
          <div class="map-legend">
            <span>拖动空白处平移</span><span>滚轮缩放</span><span>拖动地点调整位置</span><span>单击选中地点</span>
          </div>
          <div class="zoom-bar">
            <button id="zbIn" title="放大">+</button>
            <span id="zbVal">100%</span>
            <button id="zbOut" title="缩小">−</button>
            <button id="zbReset" title="复位">⟲</button>
          </div>
        </div>
        <div class="map-side" id="side"></div>
      </div>`;
    this._initWorldView();
    this.draw();
    this._bindWorldEvents();
    const back = $('#btnBackAtlas');
    if (back) back.onclick = () => this.setMode('atlas');
    $('#btnAddNode').onclick = () => this.addNode();
    $('#btnGenMap').onclick = () => this.genMap();
    $('#btnLink').onclick = () => {
      this._link = this._link ? null : { from: null };
      toast(this._link ? '连线模式：依次点击两个地点' : '已退出连线模式');
      this.draw();
    };
  },

  _initWorldView() {
    const v = Store.mapView();
    Viewport.apply($('#msvg'), v, WORLD_W, WORLD_H);
    this._updateZoomLabel();
  },

  _updateZoomLabel() {
    const el = $('#zbVal');
    if (el) el.textContent = Math.round((Store.mapView().zoom || 1) * 100) + '%';
  },

  _bindWorldEvents() {
    const svg = $('#msvg');
    if (!svg) return;
    // 滚轮缩放
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const v = Store.mapView();
      Viewport.zoomAt(v, Viewport.wheelFactor(ev.deltaY), svg, ev.clientX, ev.clientY, WORLD_W, WORLD_H);
      Viewport.apply(svg, v, WORLD_W, WORLD_H);
      this._updateZoomLabel();
      Store.touch();
    }, { passive: false });

    // 空白处平移
    let panning = false, panStart = null, startView = null;
    svg.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.node-g')) return;
      if (this._link) return;
      panning = true;
      svg.setPointerCapture(ev.pointerId);
      panStart = { x: ev.clientX, y: ev.clientY };
      startView = Object.assign({}, Store.mapView());
    });
    svg.addEventListener('pointermove', (ev) => {
      if (!panning || !panStart) return;
      const dx = ev.clientX - panStart.x;
      const dy = ev.clientY - panStart.y;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const scale = ctm.a || 1;
      const v = Store.mapView();
      v.x = startView.x - dx / scale;
      v.y = startView.y - dy / scale;
      Viewport.clamp(v, WORLD_W, WORLD_H);
      Viewport.apply(svg, v, WORLD_W, WORLD_H);
      Store.touch();
    });
    const endPan = () => { panning = false; panStart = null; };
    svg.addEventListener('pointerup', endPan);
    svg.addEventListener('pointercancel', endPan);

    // 缩放按钮
    const zIn = () => {
      const v = Store.mapView();
      v.zoom = clampNum(v.zoom * 1.25, VIEW_MIN_ZOOM, VIEW_MAX_ZOOM);
      Viewport.clamp(v, WORLD_W, WORLD_H);
      Viewport.apply(svg, v, WORLD_W, WORLD_H);
      this._updateZoomLabel();
      Store.touch();
    };
    const zOut = () => {
      const v = Store.mapView();
      v.zoom = clampNum(v.zoom / 1.25, VIEW_MIN_ZOOM, VIEW_MAX_ZOOM);
      Viewport.clamp(v, WORLD_W, WORLD_H);
      Viewport.apply(svg, v, WORLD_W, WORLD_H);
      this._updateZoomLabel();
      Store.touch();
    };
    const zReset = () => {
      const v = Store.mapView();
      v.x = 0; v.y = 0; v.zoom = 1;
      Viewport.apply(svg, v, WORLD_W, WORLD_H);
      this._updateZoomLabel();
      Store.touch();
    };
    const bIn = $('#zbIn'), bOut = $('#zbOut'), bReset = $('#zbReset');
    if (bIn) bIn.onclick = zIn;
    if (bOut) bOut.onclick = zOut;
    if (bReset) bReset.onclick = zReset;
  },

  draw() {
    const svg = $('#msvg');
    if (!svg) return;
    const m = Store.data.map;
    const cs = getComputedStyle(document.documentElement);
    const line = cs.getPropertyValue('--line-strong').trim() || '#ccc';
    const ink = cs.getPropertyValue('--ink').trim() || '#222';
    const ink3 = cs.getPropertyValue('--ink-3').trim() || '#888';
    const surface = cs.getPropertyValue('--surface').trim() || '#fff';

    // defs for node image clips
    let defs = `<defs>`;
    m.nodes.forEach((n) => {
      if (n.art && n.art.building) {
        defs += `<clipPath id="cp_${n.id}"><rect x="-24" y="48" width="48" height="36" rx="6"/></clipPath>`;
      }
    });
    defs += `</defs>`;

    const edges = m.edges.map((e) => {
      const a = m.nodes.find((n) => n.id === e.a);
      const b = m.nodes.find((n) => n.id === e.b);
      if (!a || !b) return '';
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      return `<g><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${line}" stroke-width="1.6"/>
        ${e.label ? `<text x="${mx}" y="${my - 6}" fill="${ink3}" font-size="11" text-anchor="middle" style="paint-order:stroke;stroke:${surface};stroke-width:4px">${esc(e.label)}</text>` : ''}
      </g>`;
    }).join('');

    const nodes = m.nodes.map((n) => {
      const col = NODE_COLORS[n.type] || '#a63a2a';
      const here = Store.data.characters.filter((c) => c.state && c.state.placeId === n.id);
      const chips = here.map((c, i) =>
        `<g transform="translate(${-here.length * 20 + i * 42 + 20}, 66)">
           <rect x="-16" y="0" width="32" height="16" rx="8" fill="${c.color || col}" opacity=".92"/>
           <text x="0" y="11.5" fill="#fff" font-size="10" text-anchor="middle">${esc(c.name.slice(0, 3))}</text>
         </g>`
      ).join('');
      // 右上角角标：此处道具数量
      const nItems = (n.items || []).length;
      const badge = nItems
        ? `<g transform="translate(22,-20)"><circle r="10" fill="${surface}" stroke="${col}" stroke-width="1.6"/>
           <text y="3.5" text-anchor="middle" font-size="10" fill="${col}">${nItems}</text></g>`
        : '';
      const sel = this._sel === n.id ? `stroke-width="3.5" stroke="${col}"` : '';
      // 建筑图缩略图
      let thumb = '';
      if (n.art && n.art.building) {
        const b = n.art.building;
        const href = b.kind === 'svg' ? Building.toDataURI(b.svg) : (b.url || '');
        if (href) {
          thumb = `<image href="${href}" x="-24" y="48" width="48" height="36" preserveAspectRatio="xMidYMid slice" clip-path="url(#cp_${n.id})"/>
            <rect x="-24" y="48" width="48" height="36" rx="6" fill="none" stroke="${col}" stroke-width="1.5"/>`;
        }
      }
      return `<g class="node-g" data-id="${n.id}" transform="translate(${n.x},${n.y})">
        <circle class="nd" r="27" fill="${col}" opacity=".14"/>
        <circle r="19" fill="${surface}" stroke="${col}" stroke-width="2" ${sel}/>
        <text y="5" text-anchor="middle" font-size="13" font-family="var(--serif)" fill="${col}">${esc(n.name.slice(0, 2))}</text>
        <text y="46" text-anchor="middle" font-size="12" fill="${ink}" font-family="var(--serif)">${esc(n.name)}</text>
        <text y="60" text-anchor="middle" font-size="10" fill="${ink3}">${esc(n.type || '')}</text>
        ${badge}
        ${chips}
        ${thumb}
      </g>`;
    }).join('');

    svg.innerHTML = defs + edges + nodes;

    svg.querySelectorAll('.node-g').forEach((g) => {
      g.addEventListener('pointerdown', (ev) => this.startDrag(ev, g));
    });

    this.renderSide();
  },

  startDrag(ev, g) {
    ev.stopPropagation();
    const id = g.dataset.id;
    const svg = $('#msvg');
    const m = Store.data.map;
    const node = m.nodes.find((n) => n.id === id);
    if (!node) return;

    if (this._link) {
      if (!this._link.from) {
        this._link.from = id;
        this._sel = id;
        toast('再点一个地点完成连线');
        this.draw();
      } else if (this._link.from !== id) {
        m.edges.push({ a: this._link.from, b: id, label: '' });
        Store.touch();
        this._link = null;
        this.draw();
      }
      return;
    }

    let moved = false;
    const start = this.pt(ev);
    const ox = node.x;
    const oy = node.y;
    const move = (e) => {
      const p = this.pt(e);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      node.x = Math.max(50, Math.min(950, ox + dx));
      node.y = Math.max(50, Math.min(590, oy + dy));
      g.setAttribute('transform', `translate(${node.x},${node.y})`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) {
        Store.touch();
        this.draw();
        return;
      }
      const now = Date.now();
      if (this._lastClick && this._lastClick.id === id && now - this._lastClick.t < 400) {
        this._lastClick = null;
        this._sel = id;
        this.draw();
        return;
      }
      this._lastClick = { id, t: now };
      this._sel = id;
      this.draw();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  },

  pt(ev, sel) {
    const svg = $(sel || '#msvg');
    const p = svg.createSVGPoint();
    p.x = ev.clientX;
    p.y = ev.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  },

  renderSide() {
    const side = $('#side');
    if (!side) return;
    const m = Store.data.map;
    const n = m.nodes.find((x) => x.id === this._sel);
    const chars = Store.data.characters;

    if (!n) {
      const inv = Store.inv();
      side.innerHTML = `
        <div class="card pad">
          <div class="sec-title">搜道具</div>
          <div class="item-search">
            <input type="search" id="itemQ" placeholder="搜道具名，马上知道在哪…" autocomplete="off">
            <div class="item-results" id="itemRes" ${inv.length ? '' : 'style="display:none"'}>
              ${inv.length ? inv.slice(0, 8).map((it) => this._itemRow(it)).join('') : ''}
            </div>
          </div>
          ${inv.length ? `<div class="small muted">共 ${inv.length} 件道具编入索引。</div>` : '<div class="small muted">还没有道具。去「书源」导入小说自动建索引。</div>'}
        </div>
        <div class="card pad">
          <div class="sec-title">地点</div>
          <div class="chips" style="margin-bottom:12px">
            ${m.nodes.length ? m.nodes.map((x) => `<span class="chip" data-pick="${x.id}" style="cursor:pointer">${esc(x.name)}</span>`).join('') : '<span class="small muted">还没有地点</span>'}
          </div>
          <div class="small muted">点一个地点编辑它：<b>谁在这里</b>、<b>此处有什么道具</b>、建筑图与内部描写。</div>
        </div>
        <div class="card pad">
          <div class="sec-title">人物所在</div>
          ${chars.length ? chars.map((c) => `<div class="kv"><span>${esc(c.name)}</span><b class="muted">${esc(Store.placeName(c.state.placeId))}</b></div>`).join('') : '<div class="small muted">还没有人物</div>'}
        </div>`;
      side.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => { this._sel = b.dataset.pick; this.draw(); }));
      const q = $('#itemQ');
      const res = $('#itemRes');
      if (q) {
        q.oninput = () => {
          const s = q.value.trim().toLowerCase();
          if (!s) {
            res.innerHTML = inv.slice(0, 8).map((it) => this._itemRow(it)).join('');
            res.style.display = inv.length ? '' : 'none';
            return;
          }
          const hits = inv.filter((it) => (it.name + ' ' + (it.desc || '')).toLowerCase().includes(s)).slice(0, 30);
          res.innerHTML = hits.length ? hits.map((it) => this._itemRow(it)).join('') : '<div class="small muted" style="padding:6px 9px">没有找到</div>';
          res.style.display = '';
        };
      }
      if (res) {
        res.onclick = (e) => {
          const del = e.target.closest('.ir-del');
          if (del) {
            e.stopPropagation();
            this.deleteInvItem(del.dataset.delinv, del.dataset.htype, del.dataset.hid, del.dataset.delname);
            return;
          }
          const r = e.target.closest('.item-result');
          if (!r) return;
          const t = r.dataset.type, id = r.dataset.id;
          if (t === 'place') { this._sel = id; this.draw(); }
          else if (t === 'char') App.go('characters');
        };
      }
      return;
    }

    const idx = m.nodes.indexOf(n);
    const here = chars.filter((c) => c.state && c.state.placeId === n.id);
    const art = n.art || {};
    const building = art.building;

    side.innerHTML = `
      <div class="card pad">
        <div class="sec-title">编辑地点</div>
        <label class="fld"><span>名称</span><input type="text" data-bind="map.nodes.${idx}.name" data-live value="${esc(n.name)}"></label>
        <label class="fld"><span>类型</span>
          <select data-bind="map.nodes.${idx}.type">
            ${Object.keys(NODE_COLORS).map((t) => `<option ${n.type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></label>
        <label class="fld"><span>描写（会进提示词）</span>
          <textarea data-bind="map.nodes.${idx}.desc" data-live rows="3">${esc(n.desc || '')}</textarea></label>
        <div class="small muted" style="margin-bottom:10px">连接：${
          m.edges.filter((e) => e.a === n.id || e.b === n.id)
            .map((e) => { const o = m.nodes.find((x) => x.id === (e.a === n.id ? e.b : e.a)); return o ? o.name : ''; })
            .filter(Boolean).join('、') || '无'
        }</div>
        <div style="display:flex;gap:6px">
          <button class="btn sm" id="setHere">把某人放到这里</button>
          <button class="btn sm" id="delNode">删除</button>
        </div>
      </div>

      ${this._buildingCard(n, idx, building)}

      <div class="card pad">
        <div class="sec-title">此刻在此（${here.length}）</div>
        <div class="chips">${here.map((c) => `<span class="chip" style="--c:${c.color}">${esc(c.name)}</span>`).join('') || '<span class="small muted">无人</span>'}</div>
      </div>
      <div class="card pad">
        <div class="sec-title">此处道具（${(n.items || []).length}）</div>
        ${(n.items && n.items.length)
          ? `<div class="mark-list">${n.items.map((it, i) => `
            <div class="mark-row" data-item="${i}">
              <span class="mk-dot" style="--c:${typeof propColor !== 'undefined' ? propColor(it.category) : '#a97f2f'}">具</span>
              <div style="min-width:0;flex:1">
                <div class="mk-name">${esc(it.name || '未命名')}</div>
                ${it.owner ? `<div class="mk-desc">归属：${esc(it.owner)}</div>` : ''}
                ${it.desc ? `<div class="mk-desc">${esc(it.desc.slice(0, 42))}${it.desc.length > 42 ? '…' : ''}</div>` : ''}
              </div>
              <button class="btn sm danger" data-delitem="${i}" title="删除这件道具" style="flex:0 0 auto;padding:2px 8px">✕</button>
            </div>`).join('')}</div>`
          : '<div class="small muted">这里还没有登记道具。</div>'}
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="btn sm" id="addItemHere" style="flex:1">＋ 手动登记</button>
          <button class="btn sm primary" id="genItemsHere" style="flex:1">AI 补几件</button>
        </div>
      </div>
      <div class="card pad">
        <div class="sec-title">内部描写</div>
        <label class="fld"><span>此地内部长什么样（会进提示词）</span>
          <textarea data-bind="map.nodes.${idx}.sub.desc" data-live rows="3" placeholder="几进几出、哪扇门通哪、什么时候什么人在这…">${esc((n.sub && n.sub.desc) || '')}</textarea></label>
        <div class="hint">会随场景一起进提示词，让模型知道这里的结构。</div>
      </div>`;

    bindInputs(side);
    side.querySelectorAll('input,textarea,select').forEach((inp) => inp.addEventListener('change', () => this.draw()));
    side.querySelector('#delNode').onclick = () => {
      if (!confirm('删除这个地点？')) return;
      m.nodes.splice(idx, 1);
      m.edges = m.edges.filter((e) => e.a !== n.id && e.b !== n.id);
      Store.data.characters.forEach((c) => { if (c.state && c.state.placeId === n.id) c.state.placeId = ''; });
      this._sel = null;
      Store.touch();
      this.draw();
    };
    side.querySelector('#setHere').onclick = () => {
      const opts = Store.data.characters.map((c, i) => `${i + 1}. ${c.name}（现：${Store.placeName(c.state.placeId)}）`).join('\n');
      if (!opts) return toast('还没有人物');
      const pick = prompt('输入要移到此地的人物序号（多个用逗号）：\n' + opts, '1');
      if (!pick) return;
      pick.split(/[,，\s]+/).forEach((s) => {
        const c = Store.data.characters[Number(s) - 1];
        if (c) c.state.placeId = n.id;
      });
      Store.touch();
      this.draw();
    };
    const addItem = side.querySelector('#addItemHere');
    if (addItem) addItem.onclick = () => this.addItemHere(n);
    const genItem = side.querySelector('#genItemsHere');
    if (genItem) genItem.onclick = () => this.genItemsHere(n);
    side.querySelectorAll('.mark-row[data-item]').forEach((r) => {
      r.onclick = (e) => {
        // 点在删除按钮上时不进编辑
        if (e.target.closest('[data-delitem]')) return;
        this.editItemHere(n, Number(r.dataset.item));
      };
    });
    side.querySelectorAll('[data-delitem]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const i = Number(b.dataset.delitem);
        const it = n.items[i];
        if (!it) return;
        if (!confirm(`删除道具「${it.name || '未命名'}」？`)) return;
        n.items.splice(i, 1);
        Store.rebuildInventory();
        Store.touch();
        this.draw();
        toast('已删除「' + (it.name || '未命名') + '」');
      };
    });
    // 建筑图按钮
    this._bindBuildingButtons(side, n, idx);
  },

  _itemRow(it) {
    const h = Store.itemHolder(it);
    const at = h && h.name ? (h.type === 'char' ? '在 ' + h.name + ' 身上' : '在 ' + h.name) : '未定位';
    return `<div class="item-result" data-type="${h ? h.type : ''}" data-id="${h ? h.id : ''}">
      <b>${esc(it.name || '未命名')}</b>
      <span class="ir-at">${esc(at)}</span>
      <button class="ir-del" title="删除此道具" data-delinv="${esc(it.id || '')}" data-htype="${esc(it.holderType || '')}" data-hid="${esc(it.holderId || '')}" data-delname="${esc(it.name || '')}">✕</button>
    </div>`;
  },

  deleteInvItem(invId, htype, hid, name) {
    let removed = false;
    const tryRemove = (arr) => {
      if (!arr || !Array.isArray(arr)) return false;
      const i = arr.findIndex((x) => (x.id || '') === invId || (x.name || '') === (name || ''));
      if (i >= 0) { arr.splice(i, 1); return true; }
      return false;
    };
    // 1) 按记录的归属删除（地点/人物可能已被删或改名，故需兜底）
    if (htype === 'char') { const c = Store.char(hid); if (c) removed = tryRemove(c.items) || removed; }
    else if (htype === 'place') { const n = Store.place(hid); if (n) removed = tryRemove(n.items) || removed; }
    // 2) 兜底：全局扫描人物 / 地点 / 无主池，防止归属失效的孤儿删不掉
    if (!removed) {
      Store.data.characters.forEach((c) => { if (tryRemove(c.items)) removed = true; });
      Store.data.map.nodes.forEach((n) => { if (tryRemove(n.items)) removed = true; });
      if (tryRemove(Store.propPool())) removed = true;
    }
    // 3) 直接清掉索引里残留的孤儿条目（其归属已不存在）
    const inv = Store.inv();
    const j = inv.findIndex((x) => (x.id || '') === invId);
    if (j >= 0) { inv.splice(j, 1); removed = true; }
    if (!removed) { toast('没找到该道具，可能已被删除', 'err'); return; }
    Store.rebuildInventory();
    Store.touch();
    this.draw();
    toast('已删除「' + (name || '未命名') + '」');
  },

  _buildingCard(n, idx, building) {
    if (!building) {
      return `
        <div class="card pad">
          <div class="sec-title">建筑图</div>
          <div class="small muted" style="margin-bottom:10px">为「${esc(n.name)}」生成一张外观图，用于地图展示与写作参考。</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn sm" id="btnGenBuilding">程序绘图（立面）</button>
            <button class="btn sm primary" id="btnGenPhoto">AI 出图（写实）</button>
          </div>
        </div>`;
    }
    const href = building.kind === 'svg' ? Building.toDataURI(building.svg) : (building.url || '');
    const isSvg = building.kind === 'svg';
    return `
      <div class="card pad">
        <div class="sec-title">建筑图</div>
        <div class="building-preview">
          ${href ? `<img src="${href}" alt="${esc(n.name)}">` : '<div class="small muted">图片加载中…</div>'}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
          <button class="btn sm" id="btnGenBuilding">重画</button>
          ${isSvg ? `<button class="btn sm" id="btnDlSvg">下载 SVG</button><button class="btn sm" id="btnDlPng">下载 PNG</button>` : ''}
          <button class="btn sm danger" id="btnDelBuilding">删除</button>
        </div>
      </div>`;
  },

  _bindBuildingButtons(side, n, idx) {
    const bg = side.querySelector('#btnGenBuilding');
    if (bg) bg.onclick = () => this._genBuildingSvg(n, idx);
    const bp = side.querySelector('#btnGenPhoto');
    if (bp) bp.onclick = () => this._genBuildingPhoto(n, idx);
    const ds = side.querySelector('#btnDlSvg');
    if (ds) ds.onclick = () => {
      const b = n.art && n.art.building;
      if (b && b.svg) Building.downloadSVG(b.svg, `${n.name}_建筑图.svg`);
    };
    const dp = side.querySelector('#btnDlPng');
    if (dp) dp.onclick = () => {
      const b = n.art && n.art.building;
      if (b && b.svg) Building.downloadPNG(b.svg, `${n.name}_建筑图.png`, 2);
    };
    const del = side.querySelector('#btnDelBuilding');
    if (del) del.onclick = () => {
      if (!confirm('删除这张建筑图？')) return;
      n.art.building = null;
      Store.touch();
      this.draw();
    };
  },

  async _genBuildingSvg(n, idx) {
    const btn = document.activeElement;
    if (btn) { btn.disabled = true; btn.textContent = '绘制中…'; }
    try {
      const spec = await LLM.json({ messages: Prompts.genBuilding({ place: n, world: '' }), temperature: 0.92, maxTokens: 1200 });
      const svg = Building.render(spec);
      if (!n.art) n.art = { building: null, shots: [] };
      n.art.building = { kind: 'svg', svg, spec, createdAt: new Date().toISOString() };
      Store.touch();
      this.draw();
      toast('建筑图已生成');
    } catch (e) {
      toast(e.message, 'err');
    }
    if (btn) { btn.disabled = false; btn.textContent = '程序绘图（立面）'; }
  },

  async _genBuildingPhoto(n, idx) {
    const cfg = Store.settings;
    if (!cfg.imageBaseUrl && !cfg.baseUrl) return toast('还没有配置图像接口，请到「设置」填写', 'err');
    const btn = document.activeElement;
    if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
    try {
      const spec = (n.art && n.art.building && n.art.building.spec) || (await LLM.json({ messages: Prompts.genBuilding({ place: n, world: '' }), temperature: 0.92, maxTokens: 1200 }));
      const prompt = Prompts.buildingImagePrompt({ place: n, spec });
      const res = await LLM.image({
        prompt,
        size: cfg.imageSize || '1024x1024',
        model: cfg.imageModel || cfg.model || '',
        baseUrl: cfg.imageBaseUrl || cfg.baseUrl || '',
        apiKey: cfg.imageApiKey || cfg.apiKey || ''
      });
      if (!n.art) n.art = { building: null, shots: [] };
      n.art.building = { kind: 'photo', url: res.url, prompt, createdAt: new Date().toISOString() };
      n.art.shots.push({ url: res.url, prompt, createdAt: new Date().toISOString() });
      Store.touch();
      this.draw();
      toast('写实图已生成');
    } catch (e) {
      toast(e.message, 'err');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'AI 出图（写实）'; }
  },

  addNode() {
    const id = uid('pl');
    Store.data.map.nodes.push({
      id, name: '新地点', type: '市井', x: 200 + Math.random() * 600, y: 120 + Math.random() * 380,
      desc: '', items: [], sub: { desc: '' }
    });
    Store.touch();
    this._sel = id;
    this.draw();
  },

  /* ---------- 地点上的道具 ---------- */
  addItemHere(n) {
    if (!Array.isArray(n.items)) n.items = [];
    const name = prompt('道具名称（例：断锋剑、青玉令牌）：', '');
    if (!name || !name.trim()) return;
    n.items.push({ id: uid('it'), name: name.trim(), category: '', desc: '', source: '', context: '', note: '', manual: true });
    Store.rebuildInventory();
    Store.touch();
    this.draw();
    toast('已登记到「' + n.name + '」');
  },

  async genItemsHere(n) {
    AIUndo.label('地图 · AI 生成道具');
    const btn = document.getElementById('genItemsHere');
    if (btn) { btn.disabled = true; btn.textContent = '补货中…'; }
    try {
      const o = await LLM.json({ messages: Prompts.genItems({ place: n }), temperature: 0.92, maxTokens: 1200 });
      const list = o.items || [];
      if (!list.length) throw new Error('模型没有返回道具');
      if (!Array.isArray(n.items)) n.items = [];
      const have = new Set(n.items.map((x) => String(x.name || '').trim()));
      let add = 0;
      list.forEach((raw) => {
        const nm = String(raw.name || '').trim();
        if (!nm || have.has(nm)) return;
        n.items.push({ id: uid('it'), name: nm, category: '', desc: String(raw.desc || '').slice(0, 200), source: '', context: '', note: '', manual: true });
        have.add(nm);
        add++;
      });
      if (!add) throw new Error('没有新增（可能都重复了）');
      Store.rebuildInventory();
      Store.touch();
      this.draw();
      toast(`补了 ${add} 件道具`);
    } catch (e) {
      toast(e.message, 'err');
    }
    if (btn) { btn.disabled = false; btn.textContent = 'AI 补几件'; }
  },

  editItemHere(n, i) {
    const it = n.items[i];
    if (!it) return;
    const idx = Store.data.map.nodes.indexOf(n);
    const mask = Modal.open({
      title: '道具',
      narrow: true,
      body: `
        <div class="row">
          <label class="fld" style="flex:1.4"><span>名称</span><input type="text" data-bind="map.nodes.${idx}.items.${i}.name" data-live value="${esc(it.name || '')}"></label>
          <label class="fld" style="flex:1"><span>类别</span>
            <select data-bind="map.nodes.${idx}.items.${i}.category">
              <option value="">未分类</option>
              ${(typeof PROP_CATS !== 'undefined' ? PROP_CATS : []).map((c) => `<option value="${c.key}" ${it.category === c.key ? 'selected' : ''}>${c.key}</option>`).join('')}
            </select></label>
        </div>
        <label class="fld" style="margin-bottom:0"><span>描述（会进提示词）</span>
          <textarea data-bind="map.nodes.${idx}.items.${i}.desc" data-live rows="4" placeholder="它是什么、谁会用、有什么来历">${esc(it.desc || '')}</textarea></label>`,
      footer: `<button class="btn danger" id="itDel">删除</button>
               <button class="btn" id="itMore">在道具库编辑 →</button>
               <div style="flex:1"></div><button class="btn primary" id="itDone">完成</button>`
    });
    bindInputs(mask);
    mask.querySelector('#itMore').onclick = () => {
      Modal.close();
      App.go('props');
      setTimeout(() => { if (Views.props) Views.props.edit(it.id); }, 60);
    };
    mask.querySelector('#itDone').onclick = () => { Modal.close(); Store.rebuildInventory(); Store.touch(); this.draw(); };
    mask.querySelector('#itDel').onclick = () => {
      if (!confirm(`删除道具「${it.name || '未命名'}」？`)) return;
      n.items.splice(i, 1);
      Store.rebuildInventory();
      Store.touch();
      Modal.close();
      this.draw();
    };
  },

  async genMap() {
    AIUndo.label('地图 · AI 生成地图');
    if (Store.data.map.nodes.length && !confirm('将替换现有地图（人物所在地会被清空），继续？')) return;
    const btn = $('#btnGenMap');
    btn.disabled = true;
    btn.textContent = '生成中…';
    try {
      const o = await LLM.json({ messages: Prompts.genMap(), temperature: 0.9 });
      const nodes = (o.nodes || []).map((n) => ({
        id: uid('pl'), name: n.name || '无名地', type: NODE_COLORS[n.type] ? n.type : '市井', desc: n.desc || '',
        x: Math.max(70, Math.min(930, Number(n.x) || 200 + Math.random() * 500)),
        y: Math.max(70, Math.min(570, Number(n.y) || 120 + Math.random() * 380)),
        items: [], sub: { desc: '' }
      }));
      const byName = {};
      nodes.forEach((n) => (byName[n.name] = n.id));
      const edges = (o.edges || []).map((e) => ({ a: byName[e.a], b: byName[e.b], label: e.label || '' })).filter((e) => e.a && e.b);
      Store.data.map = { nodes, edges, view: { x: 0, y: 0, zoom: 1 } };
      Store.data.characters.forEach((c) => (c.state.placeId = nodes[0] ? nodes[0].id : ''));
      Store.touch();
      this.draw();
      toast('地图已生成，可以拖动调整');
    } catch (e) {
      toast(e.message, 'err');
    }
    btn.disabled = false;
    btn.textContent = 'AI 生成地图';
  }
};
