/* ============ view-settings.js ============ */
window.Views = window.Views || {};

const API_PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0905-preview' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' }
];

const IMAGE_PRESETS = [
  { name: 'OpenAI', imageBaseUrl: 'https://api.openai.com/v1', imageModel: 'gpt-image-1' },
  { name: '智谱 CogView', imageBaseUrl: 'https://open.bigmodel.cn/api/paas/v4', imageModel: 'cogview-3-flash' },
  { name: 'SiliconFlow', imageBaseUrl: 'https://api.siliconflow.cn/v1', imageModel: 'Kwai-Kolors/Kolors' },
  { name: '豆包 Seedream', imageBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3', imageModel: 'doubao-seedream-3-0-t2i-250415' }
];

/* 场景 → 说明。空值 = 跟随默认配置 */
const USAGE_DEFS = [
  { key: 'polish', label: 'AI 润色 · 成文', hint: '写作页的润色、辅导、开演成文——建议给文笔最好的模型' },
  { key: 'interview', label: '角色对话 · 访谈', hint: '问答和开演对话——便宜快速的模型就够' },
  { key: 'image', label: '图像生成', hint: '地图建筑写实图——用支持画图的接口' }
];

Views.settings = {
  title: '设置',
  sub: 'API 与数据',
  _edit: null, // 正在编辑/新建的配置（null = 没开编辑器）

  actions() {
    return '';
  },

  profiles() {
    return Array.isArray(Store.settings.profiles) ? Store.settings.profiles : [];
  },
  currentId() {
    const list = this.profiles();
    return list.some((p) => p.id === Store.settings.currentProfile)
      ? Store.settings.currentProfile
      : (list[0] ? list[0].id : '');
  },
  usageMap() {
    return Object.assign({ polish: '', interview: '', image: '' }, Store.settings.usage || {});
  },

  mount(el) {
    const s = Store.settings;
    const list = this.profiles();
    const curId = this.currentId();
    const usage = this.usageMap();

    const profName = (id) => {
      const p = list.find((x) => x.id === id);
      return p ? p.name : '默认配置';
    };

    const editorHtml = this._edit ? `
      <div class="prof-editor" id="profEditor">
        <div class="sec-title">${this._edit.isNew ? '新增配置' : '编辑「' + esc(this._edit.name || '未命名') + '」'}</div>
        <label class="fld"><span>配置名称</span>
          <input type="text" id="pfName" value="${esc(this._edit.name || '')}" placeholder="比如：便宜跑量 / 文笔担当">
        </label>
        <div class="presets">
          ${API_PRESETS.map((p, i) => `<button class="btn sm" data-preset="${i}">${p.name}</button>`).join('')}
        </div>
        <div class="hint" style="margin-bottom:12px">任何 OpenAI 兼容接口都可以用，点上面的按钮自动填地址和模型名。</div>
        <label class="fld"><span>API 地址（Base URL）</span>
          <input type="text" id="pfBase" value="${esc(this._edit.baseUrl || '')}" placeholder="https://api.deepseek.com/v1">
        </label>
        <label class="fld"><span>API Key</span>
          <input type="password" id="pfKey" value="" placeholder="${this._edit.hasKey ? '已保存 ' + esc(this._edit.apiKeyMasked || '') + '，留空则不修改' : 'sk-…'}">
        </label>
        <div class="row">
          <label class="fld"><span>模型名</span>
            <input type="text" id="pfModel" value="${esc(this._edit.model || '')}" placeholder="deepseek-chat">
          </label>
          <label class="fld" style="flex:0 0 130px"><span>温度</span>
            <input type="number" id="pfTemp" step="0.05" min="0" max="2" value="${this._edit.temperature ?? 0.9}">
          </label>
        </div>
        <label class="fld" style="margin-bottom:0"><span>单次最大 tokens</span>
          <input type="number" id="pfMax" min="256" max="16000" step="256" value="${this._edit.maxTokens ?? 2048}">
          <div class="hint">成文时建议 2000 以上，否则正文会被截断。</div>
        </label>

        <div class="divider" style="margin:14px 0"></div>
        <div class="sec-title">图像接口（可选）</div>
        <div class="presets">
          ${IMAGE_PRESETS.map((p, i) => `<button class="btn sm" data-imgpreset="${i}">${p.name}</button>`).join('')}
        </div>
        <div class="hint" style="margin-bottom:12px">用于生成建筑写实图。留空则默认使用这套配置的对话接口。</div>
        <label class="fld"><span>图像 API 地址</span>
          <input type="text" id="pfImgBase" value="${esc(this._edit.imageBaseUrl || '')}" placeholder="默认与对话接口相同">
        </label>
        <label class="fld"><span>图像 API Key</span>
          <input type="password" id="pfImgKey" value="" placeholder="${this._edit.hasImageKey ? '已保存 ' + esc(this._edit.imageApiKeyMasked || '') + '，留空则不修改' : '留空则使用对话接口的 Key'}">
        </label>
        <div class="row">
          <label class="fld"><span>图像模型</span>
            <input type="text" id="pfImgModel" value="${esc(this._edit.imageModel || '')}" placeholder="如 cogview-3-flash">
          </label>
          <label class="fld" style="flex:0 0 130px"><span>尺寸</span>
            <select id="pfImgSize">
              <option ${(this._edit.imageSize || '1024x1024') === '1024x1024' ? 'selected' : ''}>1024x1024</option>
              <option ${this._edit.imageSize === '1024x1792' ? 'selected' : ''}>1024x1792</option>
              <option ${this._edit.imageSize === '1792x1024' ? 'selected' : ''}>1792x1024</option>
              <option ${this._edit.imageSize === '512x512' ? 'selected' : ''}>512x512</option>
            </select>
          </label>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn primary" id="pfSave">保存这套配置</button>
          <button class="btn" id="pfTest">测试连接</button>
          <button class="btn ghost" id="pfCancel">取消</button>
        </div>
      </div>` : '';

    const listHtml = list.length ? list.map((p) => `
      <div class="prof-row${p.id === curId ? ' cur' : ''}" data-id="${esc(p.id)}">
        <div class="prof-info">
          <b>${esc(p.name || '未命名')}${p.id === curId ? '<span class="prof-badge">默认</span>' : ''}</b>
          <span class="muted">${esc(shortUrl(p.baseUrl || '未填地址'))} · ${esc(p.model || '未填模型')}</span>
        </div>
        <div class="prof-ops">
          ${p.id === curId ? '' : `<button class="btn sm" data-use="${esc(p.id)}">设为默认</button>`}
          <button class="btn sm" data-edit="${esc(p.id)}">编辑</button>
          <button class="btn sm" data-dup="${esc(p.id)}">复制</button>
          <button class="btn sm danger" data-del="${esc(p.id)}">删除</button>
        </div>
      </div>`).join('') : '<div class="hint" style="padding:6px 0">还没有配置，先新增一套。</div>';

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:18px;align-items:start">
        <div>
          <div class="card pad" style="margin-bottom:16px">
            <div class="sec-title" style="display:flex;justify-content:space-between;align-items:center">
              <span>API 配置（可存多套）</span>
              <button class="btn sm" id="btnAddProf">＋ 新增一套</button>
            </div>
            <div class="prof-list">${listHtml}</div>
            <div class="hint" style="margin-top:10px">同时接入多家模型：比如一套便宜的跑日常对话，一套文笔好的专管润色成文。Key 只存在本机，不会外传。</div>
            ${editorHtml}
          </div>

          <div class="card pad" style="margin-bottom:16px">
            <div class="sec-title">场景调用</div>
            <div class="hint" style="margin-bottom:12px">不同活儿可以点不同的模型。没单独指定的场景（大纲 · 世界观 · 导入等）都用默认配置。</div>
            ${USAGE_DEFS.map((u) => `
              <label class="fld"><span>${u.label}</span>
                <select data-usage="${u.key}">
                  <option value="">跟随默认（${esc(profName(curId))}）</option>
                  ${list.map((p) => `<option value="${esc(p.id)}" ${usage[u.key] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
                </select>
                <div class="hint">${u.hint}</div>
              </label>`).join('')}
          </div>

          <div class="card pad">
            <div class="sec-title">数据</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn" id="btnExport2">导出项目 JSON</button>
              <button class="btn" id="btnImport">导入项目</button>
              <button class="btn danger" id="btnReset">清空并重建示例</button>
            </div>
            <div class="hint" style="margin-top:10px">项目数据存在 <code>moge/data/project.json</code>，每次保存都会自动留一份 .bak 备份。</div>
          </div>
        </div>

        <div>
          <div class="card pad" style="margin-bottom:16px">
            <div class="sec-title">外观</div>
            <label class="fld"><span>首页背景</span>
              <select id="cfgBg">
                <option value="cinema" ${s.bg === 'cinema' ? 'selected' : ''}>墨阁壁纸（黄昏天台 · 视频背景）</option>
                <option value="wallpaper" ${(s.bg || 'wallpaper') === 'wallpaper' ? 'selected' : ''}>跟随系统壁纸（用我电脑当前的桌面壁纸）</option>
                <option value="paper" ${s.bg === 'paper' ? 'selected' : ''}>素雅纸纹（不铺照片，最专注）</option>
              </select>
            </label>
            <button class="btn sm" id="btnSaveBg" style="margin-top:10px">保存外观</button>
            <div class="hint">「墨阁壁纸」会播放 <code>public/wallpaper/moge-cinema.mp4</code>；把 mp4 删掉就只用同名的 .jpg 静态图，照样好看也更省电。</div>
          </div>

          <div class="card pad" style="margin-bottom:16px">
            <div class="sec-title">当前状态</div>
            <div class="kv"><span class="muted">默认配置</span><b>${esc(profName(curId))}</b></div>
            <div class="kv"><span class="muted">默认模型</span><b>${(() => { const p = list.find((x) => x.id === curId); return p && p.model ? esc(p.model) : '—'; })()}</b></div>
            ${USAGE_DEFS.map((u) => `<div class="kv"><span class="muted">${u.label}</span><b>${usage[u.key] ? esc(profName(usage[u.key])) : '跟随默认'}</b></div>`).join('')}
            <div class="kv"><span class="muted">人物 / 场景 / 正文</span><b>${Store.data.characters.length} / ${countScenes()} / ${Store.data.manuscript.length}</b></div>
          </div>

          <div class="card pad">
            <div class="sec-title">怎么用</div>
            <ol style="margin:0;padding-left:18px;font-size:12.5px;line-height:2;color:var(--ink-2)">
              <li>「API 配置」里存好几套接口，选一套设为默认</li>
              <li>「场景调用」里给润色、角色对话、画图各点一套</li>
              <li>「项目」里写世界观和文风，贴一段参考文段</li>
              <li>「人物」里把性格锁死——这是整套系统不跑偏的关键</li>
              <li>「写作」给一句情节开演，再点成文，右下角随时撤销</li>
            </ol>
            <div class="divider"></div>
            <div class="small muted" style="line-height:1.9">
              每次开演 = 1 次导演调用 + 每轮 1 次角色调用。<br>
              建筑图生成：程序绘图走对话接口；AI 写实图走图像接口。
            </div>
          </div>
        </div>
      </div>`;

    /* ---- 配置列表操作 ---- */
    $('#btnAddProf').onclick = () => {
      this._edit = {
        isNew: true, id: '', name: '', baseUrl: '', apiKey: '', model: '',
        temperature: 0.9, maxTokens: 2048,
        imageBaseUrl: '', imageApiKey: '', imageModel: '', imageSize: '1024x1024'
      };
      App.rerender();
      const t = $('#profEditor'); if (t) t.scrollIntoView({ block: 'center' });
    };
    el.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => {
        const p = list.find((x) => x.id === b.dataset.edit);
        if (!p) return;
        this._edit = {
          isNew: false, id: p.id, name: p.name || '', baseUrl: p.baseUrl || '', model: p.model || '',
          temperature: p.temperature ?? 0.9, maxTokens: p.maxTokens ?? 2048,
          imageBaseUrl: p.imageBaseUrl || '', imageModel: p.imageModel || '', imageSize: p.imageSize || '1024x1024',
          hasKey: !!p.hasKey, apiKeyMasked: p.apiKeyMasked || '', hasImageKey: !!p.hasImageKey, imageApiKeyMasked: p.imageApiKeyMasked || ''
        };
        App.rerender();
        const t = $('#profEditor'); if (t) t.scrollIntoView({ block: 'center' });
      };
    });
    el.querySelectorAll('[data-use]').forEach((b) => {
      b.onclick = async () => {
        await Store.saveSettings({ currentProfile: b.dataset.use });
        toast('已设为默认配置');
        App.rerender();
      };
    });
    el.querySelectorAll('[data-dup]').forEach((b) => {
      b.onclick = async () => {
        const p = list.find((x) => x.id === b.dataset.dup);
        if (!p) return;
        const copy = Object.assign({}, p, { id: uid('p'), name: (p.name || '未命名') + ' 副本' });
        // 副本不带 Key（服务端只认 id，新 id 没有旧 Key 可沿用）
        const profiles = this.profiles().concat([copy]);
        await Store.saveSettings({ profiles });
        toast('已复制一套，记得点「编辑」补上 Key');
        App.rerender();
      };
    });
    el.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const p = list.find((x) => x.id === b.dataset.del);
        if (!p) return;
        if (list.length <= 1) return toast('至少要留一套配置', 'err');
        if (!confirm('删除配置「' + (p.name || '未命名') + '」？使用它的场景会退回默认配置。')) return;
        let profiles = list.filter((x) => x.id !== p.id);
        const usage = this.usageMap();
        const nextUsage = {};
        Object.keys(usage).forEach((k) => { nextUsage[k] = usage[k] === p.id ? '' : usage[k]; });
        const patch = { profiles, usage: nextUsage };
        if (this.currentId() === p.id) patch.currentProfile = profiles[0].id;
        await Store.saveSettings(patch);
        toast('已删除');
        App.rerender();
      };
    });

    /* ---- 编辑器 ---- */
    if (this._edit) {
      el.querySelectorAll('[data-preset]').forEach((b) => {
        b.onclick = () => {
          const p = API_PRESETS[Number(b.dataset.preset)];
          $('#pfBase').value = p.baseUrl;
          $('#pfModel').value = p.model;
        };
      });
      el.querySelectorAll('[data-imgpreset]').forEach((b) => {
        b.onclick = () => {
          const p = IMAGE_PRESETS[Number(b.dataset.imgpreset)];
          $('#pfImgBase').value = p.imageBaseUrl;
          $('#pfImgModel').value = p.imageModel;
        };
      });
      $('#pfCancel').onclick = () => { this._edit = null; App.rerender(); };
      $('#pfSave').onclick = () => this.saveEditor();
      $('#pfTest').onclick = () => this.testEditor();
    }

    /* ---- 场景调用 ---- */
    el.querySelectorAll('[data-usage]').forEach((sel) => {
      sel.onchange = async () => {
        const usage = this.usageMap();
        usage[sel.dataset.usage] = sel.value;
        await Store.saveSettings({ usage });
        toast('已切换：' + (sel.value ? this.profiles().find((p) => p.id === sel.value)?.name : '跟随默认'));
        App.rerender();
      };
    });

    /* ---- 外观 / 数据 ---- */
    $('#btnSaveBg').onclick = async () => {
      await Store.saveSettings({ bg: $('#cfgBg').value });
      toast('外观已保存');
      document.body.dataset.bg = $('#cfgBg').value;
    };
    $('#btnExport2').onclick = exportProject;
    $('#btnReset').onclick = async () => {
      if (!confirm('会清空当前所有人物、大纲、正文，重建示例项目。确定？')) return;
      Store.data = seedProject();
      await Store.save(true);
      location.reload();
    };
    $('#btnImport').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json';
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        try {
          const obj = JSON.parse(await f.text());
          if (!obj.meta) throw new Error('不是有效的项目文件');
          Store.data = obj;
          await Store.save(true);
          toast('已导入');
          location.reload();
        } catch (e) {
          toast('导入失败：' + e.message, 'err');
        }
      };
      inp.click();
    };
  },

  collectEditor() {
    return {
      id: this._edit.id,
      name: $('#pfName').value.trim() || '未命名',
      baseUrl: $('#pfBase').value.trim(),
      model: $('#pfModel').value.trim(),
      temperature: Number($('#pfTemp').value) || 0.9,
      maxTokens: Number($('#pfMax').value) || 2048,
      apiKey: $('#pfKey').value.trim(),
      imageBaseUrl: $('#pfImgBase').value.trim(),
      imageApiKey: $('#pfImgKey').value.trim(),
      imageModel: $('#pfImgModel').value.trim(),
      imageSize: $('#pfImgSize').value
    };
  },

  async saveEditor() {
    const e = this.collectEditor();
    if (!e.baseUrl) return toast('API 地址不能为空', 'err');
    if (!e.model) return toast('模型名不能为空', 'err');
    const list = this.profiles();
    const i = list.findIndex((p) => p.id === e.id);
    const patch = {};
    if (i >= 0) {
      const profiles = list.slice();
      profiles[i] = Object.assign({}, list[i], e);
      patch.profiles = profiles;
    } else {
      e.id = uid('p');
      patch.profiles = list.concat([e]);
      // 新增的第一套自动成为默认
      if (!this.currentId()) patch.currentProfile = e.id;
    }
    await Store.saveSettings(patch);
    this._edit = null;
    toast('配置已保存');
    App.rerender();
  },

  async testEditor() {
    const e = this.collectEditor();
    if (!e.baseUrl || !e.model) return toast('先把地址和模型名填上', 'err');
    const btn = $('#pfTest');
    btn.disabled = true;
    btn.textContent = '连接中…';
    try {
      const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: e.baseUrl,
          model: e.model,
          apiKey: e.apiKey || undefined,
          profile: this._edit.id || undefined,
          messages: [{ role: 'user', content: '只回复两个字：可用' }],
          maxTokens: 20,
          temperature: 0
        })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || '失败');
      const c = j.choices?.[0]?.message?.content || '';
      toast('连接成功：' + (c || 'OK').slice(0, 20));
    } catch (err) {
      toast(err.message, 'err');
    }
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
};
