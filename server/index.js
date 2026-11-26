'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Room } = require('./room');
const { GameError } = require('./game');
const { CATALOG } = require('./cards');
const sec = require('./security');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1); // so req.secure works behind the host's proxy
app.use(sec.securityHeaders);
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 16 * 1024, // game messages are tiny; refuse anything big
  perMessageDeflate: { threshold: 1024 }, // compress game state: much less bandwidth
  allowRequest: (req, cb) => cb(null, sec.originAllowed(req)), // only this site may connect
});

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
// When every person has left a room (bots don't count), it is kept just long enough to survive a refresh or a dropped
// connection, then wiped. While at least one player is still there, everything is kept.
const ROOM_EMPTY_MS = Number(process.env.OKOC_ROOM_EMPTY_MS) || 3 * 60 * 1000;

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); } while (rooms.has(code));
  return code;
}

function onEmpty(room) {
  clearTimeout(room.wipeTimer);
  room.wipeTimer = setTimeout(() => {
    const stillEmpty = ![...room.members.values()].some((m) => !m.isBot && m.sockets.size);
    if (!stillEmpty || rooms.get(room.code) !== room) return;
    rooms.delete(room.code);
    room.clearAbsence();
    if (room.game) room.game.abandon();
  }, ROOM_EMPTY_MS);
}

// Limit open connections per network address
io.use((socket, next) => {
  const ip = sec.clientIp(socket.request);
  if (!sec.admitSocket(ip)) return next(new Error('Too many connections from your network. Close some tabs and try again.'));
  socket.data.ip = ip;
  socket.on('disconnect', () => sec.releaseSocket(ip));
  next();
});

io.on('connection', (socket) => {
  let room = null;
  let pid = null;
  const ip = socket.data.ip;
  const events = new sec.Bucket(sec.LIMITS.eventsPerSec, sec.LIMITS.eventsPerSec * 3);
  const chats = new sec.Bucket(sec.LIMITS.chatPerSec, 6);

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
    if (!events.take() || (event === 'chat' && !chats.take())) { ack({ error: 'Slow down a little.' }); return; }
    if (data !== undefined && (data === null || typeof data !== 'object' || Array.isArray(data))) { ack({ error: 'Bad request.' }); return; }
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
    if (rooms.size >= sec.LIMITS.rooms) throw new GameError('The server is full right now. Try again in a few minutes.');
    if (!sec.canCreateRoom(ip)) throw new GameError('You have created a lot of rooms. Wait a few minutes.');
    const r = new Room(newCode(), onEmpty);
    rooms.set(r.code, r);
    return enter(r, r.addMember(name));
  });
  on('join', ({ code, name }) => {
    if (!sec.canJoin(ip)) throw new GameError('Too many attempts. Wait a minute and try again.');
    const r = rooms.get(String(code || '').toUpperCase().trim());
    if (!r) throw new GameError('No room with that code.');
    return enter(r, r.running() ? r.reclaim(name) : r.addMember(name));
  });
  on('resume', ({ code, pid: p, token }) => {
    if (!sec.canJoin(ip)) throw new GameError('Too many attempts. Wait a minute and try again.');
    const r = rooms.get(String(code || '').toUpperCase());
    if (!r || !r.members.has(p)) throw new GameError('That game no longer exists.');
    return enter(r, { pid: p, token });
  });
  on('leave', () => {
    const r = need();
    if (r.game && r.game.phase !== 'over') throw new GameError('You can’t leave during a game. If you close the page, the others vote to wait for you or let a bot play your seat.');
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
  on('absent:vote', ({ target, choice }) => need().voteAbsent(pid, target, choice));
  on('absent:revote', ({ target }) => need().revoteAbsent(pid, target));
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

// When the host restarts the server (for example on a new deploy), tell everyone first.
let closing = false;
function shutdown(sig) {
  if (closing) return;
  closing = true;
  console.log(`${sig} received, shutting down`);
  io.emit('notice', 'The server is restarting. Games in progress have ended; create a new game in a moment.');
  setTimeout(() => { io.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); }, 800);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// One bad message must never take the whole server (and everyone's games) down.
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
