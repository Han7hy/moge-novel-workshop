/* ============ app.js —— 路由与启动 ============ */
const ICON = {
  project: '<path d="M12 2.6 21 7.2 12 11.8 3 7.2 12 2.6Z"/><path d="M3 12 12 16.6 21 12"/><path d="M3 16.6 12 21.2 21 16.6"/>',
  import: '<path d="M4.6 4.5h5v15h-5z"/><path d="M12.4 4.5h4.6v15h-4.6z"/><path d="M19.4 6.6v12.9"/>',
  world: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>',
  factions: '<path d="M5 20.5V4.2c2.4-1.4 4.7-1.4 7 0v7.2c-2.3-1.4-4.6-1.4-7 0"/><path d="M12 11.4V4.2c2.3-1.4 4.6-1.4 7 0v16.3"/><path d="M5 20.5c2.3-1.3 4.6-1.3 7 0 2.3-1.3 4.6-1.3 7 0"/>',
  characters: '<circle cx="12" cy="8.2" r="3.6"/><path d="M5.2 20c0-3.4 3-5.7 6.8-5.7s6.8 2.3 6.8 5.7"/>',
  map: '<path d="M9.2 4.4 3.6 6.6v13l5.6-2.2 5.6 2.2 5.6-2.2v-13l-5.6 2.2-5.6-2.2Z"/><path d="M9.2 4.4v13M14.8 6.6v13"/>',
  props: '<rect x="3.5" y="7.2" width="17" height="12" rx="2"/><path d="M3.5 11.6h17M9 7.2V5.4a1.8 1.8 0 0 1 1.8-1.8h2.4A1.8 1.8 0 0 1 15 5.4v1.8"/><path d="M10.4 11.6v3h3.2v-3"/>',
  outline: '<path d="M4 6h2.6M10 6h10M4 12h2.6M10 12h10M4 18h2.6M10 18h10"/>',
  write: '<path d="M4 20.2 8.2 19.2 18.6 8.8a2.3 2.3 0 0 0-3.2-3.2L5 15.9l-1 4.3Z"/><path d="M14.4 6.6 17.6 9.8"/>',
  writer: '<path d="M4 20.4c3.7.2 6.7-.9 8.3-3.2 1.3-2 1.1-4.5-.6-6.2"/><path d="M4 20.4 15.5 5.2a2.6 2.6 0 0 1 3.7 3.7L9.4 19.6"/><path d="M7.1 17.1 10.9 18.3"/>',
  manuscript: '<path d="M6.2 3.4h7.4L19 8.8v11.8H6.2z"/><path d="M13.4 3.4v5.6H19"/><path d="M9 13.4h7M9 17h4.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.1 14.6a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'
};

const NAV = [
  { key: 'project', icon: '❖', label: '项目', hint: '作品信息与文风', group: '创 作' },
  { key: 'import', icon: '∷', label: '书源', hint: '导入小说 · 抽文风 · 建人物地图', group: '素 材' },
  { key: 'world', icon: '◉', label: '世界观', hint: '世界底色与编年' },
  { key: 'factions', icon: '⚑', label: '势力', hint: '势力划分 · 所属地 · 相互关系' },
  { key: 'characters', icon: '☰', label: '人物', hint: '分组文件夹 · 性格锁 · 关系网' },
  { key: 'map', icon: '◈', label: '地图', hint: '场景 · 人物 · 道具' },
  { key: 'props', icon: '◇', label: '道具', hint: '全书道具库 · 添加 / 修改 / 归属' },
  { key: 'outline', icon: '≡', label: '大纲', hint: '卷 · 情节点 · 明暗线', group: '架 构' },
  { key: 'write', icon: '✎', label: '角色对话', hint: '场景调度 · 开演与成文' },
  { key: 'writer', icon: '✒', label: '写作', hint: '沉浸式写作 · 章节 · 角色辅导' },
  { key: 'manuscript', icon: '❒', label: '书稿', hint: '汇编 · 通读 · 批注 · 出版前检查' },
  { key: 'settings', icon: '⚙', label: '设置', hint: 'API 与模型', divider: true }
];

const App = {
  current: 'project',
  params: null,

  async boot() {
    initTheme();
    try {
      await Store.init();
      // 地点下拉要能引用地图上的地名，启动时就把当前书的地图数据备好
      if (window.Atlas && typeof Atlas.init === 'function') {
        try { await Atlas.init(Store.currentBookId); } catch (e) {}
      }
    } catch (e) {
      document.body.innerHTML =
        '<div style="padding:60px;font-family:serif;font-size:15px">启动失败：' + esc(e.message) + '<br><br>请确认是用 <code>node server.js</code> 启动的，而不是直接双击 html 文件。</div>';
      return;
    }
    let lastGroup = '';
    $('#nav').innerHTML = NAV.map((n) => {
      let head = '';
      if (n.group && n.group !== lastGroup) {
        head += `<div class="nav-sec">${n.group}</div>`;
        lastGroup = n.group;
      }
      if (n.divider) head += '<div class="nav-div"></div>';
      return (
        head +
        `<button class="nav-item" data-key="${n.key}" title="${esc(n.hint)}">
           <span class="ni"><svg viewBox="0 0 24 24">${ICON[n.key] || ''}</svg></span><span class="nl">${n.label}</span>
         </button>`
      );
    }).join('');
    $$('#nav .nav-item').forEach((b) => (b.onclick = () => this.go(b.dataset.key)));

    const cmd = $('#cmdBtn');
    if (cmd) cmd.onclick = () => CommandPalette.open();

    // 文库切换器
    const bookBtn = $('#bookBtn');
    if (bookBtn) bookBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleBookMenu();
    };
    const bmNew = $('#bmNew');
    if (bmNew) bmNew.onclick = () => this.newBookFlow();
    document.addEventListener('click', (e) => {
      const menu = $('#bookMenu');
      const btn = $('#bookBtn');
      if (menu && !menu.hidden && !menu.contains(e.target) && !(btn && btn.contains(e.target))) {
        this.closeBookMenu();
      }
    });
    this.renderBookBar();

    this.bindKeys();
    // 地址直达：#map / #characters / #write …
    const h = (location.hash || '').replace(/^#/, '');
    if (h && window.Views && Views[h]) {
      this.current = h;
      if (h === 'map' && Views.map) Views.map._mode = 'atlas';
    }
    this.render();
    this.updateBrand();
    // AI 生成撤销：留一份起点快照，并恢复上次会话未用掉的撤销记录
    try { AIUndo.bootstrap(); } catch (e) {}
  },

  updateBrand() {
    const t = Store.data && Store.data.meta ? Store.data.meta.title : '';
    const el = $('#brandSub');
    if (el) el.textContent = t || '小说工坊';
  },

  /* ---------- 文库切换器 ---------- */
  renderBookBar() {
    const cur = Store.books.find((b) => b.id === Store.currentBookId) || Store.books[0];
    const nameEl = $('#bookName');
    if (nameEl) nameEl.textContent = cur ? cur.title || '未命名' : '我的小说';
    const menu = $('#bookMenu');
    if (!menu) return;
    menu.innerHTML = `
      <div class="bm-head">文库</div>
      <div class="bm-list" id="bmList"></div>
      <div class="bm-actions"><button class="bm-act" id="bmNew">＋ 新建文库</button></div>`;
    const list = $('#bmList');
    const nb = $('#bmNew');
    if (nb) nb.onclick = () => this.newBookFlow();
    list.innerHTML = (Store.books || [])
      .map(
        (b) => `<button class="bm-item ${b.id === Store.currentBookId ? 'on' : ''}" data-id="${b.id}">
          <span class="bm-dot"></span>
          <span class="bm-t">${esc(b.title || '未命名')}</span>
          <span class="bm-del" data-id="${b.id}" title="删除这本">✕</span>
          <span class="bm-menu" data-id="${b.id}" title="重命名">⋯</span>
        </button>`
      )
      .join('');
    list.querySelectorAll('.bm-item').forEach((el) => {
      const id = el.dataset.id;
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('bm-menu') || e.target.classList.contains('bm-del')) return;
        this.switchBook(id);
        this.closeBookMenu();
      });
      const m = el.querySelector('.bm-menu');
      if (m)
        m.addEventListener('click', (e) => {
          e.stopPropagation();
          this.bookItemMenu(id);
        });
      const d = el.querySelector('.bm-del');
      if (d)
        d.addEventListener('click', (e) => {
          e.stopPropagation();
          this.deleteBookDirect(id);
        });
    });
  },

  /** 直接删除：点一下就删，不再弹确认框 */
  deleteBookDirect(id) {
    const b = Store.books.find((x) => x.id === id);
    this.flushWriter();
    Store.deleteBook(id)
      .then(() => {
        this.closeBookMenu();
        this.renderBookBar();
        this.render();
        toast('已删除《' + ((b && b.title) || '文库') + '》');
      })
      .catch((e) => toast(e.message, 'err'));
  },

  toggleBookMenu() {
    const m = $('#bookMenu');
    if (!m) return;
    m.hidden = !m.hidden;
    if (!m.hidden) this.renderBookBar();
  },

  closeBookMenu() {
    const m = $('#bookMenu');
    if (m) m.hidden = true;
  },

  async switchBook(id) {
    if (id === Store.currentBookId) return;
    this.flushWriter(); // 换书会把 Store.data 整个替换，先把当前书的草稿写回当前书
    try {
      await Store.switchBook(id);
      this.renderBookBar();
      this.render();
      toast('已切换到《' + (Store.books.find((b) => b.id === id) || {}).title + '》');
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  newBookFlow() {
    Modal.open({
      title: '新建文库',
      narrow: true,
      body:
        '<label class="fld"><span>文库名</span><input type="text" id="nbName" placeholder="例如：山海拾遗" maxlength="40"></label>' +
        '<p class="muted small">新建后是一本空白作品，可稍后从「书源」导入 txt。</p>',
      footer: '<button class="btn ghost" id="nbCancel">取消</button><span class="sp"></span><button class="btn" id="nbOk">创建</button>',
      onMount: (mask) => {
        const inp = mask.querySelector('#nbName');
        inp.focus();
        mask.querySelector('#nbCancel').onclick = () => Modal.close();
        mask.querySelector('#nbOk').onclick = async () => {
          const t = inp.value.trim();
          this.flushWriter();
          await Store.newBook(t);
          Modal.close();
          this.closeBookMenu();
          this.renderBookBar();
          this.render();
          toast('已新建文库');
        };
      }
    });
  },

  bookItemMenu(id) {
    const b = Store.books.find((x) => x.id === id);
    if (!b) return;
    Modal.open({
      title: '重命名文库',
      narrow: true,
      body:
        '<label class="fld"><span>文库名</span><input type="text" id="bmRename" value="' +
        esc(b.title) +
        '" maxlength="40"></label>',
      footer:
        '<button class="btn ghost" id="bmCancel">取消</button><span class="sp"></span><button class="btn" id="bmSave">保存</button>',
      onMount: (mask) => {
        const inp = mask.querySelector('#bmRename');
        inp.focus();
        mask.querySelector('#bmCancel').onclick = () => Modal.close();
        mask.querySelector('#bmSave').onclick = async () => {
          const t = inp.value.trim();
          if (t) await Store.renameBook(id, t);
          Modal.close();
          this.closeBookMenu();
          this.renderBookBar();
          this.updateBrand();
          toast('已保存文库名');
        };
      }
    });
  },

  applyBackground() {
    const bg = (Store.settings && Store.settings.bg) || 'wallpaper';
    document.body.classList.toggle('bg-wallpaper', bg === 'wallpaper');
    document.body.classList.toggle('bg-cinema', bg === 'cinema');
    const v = document.querySelector('.cinema-vid');
    if (v) {
      const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (bg === 'cinema' && !reduced && !document.hidden) v.play().catch(() => {});
      else v.pause();
    }
  },

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl+K 命令面板
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        CommandPalette.open();
        return;
      }
      // Ctrl+S 立即保存
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        Store.save(true);
        toast('已保存');
        return;
      }
      // Esc 关闭
      if (e.key === 'Escape') {
        const mask = $('.mask');
        if (mask) Modal.close();
        return;
      }
      // Alt+数字 切页
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (NAV[idx]) {
          e.preventDefault();
          this.go(NAV[idx].key);
        }
      }
    });
  },

  go(key, params) {
    // 离开写作页就把「手动展开主侧栏」的临时状态清掉，下次进写作仍是收起的
    if (key !== 'writer' && window.Views && Views.writer) Views.writer._railOpen = false;
    this.current = key;
    this.params = params || null;
    try { history.replaceState(null, '', '#' + key); } catch (e) {}
    this.render();
  },

  /** 写作页的正文只存在 textarea 里；销毁 #view / 换书之前必须先提交草稿 */
  flushWriter() {
    const V = window.Views && Views.writer;
    // 全局 AI 撤销刚替换过 Store.data：旧纸面上的字（含 blur 事件）一律不回写
    if (V && V._discardDraft) return;
    // _bookId 不同说明已经换过书（换书前已提交过），不能再把旧纸写进新书
    if ($('#wrProse') && V && V._bookId === Store.currentBookId && typeof V.beforeLeave === 'function') {
      try { V.beforeLeave(); } catch (e) {}
    }
  },

  render() {
    this.flushWriter();
    // 专注模式只属于写作页；离开页面一定还原侧栏与顶栏
    document.body.classList.remove('zen-on');
    // 进写作页默认收起最左侧主导航，把宽度全留给正文；页内可随时展开
    const railOpen = !!(window.Views && Views.writer && Views.writer._railOpen);
    document.body.classList.toggle('rail-collapsed', this.current === 'writer' && !railOpen);
    // 切换书后重新载入该书的地图，只就地更新地点下拉，不打断正在写的字
    if (window.Atlas && typeof Atlas.init === 'function' && Atlas.book() !== Store.currentBookId) {
      try {
        Atlas.init(Store.currentBookId).then(() => {
          if (Atlas.book() !== Store.currentBookId) return;
          $$('#view select[data-place-ref], #modalRoot select[data-place-ref]').forEach((sel) => {
            const keep = sel.value;
            sel.innerHTML = Store.placeSelectOptions(keep);
            sel.value = keep;
          });
        }).catch(() => {});
      } catch (e) {}
    }
    this.applyBackground();
    const view = Views[this.current];
    if (!view) return;
    $$('#nav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.key === this.current));
    $('#viewTitle').textContent = view.title;
    $('#viewSub').textContent = view.sub || '';
    $('#topActions').innerHTML = view.actions ? view.actions() : '';

    const el = $('#view');
    el.className = 'view';
    el.scrollTop = 0;
    el.innerHTML = '';
    view.mount(el, this.params);
    this.updateBrand();
    this.updateRailStat();
  },

  updateRailStat() {
    const el = $('#railStat');
    if (!el || !Store.data) return;
    const ms = Store.data.manuscript || [];
    const words = ms.reduce((a, m) => a + (m.text || '').replace(/\s/g, '').length, 0);
    const w = words >= 10000 ? (words / 10000).toFixed(1) + ' 万' : String(words);
    el.innerHTML = `<span>已成文 <b>${ms.length}</b> 章</span><i></i><span><b>${w}</b> 字</span>`;
  },

  rerender() {
    this.flushWriter();
    // 重新挂载当前视图（保留数据，重建 DOM）
    const el = $('#view');
    const view = Views[this.current];
    if (!view) return;
    // 顶栏按钮随视图状态变化（比如大纲进出画布），重挂载时一起刷新
    if (view.actions) $('#topActions').innerHTML = view.actions();
    el.className = 'view';
    el.innerHTML = '';
    view.mount(el, this.params);
    this.updateBrand();
  }
};

/* ============ 命令面板 ============ */
const CommandPalette = {
  _items: [],
  _sel: 0,

  build() {
    const items = [];
    NAV.forEach((n) => items.push({ kind: '页面', icon: n.icon, label: n.label, hint: n.hint, run: () => App.go(n.key) }));

    Store.data.characters.forEach((c) =>
      items.push({
        kind: '人物',
        icon: '☰',
        label: c.name || '未命名',
        hint: c.role || '',
        run: () => {
          App.go('characters');
          setTimeout(() => Views.characters.edit(c.id), 60);
        }
      })
    );

    Store.data.map.nodes.forEach((n) =>
      items.push({
        kind: '地点',
        icon: '◈',
        label: n.name || '未命名',
        hint: (n.items && n.items.length ? n.items.length + ' 件道具' : ''),
        run: () => {
          App.go('map');
          setTimeout(() => {
            Views.map._sel = n.id;
            Views.map.draw();
          }, 60);
        }
      })
    );

    (Store.data.world.entries || []).forEach((e) =>
      items.push({
        kind: '世界观',
        icon: '◉',
        label: e.name || '未命名',
        hint: e.cat || '',
        run: () => {
          App.go('world');
          setTimeout(() => Views.world.edit(e.id), 60);
        }
      })
    );

    // 道具搜索：搜什么马上知道在哪，点开直接进道具库编辑
    items.push({
      kind: '动作', icon: '◇', label: '+ 新建道具', hint: '在道具库里登记一件新道具',
      run: () => { App.go('props'); setTimeout(() => Views.props && Views.props.create(), 60); }
    });
    (Store.data.inventory || []).forEach((it) => {
      const h = Store.itemHolder(it);
      items.push({
        kind: '道具',
        icon: '※',
        label: it.name || '未命名',
        hint: (h && h.name && h.type !== 'none' ? (h.type === 'char' ? '在 ' + h.name + ' 身上' : '在 ' + h.name) : '未定位') + (it.desc ? ' · ' + it.desc.slice(0, 20) : ''),
        run: () => {
          App.go('props');
          setTimeout(() => { if (Views.props) Views.props.edit(it.id); }, 60);
        }
      });
    });

    const scenes = [];
    (Store.data.outline.volumes || []).forEach((v, vi) =>
      (v.chapters || []).forEach((c, ci) => (c.scenes || []).forEach((s, si) => scenes.push({ s, path: [vi, ci, si], vol: v.title, ch: c.title })))
    );
    scenes.forEach(({ s, path, vol, ch }) =>
      items.push({
        kind: '场景',
        icon: '≡',
        label: s.title || '未命名场景',
        hint: vol + ' / ' + ch,
        run: () => App.go('write', { scenePath: path })
      })
    );

    return items;
  },

  open() {
    this._items = this.build();
    this._sel = 0;
    const mask = document.createElement('div');
    mask.className = 'palette-mask';
    mask.innerHTML = `
      <div class="palette">
        <div class="palette-input">
          <span class="pi-icon">⌕</span>
          <input type="text" id="paletteQ" placeholder="跳转到页面、人物、地点、世界观条目、场景…" autocomplete="off">
          <kbd>ESC</kbd>
        </div>
        <div class="palette-list" id="paletteList"></div>
        <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span class="muted">Ctrl+K 随时呼出</span></div>
      </div>`;
    document.body.appendChild(mask);
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) this.close();
    });
    const input = mask.querySelector('#paletteQ');
    input.focus();
    this.renderList('');
    input.addEventListener('input', () => {
      this._sel = 0;
      this.renderList(input.value);
    });
    input.addEventListener('keydown', (e) => {
      const list = this.filtered(input.value);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._sel = Math.min(this._sel + 1, list.length - 1);
        this.paint(list);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this._sel = Math.max(this._sel - 1, 0);
        this.paint(list);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = list[this._sel];
        if (it) {
          this.close();
          it.run();
        }
      } else if (e.key === 'Escape') {
        this.close();
      }
    });
  },

  filtered(q) {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return this._items.slice(0, 30);
    return this._items
      .filter((it) => (it.label + ' ' + it.kind + ' ' + (it.hint || '')).toLowerCase().includes(s))
      .slice(0, 30);
  },

  renderList(q) {
    const list = this.filtered(q);
    const box = $('#paletteList');
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<div class="palette-empty">没有匹配项</div>';
      return;
    }
    box.innerHTML = list
      .map(
        (it, i) => `<div class="palette-row ${i === this._sel ? 'on' : ''}" data-i="${i}">
          <span class="pr-icon">${it.icon}</span>
          <span class="pr-label">${esc(it.label)}</span>
          <span class="pr-hint">${esc(it.hint || '')}</span>
          <span class="pr-kind">${esc(it.kind)}</span>
        </div>`
      )
      .join('');
    box.querySelectorAll('.palette-row').forEach((r) => {
      r.onmousemove = () => {
        if (this._sel !== Number(r.dataset.i)) {
          this._sel = Number(r.dataset.i);
          box.querySelectorAll('.palette-row').forEach((x) => x.classList.toggle('on', x === r));
        }
      };
      r.onclick = () => {
        const it = list[Number(r.dataset.i)];
        this.close();
        if (it) it.run();
      };
    });
  },

  paint(list) {
    const box = $('#paletteList');
    if (!box) return;
    box.querySelectorAll('.palette-row').forEach((x, i) => x.classList.toggle('on', i === this._sel));
    const cur = box.querySelector('.palette-row.on');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  },

  close() {
    const m = $('.palette-mask');
    if (m) m.remove();
  }
};

document.addEventListener('DOMContentLoaded', () => App.boot());
