'use strict';
/* ⚠️ 注意：测试会写入目标实例的「当前书」画布数据，跑之前请先备份 data/books/<书id>/project.json */
/* 大纲画布测试：卷列表 → 画布 → 加点/拖动/连线/线型/缩放/持久化/章节抽屉/AI 铺卷 */
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
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const u = (m.location() && m.location().url) || '';
    if (u.includes('favicon.ico')) return; // 项目本来就没有 favicon，与控制台无关
    errs.push(m.text() + ' @ ' + u);
  });
  page.on('response', (r) => { if (r.status() >= 400) console.log('    [http ' + r.status() + '] ' + r.url()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data && Store.data.outline && Store.data.outline.volumes.length > 0, null, { timeout: 15000 });

  console.log('== 1. 卷列表 ==');
  await page.waitForSelector('.ol-card');
  const cards = await page.$$eval('.ol-card:not(.ol-card-new)', (els) => els.map((e) => ({
    title: e.querySelector('.ol-card-title').textContent,
    hasCanvas: true
  })));
  ok(cards.length >= 1, '显示卷卡片：' + cards.length + ' 卷（' + cards.map((c) => c.title).join(' / ') + '）');
  ok(await page.$('.ol-card-go') !== null, '卡片有「进入画布」提示');
  ok(await page.$('.ol-new-plus') !== null, '有「新建一卷」卡片');

  console.log('== 2. 进入画布 ==');
  await page.click('.ol-card');
  await page.waitForSelector('.olc-view', { timeout: 5000 });
  ok(await page.$('#olcSvg') !== null, '画布与 SVG 存在');
  ok(await page.$('.olc-bar') !== null, '工具条存在');
  ok(await page.$('.olc-empty') !== null, '空画布有引导');
  ok(await page.$eval('#olcZval', (e) => e.textContent) !== '', '缩放百分比显示');

  console.log('== 3. 双击加情节点 ==');
  const box = await page.$eval('#olcView', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.dblclick(box.x + box.w * 0.3, box.y + box.h * 0.4);
  await sleep(250);
  let n1 = await page.$$eval('.olc-node', (els) => els.length);
  ok(n1 === 1, '双击落下一个情节点（当前 ' + n1 + ' 个）');
  ok(await page.$('#olcIns #insTitle') !== null, '自动选中并打开右侧编辑面板');
  await page.fill('#insTitle', '主角发现自己能听见神明低语');
  await page.fill('#insDesc', '他在祭坛边听见不该听的声音，第一次意识到自己不是普通人。');
  await sleep(200);
  const t1 = await page.$eval('.olc-node .olc-n-t', (e) => e.textContent);
  ok(t1.includes('听见神明低语'), '标题实时写进卡片：' + t1.slice(0, 12) + '…');

  console.log('== 4. 按钮再加一个 + 拖动 ==');
  await page.click('#olcAdd');
  await sleep(200);
  let n2 = await page.$$eval('.olc-node', (els) => els.length);
  ok(n2 === 2, '按钮新增第二个点');
  const before = await page.$eval('.olc-node:nth-child(2)', (e) => ({ left: e.style.left, top: e.style.top }));
  const b2 = await page.$eval('.olc-node:nth-child(2)', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 20 }; });
  await page.mouse.move(b2.x, b2.y);
  await page.mouse.down();
  await page.mouse.move(b2.x + 160, b2.y + 120, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  const after = await page.$eval('.olc-node:nth-child(2)', (e) => ({ left: e.style.left, top: e.style.top }));
  ok(before.left !== after.left && before.top !== after.top, '节点可拖动，坐标变化 ' + before.left + '→' + after.left);
  const persisted = await page.evaluate(() => {
    const v = Store.data.outline.volumes.find((x) => x.id === Views.outline._cur);
    return v.canvas.nodes.map((n) => ({ x: n.x, y: n.y }));
  });
  ok(persisted[1].x > 0 && persisted[1].y > 0, '拖动结果已写进数据 (' + persisted[1].x + ',' + persisted[1].y + ')');

  console.log('== 5. 拖圆点连线 ==');
  await page.hover('.olc-node:nth-child(1)');
  const dot = await page.$eval('.olc-node:nth-child(1) .olc-n-dot', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const target = await page.$eval('.olc-node:nth-child(2)', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(dot.x, dot.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
  await sleep(350);
  let edges = await page.$$eval('path.olc-edge', (els) => els.length);
  ok(edges === 1, '两个点之间生成一条线');
  ok(await page.$('#olcIns #insType') !== null, '连线后打开线属性面板');

  console.log('== 6. 换线类型（明线 → 暗线） ==');
  await page.selectOption('#insType', 'dark');
  await sleep(150);
  let et = await page.evaluate(() => {
    const v = Store.data.outline.volumes.find((x) => x.id === Views.outline._cur);
    return v.canvas.edges[0].type;
  });
  ok(et === 'dark', '线类型改为暗线');
  ok(await page.$eval('path.olc-edge', (e) => e.getAttribute('stroke')) === '#8a6bc0', '暗线用紫色绘制');
  await page.fill('#insLabel', '伏笔：祭坛的低语');
  await sleep(150);
  ok(await page.$eval('.olc-elabel', (e) => e.textContent).then((t) => t.includes('伏笔')), '连线可加备注');

  console.log('== 7. 缩放 / 平移 / 适应 ==');
  const z0 = await page.$eval('#olcZval', (e) => e.textContent);
  await page.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.5);
  await page.mouse.wheel(0, -240);
  await sleep(250);
  const z1 = await page.$eval('#olcZval', (e) => e.textContent);
  ok(z0 !== z1, '滚轮缩放生效：' + z0 + ' → ' + z1);
  await page.click('#olcFit');
  await sleep(200);
  const zoomFit = await page.evaluate(() => Store.data.outline.volumes.find((x) => x.id === Views.outline._cur).canvas.view.zoom);
  ok(zoomFit > 0 && zoomFit <= 1.1, '「适应」重新框住内容（zoom=' + zoomFit.toFixed(2) + '）');

  console.log('== 8. 图例隐藏某类线 ==');
  await page.click('[data-lg="dark"]');
  await sleep(150);
  ok((await page.$$eval('path.olc-edge', (e) => e.length)) === 0, '点图例后暗线隐藏');
  await page.click('[data-lg="dark"]');
  await sleep(150);
  ok((await page.$$eval('path.olc-edge', (e) => e.length)) === 1, '再点恢复显示');

  console.log('== 9. 刷新后仍在（持久化） ==');
  const snapshot = await page.evaluate(() => {
    const v = Store.data.outline.volumes.find((x) => x.id === Views.outline._cur);
    return { vol: v.id, nodes: v.canvas.nodes.length, edges: v.canvas.edges.length, x: v.canvas.nodes[0].x };
  });
  await sleep(900); // 等 Store 落盘
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data, null, { timeout: 15000 });
  await page.evaluate((id) => { Views.outline._cur = id; App.go('outline'); }, snapshot.vol);
  await page.waitForSelector('.olc-node');
  await sleep(400);
  const afterReload = await page.$$eval('.olc-node', (e) => e.length);
  ok(afterReload === snapshot.nodes, '刷新后情节点还在（' + afterReload + ' 个）');
  ok((await page.$$eval('path.olc-edge', (e) => e.length)) === 1, '刷新后连线还在');
  ok(await page.evaluate(() => Store.data.outline.volumes.find((x) => x.id === Views.outline._cur).canvas.view.zoom > 0), '视口状态也被保存');

  console.log('== 10. 章节抽屉仍可编辑 ==');
  await page.click('#olcDrawerBtn');
  await sleep(300);
  ok(await page.$eval('#olcDrawer', (e) => e.classList.contains('open')), '章节抽屉展开');
  const chBefore = await page.$$eval('.olc-ch', (e) => e.length);
  await page.click('#olcAddCh');
  await sleep(300);
  const chAfter = await page.$$eval('.olc-ch', (e) => e.length);
  ok(chAfter === chBefore + 1, '抽屉里可以加章节（' + chBefore + ' → ' + chAfter + '）');
  ok(await page.$('.olc-dw-body textarea') !== null, '本卷概要可编辑');

  console.log('== 11. 删除情节点连带删线 ==');
  await page.click('.olc-node:nth-child(1)');
  await sleep(200);
  page.once('dialog', (d) => d.accept());
  await page.click('#insDel');
  await sleep(300);
  ok((await page.$$eval('.olc-node', (e) => e.length)) === 1, '节点已删除');
  ok((await page.$$eval('path.olc-edge', (e) => e.length)) === 0, '连着它的线一并删除');

  console.log('== 12. AI 铺这一卷（mock 返回） ==');
  await page.route('**/api/llm', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const isCanvas = JSON.stringify(body.messages || []).includes('情节网络图');
    if (!isCanvas) return route.continue();
    const nodes = [
      { title: '祭坛初鸣', desc: '玄冥在祭坛听见低语，选择隐瞒。', ch: 1 },
      { title: '长老试探', desc: '长老察觉她的异样，安排人盯住她。', ch: 1 },
      { title: '夜访禁地', desc: '她深夜潜回祭坛，发现裂纹在扩大。', ch: 2 },
      { title: '血脉觉醒', desc: '危急时她第一次动用不属于元素的力量。', ch: 2 }
    ];
    const edges = [
      { from: 1, to: 2, type: 'main', label: '追查' },
      { from: 2, to: 3, type: 'char', label: '监视' },
      { from: 1, to: 3, type: 'dark', label: '低语的源头' },
      { from: 3, to: 4, type: 'main', label: '逼到绝境' }
    ];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ nodes, edges }) } }] }) });
  });
  page.once('dialog', (d) => d.accept());
  await page.click('#olcAi');
  await sleep(1200);
  ok((await page.$$eval('.olc-node', (e) => e.length)) === 4, 'AI 铺了 4 个情节点');
  ok((await page.$$eval('path.olc-edge', (e) => e.length)) === 4, 'AI 连了 4 条线');
  const types = await page.$$eval('path.olc-edge', (els) => els.map((e) => e.getAttribute('stroke')));
  ok(new Set(types).size >= 3, '明线/暗线/人物线三种颜色都出现');
  const cols = await page.$$eval('.olc-node', (els) => els.map((e) => e.style.left));
  ok(new Set(cols).size >= 2, '按章节分成多列（' + Array.from(new Set(cols)).join(' / ') + '）');

  console.log('== 13. AI 结果可撤销 ==');
  const undoCount = await page.evaluate(() => (AIUndo.load() || []).length);
  ok(undoCount > 0, 'AI 调用留了撤销点（' + undoCount + ' 步）');

  ok(errs.length === 0, '无 JS 报错' + (errs.length ? '：' + errs.slice(0, 3).join(' | ') : ''));

  console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试崩溃：', e); process.exit(1); });
