/* ============ view-manuscript.js —— 书稿总览 / 批注 / 一致性检查 ============ */
window.Views = window.Views || {};

Views.manuscript = {
  title: '书稿',
  sub: '汇编 · 通读 · 批注 · 出版前检查',
  tab: 'overview',
  selId: null,
  viewAll: false,
  _checkBusy: false,

  actions() {
    return `<button class="btn" id="btnExportBook">导出全书</button>`;
  },

  /* ---------- 组装：把正文按大纲顺序排好 ---------- */
  sceneExists(id) {
    const vols = Store.data.outline.volumes || [];
    for (const v of vols) for (const c of v.chapters || []) for (const s of c.scenes || []) if (s.id === id) return true;
    return false;
  },
  buildAssembled() {
    const d = Store.data;
    const byScene = {};
    const orphans = [];
    (d.manuscript || []).forEach((m) => {
      if (m.sceneId && this.sceneExists(m.sceneId)) (byScene[m.sceneId] = byScene[m.sceneId] || []).push(m);
      else orphans.push(m);
    });
    const tree = (d.outline.volumes || []).map((v, vi) => ({
      v,
      vi,
      chapters: (v.chapters || []).map((c, ci) => ({
        c,
        ci,
        scenes: (c.scenes || []).map((s, si) => {
          const list = byScene[s.id] || [];
          return { s, vi, ci, si, entry: list[list.length - 1] || null, count: list.length };
        })
      }))
    }));
    return { tree, orphans };
  },
  statusOf(m) {
    return (m && m.status) || '未读';
  },
  dotClass(st) {
    return { none: 'dn', '待改': 'dd', '已定稿': 'do', '未读': 'du' }[st] || 'dn';
  },

  mount(el) {
    el.innerHTML = `
      <div class="ms-tabs">
        <button class="ms-tab ${this.tab === 'overview' ? 'on' : ''}" data-tab="overview">书稿总览</button>
        <button class="ms-tab ${this.tab === 'check' ? 'on' : ''}" data-tab="check">一致性检查</button>
        <span class="ms-tab-sub" id="msTabSub"></span>
      </div>
      <div class="ms-body" id="msBody"></div>`;

    el.querySelectorAll('.ms-tab').forEach((b) => {
      b.onclick = () => {
        this.tab = b.dataset.tab;
        this.mount(el);
      };
    });
    const b = $('#btnExportBook');
    if (b) b.onclick = () => this.exportBook();

    const body = $('#msBody');
    if (this.tab === 'overview') this.renderOverview(body);
    else this.renderCheck(body);
  },

  /* ===================== 总览 ===================== */
  renderOverview(body) {
    const { tree, orphans } = this.buildAssembled();
    const d = Store.data;
    const totalWords = (d.manuscript || []).reduce((a, m) => a + (m.text || '').replace(/\s/g, '').length, 0);
    const counts = { '待改': 0, '已定稿': 0, '未读': 0 };
    (d.manuscript || []).forEach((m) => (counts[this.statusOf(m)] = (counts[this.statusOf(m)] || 0) + 1));

    // 树
    let treeHtml = '';
    if (!tree.length) {
      treeHtml = `<div class="ms-empty">还没有大纲。<br>去「大纲」建场景，或从「写作」成文后存入正文库。</div>`;
    } else {
      treeHtml = tree
        .map(
          (vol) => `
        <div class="ms-vol">
          <div class="ms-vol-t">${esc(vol.v.title || '未命名卷')}</div>
          ${vol.chapters
            .map(
              (ch) => `
            <div class="ms-ch">${esc(ch.c.title || '未命名章')}</div>
            ${ch.scenes
              .map((sc) => {
                const st = sc.entry ? this.statusOf(sc.entry) : 'none';
                return `<div class="ms-scene ${sc.entry ? '' : 'empty'}" data-entry="${sc.entry ? esc(sc.entry.id) : ''}" data-path="${sc.vi}.${sc.ci}.${sc.si}">
                  <span class="ms-dot dot-${this.dotClass(st)}"></span>
                  <span class="ms-sc-t">${esc(sc.s.title || '未命名场景')}</span>
                  ${sc.entry ? `<span class="ms-sc-w">${(sc.entry.text || '').replace(/\s/g, '').length}字</span>` : '<span class="ms-sc-w muted">未成文</span>'}
                </div>`;
              })
              .join('')}`
            )
            .join('')}
        </div>`
        )
        .join('');
    }
    if (orphans.length) {
      treeHtml += `<div class="ms-vol"><div class="ms-vol-t">未归场（自由成文）</div>${orphans
        .map(
          (m) =>
            `<div class="ms-scene" data-entry="${esc(m.id)}"><span class="ms-dot dot-${this.dotClass(this.statusOf(m))}"></span><span class="ms-sc-t">${esc(m.title || '未命名')}</span><span class="ms-sc-w">${(m.text || '').replace(/\s/g, '').length}字</span></div>`
        )
        .join('')}</div>`;
    }

    // 选中正文
    const sel = (d.manuscript || []).find((m) => m.id === this.selId) || null;
    let proseHtml;
    if (sel) {
      proseHtml = `
        <div class="ms-prose-head">
          <h2>${esc(sel.title || '未命名')}</h2>
          <div class="muted small">${(sel.text || '').replace(/\s/g, '').length} 字 · ${this.statusOf(sel)}</div>
        </div>
        <div class="ms-prose-text">${esc(sel.text || '')}</div>`;
    } else {
      proseHtml = `<div class="ms-empty big"><h3>从左侧选一场，开始通读</h3><p class="small">右边可以给每段/每章标「待改 / 已定稿 / 未读」，边读边定稿。</p></div>`;
    }

    // 批注面板
    let annoHtml = `<div class="ms-anno-head">批注 / 状态</div>`;
    if (sel) {
      annoHtml += `
        <div class="ms-stat-row">
          <span class="ms-stat-chip s-draft">待改 <b>${counts['待改']}</b></span>
          <span class="ms-stat-chip s-done">已定稿 <b>${counts['已定稿']}</b></span>
          <span class="ms-stat-chip s-unread">未读 <b>${counts['未读']}</b></span>
        </div>
        <div class="ms-anno-card">
          <div class="small muted" style="margin-bottom:7px">当前状态</div>
          <div class="ms-status-pick">
            ${['待改', '已定稿', '未读'].map((s) => `<button class="ms-sp ${this.statusOf(sel) === s ? 'on s-' + ({ '待改': 'draft', '已定稿': 'done', '未读': 'unread' }[s]) : ''}" data-status="${s}">${s}</button>`).join('')}
          </div>
          <label class="fld" style="margin:12px 0 6px"><span>批注 / 修改意见</span>
            <textarea id="msNote" rows="5" placeholder="记录这一处的问题与修改方向…">${esc(sel.note || '')}</textarea></label>
          <div style="display:flex;gap:8px">
            <button class="btn sm primary" id="msDone">标记定稿</button>
            <button class="btn sm" id="msDraft">标为待改</button>
          </div>
        </div>`;
    } else {
      annoHtml += `<div class="ms-anno-card muted small">选中左侧任意一场正文，这里会出现状态标记与批注区。</div>
        <div class="ms-stat-row" style="margin-top:12px">
          <span class="ms-stat-chip s-draft">待改 <b>${counts['待改']}</b></span>
          <span class="ms-stat-chip s-done">已定稿 <b>${counts['已定稿']}</b></span>
          <span class="ms-stat-chip s-unread">未读 <b>${counts['未读']}</b></span>
        </div>`;
    }

    body.innerHTML = `
      <div class="ms-grid">
        <aside class="ms-tree">
          <div class="ms-tree-head">目录 · 卷章场</div>
          ${treeHtml}
        </aside>
        <section class="ms-prose">
          <div class="ms-prose-top">
            <span class="small muted">已汇编 ${Object.keys(tree).length ? '' : ''}${(d.manuscript || []).length} 章 · ${totalWords} 字</span>
            <button class="btn sm ghost" id="msViewAll">汇编全文</button>
          </div>
          ${proseHtml}
        </section>
        <aside class="ms-anno">${annoHtml}</aside>
      </div>`;

    $('#msTabSub').textContent = `《${d.meta.title || '未命名'}》 · 已成文 ${totalWords} 字`;

    // 交互
    body.querySelectorAll('.ms-scene').forEach((row) => {
      row.onclick = () => {
        const entry = row.dataset.entry;
        if (entry) {
          this.selId = entry;
        } else {
          const [vi, ci, si] = row.dataset.path.split('.').map(Number);
          const s = Store.data.outline.volumes[vi]?.chapters?.[ci]?.scenes?.[si];
          if (s && confirm('这一场还没成文，去写作台写它？')) {
            App.go('write', { scenePath: [vi, ci, si] });
            return;
          }
          return;
        }
        this.renderOverview(body);
      };
    });
    const va = $('#msViewAll');
    if (va)
      va.onclick = () => {
        this.viewAll = true;
        this.showAll(body);
      };
    const note = $('#msNote');
    if (note)
      note.oninput = (e) => {
        const m = (Store.data.manuscript || []).find((x) => x.id === this.selId);
        if (m) {
          m.note = e.target.value;
          Store.touch();
        }
      };
    if (sel) {
      body.querySelectorAll('.ms-sp').forEach((b) => {
        b.onclick = () => {
          const m = (Store.data.manuscript || []).find((x) => x.id === this.selId);
          if (m) {
            m.status = b.dataset.status;
            Store.touch();
            this.renderOverview(body);
          }
        };
      });
      $('#msDone').onclick = () => {
        const m = (Store.data.manuscript || []).find((x) => x.id === this.selId);
        if (m) {
          m.status = '已定稿';
          Store.touch();
          this.renderOverview(body);
          toast('已标记定稿');
        }
      };
      $('#msDraft').onclick = () => {
        const m = (Store.data.manuscript || []).find((x) => x.id === this.selId);
        if (m) {
          m.status = '待改';
          Store.touch();
          this.renderOverview(body);
          toast('已标为待改');
        }
      };
    }
  },

  showAll(body) {
    const d = Store.data;
    const { tree } = this.buildAssembled();
    const lines = [];
    tree.forEach((vol) => {
      lines.push('# ' + (vol.v.title || '未命名卷'));
      vol.chapters.forEach((ch) => {
        lines.push('## ' + (ch.c.title || '未命名章'));
        ch.scenes.forEach((sc) => {
          if (sc.entry) {
            lines.push('### ' + (sc.s.title || '未命名') + '\n\n' + (sc.entry.text || ''));
          }
        });
      });
    });
    const text = lines.join('\n\n');
    Modal.open({
      title: '汇编全文 · 通读',
      wide: true,
      body: `<div class="ms-all">${esc(text)}</div>`,
      footer: `<button class="btn" id="msCopyAll">复制</button><button class="btn" id="msCloseAll">关闭</button>`
    });
    $('#msCloseAll').onclick = () => Modal.close();
    $('#msCopyAll').onclick = () => {
      navigator.clipboard.writeText(text).then(() => toast('已复制'));
    };
  },

  exportBook() {
    const d = Store.data;
    const { tree } = this.buildAssembled();
    const lines = [];
    tree.forEach((vol) => {
      lines.push('# ' + (vol.v.title || '未命名卷') + '\n');
      vol.chapters.forEach((ch) => {
        lines.push('## ' + (ch.c.title || '未命名章') + '\n');
        ch.scenes.forEach((sc) => {
          if (sc.entry) lines.push('### ' + (sc.s.title || '未命名') + '\n\n' + (sc.entry.text || '') + '\n');
        });
      });
    });
    if (!lines.length) return toast('还没有可导出的正文', 'err');
    const blob = new Blob([`《${d.meta.title}》\n\n` + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (d.meta.title || 'book') + '.txt';
    a.click();
    toast('全书已导出');
  },

  /* ===================== 一致性检查 ===================== */
  renderCheck(body) {
    const d = Store.data;
    const scope = (d.consistency && d.consistency.scope) || { world: true, char: true, timeline: true, style: true };
    const issues = (d.consistency && d.consistency.issues) || [];
    const counts = { severe: 0, warn: 0, tip: 0 };
    issues.forEach((i) => (counts[i.severity] = (counts[i.severity] || 0) + 1));

    const tl = d.timeline || [];

    body.innerHTML = `
      <div class="ms-grid ms-grid-check">
        <aside class="ms-tree ms-check-left">
          <div class="ms-tree-head">检查范围</div>
          <div class="ms-scope">
            ${[
              ['world', '世界观 ★★★ 核心约束'],
              ['char', '人物性格锁（OOC）'],
              ['timeline', '时间线 / 连续性'],
              ['style', '文风规范（硬约束）']
            ]
              .map(
                ([k, label]) =>
                  `<label class="ms-scope-row"><input type="checkbox" data-scope="${k}" ${scope[k] ? 'checked' : ''}> ${label}</label>`
              )
              .join('')}
          </div>
          <div class="ms-tree-head" style="margin-top:16px">时间线 / 大事记</div>
          <div class="ms-tl" id="msTl">
            ${tl
              .map(
                (t, i) => `<div class="ms-tl-row" data-i="${i}">
                <input type="text" data-tl="at" value="${esc(t.at || '')}" placeholder="时点">
                <input type="text" data-tl="event" value="${esc(t.event || '')}" placeholder="事件">
                <button class="ms-tl-del" data-del="${i}">✕</button>
              </div>`
              )
              .join('')}
          </div>
          <button class="btn sm" id="msTlAdd" style="margin-top:8px">+ 加一个时点</button>
        </aside>

        <section class="ms-prose ms-check-main">
          <div class="ms-prose-top">
            <span class="small muted">${issues.length ? `上次扫描 ${d.consistency.at ? new Date(d.consistency.at).toLocaleString('zh-CN') : ''}` : '还没有扫描记录'}</span>
            <button class="btn primary sm" id="msScan">重新扫描</button>
          </div>
          ${
            this._checkBusy
              ? `<div class="ms-empty big"><h3>正在扫描…</h3><p class="small">逐段比对世界观、人物、时间线与文风，请稍候。</p></div>`
              : issues.length
              ? `<div class="ms-issue-head">共 ${issues.length} 处 · <span class="sev-severe">严重 ${counts.severe}</span> / <span class="sev-warn">警告 ${counts.warn}</span> / <span class="sev-tip">提示 ${counts.tip}</span></div>
                 <div class="ms-issues">${issues
                   .map(
                     (it, i) => `<div class="ms-issue sev-${it.severity}">
                    <div class="ms-issue-top"><span class="ms-sev sev-${it.severity}">${sevLabel(it.severity)}</span><span class="ms-issue-loc">${esc(it.location || '')}</span><button class="ms-loc" data-loc="${esc(it.location || '')}">定位</button></div>
                    <div class="ms-issue-desc">${esc(it.desc || '')}</div>
                    ${it.suggestion ? `<div class="ms-issue-sug">建议：${esc(it.suggestion)}</div>` : ''}
                  </div>`
                   )
                   .join('')}</div>`
              : `<div class="ms-empty big"><h3>还没有发现问题</h3><p class="small">点「重新扫描」，让 AI 按创作约束逐段检查正文；需要先去「设置」配好 API。</p></div>`
          }
        </section>
      </div>`;

    $('#msTabSub').textContent = `检查结果：${issues.length} 处问题`;

    body.querySelectorAll('[data-scope]').forEach((c) => {
      c.onchange = () => {
        Store.data.consistency = Store.data.consistency || {};
        Store.data.consistency.scope = Store.data.consistency.scope || {};
        Store.data.consistency.scope[c.dataset.scope] = c.checked;
        Store.touch();
      };
    });
    body.querySelectorAll('[data-tl]').forEach((inp) => {
      inp.oninput = () => {
        const i = Number(inp.closest('.ms-tl-row').dataset.i);
        const field = inp.dataset.tl;
        Store.data.timeline[i] = Store.data.timeline[i] || {};
        Store.data.timeline[i][field] = inp.value;
        Store.touch();
      };
    });
    body.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => {
        Store.data.timeline.splice(Number(b.dataset.del), 1);
        Store.touch();
        this.renderCheck(body);
      };
    });
    const add = $('#msTlAdd');
    if (add)
      add.onclick = () => {
        Store.data.timeline.push({ at: '', event: '' });
        Store.touch();
        this.renderCheck(body);
      };
    const scan = $('#msScan');
    if (scan) scan.onclick = () => this.runScan(body);
    body.querySelectorAll('[data-loc]').forEach((b) => {
      b.onclick = () => {
        const loc = b.dataset.loc || '';
        const m = (Store.data.manuscript || []).find((x) => loc.includes((x.title || '').slice(0, 6)));
        if (m) {
          this.selId = m.id;
          this.tab = 'overview';
          this.mount($('#view'));
        } else toast('没找到对应正文', 'err');
      };
    });
  },

  async runScan(body) {
    if (!Store.settings.baseUrl) {
      toast('还没配置 API，先去「设置」', 'err');
      return;
    }
    const d = Store.data;
    const scope = (d.consistency && d.consistency.scope) || {};
    const manuscript = (d.manuscript || [])
      .filter((m) => (m.text || '').trim().length > 0)
      .map((m) => ({ title: m.title || '未命名', text: m.text }));
    if (!manuscript.length) return toast('正文还是空的，先去写作', 'err');
    this._checkBusy = true;
    AIUndo.label('书稿 · AI 一致性检查');
    this.renderCheck(body);
    try {
      const o = await LLM.json({
        messages: Prompts.consistencyCheck({ scope, timeline: d.timeline || [], manuscript }),
        temperature: 0.4,
        maxTokens: 3000
      });
      const issues = Array.isArray(o.issues) ? o.issues : [];
      d.consistency = d.consistency || {};
      d.consistency.issues = issues;
      d.consistency.at = new Date().toISOString();
      Store.touch();
      this._checkBusy = false;
      this.renderCheck(body);
      toast(issues.length ? `发现 ${issues.length} 处问题` : '检查通过，未发现明显问题');
    } catch (e) {
      this._checkBusy = false;
      this.renderCheck(body);
      toast(e.message, 'err');
    }
  }
};

function sevLabel(s) {
  return { severe: '严重', warn: '警告', tip: '提示' }[s] || '提示';
}
