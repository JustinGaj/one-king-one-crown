'use strict';
// Light-weight protection for a public game server: security headers, same-site WebSocket
// connections only, and rate limits so one person (or a script) can't flood the server.
// Limits can be tuned with environment variables; the defaults suit a game among friends.

const num = (name, def) => (Number.isFinite(Number(process.env[name])) && process.env[name] !== '' ? Number(process.env[name]) : def);

const LIMITS = {
  socketsPerIp: num('OKOC_MAX_SOCKETS_PER_IP', 16), // a household of players plus a few spare tabs
  socketsTotal: num('OKOC_MAX_SOCKETS', 2000),
  rooms: num('OKOC_MAX_ROOMS', 300),
  roomsPerIp: num('OKOC_ROOMS_PER_IP_PER_10_MIN', 10),
  joinsPerIpPerMin: num('OKOC_JOINS_PER_IP_PER_MIN', 30), // also slows down guessing room codes
  eventsPerSec: num('OKOC_EVENTS_PER_SEC', 15),
  chatPerSec: 2,
};

// Behind a hosting proxy (Render, a tunnel…) the real address is in X-Forwarded-For.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
function clientIp(req) {
  if (TRUST_PROXY) {
    const f = req.headers['x-forwarded-for'];
    if (f) return String(f).split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Only letters, digits, dots, dashes and a port may come from the Host header into a policy.
const safeHost = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9.:-]/g, '');

function securityHeaders(req, res, next) {
  const host = safeHost(req.headers.host);
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // the UI sets inline style attributes
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src 'self'${host ? ` wss://${host} ws://${host}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

// A browser always sends Origin on a WebSocket; it must be this site (or one listed in
// ALLOWED_ORIGINS). Non-browser clients send none and are still rate limited.
const EXTRA_ORIGINS = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let o;
  try { o = new URL(origin); } catch (e) { return false; }
  if (safeHost(o.host) === safeHost(req.headers.host)) return true;
  return EXTRA_ORIGINS.includes(`${o.protocol}//${o.host}`.toLowerCase());
}

// Token bucket: `rate` per second, bursts up to `burst`.
class Bucket {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.tokens = burst; this.at = Date.now(); }
  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

// Per-address buckets that clean themselves up.
class PerIp {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.map = new Map(); }
  take(ip) {
    let b = this.map.get(ip);
    if (!b) { b = new Bucket(this.rate, this.burst); this.map.set(ip, b); }
    if (this.map.size > 10000) this.sweep();
    return b.take();
  }
  sweep() {
    const now = Date.now();
    for (const [k, b] of this.map) if (now - b.at > 15 * 60 * 1000) this.map.delete(k);
  }
}

const roomCreates = new PerIp(LIMITS.roomsPerIp / 600, LIMITS.roomsPerIp);
const joins = new PerIp(LIMITS.joinsPerIpPerMin / 60, LIMITS.joinsPerIpPerMin);
setInterval(() => { roomCreates.sweep(); joins.sweep(); }, 10 * 60 * 1000).unref();

// Count open connections per address.
const openByIp = new Map();
let openTotal = 0;
function admitSocket(ip) {
  const n = openByIp.get(ip) || 0;
  if (n >= LIMITS.socketsPerIp || openTotal >= LIMITS.socketsTotal) return false;
  openByIp.set(ip, n + 1);
  openTotal++;
  return true;
}
function releaseSocket(ip) {
  const n = (openByIp.get(ip) || 1) - 1;
  if (n <= 0) openByIp.delete(ip); else openByIp.set(ip, n);
  openTotal = Math.max(0, openTotal - 1);
}

module.exports = {
  LIMITS, clientIp, securityHeaders, originAllowed, Bucket, admitSocket, releaseSocket,
  canCreateRoom: (ip) => roomCreates.take(ip),
  canJoin: (ip) => joins.take(ip),
};
