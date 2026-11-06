'use strict';
/* 测试用 mock OpenAI 兼容上游：记录收到的 model / Authorization，按端口区分身份 */
const http = require('http');
const log = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const rec = { url: req.url, auth: req.headers.authorization || '', body: null };
    try { rec.body = JSON.parse(body); } catch (e) {}
    log.push(rec);
    try { fs.writeFileSync(__dirname + '/mock-log.json', JSON.stringify(log)); } catch (e) {}
    if (req.url.includes('/chat/completions')) {
      const model = rec.body ? rec.body.model : 'x';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'MOCK_OK ' + model } }] }));
    } else if (req.url.includes('/images/generations')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('fakepng').toString('base64') }] }));
    } else {
      res.writeHead(404); res.end('{}');
    }
  });
});

server.listen(7799, '127.0.0.1', () => {
  console.log('mock upstream on 7799');
});

process.on('SIGTERM', () => process.exit(0));

// 把日志落盘供断言读取
setInterval(() => {}, 1000);
const fs = require('fs');
process.on('exit', () => {});
fs.writeFileSync(__dirname + '/mock-log-start', '1');
// 每 200ms 刷新日志文件
setInterval(() => {}, 1000);
