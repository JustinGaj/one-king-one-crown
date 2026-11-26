'use strict';
// End-to-end multiplayer test: starts the real server, connects 5 socket clients,
// checks hidden information, reconnection, and plays a whole game on autopilot.
// Usage: node test/multiplayer.js
const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3100 + Math.floor(Math.random() * 500);
const URL = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  s.last = null;
  s.on('state', (st) => { s.last = st; });
  s.call = (ev, data = {}) => new Promise((res) => s.emit(ev, data, res));
  return s;
}
async function until(fn, ms = 10000, what = 'condition') {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error('Timed out waiting for ' + what);
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errs = '';
  srv.stderr.on('data', (d) => { errs += d; });
  await new Promise((res) => srv.stdout.on('data', (d) => { if (String(d).includes('running')) res(); }));
  const clients = [];
  try {
    const host = client(); clients.push(host);
    const created = await host.call('create', { name: 'Host' });
    assert(created.ok && created.code, 'room created');
    const code = created.code;
    const joined = [];
    for (const n of ['Ann', 'Ben', 'Cat', 'Dan']) {
      const c = client(); clients.push(c);
      const r = await c.call('join', { code, name: n });
      assert(r.ok, 'join ' + n);
      joined.push(r);
    }
    const dup = await client().call('join', { code, name: 'ann' });
    assert(dup.error, 'duplicate names are rejected');
    const nonHost = await clients[1].call('host:start');
    assert(nonHost.error, 'only the host can start');
    assert((await clients[1].call('host:settings', { speed: 'fast' })).error, 'only the host sets the speed');
    await host.call('host:settings', { negotiationSeconds: 3, speed: 'fast' });
    await until(() => host.last && host.last.room.settings.speed === 'fast' && host.last.room.settings.pace === 'fast', 3000, 'speed setting');
    assert((await host.call('host:start')).ok, 'start');
    await until(() => clients.every((c) => c.last && c.last.game), 5000, 'everyone gets the game');

    // Hidden information: each player sees only their own hand; others only as counts.
    for (const c of clients) {
      const g = c.last.game;
      const me = g.players.find((p) => p.pid === g.me);
      assert.strictEqual(g.hand.length, me.handCount, 'own hand matches count');
      assert(!JSON.stringify(g.players).includes('"hand"'), 'no other hands are sent');
      assert(g.prompts.every((p) => p.pid === g.me), 'only own prompts are sent');
    }
    const king = clients[0].last.game.players[0];
    assert(king.isKing && king.gold === 1000, 'King has 1000');
    assert(clients[0].last.game.players.slice(1).every((p) => p.gold === 600), 'Nobles have 600');
    const uids = new Set();
    for (const c of clients) for (const h of c.last.game.hand) { assert(!uids.has(h.uid), 'no card in two hands'); uids.add(h.uid); }

    // Wrong player can't play
    const kingClient = clients.find((c) => c.last.game.me === king.pid);
    const other = clients.find((c) => c !== kingClient);
    const bad = await other.call('play', { uid: other.last.game.hand[0].uid });
    assert(bad.error, 'cannot play out of turn');

    // Reconnect: drop a client and resume with its token
    const ann = clients[1];
    ann.disconnect();
    await sleep(300);
    const again = client(); clients[1] = again;
    const resumed = await again.call('resume', { code, pid: joined[0].pid, token: joined[0].token });
    assert(resumed.ok, 'resume with token');
    const forged = await client().call('resume', { code, pid: joined[0].pid, token: 'nope' });
    assert(forged.error, 'resume with a wrong token is rejected');
    await until(() => again.last && again.last.game, 3000, 'resumed state');

    // Everyone goes on autopilot and the game plays to the end
    for (const c of clients) assert((await c.call('auto', { on: true })).ok);
    await until(() => clients.every((c) => c.last.game && c.last.game.phase === 'over'), 240000, 'game over');
    const winners = new Set(clients.map((c) => c.last.game.winner));
    assert.strictEqual(winners.size, 1, 'everyone agrees on the winner');
    const g = clients[0].last.game;
    assert.strictEqual(g.players[0].pid, g.winner, 'the winner is the King');
    for (const p of g.players) assert(p.gold >= 0 && p.gold <= 2000);
    // Back to lobby and a second game can start
    assert((await host.call('host:lobby')).ok);
    await until(() => host.last && !host.last.game, 3000, 'lobby');
    assert(!errs.trim(), 'server logged errors:\n' + errs);
    console.log(`Multiplayer test passed (room ${code}, winner ${g.players[0].name}).`);
    process.exitCode = 0;
  } catch (e) {
    console.error('Multiplayer test FAILED:', e.message, errs ? '\nServer stderr:\n' + errs : '');
    process.exitCode = 1;
  } finally {
    for (const c of clients) c.close();
    srv.kill();
    setTimeout(() => process.exit(process.exitCode), 200);
  }
})();
