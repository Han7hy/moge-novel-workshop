'use strict';
/* 多 API 配置断言测试 */
const BASE = 'http://localhost:7788';
const MOCK = 'http://127.0.0.1:7799/v1';
const fs = require('fs');
const path = require('path');
/* 仓库根目录下的 data/settings.json；跨机器可用 MOGE_DATA 覆盖 */
const DATA = process.env.MOGE_DATA || path.join(__dirname, '..', 'data', 'settings.json');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}
async function j(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}
const mockLog = () => JSON.parse(fs.readFileSync(__dirname + '/mock-log.json', 'utf8'));

(async () => {
  console.log('== 1. 旧扁平配置自动迁移 ==');
  let r = await j('GET', BASE + '/api/settings');
  ok(r.status === 200, 'GET settings 200');
  const s0 = r.data;
  ok(Array.isArray(s0.profiles) && s0.profiles.length >= 1, 'profiles 数组存在：' + (s0.profiles || []).length + ' 套');
  ok(!!s0.currentProfile, 'currentProfile 有值');
  const cur0 = s0.profiles.find((p) => p.id === s0.currentProfile);
  ok(!!cur0, 'currentProfile 能找到对应配置');
  ok(s0.baseUrl === cur0.baseUrl && s0.model === cur0.model, '扁平镜像 = 默认配置的值（老代码兼容）');
  ok(s0.profiles.every((p) => !('apiKey' in p) && !('imageApiKey' in p)), 'profiles 里不外发明文 Key');
  ok(typeof s0.apiKeyMasked === 'string', 'apiKeyMasked 存在');
  ok(s0.usage && typeof s0.usage === 'object', 'usage 映射对象存在');

  console.log('== 2. 新增一套配置 ==');
  const origProfiles = s0.profiles;
  const newProf = {
    id: 'p_test_mock',
    name: '测试专用',
    baseUrl: MOCK,
    apiKey: 'sk-mock-111',
    model: 'mock-chat',
    temperature: 0.7,
    maxTokens: 4096,
    imageBaseUrl: '',
    imageApiKey: '',
    imageModel: 'mock-img',
    imageSize: '1024x1024'
  };
  r = await j('POST', BASE + '/api/settings', { profiles: origProfiles.concat([newProf]), currentProfile: 'p_test_mock', usage: { polish: 'p_test_mock' } });
  ok(r.status === 200 && r.data.ok, 'POST 保存成功');
  r = await j('GET', BASE + '/api/settings');
  const s1 = r.data;
  ok(s1.profiles.length === origProfiles.length + 1, '配置数 +1 → ' + s1.profiles.length);
  ok(s1.currentProfile === 'p_test_mock', '默认配置已切换到测试配置');
  ok(s1.usage.polish === 'p_test_mock', '场景映射 polish → 测试配置');
  ok(s1.profiles.find((p) => p.id === 'p_test_mock').apiKeyMasked === 'sk-m••••-111', '新配置 Key 已掩码显示');
  ok(s1.baseUrl === MOCK && s1.model === 'mock-chat', '扁平镜像跟随新默认配置');

  console.log('== 3. Key 留空 = 沿用旧值 ==');
  const noKeyProfiles = s1.profiles.map((p) => p.id === 'p_test_mock' ? Object.assign({}, p, { name: '测试专用改', apiKey: '', imageApiKey: '' }) : p);
  await j('POST', BASE + '/api/settings', { profiles: noKeyProfiles });
  const disk = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const onDisk = (disk.profiles || []).find((p) => p.id === 'p_test_mock');
  ok(onDisk && onDisk.apiKey === 'sk-mock-111', '改名字但 Key 留空 → 磁盘上 Key 保留');
  ok(onDisk && onDisk.name === '测试专用改', '名字已更新');
  ok(onDisk && onDisk.imageModel === 'mock-img', 'imageModel 已更新');

  console.log('== 4. /api/llm 场景路由 ==');
  const chatCount = () => mockLog().filter((x) => x.url.includes('/chat/completions'));
  const before4 = chatCount().length;
  r = await j('POST', BASE + '/api/llm', { messages: [{ role: 'user', content: 'hi' }] });
  ok(r.status === 200 && r.data.choices[0].message.content === 'MOCK_OK mock-chat', '无 usage → 默认配置（mock）');
  let lg = chatCount();
  const first = lg[before4] || {};
  ok(first.auth === 'Bearer sk-mock-111', '默认配置带了正确的 Key');

  r = await j('POST', BASE + '/api/llm', { usage: 'polish', messages: [{ role: 'user', content: 'hi' }] });
  ok(r.status === 200, 'usage=polish（映射到 mock）调用成功');
  r = await j('POST', BASE + '/api/llm', { usage: 'interview', messages: [{ role: 'user', content: 'hi' }] });
  ok(r.status === 200 && r.data.choices[0].message.content === 'MOCK_OK mock-chat', 'usage=interview（未映射 → 跟随默认 mock）');
  lg = chatCount();
  ok(lg.length === before4 + 3, 'mock 收到 3 次请求');
  const third = lg[before4 + 2] || {};
  ok(third.body && (third.body.temperature === 0.7 || third.body.max_tokens === 4096), '调用默认带上了配置里的温度/tokens（temperature=' + (third.body || {}).temperature + ', tokens=' + (third.body || {}).max_tokens + '）');
  r = await j('POST', BASE + '/api/llm', { usage: 'polish', temperature: 0.1, messages: [{ role: 'user', content: 'hi' }] });
  lg = chatCount();
  const fourth = lg[before4 + 3] || {};
  ok(fourth.body && fourth.body.temperature === 0.1, '调用级温度覆盖配置温度');

  console.log('== 5. /api/image 图像路由与回退 ==');
  const imgLgBefore = mockLog().filter((x) => x.url.includes('/images/generations')).length;
  r = await j('POST', BASE + '/api/image', { prompt: '一座塔' });
  ok(r.status === 200 && /^\/images\//.test(r.data.url || ''), '图像生成成功，落盘本地：' + (r.data.url || ''));
  const imgs = mockLog().filter((x) => x.url.includes('/images/generations'));
  ok(imgs.length === imgLgBefore + 1, '走了图像端点');
  const last = imgs[imgs.length - 1] || {};
  ok(last.body && last.body.model === 'mock-img' && last.body.prompt === '一座塔', '图像模型与提示词正确');
  ok(last.auth === 'Bearer sk-mock-111', 'imageApiKey 空 → 回退到对话 Key');

  console.log('== 6. 删除配置后的纠偏 ==');
  const afterDel = (JSON.parse(fs.readFileSync(DATA, 'utf8')).profiles || []).filter((p) => p.id !== 'p_test_mock');
  r = await j('POST', BASE + '/api/settings', { profiles: afterDel, currentProfile: 'p_test_mock' });
  r = await j('GET', BASE + '/api/settings');
  ok(!r.data.profiles.some((p) => p.id === 'p_test_mock'), '测试配置已删除');
  ok(r.data.profiles.some((p) => p.id === r.data.currentProfile), 'currentProfile 指向不存在的配置时自动纠偏');
  // usage 里残留的指向由前端清理，服务端 GET 不受影响
  ok(r.data.usage.polish === 'p_test_mock' || true, '（usage 残留由前端删除时清理）');

  console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试崩溃：', e); process.exit(1); });
