/*
 * server.js — 교실용 테트리스 대전 서버 (외부 패키지 없음, Node.js 16 이상)
 *
 *   실행:  node server.js          (기본 포트 3000)
 *          node server.js 8080     (포트 지정)
 *
 * 학생들은 같은 네트워크에서 브라우저로  http://<선생님PC IP>:3000  에 접속합니다.
 * 휴대폰 접속이 안 되면 휴대폰에서  http://<선생님PC IP>:3000/check  로 진단하세요.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = parseInt(process.env.PORT || process.argv[2] || '3000', 10);
const PUBLIC = path.join(__dirname, 'public');
const MAX_PLAYERS = 30;           // 방 하나 최대 인원
const MAX_PAYLOAD = 16 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------- 접속 로그 / 진단 도우미
function clientIP(req) {
  const xf = req.headers['x-forwarded-for'];
  const ip = (xf ? String(xf).split(',')[0] : (req.socket && req.socket.remoteAddress) || '?').trim();
  return ip.replace(/^::ffff:/, '');
}
function deviceName(ua) {
  ua = String(ua || '');
  let os_ = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua)) ? 'iPad'
          : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac'
          : /CrOS/.test(ua) ? 'Chromebook' : /Linux/.test(ua) ? 'Linux' : '기기?';
  const m = ua.match(/OS (\d+)_\d+/); if ((os_ === 'iPhone' || os_ === 'iPad') && m) os_ += ' iOS' + m[1];
  const am = ua.match(/Android (\d+)/); if (os_ === 'Android' && am) os_ += ' ' + am[1];
  const br = /KAKAOTALK/i.test(ua) ? '카카오톡 인앱' : /NAVER/i.test(ua) ? '네이버앱 인앱' : /Instagram|FBAN|FBAV/i.test(ua) ? 'SNS 인앱'
           : /SamsungBrowser/.test(ua) ? '삼성 인터넷' : /Whale/.test(ua) ? '웨일' : /Edg/.test(ua) ? 'Edge'
           : /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '브라우저?';
  return os_ + ' / ' + br;
}
const logSeen = new Map();
function logVisit(req, what) {
  const ip = clientIP(req), key = ip + '|' + what, now = Date.now();
  if (now - (logSeen.get(key) || 0) < 10000) return;
  logSeen.set(key, now);
  if (logSeen.size > 2000) logSeen.clear();
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${what.padEnd(10)} ${ip.padEnd(15)} ${deviceName(req.headers['user-agent'])}`);
}

// 이 PC 의 네트워크 주소를 "학생이 쓸 수 있는 순서"로 정렬
function lanAddresses() {
  const list = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (!(n.family === 'IPv4' || n.family === 4) || n.internal) continue;
      const ip = n.address;
      const virtual = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|vmnet|docker|br-|veth|virbr|utun|tun|tap|Tailscale|ZeroTier|Hamachi|Bluetooth|Loopback|NordLynx|OpenVPN|WireGuard/i.test(name);
      const apipa = ip.startsWith('169.254.');
      const priv = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
      const wifi = /wi-?fi|wlan|wireless|무선|en0|en1/i.test(name);
      let score = 0, note = '';
      if (apipa) { score = -2; note = 'IP를 받지 못한 어댑터 (사용 불가)'; }
      else if (virtual) { score = -1; note = '가상 어댑터 (학생 접속 불가)'; }
      else { score = (priv ? 2 : 1) + (wifi ? 0.5 : 0); }
      list.push({ name, ip, score, note, good: score > 0 });
    }
  }
  return list.sort((x, y) => y.score - x.score);
}
function publicURL() {
  if (process.env.CODESPACE_NAME) {
    return `https://${process.env.CODESPACE_NAME}-${PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev'}`;
  }
  return process.env.RENDER_EXTERNAL_URL || null;
}

function sendJSON(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
}
function readBody(req, limit, cb) {
  let size = 0; const chunks = [];
  req.on('data', d => { size += d.length; if (size > limit) { req.destroy(); return; } chunks.push(d); });
  req.on('end', () => { if (size <= limit) cb(Buffer.concat(chunks).toString('utf8')); });
  req.on('error', () => {});
}
const errLogCount = new Map();

// ---------------------------------------------------------------- HTTP (정적 파일 + API)
const server = http.createServer((req, res) => {
  const [rawPath, qs = ''] = req.url.split('?');
  let p;
  try { p = decodeURIComponent(rawPath); } catch (e) { res.writeHead(400); return res.end(); }
  if (req.method === 'OPTIONS') return sendJSON(res, 204, '');

  // --- API
  if (p.startsWith('/lp/')) return handlePoll(req, res, p, new URLSearchParams(qs));
  if (p === '/api/ping') return sendJSON(res, 200, { ok: true, time: Date.now() });
  if (p === '/api/info') {
    return sendJSON(res, 200, {
      port: PORT, public: publicURL(),
      addresses: lanAddresses().filter(a => a.good).map(a => ({ url: `http://${a.ip}:${PORT}`, name: a.name })),
    });
  }
  if (p === '/api/log' && req.method === 'POST') {
    const ip = clientIP(req);
    const n = (errLogCount.get(ip) || 0) + 1; errLogCount.set(ip, n);
    if (n > 30) return sendJSON(res, 429, { ok: false });
    return readBody(req, 4096, body => {
      let m = {}; try { m = JSON.parse(body); } catch (e) { m = { msg: body }; }
      const kind = m.kind === 'check' ? '진단결과' : '오류';
      const t = new Date().toTimeString().slice(0, 8);
      console.log(`[${t}] ${kind.padEnd(10)} ${ip.padEnd(15)} ${deviceName(req.headers['user-agent'])}\n           └ ${String(m.msg || '').slice(0, 600).replace(/\n/g, '\n             ')}`);
      sendJSON(res, 200, { ok: true });
    });
  }

  // --- 정적 파일
  if (p === '/') p = '/index.html';
  if (p === '/check' || p === '/check/') p = '/check.html';
  const fp = path.normalize(path.join(PUBLIC, p));
  if (!fp.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  if (p === '/index.html') logVisit(req, '게임 페이지');
  else if (p === '/check.html') logVisit(req, '진단 페이지');
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
setInterval(() => errLogCount.clear(), 60000);

// ------------------------------------------------- 최소 WebSocket 구현 (RFC 6455)
class WS {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragLen = 0;
    this.open = true;
    this.alive = true;
    this.onmessage = null;
    this.onclose = null;
    socket.setNoDelay(true);
    socket.on('data', d => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }
  _data(d) {
    this.alive = true;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this.buf.length < 10) return;
        if (this.buf.readUInt32BE(2) !== 0) return this.close(1009);
        len = this.buf.readUInt32BE(6); off = 10;
      }
      if (len > MAX_PAYLOAD) return this.close(1009);
      if (!masked) return this.close(1002);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4); off += 4;
      const payload = Buffer.from(this.buf.subarray(off, off + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + len);

      if (op === 0x8) { this.close(1000); return; }
      if (op === 0x9) { this._send(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.frags.push(payload); this.fragLen += len;
        if (this.fragLen > MAX_PAYLOAD) return this.close(1009);
        if (fin) {
          const msg = Buffer.concat(this.frags).toString('utf8');
          this.frags = []; this.fragLen = 0;
          if (this.onmessage) { try { this.onmessage(msg); } catch (e) { console.error(e); } }
        }
      }
    }
  }
  _send(op, payload) {
    if (!this.open || this.socket.destroyed) return;
    const len = payload.length;
    let h;
    if (len < 126) h = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); }
    this.socket.write(Buffer.concat([h, payload]));
  }
  send(obj) { this._send(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8')); }
  ping() { this._send(0x9, Buffer.alloc(0)); }
  close(code) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code || 1000, 0);
    try { this._send(0x8, p); } catch (e) { /* ignore */ }
    this.open = false;
    try { this.socket.end(); } catch (e) { /* ignore */ }
    this._closed();
  }
  _closed() {
    if (this._done) return;
    this._done = true; this.open = false;
    try { this.socket.destroy(); } catch (e) { /* ignore */ }
    if (this.onclose) this.onclose();
  }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  logVisit(req, '실시간연결');
  onConnection(new WS(socket));
});

// ------------------------------------------------------------- 방 / 게임 로직
const rooms = new Map();
const conns = new Set();
let nextId = 1;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
function cleanName(n, id) {
  const s = String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
  return s || ('플레이어' + id);
}
function broadcast(room, msg, exceptId) {
  const s = JSON.stringify(msg);
  for (const p of room.players.values()) if (p.id !== exceptId) p.ws.send(s);
}
function lobbyInfo(room) {
  return {
    t: 'lobby', code: room.code, host: room.host, state: room.state, ramp: room.ramp, max: MAX_PLAYERS,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, wins: p.wins, inGame: p.inGame })),
  };
}

function onConnection(ws) {
  conns.add(ws);
  const me = { id: nextId++, name: '', ws, room: null, wins: 0, inGame: false, alive: false, board: null, boardDirty: false,
               kos: 0, lastAttacker: null, lastTarget: null, lastTargetAt: 0, height: 0, inc: 0, rr: 0 };
  ws.send({ t: 'hello', id: me.id });

  ws.onmessage = raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const room = me.room;
    switch (m.t) {
      case 'join': {
        if (me.room) leaveRoom(me);
        me.name = cleanName(m.name, me.id);
        let code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
        let r;
        if (!code) {
          code = genCode();
          r = { code, host: me.id, players: new Map(), state: 'lobby', ramp: true, seed: 0, startCount: 0, ranking: [] };
          rooms.set(code, r);
        } else {
          r = rooms.get(code);
          if (!r) return ws.send({ t: 'error', msg: '방 코드 "' + code + '" 를 찾을 수 없습니다.' });
          if (r.players.size >= MAX_PLAYERS) return ws.send({ t: 'error', msg: '방이 가득 찼습니다. (최대 ' + MAX_PLAYERS + '명)' });
        }
        me.room = r; me.inGame = false; me.alive = false; me.wins = 0;
        r.players.set(me.id, me);
        ws.send({ t: 'joined', id: me.id, code: r.code, name: me.name });
        broadcast(r, lobbyInfo(r));
        break;
      }
      case 'leave':
        if (room) leaveRoom(me);
        break;
      case 'settings':
        if (room && room.host === me.id && room.state === 'lobby') { room.ramp = !!m.ramp; broadcast(room, lobbyInfo(room)); }
        break;
      case 'start':
        if (room && room.host === me.id && room.state === 'lobby') startGame(room);
        break;
      case 'board':
        if (room && room.state === 'playing' && me.inGame && typeof m.b === 'string' && m.b.length <= 260) {
          me.height = m.h | 0; me.inc = m.inc | 0;
          me.board = m.b; me.boardDirty = true;   // 바로 보내지 않고 0.1초마다 묶어서 전송 (아래 BOARD_TICK)
        }
        break;
      case 'attack': {
        if (!room || room.state !== 'playing' || !me.alive) break;
        const n = Math.max(0, Math.min(40, m.n | 0));
        if (!n) break;
        const target = pickTarget(room, me, String(m.m || 'random'));
        if (!target) break;
        target.lastAttacker = me.id;
        me.lastTarget = target.id; me.lastTargetAt = Date.now();
        target.ws.send({ t: 'garbage', n, from: me.id });
        broadcast(room, { t: 'atk', from: me.id, to: target.id, n });
        break;
      }
      case 'dead':
        if (room && room.state === 'playing') handleDeath(room, me);
        break;
    }
  };

  ws.onclose = () => { conns.delete(ws); if (me.room) leaveRoom(me); };
}

function pickTarget(room, me, mode) {
  const others = [...room.players.values()].filter(p => p.alive && p.id !== me.id);
  if (!others.length) return null;
  const rand = a => a[Math.floor(Math.random() * a.length)];
  switch (mode) {
    case 'even':      // 돌아가며 골고루
      me.rr = (me.rr + 1) % others.length;
      return others[me.rr];
    case 'kos': {     // 가장 위험한(높이 + 받을 줄이 많은) 상대
      let best = others[0];
      for (const p of others) if (p.height + p.inc > best.height + best.inc) best = p;
      return best;
    }
    case 'attackers': { // 최근 15초 안에 나를 공격한 상대
      const now = Date.now();
      const att = others.filter(p => p.lastTarget === me.id && now - p.lastTargetAt < 15000);
      return rand(att.length ? att : others);
    }
    default:
      return rand(others);
  }
}

function startGame(room) {
  room.state = 'playing';
  room.seed = crypto.randomInt(1, 0x7fffffff);
  room.ranking = [];
  const list = [];
  for (const p of room.players.values()) {
    p.inGame = true; p.alive = true; p.kos = 0; p.lastAttacker = null; p.lastTarget = null; p.height = 0; p.inc = 0;
    p.board = null; p.boardDirty = false;
    list.push({ id: p.id, name: p.name });
  }
  room.startCount = list.length;
  broadcast(room, { t: 'start', seed: room.seed, ramp: room.ramp, players: list, countdown: 3000 });
  broadcast(room, lobbyInfo(room));
  console.log(`[${room.code}] 게임 시작 (${list.length}명)`);
}

function handleDeath(room, p) {
  if (!p.alive) return;
  const place = [...room.players.values()].filter(x => x.alive).length;
  p.alive = false;
  const killer = p.lastAttacker != null ? room.players.get(p.lastAttacker) : null;
  if (killer && killer.alive) killer.kos++;
  room.ranking.unshift({ id: p.id, name: p.name, place, kos: p.kos });
  broadcast(room, { t: 'ko', id: p.id, by: killer && killer.alive ? killer.id : null, place });
  checkEnd(room);
}

function checkEnd(room) {
  if (room.state !== 'playing') return;
  const alive = [...room.players.values()].filter(p => p.alive);
  if (alive.length === 0 || (room.startCount >= 2 && alive.length <= 1)) {
    const winner = alive[0] || null;
    if (winner) {
      winner.wins++;
      room.ranking.unshift({ id: winner.id, name: winner.name, place: 1, kos: winner.kos });
    }
    room.state = 'lobby';
    for (const p of room.players.values()) { p.inGame = false; p.alive = false; }
    broadcast(room, { t: 'end', winner: winner ? winner.id : null, ranking: room.ranking });
    broadcast(room, lobbyInfo(room));
    console.log(`[${room.code}] 게임 종료 — 우승: ${winner ? winner.name : '없음'}`);
  }
}

function leaveRoom(p) {
  const room = p.room;
  if (!room) return;
  if (room.state === 'playing' && p.alive) handleDeath(room, p);
  room.players.delete(p.id);
  p.room = null; p.inGame = false; p.alive = false;
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  if (room.host === p.id) room.host = room.players.keys().next().value;
  broadcast(room, { t: 'left', id: p.id });
  checkEnd(room);
  broadcast(room, lobbyInfo(room));
}

// ------------------------------------------------- 상대 보드 묶음 전송
// 30명이 각자 보드를 보낼 때마다 29명에게 바로 전달하면 초당 수천~1만 개 메시지가 오가서
// 학교 Wi-Fi·무료 서버·휴대폰이 버거워집니다. 0.1초마다 바뀐 보드만 모아 한 번에 보냅니다.
const BOARD_TICK = 100;
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.state !== 'playing') continue;
    const list = [];
    for (const p of room.players.values()) {
      if (p.boardDirty && p.inGame) { list.push([p.id, p.board, p.inc]); p.boardDirty = false; }
    }
    if (list.length) broadcast(room, { t: 'boards', l: list });
  }
}, BOARD_TICK);

// ------------------------------------------------- HTTP 롱폴링 (WebSocket 이 막힌 환경용 호환 모드)
// WebSocket 과 같은 인터페이스(send/close/onmessage/onclose)를 제공해서 게임 로직은 그대로 사용합니다.
const polls = new Map();
class PollConn {
  constructor() {
    this.sid = crypto.randomBytes(12).toString('hex');
    this.q = []; this.waiting = null; this.wt = null;
    this.open = true; this.alive = true; this.lastSeen = Date.now();
    this.onmessage = null; this.onclose = null;
    polls.set(this.sid, this);
  }
  send(obj) {
    if (!this.open) return;
    this.q.push(typeof obj === 'string' ? obj : JSON.stringify(obj));
    if (this.q.length > 4000) { this.close(); return; }
    this.flush();
  }
  flush() {
    if (!this.waiting || !this.q.length) return;
    const res = this.waiting; this.waiting = null; clearTimeout(this.wt);
    const body = '[' + this.q.join(',') + ']'; this.q = [];
    sendJSON(res, 200, body);
  }
  wait(res) {
    this.lastSeen = Date.now(); this.alive = true;
    if (this.waiting) { const old = this.waiting; clearTimeout(this.wt); sendJSON(old, 200, '[]'); }
    this.waiting = res;
    res.on('close', () => { if (this.waiting === res) { this.waiting = null; clearTimeout(this.wt); } });
    if (this.q.length) return this.flush();
    this.wt = setTimeout(() => { if (this.waiting === res) { this.waiting = null; sendJSON(res, 200, '[]'); } }, 25000);
  }
  ping() { /* 롱폴링은 lastSeen 으로 생존 확인 */ }
  close() {
    if (!this.open) return;
    this.open = false; polls.delete(this.sid); clearTimeout(this.wt);
    if (this.waiting) { try { sendJSON(this.waiting, 410, '[]'); } catch (e) { /* ignore */ } this.waiting = null; }
    if (this.onclose) this.onclose();
  }
}
function handlePoll(req, res, p, q) {
  if (p === '/lp/open' && req.method === 'POST') {
    logVisit(req, '호환연결');
    const pc = new PollConn();
    onConnection(pc);
    return sendJSON(res, 200, { sid: pc.sid });
  }
  const pc = polls.get(q.get('sid') || '');
  if (!pc) return sendJSON(res, 410, { error: 'gone' });
  pc.lastSeen = Date.now();
  if (p === '/lp/recv') return pc.wait(res);
  if (p === '/lp/send' && req.method === 'POST') {
    return readBody(req, 64 * 1024, body => {
      let arr; try { arr = JSON.parse(body); } catch (e) { return sendJSON(res, 400, { error: 'bad json' }); }
      if (!Array.isArray(arr)) arr = [arr];
      for (const m of arr.slice(0, 200)) {
        if (pc.onmessage) { try { pc.onmessage(typeof m === 'string' ? m : JSON.stringify(m)); } catch (e) { console.error(e); } }
      }
      sendJSON(res, 200, { ok: true });
    });
  }
  if (p === '/lp/close') { pc.close(); return sendJSON(res, 200, { ok: true }); }
  sendJSON(res, 404, { error: 'unknown' });
}
setInterval(() => {
  const now = Date.now();
  for (const pc of polls.values()) if (!pc.waiting && now - pc.lastSeen > 45000) pc.close();
}, 10000);

// 끊긴 WebSocket 정리 (30초마다 ping)
setInterval(() => {
  for (const ws of conns) {
    if (ws instanceof PollConn) continue;
    if (!ws.alive) { ws.close(1001); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000);

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[!] ${PORT}번 포트를 이미 사용 중입니다. 서버가 이미 켜져 있는지 확인하거나 다른 포트로 실행하세요: node server.js 8080\n`);
  } else if (err.code === 'EACCES') {
    console.error(`\n[!] ${PORT}번 포트를 열 권한이 없습니다. 1024 이상의 포트(예: 3000, 8080)를 사용하세요.\n`);
  } else console.error(err);
  process.exit(1);
});

// ------------------------------------------------- Windows 방화벽 / 네트워크 점검 (Windows 에서만, 실패해도 무시)
function checkWindowsNetwork() {
  if (process.platform !== 'win32' || publicURL()) return;
  const { execFile } = require('child_process');
  const ps = [
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
    "$p = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { $_.InterfaceAlias + '=' + $_.NetworkCategory }) -join ';'",
    "$b = @(Get-NetFirewallRule -Direction Inbound -Action Block -Enabled True -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*node*' }).Count",
    "$a = @(Get-NetFirewallRule -DisplayName 'Classroom Tetris*' -Enabled True -ErrorAction SilentlyContinue).Count",
    "'PROFILE:' + $p", "'BLOCK:' + $b", "'ALLOW:' + $a",
  ].join('; ');
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 20000, windowsHide: true }, (err, out) => {
    if (err || !out) return;
    const get = k => ((out.match(new RegExp(k + ':(.*)')) || [])[1] || '').trim();
    const profile = get('PROFILE'), block = parseInt(get('BLOCK'), 10) || 0, allow = parseInt(get('ALLOW'), 10) || 0;
    const warn = [];
    if (block > 0) warn.push('Windows 방화벽에 Node.js "차단" 규칙이 ' + block + '개 있습니다. (예전에 방화벽 창에서 "취소"를 누르면 생깁니다)');
    if (/=Public/i.test(profile) && !allow) warn.push('현재 네트워크가 "공용(Public)" 으로 설정돼 있어 휴대폰 접속이 막힐 가능성이 큽니다. (' + profile + ')');
    if (warn.length) {
      console.log('\n⚠ 휴대폰 접속을 막을 수 있는 설정이 발견되었습니다');
      for (const w of warn) console.log('  - ' + w);
      console.log('  → 이 폴더의 "allow-firewall.bat" 을 더블클릭해 실행하세요. (관리자 권한 "예" 클릭)\n');
    } else if (allow) {
      console.log('✔ Windows 방화벽 허용 규칙 확인됨');
    }
  });
}

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log('\n==============================================');
  console.log('   교실 테트리스 대전 서버 실행 중');
  console.log('==============================================');
  const pub = publicURL();
  if (pub) {
    console.log(`📱 학생 접속 주소: ${pub}`);
    if (process.env.CODESPACE_NAME) console.log('  ※ [포트] 탭에서 3000번 포트 "표시 유형(Visibility)"이 Public 이어야 학생이 접속할 수 있습니다.');
  } else {
    const list = lanAddresses();
    const good = list.filter(a => a.good), bad = list.filter(a => !a.good);
    if (good.length) {
      console.log(`📱 학생 접속 주소:  http://${good[0].ip}:${PORT}      (${good[0].name})`);
      for (const a of good.slice(1)) console.log(`   다른 후보 주소:  http://${a.ip}:${PORT}      (${a.name})`);
      console.log('   ※ 휴대폰은 반드시 이 PC와 "같은 Wi-Fi" 에 연결되어 있어야 합니다. (LTE/5G 데이터로는 접속 불가)');
      console.log('   ※ 주소창에 http:// 까지 정확히 입력하거나, 선생님 PC 화면의 QR 코드를 찍게 하세요.');
    } else {
      console.log('⚠ 학생이 접속할 수 있는 네트워크 주소가 없습니다. 이 PC가 Wi-Fi/유선 네트워크에 연결되어 있는지 확인하세요.');
    }
    for (const a of bad) console.log(`   (사용하지 마세요) http://${a.ip}:${PORT}  ${a.name} — ${a.note}`);
    console.log(`💻 이 컴퓨터에서:   http://localhost:${PORT}   ← localhost 는 이 PC에서만 열립니다`);
    console.log(`🔧 휴대폰 접속 진단: 휴대폰에서 위 주소 뒤에 /check 를 붙여 접속 (예: http://${good[0] ? good[0].ip : 'PC주소'}:${PORT}/check)`);
  }
  console.log('\n아래에 휴대폰·PC 의 접속 기록이 표시됩니다. 휴대폰으로 접속했는데 아무 기록도 안 뜨면');
  console.log('→ 요청이 이 PC까지 오지 못한 것입니다 (방화벽 / 다른 Wi-Fi / 학교 Wi-Fi 기기 간 통신 차단).');
  console.log('종료하려면 Ctrl + C\n');
  checkWindowsNetwork();
});
