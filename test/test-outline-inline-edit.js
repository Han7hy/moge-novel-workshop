/* 大纲画布：情节点卡片上直接编辑 的断言测试 */
/* ⚠️ 注意：测试会写入目标实例的「当前书」画布数据，跑之前请先备份 data/books/<书id>/project.json */
/* 浏览器环境解析：优先工程内 playwright-core，其次 PLAYWRIGHT_CORE_PATH 指定的副本 */
function loadChromium() {
  const candidates = ['playwright-core', process.env.PLAYWRIGHT_CORE_PATH].filter(Boolean);
  for (const c of candidates) {
    try { return require(c).chromium; } catch (e) {}
  }
  console.error('找不到 playwright-core：请先 npm i -D playwright-core，或设 PLAYWRIGHT_CORE_PATH 指向它');
  process.exit(3);
}
const chromium = loadChromium();

/* Chrome 位置：默认用系统安装的 Chrome，可用 CHROME_PATH 覆盖 */
const launchOpts = { headless: true };
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
else launchOpts.channel = 'chrome';


const URL = 'http://localhost:7788/#outline';
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const u = (m.location() && m.location().url) || '';
    if (u.includes('favicon.ico')) return;
    errs.push('console: ' + m.text() + ' @ ' + u);
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data, null, { timeout: 15000 });
  await page.click('.ol-card');
  await page.waitForSelector('.olc-view');
  await sleep(400);

  const state = () => page.evaluate(() => {
    const v = Views.outline.vol();
    return {
      editId: Views.outline._editId,
      sel: Views.outline._sel,
      nodes: v.canvas.nodes.map((n) => ({ id: n.id, title: n.title, desc: n.desc, x: n.x, y: n.y })),
      editingCards: document.querySelectorAll('.olc-node.editing').length
    };
  });
  const cardPoint = (id, dy) => page.$eval(`.olc-node[data-id="${id}"]`, (e, dy) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + Math.min(60, r.width / 2), y: r.y + (dy || 12) };
  }, dy);

  const base = await state();
  console.log('（本卷原有 ' + base.nodes.length + ' 个情节点）');

  console.log('== 1. 新建点直接进编辑态 ==');
  await page.click('#olcAdd');
  await sleep(350);
  let s = await state();
  let cur = s.nodes[s.nodes.length - 1];
  ok(s.nodes.length === base.nodes.length + 1, '新增了一个情节点');
  ok(s.editingCards === 1, '新点卡片进入编辑态');
  ok(s.editId === cur.id, '_editId 指向新点');
  let act = await page.evaluate(() => {
    const a = document.activeElement;
    return { cls: a.className, sel: a.selectionStart + '-' + a.selectionEnd, val: a.value };
  });
  ok(act.cls.includes('olc-p-t'), '焦点落在标题输入框');
  ok(act.val === '新情节点' && act.sel === '0-4', '默认标题被全选，可直接改名');

  console.log('== 2. 输入即写数据 ==');
  await page.keyboard.type('祭坛初鸣');
  s = await state();
  ok(s.nodes[s.nodes.length - 1].title === '祭坛初鸣', '标题实时写入 node.title');

  console.log('== 3. Esc 取消并还原 ==');
  await page.keyboard.press('Escape');
  await sleep(250);
  s = await state();
  ok(s.editId === '' && s.editingCards === 0, 'Esc 退出编辑态');
  ok(s.nodes[s.nodes.length - 1].title === '新情节点', '标题还原为修改前');

  console.log('== 4. 双击卡片（自判）进编辑 · 回车跳描述 · Ctrl+Enter 完成 ==');
  let pt = await cardPoint(cur.id, 14);
  await page.mouse.dblclick(pt.x, pt.y);
  await sleep(320);
  s = await state();
  ok(s.editingCards === 1 && s.editId === cur.id, '连点两下卡片进入编辑');
  await page.keyboard.type('祭坛初鸣');
  await page.keyboard.press('Enter');
  act = await page.evaluate(() => document.activeElement.className);
  ok(act.includes('olc-p-d'), '标题里回车 → 跳到描述框');
  await page.keyboard.type('玄冥在祭坛听见低语，选择隐瞒。');
  await page.keyboard.press('Control+Enter');
  await sleep(300);
  s = await state();
  const done = s.nodes.find((n) => n.id === cur.id);
  ok(s.editId === '' && s.editingCards === 0, 'Ctrl+Enter 结束编辑');
  ok(done.title === '祭坛初鸣' && done.desc === '玄冥在祭坛听见低语，选择隐瞒。', '标题与描述都写入');
  const cardText = await page.$eval(`.olc-node[data-id="${cur.id}"]`, (e) => e.innerText);
  ok(cardText.includes('祭坛初鸣') && cardText.includes('玄冥在祭坛'), '卡片上直接显示新内容');

  console.log('== 5. 铅笔按钮进入编辑 ==');
  pt = await cardPoint(cur.id, 14);
  await page.mouse.move(pt.x, pt.y);
  await sleep(200);
  await page.click(`.olc-node[data-id="${cur.id}"] .olc-n-edit`);
  await sleep(300);
  s = await state();
  ok(s.editingCards === 1 && s.editId === cur.id, '点铅笔进入编辑态');
  await page.keyboard.press('Escape');
  await sleep(200);

  console.log('== 6. 空白双击新增 + 点另一张卡先落笔再选中 ==');
  const nBefore = (await state()).nodes.length;
  await page.mouse.dblclick(1200, 640);
  await sleep(350);
  s = await state();
  ok(s.nodes.length === nBefore + 1 && s.editingCards === 1, '空白双击新增点并进入编辑');
  pt = await cardPoint(cur.id, 14);
  await page.mouse.click(pt.x, pt.y);
  await sleep(320);
  s = await state();
  ok(s.editingCards === 0, '点别处先提交编辑');
  ok(s.sel === cur.id, '同时选中被点击的那个点');
  ok(s.nodes.find((n) => n.id === cur.id).desc === '玄冥在祭坛听见低语，选择隐瞒。', '已提交的内容没被回滚');

  console.log('== 7. 非编辑态仍可拖动 ==');
  const before = (await state()).nodes.find((n) => n.id === cur.id);
  pt = await cardPoint(cur.id, 20);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + 120, pt.y + 80, { steps: 8 });
  await page.mouse.up();
  await sleep(320);
  const after = (await state()).nodes.find((n) => n.id === cur.id);
  ok(Math.abs(after.x - before.x) > 40 && Math.abs(after.y - before.y) > 25, `拖动照旧生效（Δx=${after.x - before.x}, Δy=${after.y - before.y}）`);
  ok((await state()).editingCards === 0, '拖动不会误进编辑态');

  console.log('== 8. 空标题兜底 ==');
  const lastId = (await state()).nodes.slice(-1)[0].id;
  pt = await cardPoint(lastId, 14);
  await page.mouse.dblclick(pt.x, pt.y);
  await sleep(300);
  await page.evaluate(() => { const t = document.querySelector('.olc-p-t'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.keyboard.press('Control+Enter');
  await sleep(300);
  s = await state();
  ok(s.nodes.slice(-1)[0].title === '未命名情节点', '标题留空 → 落笔为「未命名情节点」');

  console.log('== 9. 刷新后仍在 ==');
  await sleep(1400);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data, null, { timeout: 15000 });
  await page.evaluate(() => { Views.outline._cur = Store.data.outline.volumes[0].id; App.go('outline'); });
  await page.waitForSelector('.olc-node');
  await sleep(400);
  const persisted = await page.evaluate((id) => {
    const n = Store.data.outline.volumes[0].canvas.nodes.find((x) => x.id === id);
    return n ? n.title + '|' + n.desc : 'not found';
  }, cur.id);
  ok(persisted === '祭坛初鸣|玄冥在祭坛听见低语，选择隐瞒。', '刷新后标题与描述仍在：' + persisted);

  console.log('== 10. 无 JS 报错 ==');
  ok(errs.length === 0, errs.length ? '有报错：' + errs.slice(0, 3).join(' | ') : '无 JS 报错');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(2); });
