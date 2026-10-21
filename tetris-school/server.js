/*
 * server.js — 교실용 테트리스 대전 서버 (외부 패키지 없음, Node.js 16 이상)
 *
 *   실행:  node server.js          (기본 포트 3000)
 *          node server.js 8080     (포트 지정)
 *
 * 학생들은 같은 네트워크에서 브라우저로  http://<선생님PC IP>:3000  에 접속합니다.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = parseInt(process.env.PORT || process.argv[2] || '3000', 10);
const PUBLIC = path.join(__dirname, 'public');
const MAX_PLAYERS = 16;
const MAX_PAYLOAD = 16 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------- 정적 파일
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const fp = path.normalize(path.join(PUBLIC, p));
  if (!fp.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

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
    t: 'lobby', code: room.code, host: room.host, state: room.state, ramp: room.ramp,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, wins: p.wins, inGame: p.inGame })),
  };
}

function onConnection(ws) {
  conns.add(ws);
  const me = { id: nextId++, name: '', ws, room: null, wins: 0, inGame: false, alive: false,
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
          broadcast(room, { t: 'board', id: me.id, b: m.b, inc: me.inc, dead: !me.alive }, me.id);
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

// 끊긴 연결 정리 (30초마다 ping)
setInterval(() => {
  for (const ws of conns) {
    if (!ws.alive) { ws.close(1001); continue; }
    ws.alive = false;
    ws.ping();
  }
}, 30000);

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[!] ${PORT}번 포트를 이미 사용 중입니다. 서버가 이미 켜져 있는지 확인하거나 다른 포트로 실행하세요: node server.js 8080\n`);
  } else console.error(err);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log('\n=== 교실 테트리스 대전 서버 실행 중 ===');
  if (process.env.CODESPACE_NAME) {
    // GitHub Codespaces
    const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
    console.log(`학생 접속 주소 (GitHub Codespaces): https://${process.env.CODESPACE_NAME}-${PORT}.${domain}`);
    console.log('  ※ 아래 [포트] 탭에서 3000번 포트의 "표시 유형(Visibility)"이 Public 이어야 학생이 접속할 수 있습니다.');
  } else if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`학생 접속 주소 (Render): ${process.env.RENDER_EXTERNAL_URL}`);
  } else {
    console.log(`이 컴퓨터:   http://localhost:${PORT}`);
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const n of nets[name] || []) {
        if ((n.family === 'IPv4' || n.family === 4) && !n.internal) console.log(`학생 접속 주소: http://${n.address}:${PORT}   (${name})`);
      }
    }
  }
  console.log('종료하려면 Ctrl + C\n');
});
