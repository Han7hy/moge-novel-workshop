/* ============ view-import.js —— 小说导入与分析 ============ */
/**
 * 读取一部已有小说 → 抽取文风（严格）→ 主要人物（性格/说话风格/分类分级）
 * → 地图（地点+特点+道具）→ 道具按首次出现归属 → 可搜索。
 *
 * 流水线状态是全局单例，切换页面不打断。
 */
window.Views = window.Views || {};

const NovelImport = {
  /* 输入 */
  text: '',
  name: '',
  encoding: '',
  /* 分块 */
  chunks: [],
  chunkSize: 18000,
  maxChunks: 0, // 0 = 全部
  /* 阶段结果 */
  raw: [],            // 每块的抽取结果
  merged: null,       // {chars, places, items}
  style: null,        // 文风档案
  world: null,        // 世界观抽取结果 { entries: [] }
  classified: null,   // 人物分类
  cards: [],          // 人物卡（top N）
  cardLimit: 10,
  extractPlaces: true,  // 是否抽取地点（可选）
  extractItems: true,   // 是否抽取道具（可选）
  /* 运行状态 */
  running: false,
  stage: '',
  done: 0,
  total: 0,
  log: [],
  error: null,
  onUpdate: null,

  emit() {
    if (this.onUpdate) this.onUpdate();
  },
  say(msg, type) {
    this.log.push({ t: new Date().toLocaleTimeString(), msg, type: type || '' });
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    this.emit();
  },

  reset() {
    this.text = '';
    this.name = '';
    this.encoding = '';
    this.chunks = [];
    this.raw = [];
    this.merged = null;
    this.style = null;
    this.world = null;
    this.classified = null;
    this.cards = [];
    this.extractPlaces = true;
    this.extractItems = true;
    this.running = false;
    this.stage = '';
    this.done = 0;
    this.total = 0;
    this.log = [];
    this.error = null;
    this.emit();
  },

  /* ---------- 读文件（自动识别 UTF-8 / GBK） ---------- */
  async loadFile(file) {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    let enc = 'UTF-8';
    if (text.includes('\uFFFD')) {
      try {
        const gbk = new TextDecoder('gbk').decode(buf);
        if (!gbk.includes('\uFFFD')) {
          text = gbk;
          enc = 'GBK';
        }
      } catch (e) {}
    }
    this.text = text.replace(/\r\n/g, '\n');
    this.name = file.name.replace(/\.(txt|md|text)$/i, '');
    this.encoding = enc;
    this.reset();
    this.text = text.replace(/\r\n/g, '\n');
    this.name = file.name.replace(/\.(txt|md|text)$/i, '');
    this.encoding = enc;
    this.splitChunks();
    this.say(`已读入《${this.name}》：${this.text.length.toLocaleString()} 字，编码 ${enc}，分为 ${this.chunks.length} 段`);
    return true;
  },

  /* ---------- 分块（优先按章节切，否则按段落边界定长切） ---------- */
  splitChunks() {
    const size = this.chunkSize;
    const text = this.text;
    if (!text) {
      this.chunks = [];
      return;
    }
    // 尝试按章节标记切块
    const chapRe = /[ \t]*((?:第|卷|Chapter\s*)[^\n]{0,30}?(?:章|节|回|卷)[^\n]{0,40})\n/g;
    const marks = [];
    let m;
    while ((m = chapRe.exec(text)) !== null) marks.push(m.index);
    if (marks.length >= 8 && marks[0] < 5000) {
      // 章节结构可信：按章节聚合到 ~size
      const bounds = [];
      let start = 0;
      let acc = 0;
      for (let i = 0; i < marks.length; i++) {
        const len = (i + 1 < marks.length ? marks[i + 1] : text.length) - marks[i];
        if (acc + len > size && acc > 0) {
          bounds.push([start, marks[i]]);
          start = marks[i];
          acc = 0;
        }
        acc += len;
      }
      bounds.push([start, text.length]);
      this.chunks = bounds.map(([a, b]) => text.slice(a, b).trim()).filter((t) => t.length > 200);
    } else {
      // 定长切，断在段落边界
      const chunks = [];
      let pos = 0;
      while (pos < text.length) {
        let end = Math.min(pos + size, text.length);
        if (end < text.length) {
          const nl = text.lastIndexOf('\n', end);
          if (nl > pos + size * 0.5) end = nl + 1;
        }
        chunks.push(text.slice(pos, end).trim());
        pos = end;
      }
      this.chunks = chunks.filter((t) => t.length > 200);
    }
  },

  /* ---------- 全流程 ---------- */
  async run() {
    AIUndo.label('整书导入 · AI 抽取');
    if (this.running) return;
    if (!this.text) return;
    if (!Store.settings.baseUrl && !Store.settings.model) {
      this.error = '还没有配置 API，请先到「设置」里填写。';
      this.emit();
      return;
    }
    this.running = true;
    this.error = null;
    this.log = [];
    this.done = 0;
    const chunks = this.maxChunks > 0 ? this.chunks.slice(0, this.maxChunks) : this.chunks;

    try {
      /* 阶段 1：逐块抽取 */
      this.stage = '抽取';
      this.total = chunks.length + 3 + this.cardLimit;
      this.emit();
      this.raw = [];
      let fail = 0;
      for (let i = 0; i < chunks.length; i++) {
        this.stage = `抽取 第 ${i + 1}/${chunks.length} 段`;
        this.emit();
        let o = null;
        try {
          o = await LLM.json({
            messages: Prompts.importChunk({ text: chunks[i], index: i, total: chunks.length, novelTitle: this.name, extractPlaces: this.extractPlaces, extractItems: this.extractItems }),
            temperature: 0.3,
            maxTokens: 6000
          });
        } catch (e) {
          // 单次重试：放宽 token 上限并加强「只返回 JSON」提醒
          try {
            o = await LLM.json({
              messages: Prompts.importChunk({ text: chunks[i], index: i, total: chunks.length, novelTitle: this.name, extractPlaces: this.extractPlaces, extractItems: this.extractItems, retry: true }),
              temperature: 0.2,
              maxTokens: 6000
            });
            this.say(`第 ${i + 1} 段首次解析失败，已重试成功`);
          } catch (e2) {
            fail++;
            this.say(`第 ${i + 1} 段失败：${e2.message}`, 'err');
          }
        }
        if (o) {
          this.raw.push(o || {});
          this.say(`第 ${i + 1} 段完成：人物 ${(o.chars || []).length}、地点 ${(o.places || []).length}、道具 ${(o.items || []).length}`);
        }
        this.done++;
        this.emit();
      }
      if (fail === chunks.length) throw new Error('所有段落都分析失败，请检查 API 配置');
      if (fail > 0) this.say(`${fail} 段失败，已跳过（不影响整体）`, 'warn');

      /* 合并 */
      this.stage = '合并实体';
      this.emit();
      this.merged = this.mergeAll(this.raw);
      this.say(`合并后：人物 ${this.merged.chars.length} 位、地点 ${this.merged.places.length} 处、道具 ${this.merged.items.length} 件`);
      this.done++;
      this.emit();

      /* 阶段 2：文风 */
      this.stage = '提取文风';
      this.emit();
      const samples = this.styleSamples();
      this.style = await LLM.json({
        messages: Prompts.importStyle({ samples, novelTitle: this.name }),
        temperature: 0.4,
        maxTokens: 2500
      });
      this.say('文风档案已生成');
      this.done++;
      this.emit();

      /* 阶段 2.5：世界观抽取 */
      this.stage = '提取世界观';
      this.emit();
      const worldSample = this.worldSamples();
      try {
        this.world = await LLM.json({
          messages: Prompts.importWorld({ text: worldSample, novelTitle: this.name }),
          temperature: 0.4,
          maxTokens: 3500
        });
        this.world = this.world && Array.isArray(this.world.entries) ? this.world : { entries: [] };
        this.say(`世界观抽取完成：${this.world.entries.length} 条（势力 / 地理 / 规则 / 禁忌 等）`);
      } catch (e) {
        this.world = { entries: [] };
        this.say('世界观抽取失败，已跳过（不影响人物与地图）：' + e.message, 'err');
      }
      this.done++;
      this.emit();

      /* 阶段 3：人物分类 */
      this.stage = '人物分类';
      this.emit();
      const top = this.merged.chars.slice(0, 40);
      this.classified = await LLM.json({
        messages: Prompts.importClassify({ chars: top, novelTitle: this.name }),
        temperature: 0.4,
        maxTokens: 2500
      });
      const catMap = {};
      (this.classified.merged || []).forEach((c) => (catMap[c.name] = c));
      this.merged.chars.forEach((c) => {
        const k = catMap[c.name];
        if (k) {
          c.category = k.category || '配角';
          c.sub = k.sub || '';
        }
      });
      this.say(`人物分类完成：${(this.classified.merged || []).length} 位已归类`);

      /* 阶段 4：人物卡（top N） */
      this.cards = [];
      const ordered = (this.classified.order || []).map((n) => this.merged.chars.find((c) => c.name === n)).filter(Boolean);
      const topChars = (ordered.length ? ordered : this.merged.chars).slice(0, this.cardLimit);
      for (const c of topChars) {
        this.stage = `人物卡：${c.name}`;
        this.emit();
        try {
          const card = await LLM.json({
            messages: Prompts.importCharCard({ char: c, novelTitle: this.name }),
            temperature: 0.5,
            maxTokens: 2400
          });
          card.name = c.name;
          card.category = c.category;
          card.sub = c.sub;
          this.cards.push(card);
          this.say(`人物卡完成：${c.name}（${c.category || ''}）`);
        } catch (e) {
          this.say(`人物卡失败：${c.name} —— ${e.message}`, 'err');
        }
        this.done++;
        this.emit();
      }

      this.stage = '完成';
      this.say('分析完成，可以应用到项目了');
    } catch (e) {
      this.error = e.message;
      this.say('中断：' + e.message, 'err');
    }
    this.running = false;
    this.emit();
  },

  /* ---------- 合并抽取结果 ---------- */
  mergeAll(raw) {
    // 先建 别名 → 主名 映射（第二轮合并用）
    const chars = new Map();
    const places = new Map();
    const items = new Map();

    let bi = -1;
    raw.forEach((r) => {
      bi++;
      (r.chars || []).forEach((c) => {
        if (!c || !c.name) return;
        if (!chars.has(c.name)) {
          chars.set(c.name, {
            name: c.name,
            aliases: new Set(),
            traits: new Set(),
            earlyTraits: new Set(),
            speechSamples: [],
            earlySpeech: [],
            roleHints: new Set(),
            earlyRoleHints: new Set(),
            mentions: 0,
            firstChunk: bi
          });
        }
        const m = chars.get(c.name);
        m.mentions += c.mentions || 1;
        (c.aliases || []).forEach((a) => a && a !== c.name && m.aliases.add(a));
        // 仅采集「登场初期」（首现段及其后 2 段）的证据，避免后期成长污染首次出场状态
        const inEarly = bi - m.firstChunk <= 2;
        if (inEarly) {
          (c.traits || []).forEach((t) => t && m.earlyTraits.add(t));
          if (c.speechSample) m.earlySpeech.push(c.speechSample);
          if (c.roleHint) m.earlyRoleHints.add(c.roleHint);
        }
        (c.traits || []).forEach((t) => t && m.traits.add(t));
        if (c.speechSample) m.speechSamples.push(c.speechSample);
        if (c.roleHint) m.roleHints.add(c.roleHint);
      });
      (r.places || []).forEach((p) => {
        if (!p || !p.name) return;
        if (!places.has(p.name)) places.set(p.name, { name: p.name, descs: new Set() });
        const m = places.get(p.name);
        if (p.desc) m.descs.add(p.desc);
      });
      (r.items || []).forEach((it) => {
        // 道具只记第一次出现（raw 顺序即文本顺序）= 起始位置 + 初始归属
        if (!it || !it.name) return;
        if (!items.has(it.name)) {
          items.set(it.name, {
            name: it.name,
            desc: it.desc || '',
            firstPlace: it.firstPlace || '',
            owner: it.owner || '',
            context: it.context || ''
          });
        }
      });
    });

    // 别名归并：某人的别名恰好是另一个条目的主名 → 合并
    const aliasKill = [];
    chars.forEach((c, name) => {
      c.aliases.forEach((a) => {
        if (chars.has(a) && a !== name) {
          const other = chars.get(a);
          const [keep, drop] = c.mentions >= other.mentions ? [c, other] : [other, c];
          if (!aliasKill.includes(drop.name)) {
            keep.mentions += drop.mentions;
            drop.traits.forEach((t) => keep.traits.add(t));
            drop.speechSamples.forEach((s) => keep.speechSamples.push(s));
            drop.roleHints.forEach((h) => keep.roleHints.add(h));
            drop.aliases.forEach((x) => x !== keep.name && keep.aliases.add(x));
            if (!keep.aliases.has(drop.name)) keep.aliases.add(drop.name);
            aliasKill.push(drop.name);
          }
        }
      });
    });
    aliasKill.forEach((k) => chars.delete(k));

    const charList = Array.from(chars.values())
      .map((c) => ({
        name: c.name,
        aliases: Array.from(c.aliases),
        traits: (c.earlyTraits.size ? Array.from(c.earlyTraits) : Array.from(c.traits)).slice(0, 8),
        speechSamples: (c.earlySpeech.length ? c.earlySpeech : c.speechSamples).slice(0, 6),
        roleHint: (c.earlyRoleHints.size ? Array.from(c.earlyRoleHints) : Array.from(c.roleHints)).slice(0, 2).join('；'),
        mentions: c.mentions,
        category: '',
        sub: ''
      }))
      .sort((a, b) => b.mentions - a.mentions);

    const placeList = Array.from(places.values()).map((p) => ({
      name: p.name,
      desc: Array.from(p.descs).slice(0, 2).join('；')
    }));

    const itemList = Array.from(items.values());

    return { chars: charList, places: placeList, items: itemList };
  },

  /* ---------- 文风采样：开头 / 中段 / 后段 ---------- */
  styleSamples() {
    const t = this.text;
    if (!t) return '';
    const seg = 4000;
    const a = t.slice(0, seg);
    const b = t.slice(Math.floor(t.length * 0.4), Math.floor(t.length * 0.4) + seg);
    const c = t.slice(Math.max(0, t.length - seg));
    return `【开头】\n${a}\n\n【中段】\n${b}\n\n【后段】\n${c}`;
  },

  /* ---------- 世界观采样：开头 + 中段（设定通常在这些位置集中交代） ---------- */
  worldSamples() {
    const t = this.text;
    if (!t) return '';
    const seg = 6000;
    const a = t.slice(0, seg);
    const b = t.slice(Math.floor(t.length * 0.35), Math.floor(t.length * 0.35) + seg);
    return `【开头】\n${a}\n\n【情节展开后】\n${b}`;
  },

  /* ---------- 应用到项目（支持勾选保留地点 / 道具） ---------- */
  async apply(opts) {
    opts = opts || {};
    const keepExisting = !!opts.keepExisting;
    const selPlaces = opts.places instanceof Set ? opts.places : null; // 要保留的地点名集合；null=全部
    const selItems = opts.items instanceof Set ? opts.items : null;    // 要保留的道具名集合；null=全部
    if (!this.merged || !this.style) return toast('还没有分析结果', 'err');
    const d = Store.data;

    if (!keepExisting && !confirm('将用导入的内容替换现有的人物、地图与文风（正文与大纲保留）。继续？')) return;

    /* 手工登记的道具不随「替换」丢失：先摘出，重建人物 / 地图后再按同名挂回
       （无主道具池 props 不会被替换，天然保留） */
    const manualProps = [];
    if (!keepExisting) {
      d.characters.forEach((c) => (c.items || []).forEach((it) => {
        if (it && it.manual) manualProps.push({ it, type: 'char', name: c.name });
      }));
      d.map.nodes.forEach((n) => (n.items || []).forEach((it) => {
        if (it && it.manual) manualProps.push({ it, type: 'place', name: n.name });
      }));
    }

    /* 文风 */
    d.styleProfile = this.style;
    d.style = {
      pov: this.style.pov || d.style.pov,
      tense: this.style.tense || d.style.tense,
      tone: [this.style.sentence, this.style.rhythm].filter(Boolean).join('；') || d.style.tone,
      sample: this.style.sample || d.style.sample
    };

    /* 人物 */
    const newChars = [];
    const byName = {};
    this.merged.chars.forEach((c) => (byName[c.name] = c));
    this.cards.forEach((card) => {
      const src = byName[card.name] || {};
      newChars.push({
        id: uid('ch'),
        name: card.name,
        role: card.role || src.roleHint || '身份未知',
        color: pickColor(newChars.length),
        category: card.category || '',
        sub: card.sub || '',
        aliases: (card.aliases && card.aliases.length ? card.aliases : (src.aliases || [])),
        appearance: card.appearance || '',
        lock: {
          traits: Store.toArr((card.lock && card.lock.traits) || src.traits),
          speech: (card.lock && card.lock.speech) || '',
          taboo: (card.lock && card.lock.taboo) || '',
          values: (card.lock && card.lock.values) || ''
        },
        drive: {
          goal: (card.drive && card.drive.goal) || '',
          fear: (card.drive && card.drive.fear) || '',
          secret: (card.drive && card.drive.secret) || '',
          arc: (card.drive && card.drive.arc) || ''
        },
        knowledge: {
          knows: (card.knowledge && card.knowledge.knows) || '',
          unknown: (card.knowledge && card.knowledge.unknown) || ''
        },
        relations: [],
        futureItems: (card.futureItems && card.futureItems.length) ? card.futureItems.map((s) => String(s).trim()).filter(Boolean) : [],
        items: [],
        state: { placeId: '', mood: (card.state && card.state.mood) || '', note: (card.state && card.state.note) || (src.speechSamples || [])[0] || '' }
      });
    });
    // 没生成卡的主要人物也收进来（简版）
    this.merged.chars.forEach((c) => {
      if (newChars.some((x) => x.name === c.name)) return;
      if (c.mentions < 8 && !['男主', '女主', '主要人物'].includes(c.category)) return; // 龙套不进
      newChars.push({
        id: uid('ch'),
        name: c.name,
        role: c.roleHint || (c.category ? c.category + (c.sub ? ' · ' + c.sub : '') : '配角'),
        color: pickColor(newChars.length),
        category: c.category || '配角',
        sub: c.sub || '',
        aliases: c.aliases || [],
        appearance: '',
        lock: { traits: Store.toArr(c.traits), speech: '', taboo: '', values: '' },
        drive: { goal: '', fear: '', secret: '', arc: '' },
        knowledge: { knows: '', unknown: '' },
        relations: [],
        futureItems: [],
        items: [],
        state: { placeId: '', mood: '', note: '' }
      });
    });

    /* 名字 → 人物 映射（关系解析 + 道具归属复用） */
    const charByName = {};
    newChars.forEach((c) => {
      charByName[c.name] = c;
      (c.aliases || []).forEach((a) => (charByName[a] = c));
    });
    // 人物卡推断的关系：按名字解析成真实关系对象；初始关系 + 未来关系 都记录
    this.cards.forEach((card) => {
      if (!card.relations || !card.relations.length) return;
      const c = newChars.find((x) => x.name === card.name);
      if (!c) return;
      card.relations.forEach((r) => {
        if (!r || !r.target) return;
        const t = charByName[r.target];
        if (t && t.id !== c.id) {
          // 关系只留一段自由文字（旧版 AI 若仍返回「称谓 label」会自动折叠进来）
          c.relations.push(foldRelLabel({
            target: t.id,
            label: r.label || '',
            attitude: r.attitude || '',
            kind: r.kind || '',
            time: r.time || '初始'
          }));
        }
      });
      if (card.futureItems && card.futureItems.length) {
        const fi = (c.futureItems || []).concat(card.futureItems.map((s) => String(s).trim()).filter(Boolean));
        c.futureItems = Array.from(new Set(fi));
      }
    });

    /* 地图（环形自动布局，只保留勾选的地点） */
    const placeNames = selPlaces || new Set(this.merged.places.map((p) => p.name));
    const placeSource = this.extractPlaces ? this.merged.places.filter((p) => placeNames.has(p.name)) : [];
    const nodes = placeSource.slice(0, 24).map((p, i, arr) => {
      const ang = (i / Math.max(1, arr.length)) * Math.PI * 2 - Math.PI / 2;
      const R = arr.length <= 3 ? 160 : 300;
      return {
        id: uid('pl'),
        name: p.name,
        type: '市井',
        x: Math.round(500 + Math.cos(ang) * R * (0.85 + (i % 3) * 0.15)),
        y: Math.round(320 + Math.sin(ang) * R * 0.75 * (0.85 + (i % 3) * 0.15)),
        desc: p.desc || '',
        items: [],
        sub: { desc: '' }
      };
    });

    /* 道具归属：只记「起始位置 + 初始归属」 */
    const placeByName = {};
    nodes.forEach((n) => (placeByName[n.name] = n));
    let unlocated = 0;
    let itemCount = 0;
    if (this.extractItems) {
      this.merged.items.forEach((it) => {
        if (selItems && !selItems.has(it.name)) return;
        const item = { id: uid('itm'), name: it.name, desc: it.desc || '', source: it.firstPlace || '', context: it.context || '', owner: it.owner || '' };
        const place = it.firstPlace ? placeByName[it.firstPlace] : null;
        if (place) {
          // 起始位置：放进该地点的道具清单
          place.items.push(item);
          itemCount++;
          // 若首属某角色 → 同时归到该角色（初始持有），如「东皇钟 · 东皇太一」
          if (it.owner && charByName[it.owner]) {
            charByName[it.owner].items.push({ id: uid('itm'), name: it.name, desc: it.desc || '', source: it.firstPlace || '', context: it.context || '', owner: it.owner });
          }
        } else if (it.owner && charByName[it.owner]) {
          // 无明确地点但有初始归属：挂在角色身上
          charByName[it.owner].items.push(item);
          itemCount++;
        } else {
          // 无地点也无归属：进无主道具池，之后可在「道具」页指定归属
          if (!Array.isArray(d.props)) d.props = [];
          d.props.push(item);
          unlocated++;
          itemCount++;
        }
      });
    }

    /* 世界观（导入时抽取，可在「世界观」页修订） */
    const worldEntries = ((this.world && this.world.entries) || []).map((e) => ({
      id: uid('we'),
      cat: WORLD_CAT_MAP && WORLD_CAT_MAP[e.cat] ? e.cat : '名词',
      name: e.name || '未命名',
      desc: e.desc || '',
      detail: e.detail || '',
      weight: Number(e.weight) || 2,
      tags: Array.isArray(e.tags) ? e.tags : [],
      links: { chars: [], places: [] }
    }));

    /* 势力：整书导入会重建世界观条目，按名字把所属地 / 成员 / 相互关系挂回去 */
    if (!keepExisting) {
      const oldFacs = (d.world && Array.isArray(d.world.entries) ? d.world.entries : []).filter((e) => e && e.cat === '势力');
      const oldByName = {}, newByName = {}, idMap = {};
      oldFacs.forEach((e) => { if (e.name) oldByName[e.name] = e; });
      worldEntries.forEach((e) => { if (e.cat === '势力' && e.name) newByName[e.name] = e; });
      Object.keys(newByName).forEach((n) => { if (oldByName[n]) idMap[oldByName[n].id] = newByName[n].id; });
      worldEntries.forEach((e) => {
        if (e.cat !== '势力') return;
        const o = oldByName[e.name];
        if (!o) return;
        const ol = o.links || {};
        e.places = Array.isArray(o.places) ? o.places.slice() : [];
        e.links = {
          chars: Array.isArray(ol.chars) ? ol.chars.slice() : [],
          places: Array.isArray(ol.places) ? ol.places.slice() : []
        };
        e.groupId = (o.groupId && Store.factionGroup(o.groupId)) ? o.groupId : '';
        e.relations = (Array.isArray(o.relations) ? o.relations : [])
          .map((r) => ({ id: r.id || uid('fr'), target: idMap[r.target] || '', kind: r.kind || '', note: r.note || '', pairId: r.pairId || '' }))
          .filter((r) => r.target);
      });
    }

    /* 分类：整书导入会重建人物，先按姓名记住作者手动归好的分类 */
    const oldGroupByName = {};
    (d.characters || []).forEach((c) => { if (c && c.name && c.groupId) oldGroupByName[c.name] = c.groupId; });

    /* 写入 */
    if (!keepExisting) {
      d.characters = newChars;
      d.map = { nodes, edges: [], view: { x: 0, y: 0, zoom: 1 } };
      d.world = {
        setting: `以下世界观由《${this.name}》自动抽取，可在「世界观」页修订。`,
        rules: '',
        tone: '',
        entries: worldEntries
      };
      if (['洪荒纪·不周遗策', '未命名作品'].includes(d.meta.title) || !d.meta.title) d.meta.title = this.name;
    } else {
      d.characters = d.characters.concat(newChars);
      d.map.nodes = d.map.nodes.concat(nodes);
      d.world = d.world || { setting: '', rules: '', tone: '', entries: [] };
      if (!Array.isArray(d.world.entries)) d.world.entries = [];
      d.world.entries = d.world.entries.concat(worldEntries);
    }
    /* 同名人物沿用原分类；分类定义 charGroups / factionGroups 保留不动 */
    d.characters.forEach((c) => {
      if (!c.groupId && oldGroupByName[c.name]) c.groupId = oldGroupByName[c.name];
    });
    /* 势力 id 在整书导入后重建，关系图的旧坐标失效，回到自动排版 */
    if (!keepExisting && d.factionNet && d.factionNet.pos) d.factionNet.pos = {};
    /* 把手工道具挂回同名人物 / 地点；原持有者已不在导入结果里就转入无主池 */
    if (!keepExisting) {
      manualProps.forEach(({ it, type, name }) => {
        if (type === 'char') {
          const c = d.characters.find((x) => x.name === name);
          if (c) { if (!Array.isArray(c.items)) c.items = []; c.items.push(it); return; }
        } else if (type === 'place') {
          const n = d.map.nodes.find((x) => x.name === name);
          if (n) { if (!Array.isArray(n.items)) n.items = []; n.items.push(it); return; }
        }
        if (!Array.isArray(d.props)) d.props = [];
        d.props.push(it);
      });
    }
    d.novel = { name: this.name, chars: this.text.length, analyzedAt: new Date().toISOString(), chunks: this.chunks.length };
    Store.rebuildInventory();
    await Store.save(true);
    try {
      await fetch('/api/book/' + encodeURIComponent(Store.currentBookId) + '/novel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: NovelImport.text })
      });
    } catch (e) {}
    const parts = [`已应用：${newChars.length} 位人物、${nodes.length} 处地点`];
    if (this.extractItems) parts.push(`${itemCount} 件道具`);
    if (worldEntries.length) parts.push(`${worldEntries.length} 条世界观（含历史 / 现状）`);
    if (unlocated) parts.push(`（${unlocated} 件未定位）`);
    toast(parts.join('、'));
    App.go('characters');
  },

  /* ---------- 应用前：勾选要保留的地点 / 道具 ---------- */
  openApplyModal(keepExisting) {
    const N = NovelImport;
    if (!N.merged) return;
    const hasPlaces = N.extractPlaces && N.merged.places.length > 0;
    const hasItems = N.extractItems && N.merged.items.length > 0;

    const placeRows = hasPlaces
      ? N.merged.places
          .map(
            (p) => `<label class="sel-row">
              <input type="checkbox" class="sel-place" data-name="${esc(p.name)}" checked>
              <span class="sel-name">${esc(p.name)}</span>
              <span class="sel-desc small muted">${esc((p.desc || '').slice(0, 46))}</span>
            </label>`
          )
          .join('')
      : '<div class="small muted">未抽取地点（可在下方配置中开启）</div>';

    const itemRows = hasItems
      ? N.merged.items
          .map(
            (it) => {
              const loc = it.firstPlace ? '位于 ' + it.firstPlace : '';
              const own = it.owner ? '归属 ' + it.owner : (it.firstPlace ? '无主' : '位置未知');
              const extra = (it.desc || '').slice(0, 22);
              return `<label class="sel-row">
              <input type="checkbox" class="sel-item" data-name="${esc(it.name)}" checked>
              <span class="sel-name">${esc(it.name)}</span>
              <span class="sel-desc small muted">${esc(loc + ' · ' + own)}${extra ? ' · ' + esc(extra) : ''}</span>
            </label>`;
            }
          )
          .join('')
      : '<div class="small muted">未抽取道具（可在下方配置中开启）</div>';

    const mask = Modal.open({
      title: '应用导入结果',
      wide: true,
      body: `
        <div class="kv"><span class="muted">人物</span><b>${N.cards.length} 张卡 + ${N.merged.chars.length} 位识别到的人物（含性格锁、关系、知识边界，全部导入）</b></div>
        <div class="kv"><span class="muted">世界观</span><b>${N.world && N.world.entries ? N.world.entries.length : 0} 条（已分 历史 / 现状 / 势力 / 规则 等）</b></div>
        <div class="row" style="margin-top:10px;align-items:center">
          <label class="radio"><input type="radio" name="impMode" value="replace" ${keepExisting ? '' : 'checked'}> 替换现有</label>
          <label class="radio"><input type="radio" name="impMode" value="append" ${keepExisting ? 'checked' : ''}> 追加不替换</label>
        </div>
        <div class="divider"></div>
        <div class="sec-title">地点 <span class="small muted">（取消勾选的不会进地图，由你决定留哪些）</span></div>
        <div class="sel-list">${placeRows}</div>
        <div class="divider"></div>
        <div class="sec-title">道具 <span class="small muted">（只记录起始位置与初始归属；取消勾选的不会导入）</span></div>
        <div class="sel-list">${itemRows}</div>
      `,
      footer: `<button class="btn" data-x>取消</button><button class="btn primary" id="impDoApply">确认导入</button>`
    });
    mask.querySelector('[data-x]').onclick = () => Modal.close();
    mask.querySelector('#impDoApply').onclick = async () => {
      const mode = mask.querySelector('input[name=impMode]:checked').value;
      const places = new Set(Array.from(mask.querySelectorAll('.sel-place:checked')).map((c) => c.dataset.name));
      const items = new Set(Array.from(mask.querySelectorAll('.sel-item:checked')).map((c) => c.dataset.name));
      Modal.close();
      await N.apply({ keepExisting: mode === 'append', places, items });
    };
  }
};

Views.import = {
  title: '书源',
  get sub() {
    const t = Store.data && Store.data.meta ? Store.data.meta.title : '';
    return `导入《${t || '当前书'}》→ 抽文风 · 提世界观 · 建人物地图 · 道具归属`;
  },

  actions() {
    if (NovelImport.running) return '';
    if (NovelImport.merged) return `<button class="btn" id="btnImpReset">清空重来</button>
                                    <button class="btn primary" id="btnImpApply">应用到项目</button>`;
    return '';
  },

  mount(el) {
    el.classList.add('no-pad');
    NovelImport.onUpdate = () => this.paint();
    this.paint();
    if (!NovelImport.running) NovelImport.emit();
    this.bindTopbar();
  },

  /* 顶栏「应用到项目 / 清空」按钮（之前未绑定，这里补上） */
  bindTopbar() {
    const a = $('#btnImpApply');
    if (a) a.onclick = () => this.openApplyModal(false);
    const r = $('#btnImpReset');
    if (r) r.onclick = () => {
      if (confirm('清空当前分析结果？')) NovelImport.reset();
    };
  },

  paint() {
    const el = $('#view');
    const N = NovelImport;
    if (!el) return;

    /* ---- 运行中：进度面板 ---- */
    if (N.running) {
      el.innerHTML = `
        <div class="imp-wrap">
          <div class="card pad imp-progress">
            <div class="sec-title">正在分析《${esc(N.name)}》</div>
            <div class="imp-stage">${esc(N.stage)}</div>
            <div class="imp-bar"><div class="imp-bar-fill" style="width:${Math.round((N.done / Math.max(1, N.total)) * 100)}%"></div></div>
            <div class="imp-count">${N.done} / ${N.total}</div>
            <div class="imp-log" id="impLog">${N.log.map((l) => `<div class="il ${l.type}"><span>${l.t}</span> ${esc(l.msg)}</div>`).join('')}</div>
          </div>
        </div>`;
      const logEl = $('#impLog');
      if (logEl) logEl.scrollTop = logEl.scrollHeight;
      return;
    }

    /* ---- 有错误 ---- */
    if (N.error && !N.merged) {
      el.innerHTML = `
        <div class="imp-wrap">
          <div class="card pad">
            <div class="sec-title">分析中断</div>
            <div class="imp-err">${esc(N.error)}</div>
            <button class="btn" onclick="NovelImport.error=null;NovelImport.emit()">返回</button>
          </div>
        </div>`;
      return;
    }

    /* ---- 有结果：预览 ---- */
    if (N.merged) {
      el.innerHTML = `
        <div class="imp-wrap">
          <div class="imp-head card pad">
            <div class="sec-title">《${esc(N.name)}》分析结果</div>
            <div class="imp-stats">
              <span>人物 <b>${N.merged.chars.length}</b></span>
              <span>地点 <b>${N.merged.places.length}</b></span>
              <span>道具 <b>${N.merged.items.length}</b></span>
              <span>人物卡 <b>${N.cards.length}</b></span>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn primary" id="btnApply">应用到项目</button>
              <button class="btn" id="btnApplyKeep">追加（不替换）</button>
              <button class="btn" id="btnRerun">重新分析</button>
              <button class="btn danger" id="btnClear">清空重来</button>
            </div>
          </div>

          <div class="imp-grid">
            <div class="card pad">
              <div class="sec-title">文风档案</div>
              ${N.style ? this.styleTable(N.style) : '<div class="small muted">未生成</div>'}
            </div>

            <div class="card pad">
              <div class="sec-title">人物（按戏份排序）</div>
              <div class="imp-chars">
                ${N.merged.chars.slice(0, 20).map((c) => `
                  <div class="imp-char ${N.cards.some((x) => x.name === c.name) ? 'has-card' : ''}">
                    <b>${esc(c.name)}</b>
                    ${c.category ? `<span class="chip ${c.category === '男主' || c.category === '女主' ? 'jade' : ''}">${esc(c.category)}</span>` : ''}
                    ${c.sub ? `<span class="small muted">${esc(c.sub)}</span>` : ''}
                    <span class="small muted">${c.mentions} 次</span>
                    ${N.cards.some((x) => x.name === c.name) ? '<span class="chip">已建卡</span>' : ''}
                  </div>`).join('')}
              </div>
            </div>

            <div class="card pad">
              <div class="sec-title">地点</div>
              <div class="imp-places">
                ${N.merged.places.slice(0, 20).map((p) => `
                  <div class="imp-place">
                    <b>${esc(p.name)}</b>
                    <span class="small muted">${esc((p.desc || '').slice(0, 60))}</span>
                  </div>`).join('') || '<div class="small muted">没有识别到地点</div>'}
              </div>
            </div>

            <div class="card pad">
              <div class="sec-title">道具（按起始位置 / 初始归属）</div>
              <div class="imp-items">
                ${N.merged.items.slice(0, 30).map((it) => {
                  const loc = it.firstPlace ? `位于 ${esc(it.firstPlace)}` : '';
                  const own = it.owner ? `归属 ${esc(it.owner)}` : (it.firstPlace ? '无主' : '位置未知');
                  return `<div class="imp-item">
                    <b>${esc(it.name)}</b>
                    <span class="small muted">${esc((it.desc || '').slice(0, 36))}</span>
                    <span class="chip">${loc}${loc ? ' · ' : ''}${own}</span>
                  </div>`;
                }).join('') || '<div class="small muted">没有识别到道具</div>'}
              </div>
            </div>
          </div>

          <div class="card pad">
            <div class="sec-title">日志</div>
            <div class="imp-log small">${N.log.map((l) => `<div class="il ${l.type}"><span>${l.t}</span> ${esc(l.msg)}</div>`).join('')}</div>
          </div>
        </div>`;
      $('#btnApply').onclick = () => this.openApplyModal(false);
      $('#btnApplyKeep').onclick = () => this.openApplyModal(true);
      this.bindTopbar();
      $('#btnRerun').onclick = () => { NovelImport.raw = []; NovelImport.merged = null; NovelImport.style = null; NovelImport.classified = null; NovelImport.cards = []; NovelImport.run(); };
      $('#btnClear').onclick = () => { if (confirm('清空当前分析结果？')) NovelImport.reset(); };
      return;
    }

    /* ---- 初始：上传 ---- */
    el.innerHTML = `
      <div class="imp-wrap">
        <div class="card pad imp-upload">
          <div class="sec-title">导入一部小说</div>
          <div class="small muted" style="margin-bottom:14px;line-height:1.9">
            上传 <b>.txt</b> 文件（自动识别 UTF-8 / GBK 编码）。分析后你会得到：<br>
            · 一份<b>严格的文风档案</b>——之后写作台的成文会逐条遵循它<br>
            · <b>全面的人物卡</b>：身份（含年龄）、称号别名、性格锁四件套、欲望与秘密、知识边界、关系<br>
            · <b>世界观</b>：自动抽取历史（已发生）与现状（正在发生）、势力、规则、禁忌等，可在「世界观」页修订<br>
            · <b>地点 / 道具</b>：可选抽取；应用前会列出清单，由你勾选保留哪些
          </div>
          <div class="imp-drop" id="impDrop">
            <div class="imp-drop-icon">书</div>
            <div>把 .txt 拖到这里，或</div>
            <button class="btn primary" id="impPick">选择文件</button>
            <input type="file" id="impFile" accept=".txt,.md,.text" style="display:none">
          </div>
          ${Store.data.novel && Store.data.novel.name ? `<div class="small muted" style="margin-top:12px">当前项目源自《${esc(Store.data.novel.name)}》（${Store.data.novel.chars ? Store.data.novel.chars.toLocaleString() + ' 字' : ''}）</div>` : ''}
        </div>

        <div class="card pad" id="impCfg" style="display:none">
          <div class="sec-title">《<span id="impName"></span>》 · 分析配置</div>
          <div class="kv"><span class="muted">字数</span><b id="impChars"></b></div>
          <div class="kv"><span class="muted">编码</span><b id="impEnc"></b></div>
          <div class="kv"><span class="muted">分段</span><b id="impChunks"></b></div>
          <div class="row" style="margin-top:12px">
            <label class="fld"><span>每段字数</span>
              <select id="impChunkSize">
                <option value="12000">12000（细，更准）</option>
                <option value="18000" selected>18000（默认）</option>
                <option value="25000">25000（粗，更省）</option>
              </select></label>
            <label class="fld"><span>最多分析前几段（0=全部）</span>
              <input type="number" id="impMaxChunks" value="0" min="0" step="1"></label>
            <label class="fld"><span>生成几张人物卡</span>
              <select id="impCardLimit">
                <option value="6">6（核心）</option>
                <option value="10" selected>10（默认）</option>
                <option value="16">16（全面）</option>
              </select></label>
          </div>
          <div class="row" style="margin-top:10px">
            <label class="chk"><input type="checkbox" id="impPlaces" ${NovelImport.extractPlaces ? 'checked' : ''}> 提取地点（取消则不建地图）</label>
            <label class="chk"><input type="checkbox" id="impItems" ${NovelImport.extractItems ? 'checked' : ''}> 提取道具（取消则不做道具归属）</label>
          </div>
          <div class="hint" id="impCost"></div>
          <button class="btn primary" id="btnRun" style="margin-top:12px">开始分析</button>
        </div>
      </div>`;

    /* 上传交互 */
    const drop = $('#impDrop');
    const fileInput = $('#impFile');
    $('#impPick').onclick = () => fileInput.click();
    fileInput.onchange = () => {
      if (fileInput.files[0]) this.loadFile(fileInput.files[0]);
    };
    drop.ondragover = (ev) => { ev.preventDefault(); drop.classList.add('on'); };
    drop.ondragleave = () => drop.classList.remove('on');
    drop.ondrop = (ev) => {
      ev.preventDefault();
      drop.classList.remove('on');
      const f = ev.dataTransfer.files[0];
      if (f) this.loadFile(f);
    };

    $('#impChunkSize').onchange = () => {
      NovelImport.chunkSize = Number($('#impChunkSize').value);
      NovelImport.splitChunks();
      this.paintCfg();
    };
    $('#impMaxChunks').onchange = () => {
      NovelImport.maxChunks = Number($('#impMaxChunks').value) || 0;
      this.paintCfg();
    };
    $('#impCardLimit').onchange = () => {
      NovelImport.cardLimit = Number($('#impCardLimit').value) || 10;
      this.paintCfg();
    };
    $('#impPlaces').onchange = () => {
      NovelImport.extractPlaces = $('#impPlaces').checked;
    };
    $('#impItems').onchange = () => {
      NovelImport.extractItems = $('#impItems').checked;
    };
    $('#btnRun').onclick = async () => {
      // 存一份到服务端，供后续重开
      try {
        await fetch('/api/book/' + encodeURIComponent(Store.currentBookId) + '/novel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: NovelImport.text })
        });
      } catch (e) {}
      NovelImport.run();
    };
  },

  async loadFile(f) {
    try {
      await NovelImport.loadFile(f);
      this.paintCfg();
      $('#impCfg').style.display = '';
      $('#impCfg').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      toast('读取失败：' + e.message, 'err');
    }
  },

  paintCfg() {
    const N = NovelImport;
    if (!N.text) return;
    $('#impName').textContent = N.name;
    $('#impChars').textContent = N.text.length.toLocaleString() + ' 字';
    $('#impEnc').textContent = N.encoding;
    $('#impChunks').textContent = N.chunks.length + ' 段';
    const n = (N.maxChunks > 0 ? Math.min(N.maxChunks, N.chunks.length) : N.chunks.length);
    const calls = n + 2 + N.cardLimit;
    $('#impCost').textContent = `预计 ${calls} 次 API 调用（${n} 段抽取 + 文风 + 分类 + ${N.cardLimit} 张人物卡）。长篇会花一些时间，期间可以切到别的页面，分析不会中断。`;
  },

  styleTable(sp) {
    const rows = [
      ['视角', sp.pov],
      ['时态', sp.tense],
      ['句式', sp.sentence],
      ['节奏', sp.rhythm],
      ['对话', sp.dialogue],
      ['描写', sp.description],
      ['心理', sp.psychology],
      ['词汇', sp.vocabulary],
      ['标点', sp.punctuation],
      ['高频词', (sp.habits || []).join('、')],
      ['严禁', (sp.avoid || []).join('；')]
    ];
    return `<div class="imp-style">
      ${rows.filter((r) => r[1]).map(([k, v]) => `<div class="imp-st-row"><span>${k}</span><div>${esc(v)}</div></div>`).join('')}
      ${sp.sample ? `<div class="imp-st-sample"><span>文风样本</span><div>${esc(sp.sample)}</div></div>` : ''}
    </div>`;
  }
};
