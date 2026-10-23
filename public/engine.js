/*
 * engine.js — TETR.IO 규칙 기반 테트리스 엔진 (DOM 없음, 브라우저/Node 공용)
 *
 * 구현한 규칙
 *  - 10 x 40 보드 (보이는 영역 20줄 + 위쪽 버퍼 20줄)
 *  - 7-bag 랜덤 (같은 방의 모든 플레이어가 같은 시드 → 같은 블록 순서)
 *  - SRS+ 회전 (TETR.IO 방식: I 미노 대칭 킥 + 180° 회전 킥)
 *  - 홀드, 다음 블록 5개 미리보기, 고스트
 *  - 락 딜레이 500ms, 이동/회전 리셋 최대 15회 (더 낮은 줄에 닿으면 리셋 횟수 초기화)
 *  - T-스핀 / T-스핀 미니 판정 (3코너 규칙, 앞쪽 코너, 5번째 킥 = 풀 T-스핀)
 *  - TETR.IO 공격표, B2B 체인 보너스, 콤보 배수, 올 클리어(+10)
 *  - 방해줄: 상쇄(공격이 먼저 받을 줄을 지움), 도착 지연 20프레임, 한 번에 최대 8줄
 *  - 패배: 블록 아웃(생성 위치가 막힘), 락 아웃(보이는 영역 밖에 완전히 고정), 탑 아웃
 */
(function (root) {
  'use strict';

  const W = 10, H = 40, VIS = 20;          // 보이는 영역: y = 20 ~ 39 (y는 아래로 증가)
  const VIS_START = H - VIS;               // 20
  const GARBAGE = 8;
  const PIECES = ['Z', 'L', 'O', 'S', 'I', 'J', 'T'];
  const COLOR_ID = { Z: 1, L: 2, O: 3, S: 4, I: 5, J: 6, T: 7 };

  const SHAPES = {
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
    O: [[1, 1], [1, 1]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  };

  function rotCW(m) {
    const n = m.length, r = [];
    for (let y = 0; y < n; y++) { r.push([]); for (let x = 0; x < n; x++) r[y].push(m[n - 1 - x][y]); }
    return r;
  }
  function toCells(m) {
    const c = [];
    for (let y = 0; y < m.length; y++) for (let x = 0; x < m.length; x++) if (m[y][x]) c.push([x, y]);
    return c;
  }
  // ROTS[type][rot] = [[x,y], ...]   rot: 0=스폰, 1=R(시계), 2=180, 3=L(반시계)
  const ROTS = {};
  for (const p of PIECES) {
    let m = SHAPES[p]; ROTS[p] = [];
    for (let r = 0; r < 4; r++) { ROTS[p].push(toCells(m)); m = rotCW(m); }
  }

  // 킥 테이블 (표준 표기: +y = 위쪽). 적용할 때 y 부호를 뒤집는다.
  const K_JLSTZ = {
    '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };
  // SRS+ (TETR.IO) I 미노 킥 — 좌우 대칭
  const K_I = {
    '01': [[0, 0], [1, 0], [-2, 0], [-2, -1], [1, 2]],
    '10': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '21': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '32': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '30': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '03': [[0, 0], [-1, 0], [2, 0], [2, -1], [-1, 2]],
  };
  // TETR.IO 180° 킥
  const K_180 = {
    '02': [[0, 0], [0, 1], [1, 1], [-1, 1], [1, 0], [-1, 0]],
    '20': [[0, 0], [0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0]],
    '13': [[0, 0], [1, 0], [1, 2], [1, 1], [0, 2], [0, 1]],
    '31': [[0, 0], [-1, 0], [-1, 2], [-1, 1], [0, 2], [0, 1]],
  };

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- TETR.IO 공격 계산 -------------------------------------------------
  const ATTACK = {
    normal: [0, 0, 1, 2, 4],     // 싱글, 더블, 트리플, 쿼드
    full: [0, 2, 4, 6],          // T-스핀 (0줄), 싱글, 더블, 트리플
    mini: [0, 0, 1],             // T-스핀 미니 (0줄), 싱글, 더블
  };
  const B2B_BONUS_LOG = 0.8, COMBO_BONUS = 0.25, COMBO_MINIFIER_LOG = 1.25, ALL_CLEAR = 10;

  function calcAttack(lines, spin, b2b, combo, pc) {
    if (lines <= 0) return 0;
    let g = spin === 'full' ? (ATTACK.full[lines] || 0)
          : spin === 'mini' ? (ATTACK.mini[lines] || 0)
          : (ATTACK.normal[lines] || 0);
    const difficult = lines === 4 || !!spin;
    if (difficult && b2b > 0) {
      const l = Math.log1p(b2b * B2B_BONUS_LOG);
      g += Math.floor(1 + l) + (b2b === 1 ? 0 : (1 + (l % 1)) / 3);
    }
    if (combo > 0) g *= 1 + COMBO_BONUS * combo;
    if (combo > 1) g = Math.max(Math.log1p(COMBO_MINIFIER_LOG * combo), g);
    let atk = Math.floor(g);
    if (pc) atk += ALL_CLEAR;
    return atk;
  }

  // ---- 게임 ---------------------------------------------------------------
  class Game {
    constructor(o = {}) {
      this.seed = (o.seed >>> 0) || 1;
      this.rng = mulberry32(this.seed);
      this.grng = mulberry32(o.garbageSeed != null ? o.garbageSeed : (Math.random() * 4294967296));
      this.board = new Uint8Array(W * H);
      this.queue = [];
      this.fillQueue();
      this.holdType = null;
      this.holdUsed = false;

      this.g0 = o.gravity != null ? o.gravity : 0.02;         // G (칸/프레임, 60fps 기준)
      this.ramp = !!o.ramp;                                     // 시간에 따른 중력 증가
      this.rampMargin = o.rampMargin != null ? o.rampMargin : 120000; // 증가 시작까지(ms)
      this.rampInc = o.rampInc != null ? o.rampInc : 0.0025;    // 초당 G 증가량
      this.sdf = o.sdf != null ? o.sdf : 6;                     // 소프트 드롭 배수 (41 = 즉시)
      this.lockDelay = 500;
      this.maxResets = 15;
      this.garbageDelay = o.garbageDelay != null ? o.garbageDelay : 334; // 20프레임
      this.garbageCap = o.garbageCap != null ? o.garbageCap : 8;

      this.softDrop = false;
      this.incoming = [];
      this.combo = -1;
      this.b2b = -1;
      this.stats = { pieces: 0, lines: 0, attack: 0, sent: 0, received: 0, time: 0, kos: 0 };
      this.dead = false;
      this.deathReason = null;
      this.time = 0;
      this.gravAcc = 0;
      this.listeners = {};
      this.dirty = true;
      this.spawn(this.nextFromQueue());
    }

    on(ev, fn) { (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); return this; }
    emit(ev, d) { const l = this.listeners[ev]; if (l) for (const f of l) f(d); }

    fillQueue() {
      while (this.queue.length < 7) {
        const bag = PIECES.slice();
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
        this.queue.push(...bag);
      }
    }
    nextFromQueue() { const t = this.queue.shift(); this.fillQueue(); return t; }

    fits(type, rot, x, y) {
      for (const [cx, cy] of ROTS[type][rot]) {
        const nx = x + cx, ny = y + cy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) return false;
        if (this.board[ny * W + nx]) return false;
      }
      return true;
    }
    curFits(dx, dy) { const c = this.cur; return this.fits(c.type, c.rot, c.x + dx, c.y + dy); }
    grounded() { return !this.curFits(0, 1); }

    spawn(type) {
      this.cur = { type, rot: 0, x: type === 'O' ? 4 : 3, y: VIS_START - 2 };
      this.lockTimer = 0;
      this.resets = 0;
      this.lowest = this.cur.y;
      this.gravAcc = 0;
      this.lastWasRotate = false;
      this.lastKick = -1;
      this.dirty = true;
      if (!this.curFits(0, 0)) { this.die('blockout'); return; }
      if (this.gravity() >= 20) this.dropToBottom();
    }

    gravity() {
      if (!this.ramp) return this.g0;
      return this.g0 + Math.max(0, this.time - this.rampMargin) / 1000 * this.rampInc;
    }

    die(reason) {
      if (this.dead) return;
      this.dead = true;
      this.deathReason = reason;
      this.dirty = true;
      this.emit('dead', reason);
    }

    onMoved() {
      this.dirty = true;
      if (this.grounded() || this.lockTimer > 0) {
        if (this.resets < this.maxResets) { this.lockTimer = 0; this.resets++; }
      }
    }
    checkLowest() {
      if (this.cur.y > this.lowest) { this.lowest = this.cur.y; this.resets = 0; this.lockTimer = 0; }
    }

    move(dx) {
      if (this.dead) return false;
      if (this.curFits(dx, 0)) {
        this.cur.x += dx;
        this.lastWasRotate = false;
        this.onMoved();
        if (this.gravity() >= 20) this.dropToBottom();
        return true;
      }
      return false;
    }

    // d: 1 = 시계, -1 = 반시계, 2 = 180°
    rotate(d) {
      if (this.dead) return false;
      const c = this.cur;
      if (c.type === 'O') return false;
      const from = c.rot, to = (from + (d === -1 ? 3 : d)) % 4;
      const key = '' + from + to;
      const table = d === 2 ? K_180 : (c.type === 'I' ? K_I : K_JLSTZ);
      const kicks = table[key];
      for (let i = 0; i < kicks.length; i++) {
        const nx = c.x + kicks[i][0], ny = c.y - kicks[i][1];
        if (this.fits(c.type, to, nx, ny)) {
          c.x = nx; c.y = ny; c.rot = to;
          this.lastWasRotate = true;
          this.lastKick = d === 2 ? -1 : i;   // 5번째 킥(i=4) 판정은 90° 회전만
          this.onMoved();
          this.checkLowest();
          if (this.gravity() >= 20) this.dropToBottom(true);
          return true;
        }
      }
      return false;
    }

    dropToBottom(keepSpin) {
      let d = 0;
      while (this.curFits(0, 1)) { this.cur.y++; d++; }
      if (d > 0) {
        if (!keepSpin) this.lastWasRotate = false;
        this.dirty = true;
        this.checkLowest();
      }
      return d;
    }

    hardDrop() {
      if (this.dead) return;
      const d = this.dropToBottom();
      if (d > 0) this.lastWasRotate = false;
      this.lock();
    }

    hold() {
      if (this.dead || this.holdUsed) return false;
      this.holdUsed = true;
      const t = this.cur.type;
      if (this.holdType === null) { this.holdType = t; this.spawn(this.nextFromQueue()); }
      else { const h = this.holdType; this.holdType = t; this.spawn(h); }
      return true;
    }

    ghostY() {
      const c = this.cur; let y = c.y;
      while (this.fits(c.type, c.rot, c.x, y + 1)) y++;
      return y;
    }

    occ(x, y) { return x < 0 || x >= W || y >= H || (y >= 0 && this.board[y * W + x] !== 0); }

    detectSpin() {
      const c = this.cur;
      if (c.type !== 'T' || !this.lastWasRotate) return null;
      const cx = c.x + 1, cy = c.y + 1;
      const k = [this.occ(cx - 1, cy - 1), this.occ(cx + 1, cy - 1), this.occ(cx + 1, cy + 1), this.occ(cx - 1, cy + 1)]; // TL TR BR BL
      if (k.filter(Boolean).length < 3) return null;
      const front = [[0, 1], [1, 2], [2, 3], [3, 0]][c.rot];
      if (k[front[0]] && k[front[1]]) return 'full';
      if (this.lastKick === 4) return 'full';
      return 'mini';
    }

    clearLines() {
      let write = H - 1, cleared = 0;
      for (let y = H - 1; y >= 0; y--) {
        let full = true;
        for (let x = 0; x < W; x++) if (!this.board[y * W + x]) { full = false; break; }
        if (full) { cleared++; continue; }
        if (write !== y) this.board.copyWithin(write * W, y * W, y * W + W);
        write--;
      }
      for (let y = write; y >= 0; y--) this.board.fill(0, y * W, y * W + W);
      return cleared;
    }

    lock() {
      if (this.dead) return;
      const c = this.cur;
      const spin = this.detectSpin();
      let allAbove = true;
      for (const [cx, cy] of ROTS[c.type][c.rot]) {
        const x = c.x + cx, y = c.y + cy;
        this.board[y * W + x] = COLOR_ID[c.type];
        if (y >= VIS_START) allAbove = false;
      }
      this.stats.pieces++;
      const lines = this.clearLines();
      this.stats.lines += lines;

      if (lines === 0 && allAbove) { this.die('lockout'); return; }

      let pc = false;
      if (lines > 0) {
        pc = this.board.every(v => v === 0);
        this.combo++;
        if (lines === 4 || spin) this.b2b++;
        else this.b2b = -1;
      } else {
        this.combo = -1;
      }

      const atk = calcAttack(lines, spin, this.b2b, this.combo, pc);
      this.stats.attack += atk;

      // 상쇄
      let send = atk;
      while (send > 0 && this.incoming.length) {
        const g = this.incoming[0];
        const k = Math.min(g.n, send);
        g.n -= k; send -= k;
        if (g.n <= 0) this.incoming.shift();
      }
      if (send > 0) { this.stats.sent += send; this.emit('attack', send); }

      if (lines > 0 || spin) {
        this.emit('clear', { lines, spin, b2b: this.b2b, combo: this.combo, pc, attack: atk, type: c.type });
      }
      this.emit('lock', { lines });

      if (lines === 0) this.applyGarbage();
      if (this.dead) return;

      this.holdUsed = false;
      this.spawn(this.nextFromQueue());
    }

    receive(n, hole) {
      if (this.dead || n <= 0) return;
      this.incoming.push({ n, hole: hole != null ? hole : Math.floor(this.grng() * W), delay: this.garbageDelay });
      this.stats.received += n;
      this.dirty = true;
    }
    pendingGarbage() { let s = 0; for (const g of this.incoming) s += g.n; return s; }

    applyGarbage() {
      let cap = this.garbageCap;
      while (cap > 0 && this.incoming.length && this.incoming[0].delay <= 0) {
        const g = this.incoming[0];
        const k = Math.min(g.n, cap);
        this.insertGarbage(k, g.hole);
        g.n -= k; cap -= k;
        if (g.n <= 0) this.incoming.shift();
        if (this.dead) return;
      }
    }

    insertGarbage(k, hole) {
      let overflow = false;
      for (let i = 0; i < k * W; i++) if (this.board[i]) { overflow = true; break; }
      this.board.copyWithin(0, k * W);
      for (let y = H - k; y < H; y++)
        for (let x = 0; x < W; x++) this.board[y * W + x] = x === hole ? 0 : GARBAGE;
      this.dirty = true;
      if (overflow) this.die('topout');
    }

    update(dt) {
      if (this.dead) return;
      this.time += dt;
      this.stats.time = this.time;
      for (const g of this.incoming) if (g.delay > 0) g.delay -= dt;

      const G = this.gravity();
      if (this.softDrop && this.sdf >= 41) {
        this.dropToBottom();
      } else {
        const speed = this.softDrop ? Math.max(G, this.sdf / 12) : G;
        if (speed >= 20) this.dropToBottom();
        else {
          this.gravAcc += speed * dt * 60 / 1000;
          while (this.gravAcc >= 1) {
            this.gravAcc -= 1;
            if (this.curFits(0, 1)) {
              this.cur.y++;
              this.lastWasRotate = false;
              this.dirty = true;
              this.checkLowest();
            } else { this.gravAcc = 0; break; }
          }
        }
      }

      if (this.grounded()) {
        this.lockTimer += dt;
        if (this.lockTimer >= this.lockDelay) this.lock();
      }
    }

    stackHeight() {
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if (this.board[y * W + x]) return H - y;
      return 0;
    }

    // 상대에게 보낼 보드 (y = 18~39, 22줄, 현재 블록 포함). 문자 '0'~'8'
    snapshot() {
      const top = VIS_START - 2;
      const a = [];
      for (let y = top; y < H; y++) for (let x = 0; x < W; x++) a.push(this.board[y * W + x]);
      if (!this.dead && this.cur) {
        const c = this.cur, id = COLOR_ID[c.type];
        for (const [cx, cy] of ROTS[c.type][c.rot]) {
          const y = c.y + cy - top, x = c.x + cx;
          if (y >= 0) a[y * W + x] = id;
        }
      }
      return a.join('');
    }
  }

  const api = { Game, W, H, VIS, VIS_START, GARBAGE, PIECES, COLOR_ID, ROTS, calcAttack, mulberry32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tetris = api;
})(typeof window !== 'undefined' ? window : globalThis);
