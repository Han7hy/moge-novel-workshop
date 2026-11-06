/* ============================================================
 * atlas-view.js —— 高德式地图交互视图（缩放 / 平移 / 鹰眼 / 点位 / 分级地貌）
 * 依赖：atlas.js（数据层）、core.js（Modal / toast / esc / $ / $$）
 * ============================================================ */
window.AtlasView = (function () {
  const PW = 1200, PH = 800;          // 图层逻辑尺寸（与 3:2 底图一致）
  const MINI_W = 180, MINI_H = 120;   // 鹰眼尺寸
  const MIN_REL = 0.72, MAX_REL = 6;  // 相对「全图适配」的缩放范围

  let host = null, stage, plane, img, vec, mkLayer, miniView, miniImg, side,
      crumb, layersBar, zoomLabel, scaleLabel, tierLabel, hintBar;
  let resizeBound = false;
  const S = {
    tx: 0, ty: 0, zoom: 1, fit: 1,
    mapId: null, sel: null, placing: false,
    panning: false, panX: 0, panY: 0, startTx: 0, startTy: 0,
    marks: []
  };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const cur = () => Atlas.current();
  const px = (v) => (v / 100) * PW;
  const py = (v) => (v / 100) * PH;
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => { let s = seed || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

  /* ---------------- 骨架 ---------------- */
  function mount(el) {
    host = el;
    el.classList.add('no-pad');
    el.innerHTML = `
      <div class="atlas-shell">
        <div class="atlas-topbar">
          <div class="atlas-crumb" id="atlasCrumb"></div>
          <div class="atlas-layers" id="atlasLayers"></div>
          <div class="atlas-actions">
            <button class="btn sm" id="atlasAdd">＋ 地点</button>
            <button class="btn sm" id="atlasNew">＋ 图层</button>
            <button class="btn sm" id="atlasNetwork">地点网络</button>
          </div>
        </div>
        <div class="atlas-main">
          <div class="atlas-stage" id="atlasStage">
            <div class="atlas-plane" id="atlasPlane">
              <img class="atlas-img" id="atlasImg" alt="">
              <svg class="atlas-vec" id="atlasVec" viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none"></svg>
            </div>
            <div class="atlas-markers" id="atlasMarkers"></div>
            <div class="atlas-overlay atlas-mini" id="atlasMini">
              <img id="atlasMiniImg" alt="">
              <div class="am-view" id="atlasMiniView"></div>
              <span class="am-cap">鹰 眼</span>
            </div>
            <div class="atlas-overlay atlas-compass"><span>北</span><i></i><small>N</small></div>
            <div class="atlas-overlay atlas-scale"><div class="as-bar"><i></i></div><span id="atlasScale">—</span></div>
            <div class="atlas-overlay atlas-legend" id="atlasLegend"></div>
            <div class="atlas-overlay atlas-zoom">
              <button id="azIn" title="放大">＋</button>
              <span id="azVal">100%</span>
              <button id="azOut" title="缩小">−</button>
              <button id="azFit" title="全图">⟲</button>
            </div>
            <div class="atlas-overlay atlas-hint" id="atlasHint"></div>
          </div>
          <div class="atlas-side" id="atlasSide"></div>
        </div>
      </div>`;
    stage = $('#atlasStage'); plane = $('#atlasPlane'); img = $('#atlasImg');
    vec = $('#atlasVec'); mkLayer = $('#atlasMarkers');
    miniView = $('#atlasMiniView'); miniImg = $('#atlasMiniImg'); side = $('#atlasSide');
    crumb = $('#atlasCrumb'); layersBar = $('#atlasLayers');
    zoomLabel = $('#azVal'); scaleLabel = $('#atlasScale'); hintBar = $('#atlasHint');

    bindEvents();
    // 注意：Store 是 core.js 里的顶层 const，不挂在 window 上，必须用标识符直接访问
    const bid = (typeof Store !== 'undefined' && Store.currentBookId) || 'default';
    if (Atlas.book() !== bid) Atlas.init(bid);
    Atlas.ready().then(render).catch((e) => {
      if (side) side.innerHTML = `<div class="empty"><h3>地图加载失败</h3><p class="small">${esc(e.message || String(e))}</p></div>`;
    });
  }

  function bindEvents() {
    if (!stage.dataset.bound) {
      stage.dataset.bound = '1';
      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = stage.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.16 : 1 / 1.16);
      }, { passive: false });

      stage.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.atlas-overlay') || e.target.closest('.atlas-mk')) return;
        S.panning = true;
        S.panX = e.clientX; S.panY = e.clientY;
        S.startTx = S.tx; S.startTy = S.ty;
        stage.classList.add('grabbing');
        try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      });
      stage.addEventListener('pointermove', (e) => {
        if (!S.panning) return;
        S.tx = S.startTx + (e.clientX - S.panX);
        S.ty = S.startTy + (e.clientY - S.panY);
        clampPan(); applyTransform();
      });
      const endPan = () => { S.panning = false; stage.classList.remove('grabbing'); };
      stage.addEventListener('pointerup', endPan);
      stage.addEventListener('pointercancel', endPan);

      stage.addEventListener('dblclick', (e) => {
        if (e.target.closest('.atlas-overlay') || e.target.closest('.atlas-mk')) return;
        const r = stage.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, 1.6);
      });

      stage.addEventListener('click', (e) => {
        const mk = e.target.closest('.atlas-mk');
        if (mk) {
          const m = cur(); if (!m) return;
          const k = m.markers.find((x) => x.id === mk.dataset.id);
          if (k && k.childMapId && e.detail >= 2) { Atlas.open(k.childMapId); return; }
          select(mk.dataset.id);
          return;
        }
        if (S.placing && !e.target.closest('.atlas-overlay')) {
          const r = stage.getBoundingClientRect();
          const mx = e.clientX - r.left, my = e.clientY - r.top;
          const x = clamp(((mx - S.tx) / S.zoom) / PW * 100, 0, 100);
          const y = clamp(((my - S.ty) / S.zoom) / PH * 100, 0, 100);
          const m = cur(); if (!m) return;
          const k = Atlas.addMarker(m.id, { x: +x.toFixed(2), y: +y.toFixed(2), name: '未命名地点 ' + (m.markers.length + 1), kind: '城邦' });
          S.placing = false; updateHint();
          renderMarkers(); select(k.id); applyTransform();
          toast('已落点，右侧可以直接改名');
        }
      });

      $('#azIn').onclick = () => buttonZoom(1.3);
      $('#azOut').onclick = () => buttonZoom(1 / 1.3);
      $('#azFit').onclick = () => fitAll();
      $('#atlasAdd').onclick = () => { S.placing = !S.placing; updateHint(); renderSide(); };
      $('#atlasNew').onclick = newLayer;
      $('#atlasNetwork').onclick = () => { if (window.Views && Views.map) Views.map.setMode('network'); };
      $('#atlasMini').addEventListener('click', (e) => {
        const r = $('#atlasMini').getBoundingClientRect();
        const cx = ((e.clientX - r.left) / r.width) * PW;
        const cy = ((e.clientY - r.top) / r.height) * PH;
        const cw = stage.clientWidth, ch = stage.clientHeight;
        S.tx = cw / 2 - cx * S.zoom; S.ty = ch / 2 - cy * S.zoom;
        clampPan(); applyTransform(); persistView();
      });
    }
    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', () => {
        if (!stage || !stage.isConnected) return;
        const rel = S.zoom / (S.fit || 1);
        S.fit = calcFit();
        S.zoom = S.fit * rel;
        const v = cur() && cur().view;
        S.tx = (stage.clientWidth - PW * S.zoom) / 2 + (v ? v.x : 0);
        S.ty = (stage.clientHeight - PH * S.zoom) / 2 + (v ? v.y : 0);
        clampPan(); applyTransform();
      });
    }
  }

  function calcFit() {
    const cw = stage.clientWidth || 900, ch = stage.clientHeight || 620;
    return Math.min(cw / PW, ch / PH);
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    const m = cur();
    if (!m || !stage || !stage.isConnected) return;
    S.mapId = m.id; S.sel = null; S.placing = false;
    stage.classList.toggle('theme-dark', m.theme === 'dark');
    stage.classList.toggle('theme-light', m.theme !== 'dark');
    img.src = m.image;
    miniImg.src = m.image;
    // 留白区域用同图虚化铺底，避免全图适配时上下出现生硬的纯色带
    const bgUrl = /^(https?:|\/)/.test(m.image) ? m.image : '/' + m.image;
    stage.style.setProperty('--stage-bg', `url("${bgUrl}")`);
    S.fit = calcFit();
    const v = m.view || { x: 0, y: 0, zoom: 1 };
    S.zoom = S.fit * clamp(v.zoom || 1, MIN_REL, MAX_REL);
    S.tx = (stage.clientWidth - PW * S.zoom) / 2 + (v.x || 0);
    S.ty = (stage.clientHeight - PH * S.zoom) / 2 + (v.y || 0);

    renderLayers();
    renderVec();
    renderMarkers();
    renderSide();
    clampPan();
    applyTransform();
    updateHint();
  }

  function renderLayers() {
    const maps = Atlas.list();
    const m = cur();
    crumb.innerHTML = (function () {
      const chain = []; let p = m, guard = 0;
      while (p && guard++ < 8) { chain.unshift(p); p = p.parentId ? Atlas.get(p.parentId) : null; }
      return chain.map((x, i) => `<span class="${i === chain.length - 1 ? 'on' : ''}">${esc(x.name)}</span>`).join('<b>›</b>');
    })();
    layersBar.innerHTML = maps.map((x) =>
      `<button data-map="${esc(x.id)}" class="${x.id === m.id ? 'on' : ''}" title="${esc(x.desc || x.name)}">
        <i class="lv lv-${x.level}"></i>${esc(x.name)}<small>${esc(levelName(x.level))}</small></button>`
    ).join('');
    layersBar.querySelectorAll('button').forEach((b) => {
      b.onclick = () => Atlas.open(b.dataset.map);
    });
    $('#atlasLegend').innerHTML = `<span class="al-title">${esc(m.name)} · 图例</span>
      <span><i class="legend-dot"></i>重要地点</span><span><i class="legend-drill"></i>可下钻</span>
      <span class="al-tier" id="atlasTier"></span>`;
    tierLabel = $('#atlasTier');
  }

  function levelName(l) {
    return { cosmos: '宇宙层', world: '大陆层', region: '区域图', local: '小地图' }[l] || '图层';
  }

  /* 矢量层：经纬网 + 大洲名 + 放大后的地势地貌符号
     整层随 plane 一起缩放，所以字号 / 线宽 / 符号尺寸都反向除以 zoom，
     保证屏幕上始终恒定；放大时符号数量增加，形成「地貌展开」的效果。 */
  function renderVec() {
    const m = cur(); if (!m) return;
    const z = S.zoom || S.fit || 1;
    const inv = 1 / z;
    const rel = clamp(S.zoom / (S.fit || 1), 1, 3);
    S._vecZoom = S.zoom;
    const f = (n) => (n * inv).toFixed(3);

    let grid = '';
    for (let x = 100; x < PW; x += 100) grid += `<line x1="${x}" y1="0" x2="${x}" y2="${PH}" stroke-width="${f(0.7)}"/>`;
    for (let y = 100; y < PH; y += 100) grid += `<line x1="0" y1="${y}" x2="${PW}" y2="${y}" stroke-width="${f(0.7)}"/>`;
    const regionText = m.regions.map((r) => `
      <g class="vec-region" transform="translate(${px(r.x).toFixed(1)},${py(r.y).toFixed(1)})">
        <text class="vec-region-name" text-anchor="middle" y="0" style="font-size:${f(25)}px;stroke-width:${f(3)}px">${esc(r.name)}</text>
        ${r.sub ? `<text class="vec-region-sub" text-anchor="middle" y="${f(20)}" style="font-size:${f(10.5)}px;stroke-width:${f(2.5)}px">${esc(r.sub)}</text>` : ''}
      </g>`).join('');

    const terrain = m.terrain.map((t) => {
      const cx = px(t.x), cy = py(t.y), rx = px(t.rx), ry = py(t.ry);
      const rand = rng(hash(t.id));
      const count = Math.round((t.kind === 'stars' ? 26 : 14) * rel);
      let syms = '';
      for (let i = 0; i < count; i++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 0.88;
        const x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d;
        const s = (0.72 + rand() * 0.7) * inv;
        syms += `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${s.toFixed(4)})" opacity="${(0.62 + rand() * 0.36).toFixed(2)}">${symbol(t.kind)}</g>`;
      }
      return `<g class="vec-terrain">
        <ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" class="vec-terrain-area" stroke-width="${f(1)}"/>
        ${syms}
        <text class="vec-terrain-name" x="${cx.toFixed(1)}" y="${(cy + ry + 20 * inv).toFixed(1)}" text-anchor="middle" style="font-size:${f(14)}px;stroke-width:${f(2.5)}px">${esc(t.name)}</text>
      </g>`;
    }).join('');

    vec.innerHTML = `
      <g class="vec-grid">${grid}</g>
      <g class="vec-tier vec-tier-1">${regionText}</g>
      <g class="vec-tier vec-tier-3">${terrain}</g>`;
  }

  function symbol(kind) {
    const c = 'currentColor';
    switch (kind) {
      case 'mountain':
        return `<path d="M-9,5 L-2,-8 L2,-2 L5,-6 L11,5 Z" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="M-2,-8 L0,-4 L2,-6" fill="none" stroke="${c}" stroke-width="1"/>`;
      case 'forest':
        return `<path d="M0,-9 L-5,1 L5,1 Z M0,-4 L-6,5 L6,5 Z" fill="none" stroke="${c}" stroke-width="1.3" stroke-linejoin="round"/>
                <line x1="0" y1="5" x2="0" y2="9" stroke="${c}" stroke-width="1.3"/>`;
      case 'lava':
        return `<path d="M-7,7 Q-3,1 -1,-3 Q1,1 3,-6 Q4,0 8,7" fill="none" stroke="${c}" stroke-width="1.4"/>
                <path d="M-5,9 L-2,5 M3,9 L5,5" stroke="${c}" stroke-width="1"/>`;
      case 'swamp':
        return `<path d="M-9,0 Q-4,-4 0,0 T9,0 M-9,5 Q-4,1 0,5 T9,5" fill="none" stroke="${c}" stroke-width="1.3"/>
                <line x1="-3" y1="-7" x2="-3" y2="0" stroke="${c}" stroke-width="1"/>`;
      case 'river':
        return `<path d="M-7,-9 Q6,-3 -4,3 T4,10" fill="none" stroke="${c}" stroke-width="1.6"/>`;
      case 'whirl':
        return `<path d="M0,0 C7,-7 10,5 2,9 C-7,12 -12,1 -6,-7 C-1,-13 10,-12 14,-4" fill="none" stroke="${c}" stroke-width="1.3"/>`;
      case 'stars':
        return `<path d="M0,-6 L0,6 M-6,0 L6,0" stroke="${c}" stroke-width="1.1"/>
                <circle r="1.5" fill="${c}"/>`;
      case 'nebula':
        return `<path d="M-9,2 C-4,-8 7,-7 7,1 C7,8 -3,9 -4,3 C-5,-1 1,-3 2,0" fill="none" stroke="${c}" stroke-width="1.2"/>`;
      default:
        return `<circle r="3" fill="none" stroke="${c}" stroke-width="1.2"/>`;
    }
  }

  function renderMarkers() {
    const m = cur(); if (!m) return;
    mkLayer.innerHTML = m.markers.map((k) => `
      <button class="atlas-mk ${k.id === S.sel ? 'sel' : ''} ${k.childMapId ? 'drill' : ''}" data-id="${esc(k.id)}" title="${esc(k.desc || k.name)}">
        <span class="am-pin"><i></i></span>
        <span class="am-name">${esc(k.name)}</span>
        ${k.childMapId ? '<span class="am-drill">↘</span>' : ''}
      </button>`).join('');
    S.marks = Array.from(mkLayer.querySelectorAll('.atlas-mk'));
  }

  function renderSide() {
    const m = cur(); if (!m) return;
    const k = m.markers.find((x) => x.id === S.sel);
    if (k) { renderMarkerPanel(m, k); return; }
    side.innerHTML = `
      <div class="as-card">
        <div class="as-eyebrow">${esc(levelName(m.level))} · ${m.markers.length} 处地名</div>
        <h3>${esc(m.name)}</h3>
        <p class="as-desc">${esc(m.desc || '尚未填写图层说明')}</p>
        <div class="as-meta"><span>滚轮缩放</span><span>拖拽平移</span><span>双击放大</span><span>鹰眼定位</span></div>
      </div>
      <div class="as-card as-list">
        <div class="as-sec-title">地 名 索 引 <small>点击定位</small></div>
        <div class="as-list-body">${m.markers.map((x) => `
          <button class="as-li" data-go="${esc(x.id)}">
            <i style="--c:${kindColor(x.kind)}"></i>
            <span>${esc(x.name)}</span><small>${esc(x.kind)}</small>
          </button>`).join('') || '<div class="small muted">这层还没有地点</div>'}</div>
      </div>
      <div class="as-card as-tip">
        <div class="as-sec-title">层 级 接 口</div>
        <p class="small">后续小地图用 <code>Atlas.register({...})</code> 注册，或点上方「＋ 图层」直接建。地点可挂 <code>childMapId</code> 下钻，双击带 ↘ 的地点即可进入。</p>
      </div>`;
    side.querySelectorAll('[data-go]').forEach((b) => {
      b.onclick = () => { focusMarker(b.dataset.go); select(b.dataset.go); };
    });
  }

  function renderMarkerPanel(m, k) {
    const others = Atlas.list().filter((x) => x.id !== m.id);
    side.innerHTML = `
      <div class="as-card as-edit">
        <div class="as-eyebrow">${esc(levelName(m.level))} · ${esc(k.kind)} · ${k.x.toFixed(1)} / ${k.y.toFixed(1)}</div>
        <label class="fld"><span>地名（可直接改）</span>
          <input id="amName" type="text" value="${esc(k.name)}"></label>
        <label class="fld"><span>类型</span>
          <select id="amKind">${Atlas.KIND_LIST.map((t) => `<option value="${t}" ${k.kind === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="fld"><span>描述</span>
          <textarea id="amDesc" rows="4" placeholder="这地方的来历、势力、禁忌…">${esc(k.desc || '')}</textarea></label>
        <label class="fld"><span>下钻到（留空即无）</span>
          <select id="amChild"><option value="">— 无 —</option>
            ${others.map((x) => `<option value="${esc(x.id)}" ${k.childMapId === x.id ? 'selected' : ''}>${esc(x.name)} · ${esc(levelName(x.level))}</option>`).join('')}
          </select></label>
        <div class="as-btns">
          ${k.childMapId ? `<button class="btn sm primary" id="amGo">进入 ${esc((Atlas.get(k.childMapId) || {}).name || '子地图')} ↘</button>` : ''}
          <button class="btn sm" id="amFocus">定位</button>
          <button class="btn sm danger" id="amDel">删除</button>
        </div>
        <button class="as-back" id="amBack">← 返回地名索引</button>
      </div>`;
    const nameIn = $('#amName');
    nameIn.oninput = () => {
      k.name = nameIn.value || '未命名地点';
      Atlas.renameMarker(m.id, k.id, k.name);
      const btn = mkLayer.querySelector(`.atlas-mk[data-id="${k.id}"] .am-name`);
      if (btn) btn.textContent = k.name;
    };
    nameIn.onblur = () => { renderMarkers(); renderSide(); };
    $('#amKind').onchange = (e) => { Atlas.updateMarker(m.id, k.id, { kind: e.target.value }); renderMarkers(); renderSide(); };
    $('#amDesc').oninput = (e) => { Atlas.updateMarker(m.id, k.id, { desc: e.target.value }); };
    $('#amChild').onchange = (e) => { Atlas.setChild(m.id, k.id, e.target.value); renderMarkers(); renderSide(); };
    const go = $('#amGo'); if (go) go.onclick = () => Atlas.open(k.childMapId);
    $('#amFocus').onclick = () => focusMarker(k.id);
    $('#amDel').onclick = () => {
      if (!confirm(`删除地点「${k.name}」？`)) return;
      Atlas.removeMarker(m.id, k.id); S.sel = null; renderMarkers(); renderSide();
    };
    $('#amBack').onclick = () => { S.sel = null; renderMarkers(); renderSide(); };
  }

  function kindColor(kind) {
    const map = { 都城: '#a63a2a', 城邦: '#a97f2f', 圣山: '#3d6a58', 关隘: '#5b6f8c', 遗迹: '#7a4b6b', 凶地: '#8a3b32', 秘境: '#6a5acd', 水泽: '#3f6b6b', 仙界: '#c2a05a', 星垣: '#cfb26a', 恒星: '#d99a45', 星体: '#a9bcc9', 星阵: '#9a8ac9', 星云: '#6f8f9e', 星门: '#c07a5a', 下界: '#8fae8f' };
    return map[kind] || '#8a8378';
  }

  /* ---------------- 变换与状态 ---------------- */
  function clampPan() {
    const cw = stage.clientWidth, ch = stage.clientHeight;
    const w = PW * S.zoom, h = PH * S.zoom;
    S.tx = w <= cw ? (cw - w) / 2 : clamp(S.tx, cw - w - 40, 40);
    S.ty = h <= ch ? (ch - h) / 2 : clamp(S.ty, ch - h - 40, 40);
  }

  function applyTransform() {
    if (!plane) return;
    plane.style.transform = `translate(${S.tx.toFixed(2)}px,${S.ty.toFixed(2)}px) scale(${S.zoom.toFixed(4)})`;
    // 缩放变化超过 2% 时重算矢量层字号与符号密度（平移不重绘）
    if (S._vecZoom === undefined || Math.abs((S._vecZoom || 1) - S.zoom) / S.zoom > 0.02) renderVec();
    const rel = S.zoom / (S.fit || 1);
    if (zoomLabel) zoomLabel.textContent = Math.round(rel * 100) + '%';
    // 点位不随底图放大：手动投影到屏幕坐标
    const m = cur();
    if (m) {
      S.marks.forEach((b) => {
        const k = m.markers.find((x) => x.id === b.dataset.id);
        if (!k) return;
        b.style.left = (S.tx + px(k.x) * S.zoom).toFixed(1) + 'px';
        b.style.top = (S.ty + py(k.y) * S.zoom).toFixed(1) + 'px';
      });
    }
    // 比例尺：屏幕 100px 对应「里」
    const li = Math.round(100 / S.zoom * 30);
    if (scaleLabel) scaleLabel.textContent = li >= 10000 ? (li / 10000).toFixed(1) + ' 万里' : li.toLocaleString('zh-CN') + ' 里';
    // 分级：放大后才显出地势地貌
    const tier = rel < 1.35 ? 1 : rel < 2.4 ? 2 : 3;
    stage.classList.remove('z1', 'z2', 'z3');
    stage.classList.add('z' + tier);
    if (tierLabel) tierLabel.textContent = ['总览 · 诸洲', '地名 · 关隘', '地势 · 地貌'][tier - 1];
    // 鹰眼视口框
    const cw = stage.clientWidth, ch = stage.clientHeight;
    const vx = -S.tx / S.zoom, vy = -S.ty / S.zoom;
    const s = MINI_W / PW;
    if (miniView) {
      miniView.style.left = clamp(vx * s, 0, MINI_W) + 'px';
      miniView.style.top = clamp(vy * s, 0, MINI_H) + 'px';
      miniView.style.width = clamp((cw / S.zoom) * s, 8, MINI_W) + 'px';
      miniView.style.height = clamp((ch / S.zoom) * s, 8, MINI_H) + 'px';
    }
  }

  function persistView() {
    const m = cur(); if (!m) return;
    Atlas.setView(m.id, {
      x: S.tx - (stage.clientWidth - PW * S.zoom) / 2,
      y: S.ty - (stage.clientHeight - PH * S.zoom) / 2,
      zoom: S.zoom / (S.fit || 1)
    });
  }

  function zoomAt(mx, my, factor) {
    const before = S.zoom / (S.fit || 1);
    const nz = clamp(S.zoom * factor, S.fit * MIN_REL, S.fit * MAX_REL);
    if (Math.abs(nz - S.zoom) < 0.0001) return;
    const gx = (mx - S.tx) / S.zoom, gy = (my - S.ty) / S.zoom;
    S.tx = mx - gx * nz; S.ty = my - gy * nz; S.zoom = nz;
    clampPan(); applyTransform(); persistView();
    const after = S.zoom / (S.fit || 1);
    if (before < 2.4 && after >= 2.4) toast('已展开地势地貌层');
  }

  function buttonZoom(f) {
    zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, f);
  }

  function fitAll() {
    S.zoom = S.fit;
    S.tx = (stage.clientWidth - PW * S.zoom) / 2;
    S.ty = (stage.clientHeight - PH * S.zoom) / 2;
    clampPan(); applyTransform(); persistView();
  }

  function focusMarker(id) {
    const m = cur(); if (!m) return;
    const k = m.markers.find((x) => x.id === id); if (!k) return;
    const cw = stage.clientWidth, ch = stage.clientHeight;
    if (S.zoom < S.fit * 1.6) S.zoom = S.fit * 1.6;
    S.tx = cw / 2 - px(k.x) * S.zoom;
    S.ty = ch / 2 - py(k.y) * S.zoom;
    clampPan(); applyTransform(); persistView();
  }

  function select(id) {
    S.sel = id;
    S.marks.forEach((b) => b.classList.toggle('sel', b.dataset.id === id));
    renderSide();
  }

  function updateHint() {
    if (!hintBar) return;
    hintBar.innerHTML = S.placing
      ? '落点模式：在地图上单击放置新地点 <button id="ahCancel">取消</button>'
      : '拖动平移 · 滚轮缩放 · 双击放大 · 单击地名查看 · 带 ↘ 的地点双击下钻';
    hintBar.classList.toggle('active', S.placing);
    const c = $('#ahCancel'); if (c) c.onclick = () => { S.placing = false; updateHint(); };
  }

  /* ---------------- 新建图层（接口的可视入口） ---------------- */
  function newLayer() {
    const maps = Atlas.list();
    const mask = Modal.open({
      title: '新建图层 / 小地图',
      narrow: true,
      body: `
        <label class="fld"><span>名称</span><input id="nlName" type="text" placeholder="例：云梦城 · 内城"></label>
        <label class="fld"><span>层级</span><select id="nlLevel">
          <option value="region">区域图（一块大陆的细化）</option>
          <option value="local">小地图（城池 / 秘境 / 建筑群）</option>
        </select></label>
        <label class="fld"><span>隶属于</span><select id="nlParent">
          ${maps.map((x) => `<option value="${esc(x.id)}" ${x.id === Atlas.activeId() ? 'selected' : ''}>${esc(x.name)} · ${esc(levelName(x.level))}</option>`).join('')}
        </select></label>
        <label class="fld"><span>底图</span><select id="nlImg">
          <option value="atlas/land.jpg">大荒底图（复用）</option>
          <option value="atlas/cosmos.jpg">周天底图（复用）</option>
          <option value="custom">自定义图片路径…</option>
        </select></label>
        <label class="fld" id="nlCustomWrap" style="display:none"><span>图片路径</span>
          <input id="nlCustom" type="text" placeholder="atlas/my-map.jpg"></label>
        <div class="hint">建好后：在父图层的地点上，把「下钻到」选成这层，就能从大地图点进去。</div>`,
      footer: `<button class="btn" data-x>取消</button><button class="btn primary" id="nlGo">创建</button>`
    });
    mask.querySelector('#nlImg').onchange = (e) => {
      mask.querySelector('#nlCustomWrap').style.display = e.target.value === 'custom' ? '' : 'none';
    };
    mask.querySelector('[data-x]').onclick = () => Modal.close();
    mask.querySelector('#nlGo').onclick = () => {
      const name = mask.querySelector('#nlName').value.trim();
      if (!name) return toast('先给图层起个名字', 'err');
      let image = mask.querySelector('#nlImg').value;
      if (image === 'custom') image = mask.querySelector('#nlCustom').value.trim() || 'atlas/land.jpg';
      const m = Atlas.register({
        name, level: mask.querySelector('#nlLevel').value,
        parentId: mask.querySelector('#nlParent').value,
        image, theme: image.indexOf('cosmos') >= 0 ? 'dark' : 'light',
        desc: '自定义图层。点「＋ 地点」在图上落点，命名后即可使用。'
      });
      Modal.close();
      Atlas.open(m.id);
      toast(`「${name}」已建立，接下来可以在这层落点`);
    };
  }

  /* ---------------- 订阅数据层 ---------------- */
  Atlas.view = {
    onChange(type) {
      if (!stage || !stage.isConnected) return;
      if (type === 'open' || type === 'register' || type === 'change' || type === 'ready') render();
      else if (type === 'marker') { renderMarkers(); renderSide(); applyTransform(); }
    }
  };
  Atlas.on((type, payload) => { if (Atlas.view) Atlas.view.onChange(type, payload); });

  return { mount, render, fitAll, focusMarker: (id) => focusMarker(id) };
})();
