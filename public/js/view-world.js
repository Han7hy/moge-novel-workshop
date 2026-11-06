/* ============ view-world.js —— 世界观构建 ============ */
window.Views = window.Views || {};

Views.world = {
  title: '世界观',
  sub: '势力 · 地理 · 编年',
  _cat: '全部',
  _q: '',
  _open: {},

  actions() {
    return `<button class="btn" id="btnWorldGen">AI 生成世界观</button>
            <button class="btn primary" id="btnWorldAdd">+ 新建条目</button>`;
  },

  mount(el) {
    const d = Store.data;
    const entries = Store.worldEntries();
    const counts = {};
    entries.forEach((e) => (counts[e.cat] = (counts[e.cat] || 0) + 1));

    // 左侧单开「势力」侧栏
    const factions = entries.filter((e) => e.cat === '势力');
    // 主区只保留 历史 / 现状，合并成一部编年（去掉「全部」）
    const MAIN_CATS = ['历史', '现状'];
    const q = this._q.trim().toLowerCase();
    const list = entries.filter((e) => {
      if (!MAIN_CATS.includes(e.cat)) return false;
      if (!q) return true;
      const hay = [e.name, e.desc, e.detail, (e.tags || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });

    el.innerHTML = `
      <div class="world-layout">
        <aside class="world-faction-col">
          <div class="card pad">
            <div class="sec-title" style="margin-bottom:10px">势力</div>
            <div class="fentry-n">${factions.length}<em>个势力</em></div>
            <div class="small muted">划分、所属地、成员与势力之间的关系，都在最左侧「势力」栏目里。</div>
            <button class="btn fentry-go" id="btnGoFactions">打开势力页 →</button>
          </div>
        </aside>

        <div class="world-main">
          <div class="card pad" style="margin-bottom:16px">
            <div class="sec-title">世界底色</div>
            <div class="row">
              <label class="fld" style="flex:1.5"><span>设定</span>
                <textarea data-bind="world.setting" data-live rows="4" placeholder="时代、地点、社会结构、势力关系…">${esc(d.world.setting)}</textarea>
              </label>
              <label class="fld" style="flex:1"><span>铁律（不可违反）</span>
                <textarea data-bind="world.rules" data-live rows="4" placeholder="例：没有超自然力量">${esc(d.world.rules)}</textarea>
              </label>
            </div>
            <label class="fld" style="margin-bottom:0"><span>整体基调</span>
              <input type="text" data-bind="world.tone" data-live value="${esc(d.world.tone)}" placeholder="例：潮湿、压抑、克制的悲悯">
            </label>
          </div>

          <div class="geo-banner" id="geoMapBtn" title="打开地图">
            <span class="geo-ic">地</span>
            <div style="min-width:0;flex:1">
              <div class="geo-t">地理 · 地图</div>
              <div class="small muted">城邦、街区、秘境、地名，都在地图上画和管理</div>
            </div>
            <span class="geo-go">打开地图 →</span>
          </div>

          <div class="chronicle">
            <div class="ch-head">
              <span class="ch-title">世界编年</span>
              <span class="ch-sub">往世 · 今世，皆载于此</span>
            </div>

            <div class="world-tools">
              <input type="search" id="worldSearch" class="world-search" placeholder="搜编年中的名称、描述、标签…" value="${esc(this._q)}">
              <span class="muted small">共 ${list.length} 条</span>
            </div>

            ${
              list.length
                ? `<div class="ch-list">${list.map((e) => this.chEntry(e)).join('')}</div>`
                : `<div class="card pad"><div class="empty" style="padding:40px 20px">
                    <h3>${entries.length ? '编年里还没有可记之事' : '这个世界还是空的'}</h3>
                    <p class="small">${entries.length ? '先写一段历史，或记一笔现状。' : '从一个大类开始：先定势力，还是先定地理？'}</p>
                  </div></div>`
            }
          </div>
        </div>
      </div>`;

    bindInputs(el);

    el.querySelectorAll('.ch-entry').forEach((c) => {
      c.onclick = () => this.edit(c.dataset.id);
    });

    const facCol = el.querySelector('.world-faction-col');
    if (facCol) {
      const go = facCol.querySelector('#btnGoFactions');
      if (go) go.onclick = () => App.go('factions');
    }

    const geo = el.querySelector('#geoMapBtn');
    if (geo) geo.onclick = () => App.go('map');

    const search = el.querySelector('#worldSearch');
    if (search) {
      let t = null;
      search.oninput = (e) => {
        clearTimeout(t);
        const v = e.target.value;
        t = setTimeout(() => {
          this._q = v;
          const pos = e.target.selectionStart;
          this.mount(el);
          const s = el.querySelector('#worldSearch');
          if (s) {
            s.focus();
            s.setSelectionRange(pos, pos);
          }
        }, 220);
      };
    }

    const bg = $('#btnWorldGen');
    if (bg) bg.onclick = () => this.genWorld();
    const ba = $('#btnWorldAdd');
    if (ba) ba.onclick = () => this.addEntry('历史');
  },

  chEntry(e) {
    const isNow = e.cat === '现状';
    const seal = isNow ? '今' : '史';
    const sealCls = isNow ? 'now' : 'past';
    const links = (e.links && (e.links.chars || []).length + (e.links.places || []).length) || 0;
    return `<div class="ch-entry" data-id="${e.id}">
      <div class="ch-axis"><span class="ch-seal ${sealCls}">${seal}</span></div>
      <div class="ch-body">
        <div class="ch-name">${esc(e.name || '未命名')}</div>
        <div class="ch-meta">${esc(e.cat || '')}${e.weight >= 3 ? ' · 核心' : ''}${links ? ' · 关联 ' + links : ''}</div>
        ${e.desc ? `<div class="ch-desc">${esc(e.desc)}</div>` : ''}
        <div class="ch-foot">
          ${(e.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
        </div>
      </div>
    </div>`;
  },

  addEntry(cat) {
    const e = {
      id: uid('we'),
      cat: cat || (this._cat !== '全部' ? this._cat : '势力'),
      name: '',
      desc: '',
      detail: '',
      weight: 2,
      tags: [],
      links: { chars: [], places: [] }
    };
    Store.worldEntries().push(e);
    Store.touch();
    this.edit(e.id);
  },

  edit(id) {
    const idx = Store.worldEntries().findIndex((e) => e.id === id);
    if (idx < 0) return;
    const e = Store.worldEntries()[idx];
    const B = (p) => `world.entries.${idx}.${p}`;
    const chars = Store.data.characters;
    const places = Store.data.map.nodes;

    const catOpts = WORLD_CATS.map((c) => `<option value="${esc(c.key)}" ${e.cat === c.key ? 'selected' : ''}>${c.icon} ${esc(c.key)}</option>`).join('');

    const mask = Modal.open({
      title: '世界观条目',
      wide: true,
      body: `
      <div class="row">
        <label class="fld" style="flex:0 0 120px"><span>分类</span>
          <select data-bind="${B('cat')}">${catOpts}</select></label>
        <label class="fld" style="flex:1.4"><span>名称</span>
          <input type="text" data-bind="${B('name')}" data-live value="${esc(e.name || '')}" placeholder="例：福安帮"></label>
        <label class="fld" style="flex:0 0 110px"><span>权重</span>
          <select data-bind="${B('weight')}">
            ${[1, 2, 3].map((w) => `<option value="${w}" ${Number(e.weight) === w ? 'selected' : ''}>${'★'.repeat(w)}</option>`).join('')}
          </select></label>
      </div>

      <label class="fld"><span>一句话（会进提示词的简版）</span>
        <textarea data-bind="${B('desc')}" data-live rows="2" placeholder="这个条目是什么，一句话讲清">${esc(e.desc || '')}</textarea>
      </label>
      <label class="fld"><span>详述（展开设定，只在需要时引用）</span>
        <textarea data-bind="${B('detail')}" data-live rows="4" placeholder="内部结构、规矩、忌讳、演变…">${esc(e.detail || '')}</textarea>
      </label>

      <label class="fld"><span>标签（每行一个）</span>
        <input type="text" data-bind="${B('tags')}" data-live data-type="lines" value="${esc((e.tags || []).join('\n'))}" placeholder="老城厢&#10;户籍">
      </label>

      <div class="sec-title">关联 <span class="small muted" style="font-family:var(--sans);letter-spacing:0">（让角色知道自己跟这个世界有什么关系）</span></div>
      <div class="row">
        <label class="fld"><span>相关人物</span>
          <div class="cast-pick" id="weChars">
            ${chars.map((c) => `<span class="pick ${((e.links && e.links.chars) || []).includes(c.id) ? 'on' : ''}" data-cid="${c.id}" style="--c:${c.color || '#a63a2a'}">${esc(c.name)}</span>`).join('') || '<span class="small muted">还没有人物</span>'}
          </div></label>
        <label class="fld"><span>相关地点</span>
          <div class="cast-pick" id="wePlaces">
            ${places.map((p) => `<span class="pick ${((e.links && e.links.places) || []).includes(p.id) ? 'on' : ''}" data-cid="${p.id}" style="--c:#a97f2f">${esc(p.name)}</span>`).join('') || '<span class="small muted">还没有地点</span>'}
          </div></label>
      </div>

      <div style="display:flex;gap:8px;margin-top:4px;align-items:center;flex-wrap:wrap">
        <button class="btn sm" id="weExpand">AI 扩充这一条</button>
        <button class="btn sm ghost" id="weUndoExpand" ${this._lastExpand && this._lastExpand.id === e.id ? '' : 'style="display:none"'}>↶ 撤销本次扩充</button>
        <span class="small muted" style="align-self:center">保留你已写的内容，只往后补细节与忌讳；生成后可撤销</span>
      </div>`,
      footer: `<button class="btn danger" id="weDel">删除</button>
               <div style="flex:1"></div>
               <button class="btn primary" id="weDone">完成</button>`
    });

    bindInputs(mask);
    const pick = (box, key) => {
      const el = mask.querySelector(box);
      el.querySelectorAll('.pick').forEach((p) => {
        p.onclick = () => {
          p.classList.toggle('on');
          const ids = Array.from(el.querySelectorAll('.pick.on')).map((x) => x.dataset.cid);
          e.links = e.links || { chars: [], places: [] };
          e.links[key] = ids;
          Store.touch();
        };
      });
    };
    pick('#weChars', 'chars');
    pick('#wePlaces', 'places');

    mask.querySelector('#weDone').onclick = () => {
      Modal.close();
      App.rerender();
    };
    mask.querySelector('#weDel').onclick = () => {
      if (!confirm(`删除「${e.name || '未命名'}」？`)) return;
      Store.worldEntries().splice(idx, 1);
      Store.touch();
      Modal.close();
      App.rerender();
    };
    const undoBtn = mask.querySelector('#weUndoExpand');
    if (undoBtn) undoBtn.onclick = () => {
      const rec = this._lastExpand;
      if (!rec || rec.id !== e.id) return;
      if (!confirm('恢复到这次 AI 扩充之前的内容？\n扩充之后你手动改动的文字也会一并还原。')) return;
      e.name = rec.before.name;
      e.desc = rec.before.desc;
      e.detail = rec.before.detail;
      e.tags = rec.before.tags.slice();
      Store.touch();
      this._lastExpand = null;
      Modal.close();
      App.rerender();
      this.edit(e.id);
    };

    mask.querySelector('#weExpand').onclick = async () => {
      const btn = mask.querySelector('#weExpand');
      const before = {
        name: e.name, desc: e.desc, detail: e.detail,
        tags: Array.isArray(e.tags) ? e.tags.slice() : []
      };
      AIUndo.label(`世界观 · AI 扩充「${e.name || '未命名'}」`);
      btn.disabled = true;
      btn.textContent = '推演中…';
      try {
        const o = await LLM.json({ messages: Prompts.expandWorldEntry({ entry: e }), temperature: 0.7 });
        const base = String(before.detail || '').trim();
        const extra = String((o && o.detail) || '').trim();
        // 兜底：模型没带上原文时把原文原样接回去，绝不丢作者写的内容
        e.detail = extra ? (base && extra.indexOf(base) !== 0 ? base + '\n\n' + extra : extra) : base;
        if (o && Array.isArray(o.tags) && o.tags.length) {
          const tags = before.tags.slice();
          o.tags.forEach((t) => { const s = String(t || '').trim(); if (s && !tags.includes(s)) tags.push(s); });
          e.tags = tags;
        }
        // 名称与一句话一律不动
        e.name = before.name;
        e.desc = before.desc;
        Store.touch();
        this._lastExpand = { id: e.id, before };
        Modal.close();
        App.rerender();
        this.edit(e.id);
        toast('已在你的原文后补写，右下角「撤销」或弹窗里「撤销本次扩充」都能还原');
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
        btn.textContent = 'AI 扩充这一条';
      }
    };
  },

  async genWorld() {
    AIUndo.label('世界观 · AI 生成世界观');
    const btn = $('#btnWorldGen');
    const has = Store.worldEntries().length;
    if (has && !confirm('会在现有条目基础上补全（不会删除你写的）。继续？')) return;
    btn.disabled = true;
    btn.textContent = '推演中…';
    try {
      const o = await LLM.json({ messages: Prompts.genWorld(), temperature: 0.92, maxTokens: 3000 });
      const items = o.entries || [];
      if (!items.length) throw new Error('模型没有返回条目');
      const existing = new Set(Store.worldEntries().map((e) => e.name));
      let added = 0;
      items.forEach((raw) => {
        const name = String(raw.name || '').trim();
        if (!name || existing.has(name)) return;
        existing.add(name);
        Store.worldEntries().push({
          id: uid('we'),
          cat: WORLD_CAT_MAP[raw.cat] ? raw.cat : '势力',
          name,
          desc: raw.desc || '',
          detail: raw.detail || '',
          weight: Number(raw.weight) || 2,
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          links: { chars: [], places: [] }
        });
        added++;
      });
      Store.touch();
      App.rerender();
      toast(added ? `新增 ${added} 条世界观条目` : '模型返回的条目都已有，没有新增');
    } catch (e) {
      toast(e.message, 'err');
    }
    btn.disabled = false;
    btn.textContent = 'AI 生成世界观';
  }
};
