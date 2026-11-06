'use strict';
/**
 * 墨阁 · 小说工坊 —— 本地服务
 * 只监听 127.0.0.1，数据存在 ./data 下，API Key 不出本机。
 */
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, execFile } = require('child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 7788);
const HOST = '0.0.0.0'; // 云沙箱只暴露一个端口，需绑定 0.0.0.0 才能被反向代理访问

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8'
};

/* ---------------- utils ---------------- */

function send(res, code, body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {});
  res.writeHead(code, h);
  res.end(body);
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function loadJSON(file, fallback) {
  try {
    const txt = await fsp.readFile(file, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return fallback;
  }
}

async function saveJSON(file, obj) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  try {
    await fsp.copyFile(file, file + '.bak');
  } catch (e) {}
  await fsp.rename(tmp, file);
}

/* ---------------- static ---------------- */

async function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || p === '') p = '/index.html';
  const target = path.normalize(path.join(PUBLIC_DIR, p));
  if (!target.startsWith(PUBLIC_DIR)) return send(res, 403, '{"error":"forbidden"}');
  try {
    const stat = await fsp.stat(target);
    if (stat.isDirectory()) return send(res, 404, '{"error":"not found"}');
    const ext = path.extname(target).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';

    // 支持 Range：视频背景要能边下边播、能循环 seek
    const range = req.headers.range;
    if (range && /^bytes=/.test(range) && stat.size > 0) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        let start = m[1] === '' ? null : parseInt(m[1], 10);
        let end = m[2] === '' ? null : parseInt(m[2], 10);
        if (start === null && end !== null) {
          start = Math.max(0, stat.size - end);
          end = stat.size - 1;
        } else {
          if (start === null) start = 0;
          if (end === null || end >= stat.size) end = stat.size - 1;
        }
        if (start <= end) {
          res.writeHead(206, {
            'Content-Type': type,
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache'
          });
          fs.createReadStream(target, { start, end }).pipe(res);
          return;
        }
      }
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(target).pipe(res);
  } catch (e) {
    send(res, 404, '{"error":"not found"}');
  }
}

/* ---------------- api: project ---------------- */

/* ---------------- api: library（书库索引） ---------------- */
const LIB_FILE = path.join(DATA_DIR, 'library.json');

/**
 * 以磁盘上的书目录为准，把索引补齐／清理：
 * - 磁盘上存在、索引里缺失的书 → 加回索引（避免「其他文库进不去」）
 * - 索引里存在、但磁盘目录已不存在的书 → 从索引剔除（被删除的书不再复活）
 */
async function reconcileBooks(lib) {
  const dir = path.join(DATA_DIR, 'books');
  let names = [];
  try { names = await fsp.readdir(dir); } catch (e) { return lib; }
  const onDisk = new Map();
  for (const name of names) {
    const pj = path.join(dir, name, 'project.json');
    try {
      const st = await fsp.stat(pj);
      if (!st.isFile()) continue;
      let meta = {};
      try { meta = JSON.parse(await fsp.readFile(pj, 'utf8')).meta || {}; } catch (e) {}
      onDisk.set(name, meta);
    } catch (e) {}
  }
  const prevById = new Map((lib.books || []).map((b) => [b.id, b]));
  const books = [];
  for (const [id, meta] of onDisk) {
    const prev = prevById.get(id) || {};
    books.push({
      id,
      title: prev.title || meta.title || '未命名作品',
      genre: prev.genre || (meta.genre || ''),
      createdAt: prev.createdAt || (meta.createdAt || ''),
      updatedAt: prev.updatedAt || (meta.updatedAt || '')
    });
  }
  lib.books = books;
  if (!lib.books.some((b) => b.id === lib.current)) {
    lib.current = lib.books.length ? lib.books[0].id : 'default';
  }
  return lib;
}

async function ensureLibrary() {
  let lib = await loadJSON(LIB_FILE, null);
  if (!lib || !Array.isArray(lib.books)) lib = { version: 1, current: 'default', books: [] };
  const before = JSON.stringify(lib);
  lib = await reconcileBooks(lib);
  if (JSON.stringify(lib) !== before) {
    await saveJSON(LIB_FILE, lib);
  }
  return lib;
}

async function handleLibrary(req, res) {
  if (req.method === 'GET') {
    const lib = await ensureLibrary();
    return send(res, 200, JSON.stringify(lib));
  }
  if (req.method === 'POST') {
    const raw = await readBody(req);
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: 'JSON 解析失败' }));
    }
    const lib = await ensureLibrary();
    const next = {
      version: 1,
      current: obj.current || lib.current,
      books: Array.isArray(obj.books)
        ? obj.books.map((b) => ({ id: b.id, title: b.title || '未命名', genre: b.genre || '', createdAt: b.createdAt || '', updatedAt: b.updatedAt || '' }))
        : lib.books
    };
    await saveJSON(LIB_FILE, next);
    return send(res, 200, JSON.stringify({ ok: true }));
  }
  send(res, 405, '{"error":"method not allowed"}');
}

/* ---------------- api: book（单本书 project.json） ---------------- */
async function bookDir(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('无效的书本 id');
  return path.join(DATA_DIR, 'books', safe);
}

async function handleBook(req, res, id) {
  let dir;
  try {
    dir = await bookDir(id);
  } catch (e) {
    return send(res, 400, JSON.stringify({ error: e.message }));
  }
  const file = path.join(dir, 'project.json');
  if (req.method === 'GET') {
    const data = await loadJSON(file, null);
    if (!data) return send(res, 404, JSON.stringify({ error: '这本书还不存在' }));
    return send(res, 200, JSON.stringify(data));
  }
  if (req.method === 'POST') {
    const raw = await readBody(req);
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: 'JSON 解析失败' }));
    }
    await fsp.mkdir(dir, { recursive: true });
    obj.meta = obj.meta || {};
    obj.meta.updatedAt = new Date().toISOString();
    await saveJSON(file, obj);
    // 同步刷新书库索引里的标题 / 更新时间
    try {
      const lib = await loadJSON(LIB_FILE, null);
      if (lib && lib.books) {
        const b = lib.books.find((x) => x.id === id);
        if (b) {
          b.updatedAt = obj.meta.updatedAt;
          if (obj.meta.title) b.title = obj.meta.title;
          if (obj.meta.genre !== undefined) b.genre = obj.meta.genre;
          await saveJSON(LIB_FILE, lib);
        }
      }
    } catch (e) {}
    return send(res, 200, JSON.stringify({ ok: true, updatedAt: obj.meta.updatedAt }));
  }
  if (req.method === 'DELETE') {
    // 整本删除：移除数据目录 + 同步索引
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (e) {}
    const lib = await loadJSON(LIB_FILE, null);
    if (lib && Array.isArray(lib.books)) {
      lib.books = lib.books.filter((b) => b.id !== id);
      if (lib.current === id) lib.current = lib.books[0] ? lib.books[0].id : 'default';
      await saveJSON(LIB_FILE, lib);
    }
    return send(res, 200, JSON.stringify({ ok: true }));
  }
  send(res, 405, '{"error":"method not allowed"}');
}

/* ---------------- api: book novel（单本书原文） ---------------- */
/* 地图册：按书存放 data/books/<id>/atlas.json */
async function handleAtlas(req, res, bookId) {
  let dir;
  try {
    dir = await bookDir(bookId || 'default');
  } catch (e) {
    return send(res, 400, JSON.stringify({ error: e.message }));
  }
  const file = path.join(dir, 'atlas.json');
  if (req.method === 'GET') {
    const d = await loadJSON(file, null);
    return send(res, 200, JSON.stringify({ ok: true, data: d }));
  }
  if (req.method === 'POST') {
    let obj;
    try {
      obj = JSON.parse(await readBody(req, 8 * 1024 * 1024));
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: 'JSON 解析失败' }));
    }
    if (!obj || !Array.isArray(obj.maps)) return send(res, 400, JSON.stringify({ error: '地图数据格式不对' }));
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
    return send(res, 200, JSON.stringify({ ok: true, maps: obj.maps.length }));
  }
  return send(res, 405, JSON.stringify({ error: 'method not allowed' }));
}

async function handleBookNovel(req, res, id) {
  let dir;
  try {
    dir = await bookDir(id);
  } catch (e) {
    return send(res, 400, JSON.stringify({ error: e.message }));
  }
  const file = path.join(dir, 'novel.txt');
  if (req.method === 'GET') {
    try {
      const txt = await fsp.readFile(file, 'utf8');
      return send(res, 200, JSON.stringify({ ok: true, name: path.basename(file), chars: txt.length, text: txt }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ ok: false }));
    }
  }
  if (req.method === 'POST') {
    const raw = await readBody(req, 32 * 1024 * 1024);
    let body;
    try {
      body = JSON.parse(raw);
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: 'JSON 解析失败' }));
    }
    const text = String(body.text || '');
    if (!text.trim()) return send(res, 400, JSON.stringify({ error: '文本为空' }));
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(file, text, 'utf8');
    return send(res, 200, JSON.stringify({ ok: true, chars: text.length }));
  }
  if (req.method === 'DELETE') {
    try {
      await fsp.unlink(file);
    } catch (e) {}
    return send(res, 200, JSON.stringify({ ok: true }));
  }
  send(res, 405, '{"error":"method not allowed"}');
}

/* ---------------- api: settings ---------------- */

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

function maskKey(k) {
  k = String(k || '');
  return k ? k.slice(0, 4) + '••••' + k.slice(-4) : '';
}

/** 老的扁平配置 → profiles[0]，只做一次，落盘 */
async function migrateSettings(s) {
  if (Array.isArray(s.profiles) && s.profiles.length) {
    if (!s.usage || typeof s.usage !== 'object') s.usage = {};
    return s;
  }
  s.profiles = [{
    id: 'p_default',
    name: '默认配置',
    baseUrl: String(s.baseUrl || '').trim(),
    apiKey: String(s.apiKey || '').trim(),
    model: String(s.model || '').trim(),
    temperature: s.temperature == null ? 0.9 : Number(s.temperature),
    maxTokens: Number(s.maxTokens) || 2048,
    imageBaseUrl: String(s.imageBaseUrl || '').trim(),
    imageApiKey: String(s.imageApiKey || '').trim(),
    imageModel: String(s.imageModel || '').trim(),
    imageSize: String(s.imageSize || '1024x1024')
  }];
  if (!s.profiles.some((p) => p.id === s.currentProfile)) s.currentProfile = 'p_default';
  if (!s.usage || typeof s.usage !== 'object') s.usage = {};
  await saveJSON(SETTINGS_FILE, s);
  return s;
}

/**
 * 解析本次调用该用哪套配置：
 * 显式 body.profile > 场景映射 usage[body.usage] > currentProfile > 第一套 > 扁平老字段
 */
function pickProfile(cfg, body) {
  const list = Array.isArray(cfg.profiles) ? cfg.profiles : [];
  let p = null;
  if (body.profile) p = list.find((x) => x.id === body.profile) || null;
  if (!p && body.usage && cfg.usage && cfg.usage[body.usage]) {
    p = list.find((x) => x.id === cfg.usage[body.usage]) || null;
  }
  if (!p && cfg.currentProfile) p = list.find((x) => x.id === cfg.currentProfile) || null;
  if (!p && list.length) p = list[0];
  return p || {};
}

async function handleSettings(req, res) {
  if (req.method === 'GET') {
    let s = await loadJSON(SETTINGS_FILE, {});
    if (!s || typeof s !== 'object') s = {};
    s = await migrateSettings(s);
    // currentProfile 指向不存在的配置时纠偏
    const list = Array.isArray(s.profiles) ? s.profiles : [];
    let cur = list.find((p) => p.id === s.currentProfile) || list[0] || null;
    if (list.length && cur && s.currentProfile !== cur.id) {
      s.currentProfile = cur.id;
      await saveJSON(SETTINGS_FILE, s);
    }
    if (!cur) cur = {};
    // 兼容镜像：老代码只看 baseUrl / model / apiKeyMasked 等扁平字段
    const resp = JSON.parse(JSON.stringify(s));
    resp.baseUrl = cur.baseUrl || '';
    resp.model = cur.model || '';
    resp.temperature = cur.temperature == null ? 0.9 : cur.temperature;
    resp.maxTokens = cur.maxTokens || 2048;
    resp.apiKeyMasked = maskKey(cur.apiKey);
    resp.imageBaseUrl = cur.imageBaseUrl || cur.baseUrl || '';
    resp.imageModel = cur.imageModel || '';
    resp.imageSize = cur.imageSize || '1024x1024';
    resp.imageApiKeyMasked = maskKey(cur.imageApiKey || (cur.imageBaseUrl ? cur.imageApiKey : cur.apiKey));
    delete resp.apiKey;
    delete resp.imageApiKey;
    // profiles 里的明文 Key 也不出服务端，只给掩码
    resp.profiles = (list || []).map((p) => {
      const q = Object.assign({}, p);
      q.apiKeyMasked = maskKey(p.apiKey);
      q.hasKey = !!p.apiKey;
      q.imageApiKeyMasked = maskKey(p.imageApiKey);
      q.hasImageKey = !!p.imageApiKey;
      delete q.apiKey;
      delete q.imageApiKey;
      return q;
    });
    return send(res, 200, JSON.stringify(resp));
  }
  if (req.method === 'POST') {
    const raw = await readBody(req);
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: 'JSON 解析失败' }));
    }
    const cur = await migrateSettings(await loadJSON(SETTINGS_FILE, {}));
    const next = Object.assign({}, cur, obj);
    if (!obj.apiKey && cur.apiKey) next.apiKey = cur.apiKey;
    if (!obj.imageApiKey && cur.imageApiKey) next.imageApiKey = cur.imageApiKey;
    // profiles：按 id 合并，Key 留空 = 沿用旧值
    if (Array.isArray(obj.profiles)) {
      const prev = new Map(((cur.profiles || []).map((p) => [p.id, p])));
      next.profiles = obj.profiles.map((p) => {
        const old = prev.get(p.id);
        const np = {
          id: p.id || ('p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
          name: String(p.name || '').slice(0, 40).trim() || '未命名',
          baseUrl: String(p.baseUrl || '').trim(),
          model: String(p.model || '').trim(),
          temperature: p.temperature == null ? 0.9 : Number(p.temperature),
          maxTokens: Number(p.maxTokens) || 2048,
          imageBaseUrl: String(p.imageBaseUrl || '').trim(),
          imageModel: String(p.imageModel || '').trim(),
          imageSize: String(p.imageSize || '1024x1024')
        };
        np.apiKey = String(p.apiKey || '').trim() || (old && old.apiKey) || '';
        np.imageApiKey = String(p.imageApiKey || '').trim() || (old && old.imageApiKey) || '';
        return np;
      });
    }
    if (!Array.isArray(next.profiles)) next.profiles = cur.profiles || [];
    if (obj.currentProfile !== undefined) next.currentProfile = obj.currentProfile;
    if (!next.profiles.some((p) => p.id === next.currentProfile)) {
      next.currentProfile = next.profiles[0] ? next.profiles[0].id : '';
    }
    if (obj.usage && typeof obj.usage === 'object') {
      next.usage = Object.assign({}, cur.usage || {}, obj.usage);
    }
    await saveJSON(SETTINGS_FILE, next);
    return send(res, 200, JSON.stringify({ ok: true }));
  }
  send(res, 405, '{"error":"method not allowed"}');
}

/* ---------------- api: llm proxy ---------------- */

async function handleLLM(req, res) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch (e) {
    return send(res, 400, JSON.stringify({ error: 'JSON 解析失败' }));
  }
  const cfg = await migrateSettings(await loadJSON(SETTINGS_FILE, {}));
  const prof = pickProfile(cfg, body);
  const baseUrl = String(body.baseUrl || prof.baseUrl || '').trim().replace(/\/+$/, '');
  const apiKey = String(body.apiKey || prof.apiKey || '').trim();
  const model = String(body.model || prof.model || '').trim();

  if (!baseUrl) return send(res, 400, JSON.stringify({ error: '还没有配置 API 地址，请到「设置」里填写。' }));
  if (!model) return send(res, 400, JSON.stringify({ error: '还没有配置模型名。' }));

  const endpoint = /\/chat\/completions$/.test(baseUrl) ? baseUrl : baseUrl + '/chat/completions';
  const payload = {
    model,
    messages: body.messages || [],
    temperature: typeof body.temperature === 'number'
      ? body.temperature
      : (typeof prof.temperature === 'number' ? prof.temperature : Number(cfg.temperature ?? 0.85)),
    max_tokens: body.maxTokens || prof.maxTokens || cfg.maxTokens || 2048,
    stream: !!body.stream
  };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return send(res, 502, JSON.stringify({ error: '连不上 API：' + e.message }));
  }

  if (!upstream.ok) {
    const t = await upstream.text().catch(() => '');
    return send(res, upstream.status, JSON.stringify({ error: 'API 返回 ' + upstream.status + '：' + t.slice(0, 600) }));
  }

  if (!payload.stream) {
    const j = await upstream.json().catch(() => null);
    return send(res, 200, JSON.stringify(j || { error: '响应解析失败' }));
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  try {
    for await (const chunk of upstream.body) {
      res.write(chunk);
    }
  } catch (e) {
    /* 客户端中断或上游断开 */
  }
  res.end();
}

/* ---------------- api: image proxy ---------------- */

/**
 * 图像生成代理。
 * 兼容 OpenAI 的 /images/generations：返回 b64_json 或 url。
 * 图片统一落盘到 data/images/，前端只拿到 /images/xxx.png 本地路径。
 */
async function handleImage(req, res) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch (e) {
    return send(res, 400, JSON.stringify({ error: 'JSON 解析失败' }));
  }
  const cfg = await migrateSettings(await loadJSON(SETTINGS_FILE, {}));
  const prof = pickProfile(cfg, { profile: body.profile, usage: body.usage || 'image' });
  const baseUrl = String(body.baseUrl || prof.imageBaseUrl || prof.baseUrl || '').trim().replace(/\/+$/, '');
  const apiKey = String(body.apiKey || prof.imageApiKey || prof.apiKey || '').trim();
  const model = String(body.model || prof.imageModel || '').trim();
  const size = String(body.size || prof.imageSize || cfg.imageSize || '1024x1024').trim();
  const prompt = String(body.prompt || '').trim();

  if (!baseUrl) return send(res, 400, JSON.stringify({ error: '还没有配置图像接口地址，请到「设置」里填写。' }));
  if (!model) return send(res, 400, JSON.stringify({ error: '还没有配置图像模型名。' }));
  if (!prompt) return send(res, 400, JSON.stringify({ error: '提示词是空的。' }));

  const endpoint = /\/images\/generations$/.test(baseUrl) ? baseUrl : baseUrl + '/images/generations';
  const payload = { model, prompt, n: 1, size };
  if (body.responseFormat) payload.response_format = body.responseFormat;

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return send(res, 502, JSON.stringify({ error: '连不上图像接口：' + e.message }));
  }

  if (!upstream.ok) {
    const t = await upstream.text().catch(() => '');
    return send(res, upstream.status, JSON.stringify({ error: '图像接口返回 ' + upstream.status + '：' + t.slice(0, 600) }));
  }

  const j = await upstream.json().catch(() => null);
  const item = j && j.data && j.data[0];
  if (!item) return send(res, 502, JSON.stringify({ error: '图像接口没有返回图片数据：' + JSON.stringify(j).slice(0, 400) }));

  const imgDir = path.join(DATA_DIR, 'images');
  await fsp.mkdir(imgDir, { recursive: true });
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  let name = '';
  let mime = 'image/png';

  if (item.b64_json) {
    name = `img_${stamp}.png`;
    const buf = Buffer.from(item.b64_json, 'base64');
    await fsp.writeFile(path.join(imgDir, name), buf);
  } else if (item.url) {
    name = `img_${stamp}.png`;
    try {
      const r = await fetch(item.url);
      if (!r.ok) throw new Error('下载图片失败 ' + r.status);
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('jpeg')) {
        name = `img_${stamp}.jpg`;
        mime = 'image/jpeg';
      } else if (ct.includes('webp')) {
        name = `img_${stamp}.webp`;
        mime = 'image/webp';
      }
      const buf = Buffer.from(await r.arrayBuffer());
      await fsp.writeFile(path.join(imgDir, name), buf);
    } catch (e) {
      return send(res, 502, JSON.stringify({ error: '图片生成成功但下载失败：' + e.message }));
    }
  } else {
    return send(res, 502, JSON.stringify({ error: '接口返回里既没有 b64_json 也没有 url' }));
  }

  return send(res, 200, JSON.stringify({ url: '/images/' + name, name, mime, revised: item.revised_prompt || '' }));
}

/* ---------------- api: images 静态 ---------------- */

async function serveImage(req, res, urlPath) {
  const name = path.basename(decodeURIComponent(urlPath));
  const target = path.join(DATA_DIR, 'images', name);
  if (!target.startsWith(path.join(DATA_DIR, 'images'))) return send(res, 403, '{"error":"forbidden"}');
  try {
    const stat = await fsp.stat(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'max-age=31536000'
    });
    fs.createReadStream(target).pipe(res);
  } catch (e) {
    send(res, 404, '{"error":"not found"}');
  }
}

/* ---------------- api: 系统壁纸（跟随桌面） ---------------- */

function execFileP(cmd, args) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
    } catch (e) {
      resolve('');
    }
  });
}

async function resolveWallpaper() {
  const appData = process.env.APPDATA;
  const cands = [];
  if (appData) {
    // 当前实际显示的那张壁纸（无论来源，永远是最新的）
    cands.push(path.join(appData, 'Microsoft/Windows/Themes/TranscodedWallpaper'));
    // Wallpaper Engine 覆盖图
    cands.push(path.join(appData, 'Microsoft/Windows/Themes/WallpaperEngineOverride.jpg'));
  }
  // 注册表里记录的壁纸路径（幻灯片 / 自定义时更准）
  const out = await execFileP('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper']);
  const m = out && out.match(/WallPaper\s+REG_SZ\s+(.+)/i);
  if (m) {
    const p = m[1].trim();
    if (p && !/^\(.*\)$/.test(p)) cands.push(p);
  }
  for (const c of cands) {
    try {
      const st = await fsp.stat(c);
      if (st.isFile()) return c;
    } catch (e) {}
  }
  // 兜底：内置那张
  return path.join(PUBLIC_DIR, 'wallpaper/moge-bg.jpg');
}

function gradientWallpaper() {
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#2b2438"/>' +
    '<stop offset="0.55" stop-color="#1b2230"/>' +
    '<stop offset="1" stop-color="#0e121a"/>' +
    '</linearGradient></defs>' +
    '<rect width="1600" height="900" fill="url(#g)"/></svg>';
  return Buffer.from(svg, 'utf8');
}

async function handleWallpaper(req, res) {
  try {
    const file = await resolveWallpaper();
    const buf = await fsp.readFile(file);
    let mime = 'image/jpeg';
    if (buf.length > 3) {
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) mime = 'image/png';
      else if (buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) mime = 'image/webp';
    }
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch (e) {
    // 找不到系统壁纸（如云环境）时回退到内置渐变，避免 404
    const svg = gradientWallpaper();
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    res.end(svg);
  }
}

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/api/health') return send(res, 200, JSON.stringify({ ok: true }));
    if (u.pathname === '/api/library') return await handleLibrary(req, res);
    if (u.pathname === '/api/settings') return await handleSettings(req, res);
    if (u.pathname === '/api/llm' && req.method === 'POST') return await handleLLM(req, res);
    if (u.pathname === '/api/image' && req.method === 'POST') return await handleImage(req, res);
    const bm = u.pathname.match(/^\/api\/book\/([^/]+)(\/novel)?$/);
    if (bm) {
      const id = decodeURIComponent(bm[1]);
      if (bm[2]) return await handleBookNovel(req, res, id);
      return await handleBook(req, res, id);
    }
    if (u.pathname === '/api/atlas') return await handleAtlas(req, res, u.searchParams.get('book'));
    if (u.pathname === '/api/wallpaper') return await handleWallpaper(req, res);
    if (u.pathname.startsWith('/images/')) return await serveImage(req, res, u.pathname);
    return await serveStatic(req, res);
  } catch (e) {
    try {
      send(res, 500, JSON.stringify({ error: e.message }));
    } catch (_) {}
  }
});

function openBrowser() {
  if (process.env.NO_OPEN) return;
  const url = `http://localhost:${PORT}`;
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {}
}

(async () => {
  await fsp.mkdir(DATA_DIR, { recursive: true });

  // 端口被占用 = 已经有一个墨阁在跑，直接把浏览器叫起来就行
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      const url = `http://localhost:${PORT}`;
      console.log('\n  墨阁已经在运行了，正在打开 ' + url + '\n');
      openBrowser();
      setTimeout(() => process.exit(0), 800);
      return;
    }
    console.error(e);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    const url = `http://localhost:${PORT}`;
    console.log('\n  墨阁 · 小说工坊已启动');
    console.log('  ' + url + '  （绑定 ' + HOST + ':' + PORT + '）');
    console.log('\n  这个黑窗口不要关，关掉服务就停了。');
    console.log('  数据在 data/ 下\n');
    openBrowser();
  });
})();
