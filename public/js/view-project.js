/* ============ view-project.js ============ */
window.Views = window.Views || {};

Views.project = {
  title: '项目',
  sub: '世界观 · 文风 · 起点',
  actions() {
    return `<button class="btn" id="btnExport">导出项目</button>`;
  },
  mount(el) {
    const d = Store.data;
    const steps = this.publishPath();
    const nextStep = steps.find((s) => !s.done) || null;
    const hints = {
      project: '先给作品起名、写一句核心，模型才知道整本书在讲什么。',
      world: '去搭世界观与人物：先定 3 条以上核心设定，再建 2 位以上角色和至少一个地点。',
      outline: '在「大纲」让 AI 帮你搭卷·章·场景，或自己写。',
      write: '进入「写作」，只给一句情节，看角色自己演，再「成文」。',
      manuscript: '在「书稿」通读批注、标记定稿，然后导出全书。'
    };
    const sp = d.styleProfile || null;
    el.innerHTML = `
      <div class="card pad pp-card" style="margin-bottom:18px">
        <div class="sec-title">出书路径 <span class="small muted" style="font-family:var(--sans);letter-spacing:0;margin-left:8px">从立项到出书，跟着走</span></div>
        <div class="pp">
          ${steps
            .map(
              (s, i) => `
            <div class="pp-step ${s.done ? 'done' : ''} ${nextStep && nextStep.key === s.key ? 'next' : ''}" data-go="${s.key}">
              <div class="pp-dot">${s.done ? '✓' : i + 1}</div>
              <div class="pp-label">${s.label}</div>
            </div>
            ${i < steps.length - 1 ? `<div class="pp-line ${s.done ? 'done' : ''}"></div>` : ''}`
            )
            .join('')}
        </div>
        <div class="pp-hint">
          ${
            nextStep
              ? `下一步 · <b>${nextStep.label}</b>：${hints[nextStep.key]}`
              : '🎉 所有阶段已完成，去「书稿」做出版前检查或导出全书。'
          }
        </div>
      </div>

      <div style="display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:18px;align-items:start">
        <div>
          <div class="card pad" style="margin-bottom:16px">
            <div class="sec-title">作品</div>
            <label class="fld"><span>书名</span>
              <input type="text" data-bind="meta.title" data-live value="${esc(d.meta.title)}" placeholder="未命名作品">
            </label>
            <div class="row">
              <label class="fld"><span>类型 / 题材</span>
                <input type="text" data-bind="meta.genre" data-live value="${esc(d.meta.genre)}" placeholder="例：民国 · 悬疑">
              </label>
            </div>
            <label class="fld"><span>一句话核心</span>
              <textarea data-bind="meta.logline" data-live rows="2" placeholder="谁，在什么处境下，要做什么，被什么挡住">${esc(d.meta.logline)}</textarea>
              <div class="hint">这句话会出现在所有提示词的最前面，决定模型对故事的整体理解。</div>
            </label>
          </div>

          <div class="card pad" style="margin-bottom:16px">
            <div class="sec-title">世界观
              <span class="small muted" style="font-family:var(--sans);letter-spacing:0;margin-left:auto">
                ${(d.world.entries || []).length} 条设定
              </span>
            </div>
            <div class="world-brief">${esc(d.world.setting || '还没有世界观。去「世界观」页搭一个：先定势力，还是先定地理？')}</div>
            ${d.world.tone ? `<div style="margin-top:10px"><span class="chip">基调 · ${esc(d.world.tone)}</span></div>` : ''}
            <div style="margin-top:14px;display:flex;gap:8px">
              <button class="btn sm primary" id="goWorld">进入世界观构建 →</button>
              <button class="btn sm" id="goMap">看地图</button>
            </div>
          </div>

          <div class="card pad">
            <div class="sec-title">文风 + 笔风档案（决定最终成文的样子）</div>
            <div class="row">
              <label class="fld"><span>叙述视角</span>
                <input type="text" data-bind="style.pov" data-live value="${esc(d.style.pov)}" placeholder="第三人称限知 / 第一人称">
              </label>
              <label class="fld"><span>时态</span>
                <input type="text" data-bind="style.tense" data-live value="${esc(d.style.tense)}" placeholder="过去时">
              </label>
            </div>
            <label class="fld"><span>笔调</span>
              <input type="text" data-bind="style.tone" data-live value="${esc(d.style.tone)}" placeholder="例：短句为主，白描，少形容词">
            </label>
            <label class="fld" style="margin-bottom:0"><span>参考文段（仿其节奏，不抄句子）</span>
              <textarea data-bind="style.sample" data-live rows="4" placeholder="贴一段你想要的语感，效果非常明显">${esc(d.style.sample)}</textarea>
            </label>

            <div class="sp-wrap">
              <div class="sp-head">
                <span class="sp-title">笔风档案</span>
                <span class="small muted">${sp ? '已从原文抽取 · 写作时优先遵循' : '还没有档案'}</span>
              </div>
              ${this._styleProfileBody(sp)}
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
                <button class="btn sm primary" id="btnReStyle">从原文重抽笔风</button>
                ${sp ? `<button class="btn sm" id="btnEditStyle">手动微调</button>
                         <button class="btn sm" id="btnApplyStyle">覆盖到上方文风</button>
                         <button class="btn sm danger" id="btnClearStyle">清掉档案</button>` : ''}
              </div>
              <div class="hint" style="margin-top:8px">「重抽」会读取本书已存的原文（书源导入过的 .txt），重新分析并覆盖档案；没有原文时可用手动微调直接写。</div>
            </div>
          </div>
        </div>

        <div>
          <div class="card pad" style="margin-bottom:16px">
            <div class="sec-title">进度</div>
            <div class="kv"><span class="muted">世界观</span><b>${(d.world.entries || []).length} 条设定</b></div>
            <div class="kv"><span class="muted">人物</span><b>${d.characters.length} 位</b></div>
            <div class="kv"><span class="muted">地点</span><b>${d.map.nodes.length} 处</b></div>
            <div class="kv"><span class="muted">道具</span><b>${(d.inventory || []).length} 件</b></div>
            <div class="kv"><span class="muted">场景</span><b>${countScenes()} 个</b></div>
            <div class="kv"><span class="muted">已成文</span><b>${d.manuscript.length} 章 · ${totalWords()} 字</b></div>
          </div>

          <div class="card pad" style="margin-bottom:16px">
            <div class="sec-title">下一步</div>
            ${
              nextStep
                ? `<p class="small" style="line-height:1.8;color:var(--ink-2);margin:0 0 12px">${esc(hints[nextStep.key])}</p>
                   <button class="btn primary" id="goNext" style="width:100%">去做：${esc(nextStep.label)} →</button>`
                : `<p class="small" style="line-height:1.8;color:var(--ink-2);margin:0 0 12px">所有阶段都已完成。去「书稿」做出版前一致性检查、通读批注、标记定稿，然后导出全书 TXT / 排版稿。</p>
                   <button class="btn primary" id="goNext" style="width:100%">去书稿做出版前检查 →</button>`
            }
          </div>

          <div class="card pad">
            <div class="sec-title">API 状态</div>
            <div class="kv"><span class="muted">服务</span><b>${Store.settings.baseUrl ? esc(shortUrl(Store.settings.baseUrl)) : '<span style="color:var(--accent)">未配置</span>'}</b></div>
            <div class="kv"><span class="muted">模型</span><b>${Store.settings.model ? esc(Store.settings.model) : '—'}</b></div>
            <div class="kv"><span class="muted">密钥</span><b>${Store.settings.apiKeyMasked || '—'}</b></div>
            <div style="margin-top:12px"><button class="btn sm" id="goSettings">去设置</button></div>
          </div>
        </div>
      </div>`;

    bindInputs(el);
    const gn = $('#goNext', el);
    if (gn) gn.onclick = () => App.go(nextStep ? nextStep.key : 'manuscript');
    el.querySelectorAll('.pp-step[data-go]').forEach((s) => (s.onclick = () => App.go(s.dataset.go)));
    $('#goSettings', el).onclick = () => App.go('settings');
    $('#goWorld', el).onclick = () => App.go('world');
    $('#goMap', el).onclick = () => App.go('map');
    const b = $('#btnExport');
    if (b) b.onclick = exportProject;
    const bs = $('#btnReStyle', el);
    if (bs) bs.onclick = () => this.reextractStyle();
    const be = $('#btnEditStyle', el);
    if (be) be.onclick = () => this.editStyleProfile();
    const ba = $('#btnApplyStyle', el);
    if (ba) ba.onclick = () => this.applyProfileToStyle();
    const bc = $('#btnClearStyle', el);
    if (bc) bc.onclick = () => {
      if (!confirm('清掉笔风档案？成文将只依赖上方「文风」字段。')) return;
      Store.data.styleProfile = null;
      Store.save(true);
      App.render();
      toast('已清掉笔风档案');
    };
  },

  /* ---------- 笔风档案 ---------- */
  _styleProfileBody(sp) {
    if (!sp) {
      return `<div class="small muted">从「书源」导入小说时会自动抽一份；也可以现在从已存的原文重抽，或手动填写。</div>`;
    }
    const rows = [
      ['视角', sp.pov], ['句式', sp.sentence], ['节奏', sp.rhythm],
      ['对话', sp.dialogue], ['描写', sp.description], ['心理', sp.psychology],
      ['词汇', sp.vocabulary], ['标点', sp.punctuation]
    ].filter((r) => r[1]);
    const habits = Array.isArray(sp.habits) ? sp.habits.filter(Boolean) : [];
    const avoid = Array.isArray(sp.avoid) ? sp.avoid.filter(Boolean) : [];
    return `
      ${rows.length ? `<div class="sp-grid">${rows.map((r) => `<div class="sp-kv"><span>${r[0]}</span><b>${esc(r[1])}</b></div>`).join('')}</div>` : ''}
      ${habits.length ? `<div class="sp-sub">高频词 / 口头禅</div><div class="chips">${habits.map((h) => `<span class="chip">${esc(h)}</span>`).join('')}</div>` : ''}
      ${avoid.length ? `<div class="sp-sub">禁忌（不要这样写）</div><div class="chips">${avoid.map((h) => `<span class="chip" style="--c:#a63a2a">${esc(h)}</span>`).join('')}</div>` : ''}
      ${sp.sample ? `<div class="sp-sub">模仿样本</div><div class="world-brief">${esc(sp.sample)}</div>` : ''}`;
  },

  /** 从本书已存的原文重新抽取笔风 */
  async reextractStyle() {
    const id = Store.currentBookId;
    let text = '';
    try {
      const r = await fetch(`/api/book/${encodeURIComponent(id)}/novel`);
      const j = await r.json().catch(() => null);
      text = (j && j.text) || '';
    } catch (e) {}
    if (!text || text.length < 200) {
      return toast('这本书还没有存原文，请先到「书源」上传 .txt', 'err');
    }
    AIUndo.label('项目 · AI 抽取文风');
    const btn = document.getElementById('btnReStyle');
    if (btn) { btn.disabled = true; btn.textContent = '抽取中…'; }
    try {
      const seg = 4000;
      const samples = [
        '【开头】\n' + text.slice(0, seg),
        '【中段】\n' + text.slice(Math.floor(text.length * 0.4), Math.floor(text.length * 0.4) + seg),
        '【后段】\n' + text.slice(Math.max(0, text.length - seg))
      ].join('\n\n');
      const o = await LLM.json({
        messages: Prompts.importStyle({ samples, novelTitle: Store.data.meta.title }),
        temperature: 0.35,
        maxTokens: 1800
      });
      if (!o || !o.sentence) throw new Error('模型返回不完整');
      Store.data.styleProfile = o;
      // 顺手同步上方文风字段，保证两处一致
      if (o.pov) Store.data.style.pov = o.pov;
      if (o.tense) Store.data.style.tense = o.tense;
      if (o.sample && !Store.data.style.sample) Store.data.style.sample = o.sample;
      Store.save(true);
      App.render();
      toast('笔风已重抽');
    } catch (e) {
      toast(e.message || '抽取失败', 'err');
    }
    if (btn) { btn.disabled = false; btn.textContent = '从原文重抽笔风'; }
  },

  /** 手动微调笔风档案 */
  editStyleProfile() {
    const d = Store.data;
    const sp = d.styleProfile || {};
    const F = [
      ['pov', '视角', 1], ['tense', '时态', 1], ['sentence', '句式', 2],
      ['rhythm', '段落节奏', 2], ['dialogue', '对话', 2], ['description', '描写', 2],
      ['psychology', '心理描写', 2], ['vocabulary', '词汇层', 2], ['punctuation', '标点', 2]
    ];
    const mask = Modal.open({
      title: '微调笔风',
      body: `
        <div class="hint" style="margin-bottom:12px">写得越具体，成文越像。留空的条目不会进提示词。</div>
        ${F.map(([k, label, rows]) => `
          <label class="fld"><span>${label}</span>
            <textarea data-sp="${k}" rows="${rows}" placeholder="${label}">${esc(sp[k] || '')}</textarea></label>`).join('')}
        <label class="fld"><span>高频词 / 口头禅（一行一个）</span>
          <textarea data-sp="habits" rows="3" placeholder="逐字照抄原文里反复出现的词">${esc((sp.habits || []).join('\n'))}</textarea></label>
        <label class="fld"><span>禁忌（一行一条：这部作品不做的事）</span>
          <textarea data-sp="avoid" rows="3" placeholder="例：从不写大段心理">${esc((sp.avoid || []).join('\n'))}</textarea></label>
        <label class="fld" style="margin-bottom:0"><span>模仿样本（手写一段，模型会照着学）</span>
          <textarea data-sp="sample" rows="4" placeholder="150 字左右">${esc(sp.sample || '')}</textarea></label>`,
      footer: `<div style="flex:1"></div><button class="btn primary" id="spSave">保存</button>`
    });
    mask.querySelector('#spSave').onclick = () => {
      const out = Object.assign({}, sp);
      F.forEach(([k]) => { out[k] = (mask.querySelector(`[data-sp="${k}"]`) || {}).value || ''; });
      const lines = (sel) => String((mask.querySelector(`[data-sp="${sel}"]`) || {}).value || '')
        .split('\n').map((s) => s.trim()).filter(Boolean);
      out.habits = lines('habits');
      out.avoid = lines('avoid');
      out.sample = (mask.querySelector('[data-sp="sample"]') || {}).value || '';
      d.styleProfile = out;
      Store.save(true);
      Modal.close();
      App.render();
      toast('笔风已更新');
    };
  },

  /** 把档案里的视角/时态/样本覆盖到上方文风字段 */
  applyProfileToStyle() {
    const sp = Store.data.styleProfile;
    if (!sp) return;
    if (sp.pov) Store.data.style.pov = sp.pov;
    if (sp.tense) Store.data.style.tense = sp.tense;
    if (sp.sentence) Store.data.style.tone = sp.sentence;
    if (sp.sample) Store.data.style.sample = sp.sample;
    Store.save(true);
    App.render();
    toast('已用笔风档案覆盖文风字段');
  },

  publishPath() {
    const d = Store.data;
    if (!d) return [];
    const worldOk = (d.world.entries || []).length >= 3;
    const charOk = d.characters.length >= 2;
    const mapOk = d.map.nodes.length >= 1;
    const sceneOk = countScenes() >= 1;
    const msOk = d.manuscript.length >= 1;
    const doneOk = d.manuscript.some((m) => m.status === 'done');
    return [
      { key: 'project', label: '立项起名', done: !!(d.meta.title && d.meta.logline) },
      { key: 'world', label: '搭世界观·人物', done: worldOk && charOk && mapOk },
      { key: 'outline', label: '写大纲场景', done: sceneOk },
      { key: 'write', label: '角色对话·开演成文', done: msOk },
      { key: 'manuscript', label: '通读·定稿·导出', done: doneOk }
    ];
  }
};

function countScenes() {
  let n = 0;
  (Store.data.outline.volumes || []).forEach((v) => (v.chapters || []).forEach((c) => (n += (c.scenes || []).length)));
  return n;
}
function totalWords() {
  return Store.data.manuscript.reduce((a, m) => a + (m.text || '').replace(/\s/g, '').length, 0);
}
function shortUrl(u) {
  return String(u).replace(/^https?:\/\//, '').replace(/\/v1\/?$/, '');
}
function exportProject() {
  const blob = new Blob([JSON.stringify(Store.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (Store.data.meta.title || 'project') + '-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  toast('项目已导出');
}
