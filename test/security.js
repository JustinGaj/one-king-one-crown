'use strict';
// Checks the public-server protections: security headers, same-site WebSockets only,
// per-network connection caps, event rate limits and room-creation limits.
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3600 + Math.floor(Math.random() * 300);
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(p) {
  return new Promise((res, rej) => http.get(URL + p, (r) => { r.resume(); r.on('end', () => res(r)); }).on('error', rej));
}
function connect(opts = {}) {
  return new Promise((res) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false, ...opts });
    s.call = (ev, data = {}) => new Promise((r) => s.emit(ev, data, r));
    s.once('connect', () => res({ s, ok: true }));
    s.once('connect_error', (e) => res({ s, ok: false, error: e.message }));
  });
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT, OKOC_MAX_SOCKETS_PER_IP: '6', OKOC_ROOMS_PER_IP_PER_10_MIN: '3' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errs = '';
  srv.stderr.on('data', (d) => { errs += d; });
  await new Promise((res) => srv.stdout.on('data', (d) => { if (String(d).includes('running')) res(); }));
  const open = [];
  try {
    // Security headers on the page
    const page = await get('/');
    assert(/default-src 'self'/.test(page.headers['content-security-policy']), 'CSP');
    assert(/frame-ancestors 'none'/.test(page.headers['content-security-policy']), 'no framing');
    assert.strictEqual(page.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(page.headers['x-frame-options'], 'DENY');
    assert(!page.headers['x-powered-by'], 'no X-Powered-By');
    assert.strictEqual((await get('/.env')).statusCode, 404, 'no hidden files');

    // A WebSocket from another website is refused; from this site it works
    const evil = await connect({ extraHeaders: { Origin: 'https://evil.example' } });
    assert(!evil.ok, 'cross-site WebSocket refused');
    evil.s.close();
    const good = await connect({ extraHeaders: { Origin: URL } });
    assert(good.ok, 'same-site WebSocket allowed');
    open.push(good.s);

    // Event flood: rate limited
    const spam = await Promise.all(Array.from({ length: 80 }, () => good.s.call('chat', { text: 'hi' })));
    assert(spam.some((r) => r.error === 'Slow down a little.'), 'events are rate limited');
    await sleep(1200);

    // Room creation is limited per network
    const made = [];
    for (let i = 0; i < 5; i++) {
      const c = await connect();
      open.push(c.s);
      made.push(await c.s.call('create', { name: 'P' + i }));
    }
    assert(made.slice(0, 3).every((r) => r.ok), 'first rooms are fine');
    assert(made.slice(3).some((r) => /a lot of rooms/.test(r.error || '')), 'room creation is limited');

    // Connections per network are capped
    const extra = [];
    for (let i = 0; i < 4; i++) extra.push(await connect());
    for (const e of extra) open.push(e.s);
    assert(extra.some((e) => !e.ok && /Too many connections/.test(e.error)), 'connections per network are capped');

    // Bad payloads are rejected, not crashing anything
    const bad = await good.s.call('join', 'not-an-object');
    assert(bad.error, 'non-object payload rejected');

    assert(!errs.trim(), 'server logged errors:\n' + errs);
    console.log('Security test passed.');
    process.exitCode = 0;
  } catch (e) {
    console.error('Security test FAILED:', e.message, errs ? '\nServer stderr:\n' + errs : '');
    process.exitCode = 1;
  } finally {
    for (const s of open) s.close();
    srv.kill();
    setTimeout(() => process.exit(process.exitCode), 200);
  }
})();
