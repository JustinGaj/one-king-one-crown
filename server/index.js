'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Room } = require('./room');
const { GameError } = require('./game');
const { CATALOG } = require('./cards');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

const PUBLIC = path.join(__dirname, '..', 'public');
// Serve index.html with versioned asset URLs so browsers always load the current client
const BUILD = Date.now().toString(36);
const INDEX = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
  .replace(/(\/(?:app|guide)\.js|\/style\.css)"/g, `$1?v=${BUILD}"`);
app.get(['/', '/index.html'], (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(INDEX); });
app.use('/art', express.static(path.join(PUBLIC, 'art'), { maxAge: '7d' }));
app.use(express.static(PUBLIC, { maxAge: 0, etag: true })); // always revalidate code so updates show up
app.get('/api/cards', (req, res) => res.json(CATALOG));
app.get('/healthz', (req, res) => res.send('ok'));

const rooms = new Map();
const ROOM_IDLE_MS = 30 * 60 * 1000;

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); } while (rooms.has(code));
  return code;
}

function onEmpty(room) {
  // Remove rooms nobody has been in for a while
  setTimeout(() => {
    const stillEmpty = ![...room.members.values()].some((m) => !m.isBot && m.sockets.size);
    if (stillEmpty && Date.now() - room.lastActive >= ROOM_IDLE_MS - 1000 && rooms.get(room.code) === room) {
      rooms.delete(room.code);
      for (const p of (room.game ? room.game.prompts.values() : [])) p.resolve(null);
    }
  }, ROOM_IDLE_MS);
}

io.on('connection', (socket) => {
  let room = null;
  let pid = null;

  const enter = (r, member) => {
    if (room && pid) room.detach(pid, socket);
    room = r;
    pid = member.pid;
    room.attach(pid, member.token, socket);
    return { code: room.code, pid, token: member.token };
  };

  // Wrap a handler so it always acks { ok } or { error }
  const on = (event, fn) => socket.on(event, (data, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    try {
      const res = fn(data || {});
      ack({ ok: true, ...(res || {}) });
    } catch (e) {
      if (!(e instanceof GameError)) console.error(e);
      ack({ error: e instanceof GameError ? e.message : 'Something went wrong.' });
    }
  });
  const need = () => { if (!room || !pid) throw new GameError('You are not in a room.'); return room; };
  const game = () => { const r = need(); if (!r.game || r.game.phase === 'over') throw new GameError('No game is running.'); return r.game; };

  on('create', ({ name }) => {
    const r = new Room(newCode(), onEmpty);
    rooms.set(r.code, r);
    return enter(r, r.addMember(name));
  });
  on('join', ({ code, name }) => {
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) throw new GameError('No room with that code.');
    return enter(r, r.addMember(name));
  });
  on('resume', ({ code, pid: p, token }) => {
    const r = rooms.get(String(code || '').toUpperCase());
    if (!r || !r.members.has(p)) throw new GameError('That game no longer exists.');
    return enter(r, { pid: p, token });
  });
  on('leave', () => {
    const r = need();
    if (r.game && r.game.phase !== 'over') throw new GameError('You can’t leave during a game — use autopilot instead.');
    r.removeMember(pid);
    room = null; pid = null;
  });

  on('host:addBot', () => need().addBot(pid));
  on('host:kick', ({ target }) => { const r = need(); r.requireHost(pid); r.removeMember(target); });
  on('host:settings', (s) => need().setSettings(pid, s));
  on('host:start', () => need().start(pid));
  on('host:lobby', () => need().backToLobby(pid));
  on('host:skip', () => need().skipWaits(pid));
  // Players can't hand their seat to the computer; only someone away for a minute is covered
  // automatically. The automated multiplayer test switches it on to play a whole game quickly.
  if (process.env.OKOC_TEST_AUTOPILOT === '1') on('auto', ({ target, on: v }) => need().setAuto(pid, target || pid, !!v));
  on('chat', ({ text }) => need().lobbyMessage(pid, text));
  on('tutorial', ({ on: v }) => need().setTutorial(pid, !!v));
  on('tour:done', () => need().tourDone(pid));

  on('play', ({ uid, faceDown, target }) => game().play(pid, { uid, faceDown: !!faceDown, target }));
  on('answer', ({ id, value }) => game().answer(pid, id, value));
  on('neg:give', ({ to, amount }) => game().giveGold(pid, to, amount));
  on('neg:trade', ({ to, uid }) => game().offerTrade(pid, to, uid));
  on('neg:discard', ({ partner, uid }) => game().dealDiscard(pid, partner, uid));
  on('neg:bomb', ({ action, to }) => game().bombAction(pid, action, to));
  on('neg:ready', ({ ready }) => game().setReady(pid, ready !== false));
  on('badBlood', ({ id }) => game().payBadBlood(pid, id));
  on('freeDebt', ({ id }) => game().freeDebt(pid, id));

  socket.on('disconnect', () => { if (room && pid) room.detach(pid, socket); });
});

server.listen(PORT, () => console.log(`One King One Crown is running on http://localhost:${PORT}`));
