/* ============================================================
 * atlas.js —— 地图数据层 / 对外接口
 *
 * 层级模型：cosmos(宇宙) → world(大陆) → region(区域) → local(小地图)
 * 任意地点 marker.childMapId 可指向另一张地图，形成「下钻」。
 * 后续做小地图，只需调用 Atlas.register({...})，视图会自动出现入口。
 *
 * 对外接口（window.Atlas）：
 *   Atlas.init(bookId)           初始化（自动读取 / 播种默认双层地图）
 *   Atlas.ready()                Promise，数据可用
 *   Atlas.list()                 所有地图
 *   Atlas.get(id) / current()    取地图 / 当前地图
 *   Atlas.register(def)          注册新地图（小地图），返回 def
 *   Atlas.remove(id)
 *   Atlas.addMarker(mapId, m) / updateMarker(mapId, markerId, patch)
 *   Atlas.renameMarker(mapId, markerId, name) / removeMarker(mapId, markerId)
 *   Atlas.setChild(mapId, markerId, childMapId)
 *   Atlas.open(id)               切换当前地图（通知视图）
 *   Atlas.on(fn)                 订阅变更 (type, payload)
 *   Atlas.save(now)              立即/延迟持久化到 /api/atlas
 * ============================================================ */
window.Atlas = (function () {
  const API = '/api/atlas';
  const LEVELS = ['cosmos', 'world', 'region', 'local'];
  const KIND_LIST = ['都城', '城邦', '圣山', '关隘', '遗迹', '凶地', '秘境', '水泽', '仙界', '星垣', '恒星', '星体', '星阵', '星云', '星门', '下界'];

  /* ---------------- 默认：两层地图 ---------------- */
  function seed() {
    return {
      version: 1,
      active: 'dahuang',
      maps: [
        {
          id: 'zhoutian', name: '周天', level: 'cosmos', parentId: null,
          theme: 'dark', image: 'atlas/cosmos.jpg',
          desc: '鸿蒙未判之上，周天星斗各安其位。诸界悬于太虚，天河横贯，混沌未息。',
          view: { x: 0, y: 0, zoom: 1 },
          regions: [
            { id: 'r_z1', name: '紫微垣', x: 48, y: 18, sub: '众星拱北辰' },
            { id: 'r_z2', name: '大日金轮', x: 39, y: 42, sub: '万光之源' },
            { id: 'r_z3', name: '太阴广寒', x: 52, y: 41, sub: '清辉所凝' },
            { id: 'r_z4', name: '天 河', x: 62, y: 62, sub: '星流不息' },
            { id: 'r_z5', name: '混沌气海', x: 85, y: 20, sub: '未分之息' },
            { id: 'r_z6', name: '太虚渊', x: 12, y: 68, sub: '无物之境' }
          ],
          markers: [
            { id: 'm_z1', name: '紫微帝星', kind: '星垣', x: 48, y: 17, desc: '周天中枢，众星所拱。', childMapId: '' },
            { id: 'm_z2', name: '大日金轮', kind: '恒星', x: 39, y: 42, desc: '洪荒第一缕光，昼夜由此而分。', childMapId: '' },
            { id: 'm_z3', name: '太阴广寒', kind: '星体', x: 51, y: 40, desc: '与日相对，主潮汐与轮回。', childMapId: '' },
            { id: 'm_z4', name: '周天星斗大阵', kind: '星阵', x: 66, y: 55, desc: '三百六十五颗主星连缀成阵。', childMapId: '' },
            { id: 'm_z5', name: '蓬莱星岛', kind: '仙界', x: 26, y: 71, desc: '悬于太虚的仙家别境。', childMapId: '' },
            { id: 'm_z6', name: '方丈仙阙', kind: '仙界', x: 44, y: 77, desc: '云气凝成的宫阙，可望不可即。', childMapId: '' },
            { id: 'm_z7', name: '混沌气海', kind: '星云', x: 85, y: 20, desc: '天地未分之气，至今未散。', childMapId: '' },
            { id: 'm_z8', name: '太虚渊', kind: '星云', x: 12, y: 68, desc: '星光照不到的尽头。', childMapId: '' },
            { id: 'm_z9', name: '大荒投影', kind: '下界', x: 55, y: 62, desc: '自周天下望，可见诸洲浮于沧溟。点此下界。', childMapId: 'dahuang' },
            { id: 'm_z10', name: '归墟星门', kind: '星门', x: 83, y: 83, desc: '万水与万星共同的尽头。', childMapId: '' }
          ],
          terrain: [
            { id: 't_z1', name: '银河星带', kind: 'stars', x: 58, y: 55, rx: 34, ry: 22, rotate: -28 },
            { id: 't_z2', name: '紫微星团', kind: 'stars', x: 48, y: 18, rx: 10, ry: 9, rotate: 0 },
            { id: 't_z3', name: '混沌涡', kind: 'nebula', x: 85, y: 20, rx: 11, ry: 9, rotate: 0 },
            { id: 't_z4', name: '太虚涡', kind: 'nebula', x: 12, y: 68, rx: 11, ry: 9, rotate: 0 },
            { id: 't_z5', name: '归墟星涡', kind: 'nebula', x: 83, y: 83, rx: 9, ry: 8, rotate: 0 }
          ]
        },
        {
          id: 'dahuang', name: '大荒', level: 'world', parentId: 'zhoutian',
          theme: 'light', image: 'atlas/land.jpg',
          desc: '沧溟之上，诸洲分立。不周天柱撑于中央，归墟海眼吞尽万水。',
          view: { x: 0, y: 0, zoom: 1 },
          regions: [
            { id: 'r_d1', name: '玄 冥 北 溟', x: 19, y: 19, sub: '极北 · 万载玄冰' },
            { id: 'r_d2', name: '青 丘 神 木', x: 82, y: 17, sub: '东极 · 建木所植' },
            { id: 'r_d3', name: '不 周 天 柱', x: 50, y: 27, sub: '中天 · 撑天之脊' },
            { id: 'r_d4', name: '云 梦 大 泽', x: 34, y: 50, sub: '中土 · 灵渠纵横' },
            { id: 'r_d5', name: '离 火 赤 原', x: 60, y: 47, sub: '南离 · 熔岩裂谷' },
            { id: 'r_d6', name: '祝 融 熔 洲', x: 17, y: 73, sub: '西南 · 不熄之火' },
            { id: 'r_d7', name: '幽 篁 南 荒', x: 79, y: 76, sub: '东南 · 瘴雾古林' },
            { id: 'r_d8', name: '归 墟 海 眼', x: 47, y: 88, sub: '无底 · 万水所归' }
          ],
          markers: [
            { id: 'm_d1', name: '不周山巅', kind: '圣山', x: 50, y: 11, desc: '天柱之顶，传为众神登天处。', childMapId: '' },
            { id: 'm_d2', name: '天门墟', kind: '遗迹', x: 50, y: 32, desc: '天柱半腰的古祭台，石阶没入云中。', childMapId: '' },
            { id: 'm_d3', name: '悬河渡', kind: '关隘', x: 48, y: 57, desc: '天河自天柱坠落，唯此处可渡。', childMapId: '' },
            { id: 'm_d4', name: '玄冰阙', kind: '都城', x: 18, y: 12, desc: '北溟之主所居，以万年玄冰筑城。', childMapId: '' },
            { id: 'm_d5', name: '霜龙脊', kind: '圣山', x: 25, y: 25, desc: '雪岭如龙脊，其下有沉睡之骨。', childMapId: '' },
            { id: 'm_d6', name: '苍梧王庭', kind: '都城', x: 82, y: 12, desc: '建于建木枝桠之上的木都。', childMapId: '' },
            { id: 'm_d7', name: '万木神庭', kind: '圣山', x: 85, y: 25, desc: '群木之祖，岁岁不落叶。', childMapId: '' },
            { id: 'm_d8', name: '云梦城', kind: '都城', x: 33, y: 45, desc: '灵渠交汇处的泽国大城。', childMapId: '' },
            { id: 'm_d9', name: '灵渠泽', kind: '水泽', x: 38, y: 59, desc: '水脉最盛处，传说可照见来世。', childMapId: '' },
            { id: 'm_d10', name: '离火神殿', kind: '遗迹', x: 57, y: 40, desc: '熔岩环绕的旧神殿，门从未开启。', childMapId: '' },
            { id: 'm_d11', name: '赤铜峡', kind: '关隘', x: 62, y: 53, desc: '赤原与外界的唯一通路。', childMapId: '' },
            { id: 'm_d12', name: '祝融墟', kind: '都城', x: 15, y: 66, desc: '火部遗民所筑，城下终年灼热。', childMapId: '' },
            { id: 'm_d13', name: '熔心火山', kind: '凶地', x: 20, y: 79, desc: '地火之口，寸草不生。', childMapId: '' },
            { id: 'm_d14', name: '幽篁津', kind: '城邦', x: 76, y: 70, desc: '瘴林边缘的渡口，往来皆是异客。', childMapId: '' },
            { id: 'm_d15', name: '瘴骨沼', kind: '凶地', x: 82, y: 83, desc: '雾中白骨成丘，指南之物尽失。', childMapId: '' },
            { id: 'm_d16', name: '归墟之门', kind: '秘境', x: 47, y: 86, desc: '海眼中心，万水与万灵的归处。', childMapId: '' },
            { id: 'm_d17', name: '悬空列岛', kind: '秘境', x: 68, y: 18, desc: '不接地脉的浮岛，随星移而动。', childMapId: '' }
          ],
          terrain: [
            { id: 't_d1', name: '玄冥雪岭', kind: 'mountain', x: 19, y: 20, rx: 14, ry: 9, rotate: 0 },
            { id: 't_d2', name: '青丘林海', kind: 'forest', x: 82, y: 18, rx: 13, ry: 8, rotate: 0 },
            { id: 't_d3', name: '不周群峰', kind: 'mountain', x: 50, y: 27, rx: 9, ry: 17, rotate: 0 },
            { id: 't_d4', name: '云梦林泽', kind: 'forest', x: 34, y: 51, rx: 11, ry: 9, rotate: 0 },
            { id: 't_d5', name: '离火熔原', kind: 'lava', x: 60, y: 48, rx: 10, ry: 9, rotate: 0 },
            { id: 't_d6', name: '祝融火脉', kind: 'lava', x: 17, y: 73, rx: 14, ry: 11, rotate: 0 },
            { id: 't_d7', name: '幽篁瘴林', kind: 'swamp', x: 79, y: 76, rx: 12, ry: 9, rotate: 0 },
            { id: 't_d8', name: '悬河', kind: 'river', x: 48, y: 49, rx: 2, ry: 18, rotate: 0 },
            { id: 't_d9', name: '归墟涡海', kind: 'whirl', x: 47, y: 87, rx: 8, ry: 7, rotate: 0 }
          ]
        }
      ]
    };
  }

  let db = null, bookId = 'default', readyPromise = null, saveTimer = null;
  const listeners = [];

  function normalize(d) {
    const base = seed();
    const out = (d && Array.isArray(d.maps) && d.maps.length) ? d : base;
    out.version = 1;
    out.active = out.active || (out.maps[0] && out.maps[0].id) || 'dahuang';
    out.maps = out.maps.map((m) => ({
      id: m.id || uid('map'),
      name: m.name || '未命名图层',
      level: LEVELS.includes(m.level) ? m.level : 'region',
      parentId: m.parentId || null,
      theme: m.theme === 'dark' ? 'dark' : 'light',
      image: m.image || 'atlas/land.jpg',
      desc: m.desc || '',
      view: { x: Number(m.view && m.view.x) || 0, y: Number(m.view && m.view.y) || 0, zoom: Number(m.view && m.view.zoom) || 1 },
      regions: Array.isArray(m.regions) ? m.regions : [],
      markers: (Array.isArray(m.markers) ? m.markers : []).map((k) => ({
        id: k.id || uid('mk'), name: k.name || '未命名地点', kind: k.kind || '城邦',
        x: Number(k.x) || 0, y: Number(k.y) || 0, desc: k.desc || '', childMapId: k.childMapId || ''
      })),
      terrain: Array.isArray(m.terrain) ? m.terrain : []
    }));
    if (!out.maps.some((m) => m.id === out.active)) out.active = out.maps[0].id;
    return out;
  }

  function emit(type, payload) {
    listeners.forEach((fn) => { try { fn(type, payload); } catch (e) { console.warn('Atlas listener', e); } });
  }

  function save(now) {
    clearTimeout(saveTimer);
    const flush = async () => {
      if (!db) return;
      try {
        await fetch(API + '?book=' + encodeURIComponent(bookId), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(db)
        });
      } catch (e) { console.warn('atlas save failed', e); }
    };
    if (now) return flush();
    saveTimer = setTimeout(flush, 450);
  }

  const A = {
    KIND_LIST,
    LEVELS,
    view: null, // 视图注册进来

    init(book) {
      bookId = book || (window.Store && Store.currentBookId) || 'default';
      readyPromise = (async () => {
        let d = null;
        try {
          const r = await fetch(API + '?book=' + encodeURIComponent(bookId));
          const j = await r.json();
          d = j && j.data;
        } catch (e) {}
        db = normalize(d);
        if (!d) save(true); // 首次播种
        emit('ready', db);
        return db;
      })();
      return readyPromise;
    },

    ready() { return readyPromise || this.init(); },
    book() { return bookId; },
    raw() { return db; },
    list() { if (!db) db = normalize(null); return db.maps; },
    get(id) { if (!db) db = normalize(null); return db.maps.find((m) => m.id === id) || null; },
    current() { return this.get(this.activeId()); },
    activeId() { if (!db) db = normalize(null); return db.active; },
    on(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    save,

    open(id, opts) {
      if (!db) return;
      const m = this.get(id || (opts && opts.id));
      if (!m) return;
      db.active = m.id;
      save();
      emit('open', m);
    },

    /** 注册新地图（后续小地图就走这里）。def 缺失字段会自动补全 */
    register(def) {
      if (!db) db = normalize(null);
      const m = {
        id: def.id || uid('map'),
        name: def.name || '新图层',
        level: LEVELS.includes(def.level) ? def.level : 'region',
        parentId: def.parentId || 'dahuang',
        theme: def.theme || 'light',
        image: def.image || 'atlas/land.jpg',
        desc: def.desc || '',
        view: { x: 0, y: 0, zoom: 1 },
        regions: def.regions || [],
        markers: def.markers || [],
        terrain: def.terrain || []
      };
      db.maps.push(m);
      db = normalize(db);
      save();
      emit('register', m);
      return m;
    },

    remove(id) {
      if (!db || id === 'dahuang' || id === 'zhoutian') return false;
      db.maps = db.maps.filter((m) => m.id !== id);
      db.maps.forEach((m) => m.markers.forEach((k) => { if (k.childMapId === id) k.childMapId = ''; }));
      if (db.active === id) db.active = 'dahuang';
      save(); emit('change', db);
      return true;
    },

    addMarker(mapId, k) {
      const m = this.get(mapId); if (!m) return null;
      const mk = {
        id: uid('mk'), name: k.name || '未命名地点', kind: k.kind || '城邦',
        x: Math.max(0, Math.min(100, Number(k.x) || 0)),
        y: Math.max(0, Math.min(100, Number(k.y) || 0)),
        desc: k.desc || '', childMapId: k.childMapId || ''
      };
      m.markers.push(mk);
      save(); emit('marker', { map: m, marker: mk, type: 'add' });
      return mk;
    },

    updateMarker(mapId, markerId, patch) {
      const m = this.get(mapId); if (!m) return null;
      const k = m.markers.find((x) => x.id === markerId); if (!k) return null;
      Object.assign(k, patch);
      save(); emit('marker', { map: m, marker: k, type: 'update' });
      return k;
    },

    renameMarker(mapId, markerId, name) {
      return this.updateMarker(mapId, markerId, { name: String(name || '').trim() || '未命名地点' });
    },

    removeMarker(mapId, markerId) {
      const m = this.get(mapId); if (!m) return;
      m.markers = m.markers.filter((x) => x.id !== markerId);
      save(); emit('marker', { map: m, marker: null, type: 'remove', markerId });
    },

    setChild(mapId, markerId, childMapId) {
      return this.updateMarker(mapId, markerId, { childMapId: childMapId || '' });
    },

    setView(mapId, v) {
      const m = this.get(mapId); if (!m) return;
      m.view = { x: v.x || 0, y: v.y || 0, zoom: v.zoom || 1 };
      save(); // 视图状态也持久化，切回来还在原处
    },

    /** 返回某地点的下钻目标（供 UI / 后续逻辑调用） */
    childOf(mapId, markerId) {
      const m = this.get(mapId); if (!m) return null;
      const k = m.markers.find((x) => x.id === markerId);
      return k && k.childMapId ? this.get(k.childMapId) : null;
    }
  };

  return A;
})();
