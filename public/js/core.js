/* ============ core.js —— 工具 / 存储 / LLM ============ */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 旧版关系 = 称谓 label + 分类 kind；新版只留一个自由填写的「关系」kind。
   载入时把旧称谓折叠进关系文字，既不丢信息，也不再出现两栏重复。 */
const LEGACY_REL_KINDS = ['血缘', '师徒', '主仆', '亲属', '恋人', '敌对', '盟友', '其他'];
function foldRelLabel(r) {
  if (!r || typeof r !== 'object') return r;
  const lb = String(r.label == null ? '' : r.label).trim();
  const kd = String(r.kind == null ? '' : r.kind).trim();
  if (lb) {
    if (!kd || LEGACY_REL_KINDS.includes(kd)) r.kind = lb;   // 称谓比分类更具体
    else if (kd !== lb && !kd.includes(lb) && !lb.includes(kd)) r.kind = lb + ' · ' + kd;
    else r.kind = lb.length >= kd.length ? lb : kd;
  } else {
    r.kind = kd === '其他' ? '' : kd; // 旧默认分类「其他」视作没填，留给作者自己写
  }
  delete r.label;
  if (!r.id) r.id = uid('rel');
  return r;
}

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'err' ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = '.25s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(10px)';
    setTimeout(() => el.remove(), 260);
  }, type === 'err' ? 5200 : 2600);
}

/* ============ AI 生成撤销 ============
   每次 LLM 调用之前自动留一份「整书数据」快照，任何 AI 生成都能原样退回去。
   快照存在浏览器 localStorage、按书隔离，不写进 project.json，也不增加服务端负担。 */
const AI_PAGE_LABEL = {
  project: '项目设定', import: '整书导入', world: '世界观', factions: '势力',
  characters: '人物', map: '地图', props: '道具', outline: '大纲',
  write: '角色对话', writer: '写作', settings: '设置', manuscript: '书稿', timeline: '时间线'
};
const AIUndo = {
  MAX: 12,
  _label: '',
  _hidden: false,

  /** 由具体生成入口调用，给这一步起个看得懂的名字；30 秒后自动过期，避免误标 */
  label(s) { this._label = String(s || ''); this._labelAt = Date.now(); },
  key() { return 'moge-ai-undo-' + (Store.currentBookId || 'default'); },
  load() {
    try {
      const a = JSON.parse(localStorage.getItem(this.key()) || '[]');
      return Array.isArray(a) ? a.filter((x) => x && typeof x.before === 'string') : [];
    } catch (e) { return []; }
  },
  save(a) {
    try { localStorage.setItem(this.key(), JSON.stringify(a)); }
    catch (e) {
      try { localStorage.setItem(this.key(), JSON.stringify(a.slice(-3))); } catch (e2) {}
    }
  },
  now() { try { return JSON.stringify(Store.data); } catch (e) { return ''; } },
  autoLabel() {
    if (this._label && Date.now() - (this._labelAt || 0) < 30000) {
      const s = this._label; this._label = ''; return s;
    }
    this._label = '';
    const h = (location.hash || '').replace(/^#/, '');
    return (AI_PAGE_LABEL[h] || '当前页') + ' · AI 生成';
  },

  /** 每次 LLM 调用前自动调用（chat / image 内部挂了钩子） */
  capture() {
    if (!Store.data) return;
    const before = this.now();
    if (!before) return;
    const arr = this.load();
    // 上一次 AI 调用没有改动数据（导演决策、总结、访谈等）→ 那张快照作废，用本次替换
    if (arr.length && arr[arr.length - 1].before === before) arr.pop();
    arr.push({
      id: uid('au'), at: new Date().toISOString(),
      label: this.autoLabel(), before
    });
    if (arr.length > this.MAX) arr.splice(0, arr.length - this.MAX);
    this.save(arr);
    this._hidden = false;
    // 快照拍在写入之前，等生成结果写进数据（Store.touch）后再刷新浮条
    this._dirty = true;
    this.render();
  },

  /** 可用的撤销步数：跳过与当前数据完全一致的无效快照 */
  usable(arr) {
    const cur = this.now();
    let i = arr.length - 1;
    while (i >= 0 && arr[i].before === cur) i--;
    return i + 1;
  },

  /** 恢复到某一步之前，并丢弃这一步之后的记录 */
  restore(i) {
    const arr = this.load();
    if (i < 0 || i >= arr.length) return false;
    const target = arr[i];
    let data;
    try { data = JSON.parse(target.before); } catch (e) { toast('撤销失败：快照已损坏', 'err'); return false; }
    // 撤销会整本替换 Store.data；若写作页纸面还留着被采用的 AI 稿，
    // 紧接着的 rerender 会把旧字 flush 回新数据里，等于撤销失败。
    // 标记一次「跳过 flush」，让重挂载直接读恢复后的章节正文。
    if (window.Views && window.Views.writer) window.Views.writer._discardDraft = true;
    // 万一这次没有触发 rerender，别让标记留到下一次正常输入
    setTimeout(() => { if (window.Views && window.Views.writer) window.Views.writer._discardDraft = false; }, 0);
    Store.data = data;
    arr.splice(i);
    this.save(arr);
    this._dirty = false;
    this._hidden = false;
    Store.touch();
    try { if (typeof Modal !== 'undefined' && typeof Modal.close === 'function') Modal.close(); } catch (e) {}
    // App 是顶层 const，不挂在 window 上；以前写 window.App 导致撤销后界面一直不刷新
    try { if (typeof App !== 'undefined' && typeof App.rerender === 'function') App.rerender(); } catch (e) {}
    this.render();
    toast('已撤销：' + target.label);
    return true;
  },
  undo() {
    const arr = this.load();
    const cur = this.now();
    let i = arr.length - 1;
    while (i >= 0 && arr[i].before === cur) i--;
    if (i < 0) { toast('没有可撤销的 AI 生成'); return false; }
    return this.restore(i);
  },
  undoTo(id) { return this.restore(this.load().findIndex((x) => x.id === id)); },
  clear() { this.save([]); this.render(); },

  /** 首次打开时留一份基线，之后的任何生成都至少能退回「现在这个样子」 */
  bootstrap() {
    const arr = this.load();
    if (!arr.length) {
      const before = this.now();
      if (before) {
        try {
          this.save([{ id: uid('au'), at: new Date().toISOString(), label: '本次打开时的状态（起点）', before }]);
        } catch (e) {}
      }
    }
    this.render();
  },

  render() {
    const host = document.getElementById('aiUndoBar');
    if (!host) return;
    const arr = this.load();
    const n = this.usable(arr);
    if (!n) { host.innerHTML = ''; host.classList.remove('on'); return; }
    host.classList.add('on');
    if (this._hidden) return this.renderMini(n);
    const last = arr[arr.length - 1];
    host.innerHTML = `<div class="ai-undo-card">
      <span class="ai-undo-mark">✦</span>
      <div class="ai-undo-txt"><b>AI 生成已留档</b><small>${esc(last.label)}</small></div>
      <button class="btn sm primary" id="aiUndoGo">↶ 撤销</button>
      <button class="btn sm" id="aiUndoList">历史 ${n}</button>
      <button class="ai-undo-x" id="aiUndoHide" title="收起">×</button>
    </div>`;
    const go = host.querySelector('#aiUndoGo'); if (go) go.onclick = () => this.undo();
    const li = host.querySelector('#aiUndoList'); if (li) li.onclick = () => this.history();
    const hi = host.querySelector('#aiUndoHide'); if (hi) hi.onclick = () => { this._hidden = true; this.render(); };
  },
  renderMini(n) {
    const host = document.getElementById('aiUndoBar');
    if (!host) return;
    host.innerHTML = `<button class="ai-undo-mini" title="展开 AI 生成撤销">↶ <b>${n}</b></button>`;
    const b = host.querySelector('#aiUndoMini') || host.querySelector('.ai-undo-mini');
    if (b) b.onclick = () => { this._hidden = false; this.render(); };
  },
  history() {
    const rows = this.load().slice().reverse();
    const mask = Modal.open({
      title: 'AI 生成 · 撤销历史', narrow: true,
      body: `<div class="hint" style="margin:0 0 10px">每一步都是「那次 AI 生成之前」的完整书稿状态。回到任意一步，这一步之后的生成记录会一起清掉。</div>
        <div id="aiUndoRows">${rows.length ? rows.map((x) => `
          <div class="ai-undo-row">
            <div style="min-width:0"><b>${esc(x.label)}</b><small>${esc(new Date(x.at).toLocaleString('zh-CN'))}</small></div>
            <button class="btn sm" data-aiundo="${x.id}">回到此前</button>
          </div>`).join('') : '<div class="rel-empty">还没有生成记录。</div>'}</div>`,
      footer: `<button class="btn danger" id="aiUndoClear">清空历史</button><button class="btn primary" data-done>关闭</button>`
    });
    mask.querySelector('#aiUndoRows').addEventListener('click', (e) => {
      const b = e.target.closest('[data-aiundo]');
      if (b) { Modal.close(); this.undoTo(b.dataset.aiundo); }
    });
    mask.querySelector('#aiUndoClear').onclick = () => { this.clear(); Modal.close(); };
    mask.querySelector('[data-done]').onclick = () => Modal.close();
  }
};

/* ---------- 路径读写 ---------- */
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, val) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (o[k] == null) o[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    o = o[k];
  }
  o[parts[parts.length - 1]] = val;
}

/* ---------- 弹窗 ---------- */
const Modal = {
  open({ title, body, footer, wide, narrow, onMount, onClose }) {
    this.close();
    const mask = document.createElement('div');
    mask.className = 'mask';
    // 任何关闭方式（✕ / 点遮罩 / Esc / 代码调用）都统一触发，供视图刷新数据
    mask.__onClose = typeof onClose === 'function' ? onClose : null;
    mask.innerHTML = `
      <div class="modal ${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''}">
        <div class="modal-head"><h2>${esc(title)}</h2><button class="close-x">✕</button></div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>`;
    $('#modalRoot').appendChild(mask);
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) this.close();
    });
    mask.querySelector('.close-x').onclick = () => this.close();
    if (onMount) onMount(mask);
    return mask;
  },
  close() {
    const root = $('#modalRoot');
    if (!root) return;
    const masks = Array.from(root.querySelectorAll('.mask'));
    root.innerHTML = '';
    masks.forEach((m) => {
      if (m.__onClose) { try { m.__onClose(); } catch (e) { console.warn('onClose', e); } }
      m.__onClose = null;
    });
  }
};

/* ---------- 世界观分类 ---------- */
const WORLD_CATS = [
  { key: '势力', icon: '势', color: '#a63a2a', hint: '门派、集团、帮派、机构' },
  { key: '地理', icon: '地', color: '#3d6a58', hint: '城邦、街区、秘境、地名' },
  { key: '历史', icon: '史', color: '#a97f2f', hint: '已发生的重大事件、纪元、旧怨、传说' },
  { key: '现状', icon: '状', color: '#6a5acd', hint: '当下格局、势力消长、明面与暗流、未解之谜' },
  { key: '规则', icon: '规', color: '#5b6f8c', hint: '超自然体系、社会机制、玩法' },
  { key: '禁忌', icon: '禁', color: '#7a4b6b', hint: '不能碰的东西、禁忌、代价' },
  { key: '文化', icon: '文', color: '#8c5a3c', hint: '习俗、信仰、礼节、方言' },
  { key: '名词', icon: '名', color: '#3f6b6b', hint: '专有名词、行话、称谓' },
  { key: '器物', icon: '物', color: '#4a6b4a', hint: '关键道具、器物、财货' }
];
const WORLD_CAT_MAP = {};
WORLD_CATS.forEach((c) => (WORLD_CAT_MAP[c.key] = c));

/* ---------- 画布视口：平移 + 缩放 ---------- */
const VIEW_MIN_ZOOM = 0.4;
const VIEW_MAX_ZOOM = 5;

function clampNum(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

const Viewport = {
  /** 读取并规整一个视口状态 {x, y, zoom} */
  read(v) {
    const z = Number(v && v.zoom);
    return {
      x: Number(v && v.x) || 0,
      y: Number(v && v.y) || 0,
      zoom: clampNum(Number.isFinite(z) && z > 0 ? z : 1, VIEW_MIN_ZOOM, VIEW_MAX_ZOOM)
    };
  },
  /** 视口对应的 viewBox 尺寸 */
  box(v, baseW, baseH) {
    return { w: baseW / v.zoom, h: baseH / v.zoom };
  },
  /** 把 viewBox 写进 svg */
  apply(svg, v, baseW, baseH) {
    if (!svg) return;
    const b = this.box(v, baseW, baseH);
    svg.setAttribute('viewBox', `${round2(v.x)} ${round2(v.y)} ${round2(b.w)} ${round2(b.h)}`);
  },
  /** 限制平移范围，别把地图拖丢 */
  clamp(v, baseW, baseH) {
    const b = this.box(v, baseW, baseH);
    const lox = -b.w * 0.28;
    const hix = baseW - b.w * 0.72;
    v.x = clampNum(v.x, Math.min(lox, hix), Math.max(lox, hix));
    const loy = -b.h * 0.28;
    const hiy = baseH - b.h * 0.72;
    v.y = clampNum(v.y, Math.min(loy, hiy), Math.max(loy, hiy));
    return v;
  },
  /**
   * 以屏幕上某个点为锚点缩放：该点下的内容保持不动。
   * svg 必须已经带上当前 viewBox。
   */
  zoomAt(v, factor, svg, clientX, clientY, baseW, baseH) {
    if (!svg) return v;
    const ctm = svg.getScreenCTM();
    if (!ctm) return v;
    const p = svg.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    const cur = p.matrixTransform(ctm.inverse());
    const old = this.box(v, baseW, baseH);
    const fx = (cur.x - v.x) / old.w;
    const fy = (cur.y - v.y) / old.h;
    const z0 = v.zoom;
    v.zoom = clampNum(z0 * factor, VIEW_MIN_ZOOM, VIEW_MAX_ZOOM);
    if (v.zoom === z0) return v;
    const nb = this.box(v, baseW, baseH);
    v.x = cur.x - fx * nb.w;
    v.y = cur.y - fy * nb.h;
    return this.clamp(v, baseW, baseH);
  },
  /** 滚轮：向上放大，向下缩小 */
  wheelFactor(deltaY) {
    return deltaY < 0 ? 1.16 : 1 / 1.16;
  }
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

/* ---------- 人物分组：文件夹树，可一层层嵌套 ---------- */
const CHAR_GROUP_COLORS = ['#a63a2a', '#3d6a58', '#5b6f8c', '#a97f2f', '#8c5a7a', '#4f7a8c', '#7d8256', '#a4633c'];
function defaultCharGroups() {
  return ['主角', '配角', '反派', '其他'].map((name, i) => ({
    id: ['cg_main', 'cg_side', 'cg_foe', 'cg_other'][i],
    name,
    color: CHAR_GROUP_COLORS[i],
    parentId: ''
  }));
}

/* ---------- 势力分类：单层，名字 / 顺序由作者定 ---------- */
function defaultFactionGroups() {
  return ['主要势力', '盟友', '敌对', '其他'].map((name, i) => ({
    id: ['fg_main', 'fg_ally', 'fg_foe', 'fg_other'][i],
    name,
    color: CHAR_GROUP_COLORS[i]
  }));
}

/* ---------- 默认项目 ---------- */
function blankProject() {
  return {
    meta: { title: '未命名作品', genre: '', logline: '', updatedAt: '' },
    novel: { name: '', chars: 0, analyzedAt: '', chunks: 0 },
    world: { setting: '', rules: '', tone: '', entries: [] },
    style: { pov: '第三人称限知', tense: '过去时', tone: '冷峻克制，短句为主，白描，少形容词', sample: '' },
    styleProfile: null,
    inventory: [],
    props: [],          // 未定位 / 无主道具池（挂在人物、地点上的道具仍存各自的 items）
    characters: [],
    charGroups: defaultCharGroups(), // 人物分组（可嵌套）
    factionGroups: defaultFactionGroups(), // 势力分类（单层，可增删改名 / 排序）
    relNet: { pos: {} }, // 关系网：人物节点自定义坐标 { [charId]: {x, y} }
    factionNet: { pos: {} }, // 势力关系图：节点自定义坐标 { [factionId]: {x, y} }
    map: { nodes: [], edges: [] },
    outline: { volumes: [] },
    manuscript: [],
    writer: { chapters: [], activeId: '', chats: {}, target: 3000 }, // 沉浸式写作：章节正文 / 目标字数 / 角色辅导留档
    timeline: [],
    consistency: { issues: [], at: null, scope: { world: true, char: true, timeline: true, style: true } },
    memory: { summaries: [] },
    interviews: {},       // 作者问答：{ [人物id]: [{q, a, at}] }
    settingsLocal: { rounds: 6, autoRun: true }
  };
}

function seedProject() {
  const p = blankProject();
  p.meta = {
    title: '洪荒纪·不周遗策',
    genre: '洪荒 · 神话 · 量劫',
    logline: '巫妖量劫将至，不周山深处浮现盘古遗念，各方圣人暗中落子，一介散修却窥见了天道之外的一线生机。',
    updatedAt: ''
  };
  p.world = {
    setting:
      '盘古开天后三千元会，洪荒天地初定。巫族掌地、妖族掌天，三清立教、西方二圣觊觎东土。天道初成，量劫隐现，鸿钧合道后第一次大劫即将降临。',
    rules: '天道之下，圣人不死不灭；量劫之中，众生皆为棋子。先天灵宝有定数，功德可抵因果，杀劫需以杀劫消。没有穿越者，没有系统。',
    tone: '苍茫、宏大、宿命的悲怆，白骨露于野，大能一言决万族生灭',
    entries: [
      {
        id: 'we_1',
        cat: '势力',
        name: '巫族',
        desc: '盘古精血所化十二祖巫，不修元神、只炼肉身，掌天地法则。以不周山为祖地，地煞七十二阵横行洪荒。',
        detail: '祖巫各有本命神通：帝江掌空间、烛龙掌时间、祝融掌火、共工掌水、玄冥掌冰、后土掌土……巫族无元神，故不能卜算天机，行事全凭血气与本能。',
        weight: 3,
        tags: ['盘古', '肉身', '不周山'],
        links: { chars: ['ch_xuanming'], places: ['pl_buzhou'] }
      },
      {
        id: 'we_2',
        cat: '势力',
        name: '妖族天庭',
        desc: '帝俊、太一立天庭，统御周天星斗。以河图洛书为根基，布周天星斗大阵，与巫族分庭抗礼。',
        detail: '天庭三十三重天，妖师鲲鹏掌北冥宫，十大妖帅各领部众。东皇钟镇压气运，然妖族气运已显颓势。',
        weight: 3,
        tags: ['帝俊', '东皇钟', '天庭'],
        links: { chars: ['ch_baize'], places: ['pl_tianting'] }
      },
      {
        id: 'we_3',
        cat: '规则',
        name: '量劫',
        desc: '天道自我调节的机制。杀孽积累至临界点，便引发大劫，以杀止杀、以劫消劫。',
        detail: '龙汉初劫灭了三族，道魔之争定了玄门。如今巫妖杀伐日盛，新一轮量劫已如悬顶之剑。量劫中，天机混沌，圣人也只能顺势而为。',
        weight: 3,
        tags: ['天道', '因果', '杀劫'],
        links: { chars: [], places: [] }
      },
      {
        id: 'we_4',
        cat: '名词',
        name: '鸿蒙紫气',
        desc: '成圣之基。鸿钧道祖于紫霄宫分赐六道，得者可证天道圣人。',
        detail: '红云老祖曾得一缕，因此招来杀身之祸。鸿蒙紫气无形无质，却可引动天地共鸣，是洪荒最珍贵的"门票"。',
        weight: 3,
        tags: ['圣人', '紫霄宫'],
        links: { chars: ['ch_hongyun'], places: [] }
      },
      {
        id: 'we_5',
        cat: '器物',
        name: '东皇钟',
        desc: '开天三宝之一，混沌钟。太一持之可镇压鸿蒙、扭转时空。',
        detail: '攻防一体，钟声一响，万法寂灭。然此宝与妖族气运相连，太一若殒，钟或将遁入混沌。',
        weight: 3,
        tags: ['先天至宝', '太一'],
        links: { chars: [], places: ['pl_tianting'] }
      },
      {
        id: 'we_6',
        cat: '地理',
        name: '幽冥血海',
        desc: '盘古肚脐所化，污浊至极，天地间一切戾气、怨气汇聚于此。',
        detail: '血海不枯，冥河不死。冥河老祖于此立阿修罗教，造阿修罗族，以杀道证混元。血海深处有十二品业火红莲镇守。',
        weight: 2,
        tags: ['冥河', '血海', '阿修罗'],
        links: { chars: ['ch_minghe'], places: ['pl_xuehai'] }
      },
      {
        id: 'we_7',
        cat: '禁忌',
        name: '不周山禁制',
        desc: '天柱之内有盘古遗念封印，非巫族血脉不可深入。擅闯者，肉身崩解、元神湮灭。',
        detail: '量劫前夕，封印出现裂隙，有混沌气息外泄。各大圣人暗中探查，却无人敢正面破封——盘古遗念，连圣人也忌惮三分。',
        weight: 3,
        tags: ['盘古', '封印', '天柱'],
        links: { chars: [], places: ['pl_buzhou'] }
      }
    ]
  };
  p.style = {
    pov: '第三人称全知（随场景切换视角）',
    tense: '过去时',
    tone: '苍茫宏大，白描中见壮阔。写杀伐不渲染血腥，写圣人只落一子。景物要有洪荒气象：亿万里、千重云、万古风。',
    sample: '玄冥站在不周山巅，脚下是翻涌了亿万年的云海。她不看天，不看地，只看山腹深处那一道裂隙——那里有盘古的心跳，一声比一声弱。'
  };

  const c1 = {
    id: 'ch_xuanming',
    name: '玄冥',
    role: '祖巫，冰之法则掌控者',
    color: '#3d6a58',
    lock: {
      traits: ['冷傲到近乎残忍', '对巫族有偏执的守护欲', '不信天机、只信拳头', '对后土有隐秘的柔软'],
      speech: '话极少，每句不超过七个字。不说"我觉得"，只说"该杀"或"不该"。情绪激动时周围会结霜。',
      taboo: '不会向任何人低头，不会承认自己害怕盘古遗念消散',
      values: '巫族存续高于一切；个人生死轻于鸿毛'
    },
    drive: {
      goal: '守住不周山封印，不让外人染指盘古遗念',
      fear: '盘古彻底消散后，巫族失去根脚',
      secret: '她曾在封印裂隙里听到盘古说"对不起"',
      arc: '从只信暴力，到理解"守护"有时需要放手'
    },
    knowledge: {
      knows: '不周山地脉走向、十二都天神煞阵、各祖巫弱点',
      unknown: '天道真正的意图、鸿钧为何默许量劫、其他圣人暗中布局'
    },
    relations: [
      { target: 'ch_baize', kind: '敌对阵营', attitude: '恨其算计，却不得不承认妖族有聪明人' },
      { target: 'ch_hongyun', kind: '旧识', attitude: '瞧不上老好人的软弱，但欠过一份因果' }
    ],
    state: { placeId: 'pl_buzhou', mood: '警觉，压抑', note: '' }
  };
  const c2 = {
    id: 'ch_baize',
    name: '白泽',
    role: '妖族军师，通万物之情',
    color: '#a97f2f',
    lock: {
      traits: ['算无遗策', '表面温和、内心冷酷', '对妖族忠诚但不愚忠', '说话永远留三分'],
      speech: '语速平缓，爱用比喻和典故。不说"你错了"，说"此计若行，恐有变数"。从不用脏字。',
      taboo: '不会暴露自己真正的本体藏身之处',
      values: '族群存续第一；若妖族必亡，至少要换个体面的结局'
    },
    drive: {
      goal: '在量劫中为妖族争取一线生机，即使要背刺帝俊',
      fear: '天机显示妖族气运将尽，而他自己也在劫中',
      secret: '他早就算出东皇钟会在量劫中失落，却一直没有告诉太一',
      arc: '从军师到棋手，最终发现自己也是棋子'
    },
    knowledge: {
      knows: '周天星斗大阵的破绽、各势力暗棋、天道运行的部分规律',
      unknown: '鸿蒙紫气的真正来历、盘古遗念的内容、天道之上是否还有存在'
    },
    relations: [
      { target: 'ch_xuanming', kind: '宿敌', attitude: '欣赏她的直率，但立场必须杀她' },
      { target: 'ch_minghe', kind: '暗盟', attitude: '互相利用，都知道对方会随时翻脸' }
    ],
    state: { placeId: 'pl_tianting', mood: '盘算，忧虑', note: '' }
  };
  const c3 = {
    id: 'ch_hongyun',
    name: '红云老祖',
    role: '散修大能，鸿蒙紫气持有者',
    color: '#a63a2a',
    lock: {
      traits: ['老好人', '与世无争', '对因果有近乎病态的执念', '关键时刻反而懦弱'],
      speech: '客气、迂回，喜欢说"道友所言极是"。被逼急了会语无伦次。',
      taboo: '不会主动杀人，不会拒绝别人的请求',
      values: '因果循环，报应不爽；宁愿自己吃亏，也不愿欠人'
    },
    drive: {
      goal: '保住鸿蒙紫气，证道成圣',
      fear: '因紫气招来杀身之祸',
      secret: '他其实已经隐约猜到鸿钧赐他紫气是为了"引蛇出洞"',
      arc: '从老好人到明白"善良需要牙齿"'
    },
    knowledge: {
      knows: '洪荒各大势力表面上的规矩、几处隐秘洞府的位置',
      unknown: '圣人真正的实力、量劫的具体走向、谁是真想杀他的人'
    },
    relations: [
      { target: 'ch_xuanming', kind: '故人', attitude: '感激她曾在血海边缘救过自己一次' },
      { target: 'ch_minghe', kind: '追杀者', attitude: '恐惧，但不恨——他觉得冥河也是被天道推着走' }
    ],
    state: { placeId: 'pl_kunlun', mood: '惶恐，强撑', note: '' }
  };
  const c4 = {
    id: 'ch_minghe',
    name: '冥河',
    role: '血海之主，阿修罗教教主',
    color: '#7a4b6b',
    lock: {
      traits: ['阴冷', '极度谨慎', '对"不死"有病态追求', '说话像毒蛇吐信'],
      speech: '慢，每个字都像在掂量。喜欢用反问。"你以为血海会干？"笑起来没有声音。',
      taboo: '绝不离开血海范围，绝不把本体暴露在任何人的视线里',
      values: '活着就是一切；只要血海不干，他就能一直算下去'
    },
    drive: {
      goal: '夺取鸿蒙紫气，以杀道证混元',
      fear: '血海被蒸干——这是唯一真正能杀死他的方法',
      secret: '他已经在血海深处藏了一滴盘古精血，准备在量劫最混乱时造出第十三个祖巫',
      arc: '从躲在血海算计一切，到被迫走出血海面对天道'
    },
    knowledge: {
      knows: '血海每一条暗流的走向、各势力见不得光的把柄、杀道的极限',
      unknown: '盘古遗念的内容、天道之上是否还有"道"、后土化轮回后他会失去什么'
    },
    relations: [
      { target: 'ch_baize', kind: '暗盟', attitude: '利用妖族分散注意力，自己坐收渔利' },
      { target: 'ch_hongyun', kind: '猎物', attitude: '不恨他，只是他需要那缕紫气' }
    ],
    state: { placeId: 'pl_xuehai', mood: '阴鸷，隐忍', note: '' }
  };
  p.characters = [c1, c2, c3, c4];

  p.map = {
    view: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: 'pl_buzhou',
        name: '不周山',
        type: '要地',
        x: 500,
        y: 320,
        desc: '盘古脊柱所化，天柱。山顶积雪亿万年不化，山腹有盘古遗念封印。巫族祖地。',
        items: [
        { id: 'mk_1', name: '封印裂隙', desc: '盘古遗念外泄之处。靠近会听到心跳声，修为不足者肉身崩解。' },
        { id: 'mk_2', name: '玄冰祭坛', desc: '玄冥以本命玄冰所筑，可暂时延缓裂隙扩张。但每用一次，她折寿一元会。' },
        { id: 'mk_4', name: '盘古血石', desc: '裂隙边缘凝结的暗红色晶石。里面封存着盘古开天前的记忆碎片。' }
        ],
        sub: { desc: '祖巫殿深埋山腹，地脉如血管般盘绕。封印裂隙附近，连祖巫的肉身都会感到刺痛。' }
      },
      {
        id: 'pl_tianting',
        name: '天庭',
        type: '官署',
        x: 720,
        y: 180,
        desc: '三十三重天，帝俊、太一所立。周天星斗大阵为核心，星辰之力汇聚于此。',
        items: [
        { id: 'mk_5', name: '周天星斗阵眼', desc: '河图洛书悬挂之处。阵眼一旦被破，天庭防御形同虚设。' },
        { id: 'mk_6', name: '白泽的算筹', desc: '妖师殿角落有一盘未收起的算筹，算的是"妖族气运终局"——结果被他抹去了。' }
        ],
        sub: { desc: '凌霄宝殿居最高层，妖师宫在三十三天外。星斗大阵的阵眼在南天门外。' }
      },
      {
        id: 'pl_xuehai',
        name: '幽冥血海',
        type: '暗处',
        x: 220,
        y: 460,
        desc: '天地污浊汇聚之所，血浪翻涌亿万里。冥河老祖道场，阿修罗族诞生之地。',
        items: [
        { id: 'mk_7', name: '业火红莲', desc: '十二品莲台，冥河证道之宝。莲火沾身，业力不够者直接烧成飞灰。' },
        { id: 'mk_8', name: '盘古精血', desc: '藏在第七层深处的一滴血。冥河想用它造第十三个祖巫——但盘古精血有自己的意志。' }
        ],
        sub: { desc: '血海分九层，越深越污浊。冥河本体在第七层，上面六层都是替身。' }
      },
      {
        id: 'pl_kunlun',
        name: '昆仑山',
        type: '要地',
        x: 320,
        y: 160,
        desc: '三清道场。玉虚宫、碧游宫、八景宫分踞三峰。玄门正宗，天道之下的清修之地。',
        items: [
        { id: 'mk_10', name: '紫霄宫遗碑', desc: '鸿钧讲道后留下的残碑，上面有道纹。有人试图补全，补到一半疯了。' }
        ],
        sub: { desc: '三清宫之间以虹桥相连，但三位圣人已有千年不互通音讯。' }
      },
      {
        id: 'pl_donghai',
        name: '东海',
        type: '荒野',
        x: 840,
        y: 380,
        desc: '龙族地盘，蓬莱、方丈、瀛洲三仙岛隐于雾中。海面下是龙族祖坟。',
        items: [
        { id: 'mk_11', name: '蓬莱雾径', desc: '一条被雾气掩盖的航路，通往三仙岛。龙族知道，但从不阻拦——上岛的人没几个能回来。' }
        ],
        sub: { desc: '海面风平浪静，海底暗流能撕碎大罗金仙的肉身。蓬莱岛每千年上浮一次。' }
      },
      {
        id: 'pl_xifang',
        name: '须弥山',
        type: '荒野',
        x: 160,
        y: 180,
        desc: '西方教道场。准提、接引两位圣人立教之地，地脉贫瘠，故觊觎东土气运。',
        items: [
        { id: 'mk_12', name: '八宝功德池', desc: '西方教聚敛功德之所。池底沉着无数"失败者"的残魂。' }
        ],
        sub: { desc: '须弥山一半是净土、一半是废墟。废墟里藏着西方教不能见光的东西。' }
      }
    ],
    edges: [
      { a: 'pl_buzhou', b: 'pl_kunlun', label: '虹桥可通' },
      { a: 'pl_buzhou', b: 'pl_xuehai', label: '地脉相连' },
      { a: 'pl_tianting', b: 'pl_donghai', label: '星光照海' },
      { a: 'pl_kunlun', b: 'pl_tianting', label: '三千里云路' },
      { a: 'pl_xifang', b: 'pl_kunlun', label: '西方朝圣路' },
      { a: 'pl_xuehai', b: 'pl_xifang', label: '血河暗通' }
    ]
  };

  p.outline = {
    volumes: [
      {
        id: 'vol_1',
        title: '第一卷 · 天柱裂',
        summary: '不周山封印出现裂隙，各方势力暗中落子。玄冥发现盘古遗念在衰退，白泽算出妖族必亡却选择隐瞒。',
        chapters: [
          {
            id: 'chp_1',
            title: '第一章 · 裂隙中的心跳',
            summary: '玄冥在不周山封印裂隙前听到了盘古的遗言。与此同时，白泽在天庭算出了量劫的真相。',
            scenes: [
              {
                id: 'sc_1',
                title: '山腹密语',
                placeId: 'pl_buzhou',
                cast: ['ch_xuanming'],
                goal: '玄冥试图加固封印，却发现裂隙比她想象的深',
                conflict: '盘古遗念在呼唤她"进来"，她不知道是陷阱还是遗愿',
                beats: ['玄冥独自下到裂隙边缘，玄冰祭坛出现新的裂纹', '她听到了心跳——不是自己的，是盘古的', '裂隙深处有东西在回应她的血脉，她第一次感到了恐惧', '她选择退出来，没有告诉任何人']
              }
            ]
          }
        ]
      }
    ]
  };
  return p;
}
const Store = {
  data: null,
  settings: {},
  books: [],
  currentBookId: '',
  _timer: null,

  async init() {
    const sRes = await fetch('/api/settings');
    this.settings = (await sRes.json().catch(() => ({}))) || {};
    let lib = await fetch('/api/library').then((r) => r.json().catch(() => null));
    if (!lib || !Array.isArray(lib.books) || !lib.books.length) {
      lib = { version: 1, current: 'default', books: [{ id: 'default', title: '我的小说', genre: '', createdAt: '', updatedAt: '' }] };
    }
    this.books = lib.books;
    let cur = localStorage.getItem('moge-book') || lib.current || lib.books[0].id;
    if (!this.books.some((b) => b.id === cur)) cur = lib.books[0].id;
    await this.loadBook(cur, true);
  },

  /** 把字符串/数组统一归整为字符串数组（导入或 AI 产出可能把数组字段写成整段字符串） */
  toArr(v, sep) {
    if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.trim());
    if (typeof v === 'string') return v.split(sep || /\n/).map((s) => s.trim()).filter(Boolean);
    return [];
  },

  /** 把任意值归整为字符串 */
  toStr(v) {
    return v == null ? '' : String(v);
  },

  /** 把服务器返回的项目数据归整为内存结构（不再生成痕迹 sub.items） */
  normalize(p) {
    const d = Object.assign(blankProject(), p);
    // 老数据里的道具可能没有 id，补上稳定 id 才能编辑 / 改归属 / 跨视图定位
    const ensureItemIds = (arr) => arr.forEach((it) => {
      if (it && typeof it === 'object' && !it.id) it.id = uid('it');
    });
    d.meta = Object.assign(blankProject().meta, p.meta || {});
    d.world = Object.assign(blankProject().world, p.world || {});
    if (!Array.isArray(d.world.entries)) d.world.entries = [];
    // 势力条目扩展：所属地 places（地名字符串）、势力间关系 relations
    d.world.entries.forEach((e) => {
      if (!e || typeof e !== 'object') return;
      if (!e.links || typeof e.links !== 'object') e.links = { chars: [], places: [] };
      if (!Array.isArray(e.links.chars)) e.links.chars = [];
      if (!Array.isArray(e.links.places)) e.links.places = [];
      if (e.cat === '势力') {
        if (!Array.isArray(e.places)) e.places = [];
        e.relations = (Array.isArray(e.relations) ? e.relations : [])
          .filter((r) => r && typeof r === 'object')
          .map((r) => ({
            id: r.id || uid('fr'), target: String(r.target || ''),
            kind: String(r.kind || ''), note: String(r.note || ''),
            pairId: String(r.pairId || '') // 拖拽连线建立的关系两端共享，删一端同步删另一端
          }));
      }
    });
    const factionIds = new Set(d.world.entries.filter((e) => e.cat === '势力').map((e) => e.id));
    d.world.entries.forEach((e) => {
      if (e.cat === '势力') e.relations = e.relations.filter((r) => factionIds.has(r.target) && r.target !== e.id);
    });
    /* 势力分类：老书补默认；作者删空后是 []，不会被填回 */
    d.factionGroups = (Array.isArray(d.factionGroups) ? d.factionGroups : defaultFactionGroups())
      .filter((g) => g && typeof g === 'object')
      .map((g, i) => ({
        id: g.id || uid('fg'),
        name: String(g.name || '').trim(),
        color: g.color || CHAR_GROUP_COLORS[i % CHAR_GROUP_COLORS.length]
      }));
    const fgIds = new Set(d.factionGroups.map((g) => g.id));
    d.world.entries.forEach((e) => {
      if (e && e.cat === '势力' && !fgIds.has(e.groupId)) e.groupId = '';
    });
    if (!d.factionNet || typeof d.factionNet !== 'object') d.factionNet = { pos: {} };
    if (!d.factionNet.pos || typeof d.factionNet.pos !== 'object') d.factionNet.pos = {};
    Object.keys(d.factionNet.pos).forEach((k) => { if (!factionIds.has(k)) delete d.factionNet.pos[k]; });
    d.style = Object.assign(blankProject().style, p.style || {});
    d.styleProfile = p.styleProfile || null;
    d.novel = Object.assign(blankProject().novel, p.novel || {});
    d.inventory = Array.isArray(p.inventory) ? p.inventory : [];
    d.props = Array.isArray(p.props) ? p.props : [];
    d.map = p.map || { nodes: [], edges: [] };
    if (!Array.isArray(d.map.nodes)) d.map.nodes = [];
    if (!Array.isArray(d.map.edges)) d.map.edges = [];
    d.map.view = Viewport.read(d.map.view);
    // 地点归一化：只保留 desc + items（人物/道具），去掉痕迹 sub.items
    d.map.nodes.forEach((n) => {
      n.sub = { desc: (n.sub && n.sub.desc) || '' }; // 保留内部描写，痕迹 sub.items 已移除
      if (!Array.isArray(n.items)) n.items = [];
      ensureItemIds(n.items);
      if (!n.art || typeof n.art !== 'object') n.art = { building: null, shots: [] };
      if (!Array.isArray(n.art.shots)) n.art.shots = [];
    });
    // 人物分类：老书没有这个字段时给四个默认组；用户删空后是 []，不会被重新填回
    const rawGroups = Array.isArray(p.charGroups) ? p.charGroups : d.charGroups;
    d.charGroups = (Array.isArray(rawGroups) ? rawGroups : defaultCharGroups())
      .filter((g) => g && typeof g === 'object')
      .map((g, i) => ({
        id: g.id || uid('cg'),
        name: String(g.name || '').trim(),
        color: g.color || CHAR_GROUP_COLORS[i % CHAR_GROUP_COLORS.length],
        parentId: String(g.parentId || '')
      }));
    const gids = new Set(d.charGroups.map((g) => g.id));
    // 父级不存在 / 自引用 → 提回根目录；加载时顺手打断可能的环
    d.charGroups.forEach((g) => {
      if (g.parentId && (!gids.has(g.parentId) || g.parentId === g.id)) g.parentId = '';
    });
    d.charGroups.forEach((g) => {
      const seen = new Set([g.id]);
      let p = d.charGroups.find((x) => x.id === g.parentId);
      while (p) { if (seen.has(p.id)) { g.parentId = ''; break; } seen.add(p.id); p = d.charGroups.find((x) => x.id === p.parentId); }
    });
    d.characters = Array.isArray(p.characters) ? p.characters : [];
    d.characters.forEach((c) => {
      if (!c.groupId || !gids.has(c.groupId)) c.groupId = '';
      // 容错归整：导入 / AI 产出可能把数组字段写成字符串，这里统一修正，避免人物页崩掉
      if (!c.lock || typeof c.lock !== 'object') c.lock = {};
      c.lock.traits = this.toArr(c.lock.traits);
      c.lock.speech = this.toStr(c.lock.speech);
      c.lock.taboo = this.toStr(c.lock.taboo);
      c.lock.values = this.toStr(c.lock.values);
      if (!c.drive || typeof c.drive !== 'object') c.drive = {};
      ['goal', 'fear', 'secret', 'arc'].forEach((k) => (c.drive[k] = this.toStr(c.drive[k])));
      if (!c.knowledge || typeof c.knowledge !== 'object') c.knowledge = {};
      c.knowledge.knows = this.toStr(c.knowledge.knows);
      c.knowledge.unknown = this.toStr(c.knowledge.unknown);
      if (!c.state || typeof c.state !== 'object') c.state = {};
      c.state.placeId = this.toStr(c.state.placeId);
      c.state.mood = this.toStr(c.state.mood);
      c.state.note = this.toStr(c.state.note);
      c.aliases = this.toArr(c.aliases, /[,，、;；\n]/);
      c.relations = (Array.isArray(c.relations) ? c.relations : [])
        .filter((r) => r && typeof r === 'object')
        .map(foldRelLabel); // 旧「称谓 + 分类」→ 一条自由填写的关系文字
      c.futureItems = this.toArr(c.futureItems);
      if (!Array.isArray(c.items)) c.items = [];
      ensureItemIds(c.items);
    });
    ensureItemIds(d.props);
    // 关系网自定义坐标：只保留仍在册的人物，避免删人后残留脏数据
    d.relNet = (p.relNet && typeof p.relNet === 'object') ? p.relNet : { pos: {} };
    if (!d.relNet.pos || typeof d.relNet.pos !== 'object' || Array.isArray(d.relNet.pos)) d.relNet.pos = {};
    const ids = new Set(d.characters.map((c) => c.id));
    Object.keys(d.relNet.pos).forEach((k) => { if (!ids.has(k)) delete d.relNet.pos[k]; });
    d.outline = p.outline || { volumes: [] };
    /* 大纲：每卷除了章节，还带一块「情节画布」——情节点 + 明线/暗线/人物线 + 视口 */
    if (!Array.isArray(d.outline.volumes)) d.outline.volumes = [];
    d.outline.volumes = d.outline.volumes.filter((v) => v && typeof v === 'object').map((v, vi) => {
      v.id = v.id || uid('vol');
      v.title = String(v.title || ('第' + (vi + 1) + '卷'));
      v.summary = String(v.summary || '');
      v.chapters = (Array.isArray(v.chapters) ? v.chapters : []).filter((c) => c && typeof c === 'object').map((c, ci) => {
        c.id = c.id || uid('chp');
        c.title = String(c.title || ('第' + (ci + 1) + '章'));
        c.summary = String(c.summary || '');
        c.scenes = Array.isArray(c.scenes) ? c.scenes : [];
        return c;
      });
      const cv = (v.canvas && typeof v.canvas === 'object' && !Array.isArray(v.canvas)) ? v.canvas : {};
      const nodes = (Array.isArray(cv.nodes) ? cv.nodes : [])
        .filter((n) => n && typeof n === 'object')
        .map((n) => ({
          id: n.id || uid('oc'),
          title: String(n.title == null ? '情节点' : n.title),
          desc: String(n.desc == null ? '' : n.desc),
          ch: Number.isInteger(Number(n.ch)) ? Number(n.ch) : -1,
          x: Number(n.x) || 0,
          y: Number(n.y) || 0
        }));
      const ids = new Set(nodes.map((n) => n.id));
      const edges = (Array.isArray(cv.edges) ? cv.edges : [])
        .filter((e) => e && typeof e === 'object' && ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
        .map((e) => ({
          id: e.id || uid('oe'),
          from: e.from,
          to: e.to,
          type: ['main', 'dark', 'char', 'sub'].includes(e.type) ? e.type : 'main',
          label: String(e.label == null ? '' : e.label)
        }));
      const view = (cv.view && typeof cv.view === 'object') ? cv.view : {};
      const zoom = Number(view.zoom);
      v.canvas = {
        nodes,
        edges,
        view: {
          x: Number(view.x) || 0,
          y: Number(view.y) || 0,
          zoom: Number.isFinite(zoom) && zoom > 0 ? Math.min(2.5, Math.max(0.25, zoom)) : 1
        }
      };
      return v;
    });
    // 沉浸式写作：章节正文是作者手写的，归整时只补字段、绝不丢文字
    const w = (p.writer && typeof p.writer === 'object' && !Array.isArray(p.writer)) ? p.writer : {};
    d.writer = {
      chapters: (Array.isArray(w.chapters) ? w.chapters : [])
        .filter((c) => c && typeof c === 'object')
        .map((c, i) => ({
          id: c.id || uid('wc'),
          title: String(c.title || ('第 ' + (i + 1) + ' 章')),
          text: String(c.text == null ? '' : c.text),
          note: String(c.note == null ? '' : c.note),
          createdAt: c.createdAt || '',
          updatedAt: c.updatedAt || ''
        })),
      activeId: String(w.activeId || ''),
      chats: (w.chats && typeof w.chats === 'object' && !Array.isArray(w.chats)) ? w.chats : {},
      target: Number(w.target) > 0 ? Number(w.target) : 3000
    };
    Object.keys(d.writer.chats).forEach((k) => { if (!Array.isArray(d.writer.chats[k])) delete d.writer.chats[k]; });
    const wIds = new Set(d.writer.chapters.map((c) => c.id));
    if (!wIds.has(d.writer.activeId)) d.writer.activeId = d.writer.chapters.length ? d.writer.chapters[0].id : '';
    d.memory = p.memory || { summaries: [] };
    d.interviews = (p.interviews && typeof p.interviews === 'object' && !Array.isArray(p.interviews)) ? p.interviews : {};
    Object.keys(d.interviews).forEach((k) => { if (!Array.isArray(d.interviews[k])) delete d.interviews[k]; });
    d.timeline = Array.isArray(p.timeline) ? p.timeline : [];
    d.consistency = p.consistency || { issues: [], at: null, scope: {} };
    d.consistency.scope = Object.assign({ world: true, char: true, timeline: true, style: true }, d.consistency.scope || {});
    d.consistency.issues = Array.isArray(d.consistency.issues) ? d.consistency.issues : [];
    return d;
  },

  async loadBook(id, isInit) {
    const p = await fetch('/api/book/' + encodeURIComponent(id)).then((r) => r.json().catch(() => null));
    if (p && p.meta) {
      this.data = this.normalize(p);
      this.currentBookId = id;
      localStorage.setItem('moge-book', id);
    } else if (isInit) {
      // 文库里没有这本书的数据（首次迁移/兜底），用种子库
      this.data = seedProject();
      this.currentBookId = id;
      localStorage.setItem('moge-book', id);
      await this.save(true);
    } else {
      throw new Error('该书数据读取失败');
    }
    // 道具索引是派生数据：每次载入都按人物 / 地点 / 无主池重建，避免手动增删改后索引过期
    this.rebuildInventory();
  },

  async switchBook(id) {
    if (id === this.currentBookId) return;
    await this.loadBook(id, false);
    const lib = await fetch('/api/library').then((r) => r.json().catch(() => null));
    if (lib && Array.isArray(lib.books)) {
      lib.current = id;
      lib.books = this.books;
      await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lib) });
    }
  },

  async newBook(title) {
    const id = 'bk_' + Math.random().toString(36).slice(2, 9);
    const now = new Date().toISOString();
    const book = { id, title: title || '未命名作品', genre: '', createdAt: now, updatedAt: now };
    this.books.push(book);
    const lib = { version: 1, current: id, books: this.books };
    await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lib) });
    await fetch('/api/book/' + encodeURIComponent(id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(blankProject())
    });
    this.currentBookId = id;
    localStorage.setItem('moge-book', id);
    this.data = this.normalize(blankProject());
  },

  async renameBook(id, title) {
    const b = this.books.find((x) => x.id === id);
    if (!b) return;
    b.title = title;
    b.updatedAt = new Date().toISOString();
    // 书名与文库名是同一个东西：改文库名时同步作品内的书名，否则下次保存会被覆盖回去
    if (id === this.currentBookId) {
      this.data.meta.title = title;
      await this.save(true);
      return;
    }
    const p = await fetch('/api/book/' + encodeURIComponent(id)).then((r) => r.json().catch(() => null));
    if (p && p.meta) {
      p.meta.title = title;
      await fetch('/api/book/' + encodeURIComponent(id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p)
      });
    }
  },

  async deleteBook(id) {
    if (this.books.length <= 1) throw new Error('至少保留一本书');
    const removedCurrent = id === this.currentBookId;
    this.books = this.books.filter((b) => b.id !== id);
    // 真正删掉这本书的数据目录
    try {
      await fetch('/api/book/' + encodeURIComponent(id), { method: 'DELETE' });
    } catch (e) {}
    if (removedCurrent) {
      await this.loadBook(this.books[0].id, false);
    }
    const lib = { version: 1, current: this.currentBookId, books: this.books };
    await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lib) });
  },

  save(now) {
    clearTimeout(this._timer);
    const hint = $('#saveHint');
    if (hint) hint.textContent = '未保存…';
    const run = async () => {
      try {
        // 本地同步书库索引里的书名（服务端也会同步一次）
        const b = this.books.find((x) => x.id === this.currentBookId);
        if (b && this.data && this.data.meta) {
          if (this.data.meta.title) b.title = this.data.meta.title;
          if (this.data.meta.genre !== undefined) b.genre = this.data.meta.genre;
          b.updatedAt = new Date().toISOString();
        }
        await fetch('/api/book/' + encodeURIComponent(this.currentBookId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.data)
        });
        if (hint) hint.textContent = '已保存';
        try { if (typeof App !== 'undefined' && typeof App.renderBookBar === 'function') App.renderBookBar(); } catch (e) {}
      } catch (e) {
        if (hint) hint.textContent = '保存失败';
      }
    };
    if (now) return run();
    this._timer = setTimeout(run, 600);
  },

  touch() {
    // 刚发生过 AI 调用 → 数据已写入，这时重算一次撤销浮条
    try {
      if (typeof AIUndo !== 'undefined' && AIUndo._dirty) { AIUndo._dirty = false; AIUndo.render(); }
    } catch (e) {}
    this.save();
    const hint = $('#saveHint');
    if (hint) hint.textContent = '编辑中…';
  },

  /* ---------- 人物分组（文件夹树） ---------- */
  charGroups() {
    if (!Array.isArray(this.data.charGroups)) this.data.charGroups = defaultCharGroups();
    return this.data.charGroups;
  },
  charGroup(id) {
    return this.charGroups().find((g) => g.id === id) || null;
  },
  charGroupColor(g) {
    return (g && g.color) || '#8a8378';
  },
  charGroupOf(c) {
    return (c && this.charGroup(c.groupId)) || null;
  },
  charGroupChildren(parentId) {
    const pid = parentId || '';
    return this.charGroups().filter((g) => (g.parentId || '') === pid);
  },
  charGroupPath(id) {
    const path = [], seen = new Set();
    let g = this.charGroup(id);
    while (g && !seen.has(g.id)) {
      seen.add(g.id); path.unshift(g);
      g = this.charGroup(g.parentId);
    }
    return path;
  },
  charGroupDescendants(id) {
    const out = [], seen = new Set([id]);
    const walk = (pid) => this.charGroupChildren(pid).forEach((g) => {
      if (seen.has(g.id)) return;
      seen.add(g.id); out.push(g); walk(g.id);
    });
    walk(id);
    return out;
  },
  charGroupLabel(g) {
    return this.charGroupPath(g.id).map((x) => x.name || '未命名').join(' / ');
  },
  /** 组里的人物；recursive=true 时连子文件夹里的一起算 */
  charGroupChars(id, recursive) {
    const ids = new Set([id]);
    if (recursive) this.charGroupDescendants(id).forEach((g) => ids.add(g.id));
    return this.data.characters.filter((c) => ids.has(c.groupId));
  },
  ungroupedChars() {
    const ids = new Set(this.charGroups().map((g) => g.id));
    return this.data.characters.filter((c) => !ids.has(c.groupId));
  },
  setCharGroup(charId, groupId) {
    const c = this.char(charId);
    if (!c) return;
    c.groupId = (groupId && this.charGroup(groupId)) ? groupId : '';
    this.touch();
  },
  addCharGroup(name, parentId) {
    const n = String(name || '').trim().slice(0, 20);
    if (!n) return null;
    const pid = (parentId && this.charGroup(parentId)) ? parentId : '';
    const dup = this.charGroupChildren(pid).find((g) => g.name === n);
    if (dup) return dup;
    const list = this.charGroups();
    const g = { id: uid('cg'), name: n, color: CHAR_GROUP_COLORS[list.length % CHAR_GROUP_COLORS.length], parentId: pid };
    let at = list.length;
    for (let i = list.length - 1; i >= 0; i--) if ((list[i].parentId || '') === pid) { at = i + 1; break; }
    list.splice(at, 0, g);
    this.touch();
    return g;
  },
  renameCharGroup(id, name) {
    const g = this.charGroup(id);
    if (!g) return;
    g.name = String(name || '').trim().slice(0, 20);
    this.touch();
  },
  /** 连同子文件夹一起删，人物只回「未分组」 */
  removeCharGroup(id) {
    const kill = new Set([id].concat(this.charGroupDescendants(id).map((g) => g.id)));
    this.data.charGroups = this.charGroups().filter((g) => !kill.has(g.id));
    let moved = 0;
    this.data.characters.forEach((c) => { if (kill.has(c.groupId)) { c.groupId = ''; moved++; } });
    this.touch();
    return moved;
  },
  /** 同级 ↑↓ */
  moveCharGroup(id, dir) {
    const list = this.charGroups();
    const g = this.charGroup(id);
    if (!g) return;
    const sibs = list.filter((x) => (x.parentId || '') === (g.parentId || ''));
    const j = sibs.indexOf(g) + dir;
    if (j < 0 || j >= sibs.length) return;
    const a = list.indexOf(g), b = list.indexOf(sibs[j]);
    if (a < 0 || b < 0) return;
    list[a] = sibs[j]; list[b] = g;
    this.touch();
  },
  /** 改父级（升一级 / 挂到别的组下），禁止挂进自己的后代 */
  moveCharGroupTo(id, parentId) {
    const g = this.charGroup(id);
    if (!g) return false;
    const pid = parentId || '';
    if (pid === id) return false;
    if (pid && !this.charGroup(pid)) return false;
    if (pid && this.charGroupDescendants(id).some((x) => x.id === pid)) return false;
    g.parentId = pid;
    this.touch();
    return true;
  },

  char(id) {
    return this.data.characters.find((c) => c.id === id);
  },
  place(id) {
    const direct = this.data.map.nodes.find((n) => n.id === id);
    if (direct) return direct;
    // 地图引用：atlas:<地图id>:r|m:<地点id> —— 不复制地名，改名后自动跟着变
    const m = /^atlas:([^:]+):([rm]):(.+)$/.exec(String(id || ''));
    if (!m || !window.Atlas || typeof Atlas.get !== 'function') return undefined;
    try {
      const map = Atlas.get(m[1]);
      if (!map) return undefined;
      const src = m[2] === 'r' ? (map.regions || []) : (map.markers || []);
      const it = src.find((x) => x.id === m[3]);
      if (!it) return undefined;
      return {
        id: String(id),
        name: String(it.name || '未命名地点').replace(/\s+/g, ' '),
        desc: (m[2] === 'r' ? it.sub : it.desc) || '',
        items: [],
        atlas: true, mapId: map.id, mapName: map.name
      };
    } catch (e) { return undefined; }
  },
  charName(id) {
    const c = this.char(id);
    return c ? c.name : '？';
  },
  placeName(id) {
    const p = this.place(id);
    return p ? p.name : '未指定';
  },
  /** 所有可引用的地点：章节场景 + 两层地图上的区域 / 地名 */
  placeOptions() {
    const out = [];
    (this.data.map.nodes || []).forEach((n) => out.push({
      value: n.id, label: n.name || '未命名场景', group: '章节场景'
    }));
    try {
      const maps = (window.Atlas && typeof Atlas.list === 'function') ? Atlas.list() : [];
      maps.forEach((m) => {
        const group = '地图 · ' + (m.name || '未命名地图');
        (m.regions || []).forEach((r) => out.push({
          value: `atlas:${m.id}:r:${r.id}`,
          label: String(r.name || '未命名区域').replace(/\s+/g, ' '),
          group, hint: '区域'
        }));
        (m.markers || []).forEach((k) => out.push({
          value: `atlas:${m.id}:m:${k.id}`,
          label: String(k.name || '未命名地点').replace(/\s+/g, ' '),
          group, hint: k.kind || '地点'
        }));
      });
    } catch (e) { /* Atlas 未就绪时至少还有章节场景 */ }
    return out;
  },
  /** 地点下拉的统一选项（按来源分组），供写作 / 大纲 / 人物档案共用 */
  placeSelectOptions(selected) {
    const opts = this.placeOptions();
    const html = ['<option value="">未指定</option>'];
    const groups = {};
    opts.forEach((o) => { (groups[o.group] || (groups[o.group] = [])).push(o); });
    Object.keys(groups).forEach((g) => {
      html.push(`<optgroup label="${esc(g)}">`);
      groups[g].forEach((o) => html.push(
        `<option value="${esc(o.value)}" ${selected === o.value ? 'selected' : ''}>${esc(o.label)}${o.hint ? ' · ' + esc(o.hint) : ''}</option>`
      ));
      html.push('</optgroup>');
    });
    return html.join('');
  },
  /* 作者问答：按人物分别留档，刷新后还在 */
  interviews() {
    if (!this.data.interviews || typeof this.data.interviews !== 'object' || Array.isArray(this.data.interviews)) this.data.interviews = {};
    return this.data.interviews;
  },
  interviewLog(charId) {
    const all = this.interviews();
    if (!Array.isArray(all[charId])) all[charId] = [];
    return all[charId];
  },
  pushInterview(charId, q, a) {
    const log = this.interviewLog(charId);
    // v=2：纯台词、设定边界规则下产生的问答；旧记录（无 v）不进入后续上下文
    log.push({ q: String(q || ''), a: String(a || ''), v: 2, at: new Date().toISOString() });
    if (log.length > 40) log.splice(0, log.length - 40);
    this.touch();
  },
  /** 只把新规则下的问答带进提示词，避免旧版「加戏」语气污染后续回答 */
  interviewContext(charId) {
    return this.interviewLog(charId).filter((h) => h && h.v === 2).slice(-6);
  },
  clearInterview(charId) {
    this.interviews()[charId] = [];
    this.touch();
  },

  /* ---------- 沉浸式写作：章节 / 正文 / 角色辅导 ---------- */
  writer() {
    if (!this.data.writer || typeof this.data.writer !== 'object' || Array.isArray(this.data.writer)) {
      this.data.writer = { chapters: [], activeId: '', chats: {}, target: 3000 };
    }
    const w = this.data.writer;
    if (!Array.isArray(w.chapters)) w.chapters = [];
    if (!w.chats || typeof w.chats !== 'object' || Array.isArray(w.chats)) w.chats = {};
    if (!(Number(w.target) > 0)) w.target = 3000;
    return w;
  },
  writerChapters() { return this.writer().chapters; },
  writerActive() {
    const w = this.writer();
    return w.chapters.find((c) => c.id === w.activeId) || w.chapters[0] || null;
  },
  writerChapter(id) { return this.writerChapters().find((c) => c.id === id) || null; },
  writerAddChapter(title) {
    const w = this.writer();
    const c = {
      id: uid('wc'),
      title: String(title || '').trim() || '第 ' + (w.chapters.length + 1) + ' 章',
      text: '', note: '', createdAt: new Date().toISOString(), updatedAt: ''
    };
    w.chapters.push(c);
    w.activeId = c.id;
    this.touch();
    return c;
  },
  writerRenameChapter(id, title) {
    const c = this.writerChapter(id);
    const t = String(title || '').trim();
    if (!c || !t) return;
    c.title = t;
    const ms = (this.data.manuscript || []).find((m) => m && m.writerId === id);
    if (ms) ms.title = t;
    this.touch();
  },
  writerRemoveChapter(id) {
    const w = this.writer();
    const i = w.chapters.findIndex((c) => c.id === id);
    if (i < 0) return false;
    w.chapters.splice(i, 1);
    if (w.activeId === id) w.activeId = (w.chapters[Math.min(i, w.chapters.length - 1)] || {}).id || '';
    this.data.manuscript = (this.data.manuscript || []).filter((m) => !m || m.writerId !== id);
    this.touch();
    return true;
  },
  writerMoveChapter(id, toIndex) {
    const list = this.writerChapters();
    const i = list.findIndex((c) => c.id === id);
    const j = Math.max(0, Math.min(list.length - 1, Number(toIndex) || 0));
    if (i < 0 || i === j) return;
    list.splice(j, 0, list.splice(i, 1)[0]);
    this.touch();
  },
  /** 正文即时落盘，并同步一条到「书稿 / 正文库」，让全站字数与导出一致 */
  writerSaveText(id, text) {
    const c = this.writerChapter(id);
    if (!c) return;
    c.text = String(text == null ? '' : text);
    c.words = c.text.replace(/\s/g, '').length;
    c.updatedAt = new Date().toISOString();
    if (!Array.isArray(this.data.manuscript)) this.data.manuscript = [];
    const ms = this.data.manuscript;
    let m = ms.find((x) => x && x.writerId === id);
    if (!c.text.trim()) {
      if (m) this.data.manuscript = ms.filter((x) => x !== m);
    } else if (m) {
      m.title = c.title; m.text = c.text; m.words = c.words; m.updatedAt = c.updatedAt;
    } else {
      ms.push({
        id: uid('ms'), writerId: id, title: c.title, text: c.text, words: c.words,
        createdAt: c.createdAt || c.updatedAt, updatedAt: c.updatedAt
      });
    }
    this.touch();
  },
  writerChat(charId) {
    const ch = this.writer().chats;
    if (!Array.isArray(ch[charId])) ch[charId] = [];
    return ch[charId];
  },
  writerPushChat(charId, q, a) {
    const log = this.writerChat(charId);
    log.push({ q: String(q || ''), a: String(a || ''), at: new Date().toISOString() });
    if (log.length > 40) log.splice(0, log.length - 40);
    this.touch();
  },
  writerClearChat(charId) { this.writer().chats[charId] = []; this.touch(); },

  /* 世界观条目 */
  worldEntries() {
    if (!Array.isArray(this.data.world.entries)) this.data.world.entries = [];
    return this.data.world.entries;
  },
  worldEntry(id) {
    return this.worldEntries().find((e) => e.id === id);
  },
  /* 势力：仍存 world.entries 里的「势力」条目，另带所属地 / 相互关系 */
  factions() {
    return this.worldEntries().filter((e) => e.cat === '势力');
  },
  faction(id) {
    return this.factions().find((e) => e.id === id) || null;
  },
  addFaction(name, groupId) {
    const e = {
      id: uid('fc'), cat: '势力', name: String(name || '').trim().slice(0, 30),
      desc: '', detail: '', weight: 2, tags: [], groupId: this.factionGroup(groupId) ? groupId : '',
      links: { chars: [], places: [] }, places: [], relations: []
    };
    this.worldEntries().push(e);
    this.touch();
    return e;
  },
  removeFaction(id) {
    const list = this.worldEntries();
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return;
    list.splice(i, 1);
    this.factions().forEach((f) => {
      if (Array.isArray(f.relations)) f.relations = f.relations.filter((r) => r.target !== id);
    });
    this.touch();
  },
  /** 地图里的地名池，给「所属地」点选用；Atlas 没就绪时也有默认地名 */
  factionPlaces() {
    const out = [];
    const push = (n) => { const s = String(n || '').trim(); if (s && !out.includes(s)) out.push(s); };
    try {
      const maps = (window.Atlas && typeof Atlas.list === 'function') ? Atlas.list() : [];
      maps.forEach((m) => {
        (m.regions || []).forEach((r) => push(r.name));
        (m.markers || []).forEach((k) => push(k.name));
      });
    } catch (e) { /* Atlas 尚未加载，忽略 */ }
    return out;
  },
  /* ---------- 势力分类 ---------- */
  factionGroups() {
    if (!Array.isArray(this.data.factionGroups)) this.data.factionGroups = defaultFactionGroups();
    return this.data.factionGroups;
  },
  factionGroup(id) {
    return this.factionGroups().find((g) => g.id === id) || null;
  },
  factionGroupColor(g) {
    return (g && g.color) || '#8a8378';
  },
  factionGroupOf(f) {
    return (f && this.factionGroup(f.groupId)) || null;
  },
  setFactionGroup(factionId, groupId) {
    const f = this.faction(factionId);
    if (!f) return;
    f.groupId = (groupId && this.factionGroup(groupId)) ? groupId : '';
    this.touch();
  },
  addFactionGroup(name) {
    const n = String(name || '').trim().slice(0, 20);
    if (!n) return null;
    const list = this.factionGroups();
    const dup = list.find((g) => g.name === n);
    if (dup) return dup;
    const g = { id: uid('fg'), name: n, color: CHAR_GROUP_COLORS[list.length % CHAR_GROUP_COLORS.length] };
    list.push(g);
    this.touch();
    return g;
  },
  renameFactionGroup(id, name) {
    const g = this.factionGroup(id);
    if (!g) return;
    g.name = String(name || '').trim().slice(0, 20);
    this.touch();
  },
  removeFactionGroup(id) {
    const list = this.factionGroups();
    const i = list.findIndex((g) => g.id === id);
    if (i < 0) return 0;
    list.splice(i, 1);
    let moved = 0;
    this.factions().forEach((f) => { if (f.groupId === id) { f.groupId = ''; moved++; } });
    this.touch();
    return moved;
  },
  moveFactionGroup(id, dir) {
    const list = this.factionGroups();
    const i = list.findIndex((g) => g.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    list.splice(j, 0, list.splice(i, 1)[0]);
    this.touch();
  },
  factionNetPos() {
    if (!this.data.factionNet || typeof this.data.factionNet !== 'object') this.data.factionNet = { pos: {} };
    if (!this.data.factionNet.pos || typeof this.data.factionNet.pos !== 'object') this.data.factionNet.pos = {};
    return this.data.factionNet.pos;
  },
  /* 关系两端各存一条（档案里双方都看得到），但关系图按无向对合并成一条线 */
  addFactionRelation(fromId, toId, kind) {
    const a = this.faction(fromId), b = this.faction(toId);
    if (!a || !b || a.id === b.id) return null;
    const k = String(kind || '').trim().slice(0, 30);
    if (!k) return null;
    const pairId = uid('fp');
    a.relations = Array.isArray(a.relations) ? a.relations : [];
    b.relations = Array.isArray(b.relations) ? b.relations : [];
    a.relations.push({ id: uid('fr'), target: b.id, kind: k, note: '', pairId });
    b.relations.push({ id: uid('fr'), target: a.id, kind: k, note: '', pairId });
    this.touch();
    return pairId;
  },
  removeFactionRelation(factionId, relId) {
    const f = this.faction(factionId);
    if (!f || !Array.isArray(f.relations)) return;
    const r = f.relations.find((x) => x.id === relId);
    if (!r) return;
    const pairId = r.pairId || '';
    this.factions().forEach((x) => {
      if (!Array.isArray(x.relations)) return;
      x.relations = x.relations.filter((y) => pairId ? (y.pairId !== pairId && y.id !== relId) : y.id !== relId);
    });
    this.touch();
  },
  /* 道具计数（替代原"痕迹"计数，地图已移除痕迹图层） */
  totalItems() {
    return this.inv().length;
  },
  /* 建筑图 */
  art(placeId) {
    const p = this.place(placeId);
    if (!p) return null;
    if (!p.art || typeof p.art !== 'object') p.art = { building: null, shots: [] };
    if (!Array.isArray(p.art.shots)) p.art.shots = [];
    return p.art;
  },
  /* 道具索引 */
  inv() {
    if (!Array.isArray(this.data.inventory)) this.data.inventory = [];
    return this.data.inventory;
  },
  /* 搜索道具：返回 [{item, holder}]，holder = {type:'char'|'place', id, name} */
  searchItems(q) {
    const s = String(q || '').trim().toLowerCase();
    const inv = this.inv();
    if (!s) return inv.slice(0, 50).map((it) => ({ item: it, holder: this.itemHolder(it) }));
    return inv
      .filter((it) => (it.name + ' ' + (it.desc || '')).toLowerCase().includes(s))
      .slice(0, 50)
      .map((it) => ({ item: it, holder: this.itemHolder(it) }));
  },
  itemHolder(it) {
    if (!it) return null;
    if (it.holderType === 'char') {
      const c = this.char(it.holderId);
      return c ? { type: 'char', id: c.id, name: c.name } : { type: 'char', id: it.holderId, name: it.holderName || '（人物已删）' };
    }
    if (it.holderType === 'place') {
      const p = this.place(it.holderId);
      return p ? { type: 'place', id: p.id, name: p.name } : { type: 'place', id: it.holderId, name: it.holderName || '（地点已删）' };
    }
    return { type: 'none', id: '', name: '未定位' };
  },
  /** 重建道具索引（人物 items + 地点 items + 无主池），任何增删改后调用 */
  rebuildInventory() {
    const inv = [];
    const pack = (it, type, hid, hname) => {
      if (!it || typeof it !== 'object') return;
      if (!it.id) it.id = uid('it');
      inv.push({
        id: it.id,
        name: it.name || '',
        desc: it.desc || '',
        category: it.category || '',
        source: it.source || '',
        note: it.note || '',
        context: it.context || '',
        manual: !!it.manual,
        holderType: type,
        holderId: hid,
        holderName: hname
      });
    };
    this.data.characters.forEach((c) => (c.items || []).forEach((it) => pack(it, 'char', c.id, c.name)));
    this.data.map.nodes.forEach((n) => (n.items || []).forEach((it) => pack(it, 'place', n.id, n.name)));
    this.propPool().forEach((it) => pack(it, 'none', '', '未定位'));
    this.data.inventory = inv;
    return inv;
  },

  /* ---------- 道具：全书聚合 / 增删改 ----------
     道具实体存在三处：人物 items、地点 items、无主池 props。
     这里提供统一入口，视图不必关心它挂在哪里。                        */
  propPool() {
    if (!Array.isArray(this.data.props)) this.data.props = [];
    return this.data.props;
  },
  propList() {
    const out = [];
    this.data.characters.forEach((c) => (c.items || []).forEach((it) => out.push({
      item: it, list: c.items, holderType: 'char', holderId: c.id, holderName: c.name || '未命名人物'
    })));
    this.data.map.nodes.forEach((n) => (n.items || []).forEach((it) => out.push({
      item: it, list: n.items, holderType: 'place', holderId: n.id, holderName: n.name || '未命名地点'
    })));
    this.propPool().forEach((it) => out.push({
      item: it, list: this.data.props, holderType: 'none', holderId: '', holderName: '未定位'
    }));
    return out;
  },
  propGet(id) {
    return this.propList().find((e) => e.item && e.item.id === id) || null;
  },
  propTarget(type, id) {
    if (type === 'char') {
      const c = this.char(id);
      if (!c) return null;
      if (!Array.isArray(c.items)) c.items = [];
      return c.items;
    }
    if (type === 'place') {
      const n = this.place(id);
      if (!n) return null;
      if (!Array.isArray(n.items)) n.items = [];
      return n.items;
    }
    return this.propPool();
  },
  propCommit() {
    this.rebuildInventory();
    this.touch();
  },
  propAdd(patch, holderType, holderId) {
    const list = this.propTarget(holderType || 'none', holderId);
    if (!list) return null;
    const it = Object.assign({
      id: uid('it'), name: '', category: '', desc: '', source: '', note: '', context: '', manual: true
    }, patch || {});
    list.push(it);
    this.propCommit();
    return it;
  },
  propSet(id, patch) {
    const e = this.propGet(id);
    if (!e) return null;
    Object.assign(e.item, patch || {});
    this.propCommit();
    return e.item;
  },
  propMove(id, holderType, holderId) {
    const e = this.propGet(id);
    if (!e) return null;
    const target = this.propTarget(holderType || 'none', holderId);
    if (!target || target === e.list) return e.item;
    const i = e.list.indexOf(e.item);
    if (i >= 0) e.list.splice(i, 1);
    target.push(e.item);
    this.propCommit();
    return e.item;
  },
  propRemove(id) {
    const e = this.propGet(id);
    if (!e) return false;
    const i = e.list.indexOf(e.item);
    if (i >= 0) e.list.splice(i, 1);
    this.propCommit();
    return true;
  },
  /* 世界地图视口 */
  mapView() {
    if (!this.data.map.view) this.data.map.view = { x: 0, y: 0, zoom: 1 };
    return this.data.map.view;
  },
  /* 设置项 */
  async saveSettings(obj) {
    this.settings = Object.assign({}, this.settings, obj);
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    });
  }
};

/* ---------- 通用表单绑定 ---------- */
function bindInputs(root) {
  if (!root) return;
  // 同一 root 反复渲染时先摘掉旧监听，避免重复触发 / 失效
  if (root.__bInput) root.removeEventListener('input', root.__bInput);
  if (root.__bChange) root.removeEventListener('change', root.__bChange);

  const apply = (el) => {
    const path = el.dataset.bind;
    if (!path) return;
    let v = el.value;
    if (el.dataset.type === 'num') v = Number(v) || 0;
    if (el.dataset.type === 'lines') v = v.split('\n').map((s) => s.trim()).filter(Boolean);
    if (el.dataset.type === 'comma') v = v.split(/[，,、;；\n]/).map((s) => s.trim()).filter(Boolean);
    setPath(Store.data, path, v);
    Store.touch();
  };

  const onInput = (e) => {
    const el = e.target;
    if (el.matches('[data-bind][data-live]')) apply(el);
  };
  const onChange = (e) => {
    const el = e.target;
    if (el.matches('[data-bind]') && !el.hasAttribute('data-live')) apply(el);
  };

  root.__bInput = onInput;
  root.__bChange = onChange;
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
}

/* ---------- LLM ---------- */
const LLM = {
  busy: false,

  async chat({ messages, temperature, maxTokens, stream, onDelta, noUndo, usage, profile }) {
    // 统一撤销钩子：任何 AI 调用之前先留一份整书快照
    // noUndo：纯聊天（角色辅导）不改动创作数据，不占用撤销历史
    if (!noUndo) { try { AIUndo.capture(); } catch (e) {} }
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, temperature, maxTokens, stream: !!stream, usage, profile })
    });
    if (!res.ok) {
      let msg = '请求失败';
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch (e) {}
      throw new Error(msg);
    }
    if (!stream) {
      const j = await res.json();
      const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!c) throw new Error('模型没有返回内容');
      return c;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '';
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const d = t.slice(5).trim();
        if (!d || d === '[DONE]') continue;
        try {
          const j = JSON.parse(d);
          const delta = j.choices && j.choices[0] && (j.choices[0].delta || {});
          const piece = (delta && delta.content) || '';
          if (piece) {
            full += piece;
            if (onDelta) onDelta(piece, full);
          }
        } catch (e) {}
      }
    }
    return full;
  },

  async json({ messages, temperature, maxTokens, usage, profile }) {
    const raw = await this.chat({ messages, temperature: temperature ?? 0.8, maxTokens: maxTokens || 2000, usage, profile });
    return parseJSON(raw);
  },

  async image({ prompt, size, model, baseUrl, apiKey, usage, profile }) {
    try { AIUndo.capture(); } catch (e) {}
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, size, model, baseUrl, apiKey, usage, profile })
    });
    if (!res.ok) {
      let msg = '图像生成失败';
      try {
        const j = await res.json();
        msg = j.error || msg;
      } catch (e) {}
      throw new Error(msg);
    }
    return await res.json();
  }
};

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

// 从文本中截取最外层 {} 或 [] 并解析，顺手清掉尾随逗号
function extractAndParse(s, open, close) {
  const i = s.indexOf(open);
  const j = s.lastIndexOf(close);
  if (i < 0 || j <= i) return null;
  return tryParse(s.slice(i, j + 1).replace(/,\s*([}\]])/g, '$1'));
}

// 模型输出被截断（超 token）时，尽力补齐未完成的字符串与括号
function recoverTruncated(s) {
  let inStr = false;
  let esc = false;
  for (const c of s) {
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\') {
      esc = true;
      continue;
    }
    if (c === '"') inStr = !inStr;
  }
  let work = s;
  if (inStr) work += '"'; // 字符串被切断，先补上引号
  const pairs = { '}': '{', ']': '[' };
  const stack = [];
  inStr = false;
  esc = false;
  for (const c of work) {
    if (esc) {
      esc = false;
      continue;
    }
    if (c === '\\') {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      if (stack.length && stack[stack.length - 1] === pairs[c]) stack.pop();
    }
  }
  let tail = '';
  while (stack.length) {
    const o = stack.pop();
    tail += o === '{' ? '}' : ']';
  }
  return tryParse(work + tail);
}

function parseJSON(text) {
  if (!text) throw new Error('模型返回为空');
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```\s*$/i, '').trim();
  let r = tryParse(s);
  if (r) return r;
  r = extractAndParse(s, '{', '}');
  if (r) return r;
  r = extractAndParse(s, '[', ']');
  if (r) return r;
  r = recoverTruncated(s);
  if (r) return r;
  throw new Error('返回内容不是合法 JSON');
}

/* ---------- 主题 ---------- */
function initTheme() {
  const saved = localStorage.getItem('moge-theme') || 'light';
  document.documentElement.dataset.theme = saved;
  const btn = $('#themeBtn');
  if (btn)
    btn.onclick = () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('moge-theme', next);
      document.dispatchEvent(new CustomEvent('theme-change'));
    };
}

/* ---------- 颜色 ---------- */
const PALETTE = ['#a63a2a', '#3d6a58', '#a97f2f', '#5b6f8c', '#7a4b6b', '#4a6b4a', '#8c5a3c', '#3f6b6b'];
function pickColor(i) {
  return PALETTE[i % PALETTE.length];
}
