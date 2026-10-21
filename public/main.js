/* main.js — 화면, 입력(키보드 + 터치 키패드, DAS/ARR), 렌더링, 네트워크 */
(function () {
  'use strict';
  const { Game, W, H, VIS_START, ROTS, COLOR_ID } = window.Tetris;
  const $ = id => document.getElementById(id);
  const TOP = VIS_START - 2;            // 화면에 그리는 첫 줄 (보이는 영역 위 2줄 포함)
  const ROWS = H - TOP;                 // 22
  const COLORS = [null, '#e5484d', '#f08c3a', '#f5c542', '#4cc46a', '#3fc6e0', '#4566e6', '#a356d6', '#6b6f7a'];
  const IS_TOUCH = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;

  // ------------------------------------------------------------------ 설정
  const ACTIONS = [
    ['left', '왼쪽 이동'], ['right', '오른쪽 이동'], ['soft', '소프트 드롭'], ['hard', '하드 드롭'],
    ['ccw', '반시계 회전'], ['cw', '시계 회전'], ['r180', '180° 회전'], ['hold', '홀드'], ['retry', '다시 시작(연습)'],
  ];
  const DEFAULT_BINDS = {
    left: ['ArrowLeft'], right: ['ArrowRight'], soft: ['ArrowDown'], hard: ['Space'],
    ccw: ['KeyZ', 'ControlLeft'], cw: ['ArrowUp', 'KeyX'], r180: ['KeyA'], hold: ['KeyC', 'ShiftLeft'], retry: ['KeyR'],
  };
  const DEFAULTS = { das: 167, arr: 33, sdf: 6, ghost: true, pad: 'auto', padScale: 100, vibrate: true, binds: DEFAULT_BINDS };
  let settings = loadSettings();
  let keyMap = {};

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('tetris-settings') || '{}');
      return Object.assign({}, DEFAULTS, s, { binds: Object.assign({}, DEFAULT_BINDS, s.binds || {}) });
    } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
  }
  function saveSettings() {
    try { localStorage.setItem('tetris-settings', JSON.stringify(settings)); } catch (e) { /* 사생활 보호 모드 등 */ }
    buildKeyMap();
  }
  function buildKeyMap() {
    keyMap = {};
    for (const [a] of ACTIONS) for (const k of settings.binds[a] || []) keyMap[k] = a;
    renderHelp();
  }
  function padEnabled() { return settings.pad === 'on' || (settings.pad === 'auto' && IS_TOUCH); }
  function keyName(code) {
    const names = { Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
      ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt' };
    if (names[code]) return names[code];
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
  }
  function renderHelp() {
    const t = $('help-table'); t.innerHTML = '';
    for (const [a, label] of ACTIONS) {
      const tr = document.createElement('tr');
      const k = document.createElement('td'); k.textContent = (settings.binds[a] || []).map(keyName).join(' / ');
      const l = document.createElement('td'); l.textContent = label;
      tr.append(k, l); t.append(tr);
    }
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>1 / 2 / 3 / 4</td><td>공격 대상: 무작위 / 골고루 / 위험한 상대 / 나를 공격한 상대</td>';
    t.append(tr);
  }
  buildKeyMap();
  document.body.classList.toggle('touch', IS_TOUCH);

  // ------------------------------------------------------------------ 화면 전환
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id);
    if (id === 'game-screen') layout();
  }
  const nameInput = $('name');
  try { nameInput.value = localStorage.getItem('tetris-name') || ''; } catch (e) { /* ignore */ }

  // ------------------------------------------------------------------ 상태
  let ws = null, myId = null, roomCode = null, lobby = null;
  let game = null, mode = null, running = false, countdownTimer = null;
  let opps = new Map();               // id -> {name, b, inc, dead, place, el, canvas, ctx}
  let targeting = 'random';
  let myTarget = null;                // 내가 마지막으로 공격한 상대
  const attackersOnMe = new Map();    // id -> 시각
  let lastBoardSent = 0, myPlace = null;

  // ------------------------------------------------------------------ 네트워크
  function setConn(ok, text) {
    const el = $('conn-status'); el.textContent = text;
    el.className = 'conn ' + (ok ? 'ok' : 'bad');
    $('btn-create').disabled = !ok; $('btn-join').disabled = !ok;
  }
  function serverURL() {
    let url = new URLSearchParams(location.search).get('server') || window.TETRIS_SERVER || '';
    url = String(url).trim();
    if (url) {
      if (!/^(wss?|https?):\/\//i.test(url)) url = 'wss://' + url;
      return url.replace(/^http/i, 'ws').replace(/\/+$/, '');
    }
    if (location.protocol === 'file:') return null;
    if (/\.github\.io$/i.test(location.hostname)) return null;   // GitHub Pages 는 서버를 실행할 수 없음
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  }
  function connect() {
    const url = serverURL();
    if (!url) {
      setConn(false, location.protocol === 'file:'
        ? '파일로 직접 열었습니다 → 혼자 연습만 가능. 대전은 서버를 실행한 뒤 그 주소로 접속하세요.'
        : 'GitHub Pages 에는 서버가 없어 혼자 연습만 가능합니다. 대전하려면 config.js 에 서버 주소를 적으세요.');
      return;
    }
    try { ws = new WebSocket(url); } catch (e) { setConn(false, '서버 주소가 올바르지 않습니다: ' + url); return; }
    ws.onopen = () => setConn(true, '● 서버 연결됨');
    ws.onclose = () => {
      ws = null; setConn(false, '서버에 연결할 수 없습니다. 3초 후 다시 시도합니다… (무료 서버는 깨어나는 데 1분 정도 걸릴 수 있어요)');
      if (mode === 'multi' || roomCode) {
        roomCode = null; stopGame();
        mode = null; show('lobby');
        $('lobby-msg').textContent = '서버와 연결이 끊겨 방에서 나왔습니다.';
      }
      setTimeout(connect, 3000);
    };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } handle(m); };
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  function handle(m) {
    switch (m.t) {
      case 'hello': myId = m.id; break;
      case 'error':
        $('lobby-msg').textContent = m.msg; break;
      case 'joined':
        myId = m.id; roomCode = m.code; $('lobby-msg').textContent = '';
        show('room'); break;
      case 'lobby':
        lobby = m; renderRoom(); break;
      case 'start':
        startMulti(m); break;
      case 'board': {
        const o = opps.get(m.id); if (!o) break;
        o.b = m.b; o.inc = m.inc; drawOpp(o); break;
      }
      case 'garbage':
        if (game && running && !game.dead) game.receive(m.n);
        break;
      case 'atk': {
        if (m.to === myId) attackersOnMe.set(m.from, performance.now());
        if (m.from === myId) myTarget = m.to;
        updateOppMarks(); break;
      }
      case 'ko': {
        if (m.id === myId) { myPlace = m.place; }
        else {
          const o = opps.get(m.id);
          if (o) { o.dead = true; o.place = m.place; markOpp(o); drawOpp(o); }
        }
        if (m.by === myId && m.id !== myId && game) { game.stats.kos++; showAction('<div class="big">KO!</div>'); }
        break;
      }
      case 'left': {
        const o = opps.get(m.id);
        if (o && !o.dead) { o.dead = true; o.left = true; markOpp(o); drawOpp(o); }
        break;
      }
      case 'end':
        endMulti(m); break;
    }
  }

  // ------------------------------------------------------------------ 로비 / 대기실
  function myName() {
    const n = nameInput.value.trim();
    try { localStorage.setItem('tetris-name', n); } catch (e) { /* ignore */ }
    return n;
  }
  $('btn-create').onclick = () => send({ t: 'join', name: myName() });
  $('btn-join').onclick = () => {
    const c = $('code').value.trim().toUpperCase();
    if (!c) { $('lobby-msg').textContent = '방 코드를 입력하세요.'; return; }
    send({ t: 'join', name: myName(), code: c });
  };
  $('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
  $('btn-solo').onclick = () => startSolo();
  $('btn-leave').onclick = () => { send({ t: 'leave' }); roomCode = null; lobby = null; show('lobby'); };
  $('btn-start').onclick = () => send({ t: 'start' });
  $('opt-ramp').onchange = e => send({ t: 'settings', ramp: e.target.checked });
  $('btn-quit').onclick = () => quitGame();

  function quitGame() {
    if (mode === 'multi') {
      if (running && game && !game.dead && !confirm('게임에서 나가면 패배로 처리됩니다. 나갈까요?')) return;
      send({ t: 'leave' }); roomCode = null; stopGame(); show('lobby');
    } else { stopGame(); show('lobby'); }
    mode = null;
    exitFullscreen();
  }

  function renderRoom() {
    if (!lobby) return;
    $('room-code').textContent = lobby.code;
    const ul = $('player-list'); ul.innerHTML = '';
    for (const p of lobby.players) {
      const li = document.createElement('li');
      if (p.id === myId) li.className = 'me';
      const n = document.createElement('span'); n.textContent = p.name;
      if (p.id === lobby.host) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = '방장'; n.append(t); }
      const w = document.createElement('span'); w.className = 'wins'; w.textContent = p.wins + '승';
      li.append(n, w); ul.append(li);
    }
    const isHost = lobby.host === myId;
    $('btn-start').disabled = !isHost || lobby.state !== 'lobby';
    $('btn-start').textContent = isHost ? '게임 시작' : '방장이 시작하기를 기다리는 중…';
    $('opt-ramp').checked = lobby.ramp; $('opt-ramp').disabled = !isHost;
    $('room-msg').textContent = lobby.state === 'playing' && mode !== 'multi'
      ? '게임이 진행 중입니다. 다음 판부터 참가할 수 있어요.' : '';
    $('room-msg').style.color = '#ffcf5c';
  }

  // ------------------------------------------------------------------ 게임 시작/종료
  function newGame(opts) {
    stopGame();
    game = new Game(Object.assign({ sdf: settings.sdf }, opts));
    game.on('attack', n => { if (mode === 'multi') send({ t: 'attack', n, m: targeting }); });
    game.on('clear', onClear);
    game.on('dead', () => {
      if (mode === 'multi') { send({ t: 'dead' }); sendBoard(true); showOverlay('<h2>KO</h2><p class="hint">다른 친구들의 경기를 관전하세요</p>'); }
      else showOverlay('<h2>GAME OVER</h2>' + soloButtons());
    });
    input.resetMotion();
    myPlace = null;
  }
  function soloButtons() {
    return '<div class="ov-btns"><button class="btn primary" data-act="retry">다시 시작</button>' +
           '<button class="btn" data-act="lobby">로비로</button></div>' +
           '<p class="hint pc-only">R 키로 다시 시작 · Esc 로비로</p>';
  }

  function countdown(ms, done) {
    let n = Math.round(ms / 1000);
    const tick = () => {
      if (n <= 0) { hideOverlay(); done(); return; }
      showOverlay('<div class="count">' + n + '</div>');
      n--; countdownTimer = setTimeout(tick, 1000);
    };
    tick();
  }

  function startSolo() {
    mode = 'solo';
    opps.clear(); $('opponents').innerHTML = '';
    $('tb-mode').textContent = '혼자 연습 · 40줄';
    updateTargetLabel();
    newGame({ seed: (Math.random() * 2 ** 31) | 0, ramp: false });
    show('game-screen');
    countdown(3000, () => beginRunning());
  }

  function startMulti(m) {
    mode = 'multi';
    newGame({ seed: m.seed, ramp: m.ramp });
    opps.clear(); attackersOnMe.clear(); myTarget = null;
    const box = $('opponents'); box.innerHTML = '';
    for (const p of m.players) {
      if (p.id === myId) continue;
      const el = document.createElement('div'); el.className = 'opp';
      const nm = document.createElement('div'); nm.className = 'oname'; nm.textContent = p.name;
      const cv = document.createElement('canvas');
      const ko = document.createElement('div'); ko.className = 'oko hidden';
      el.append(nm, cv, ko); box.append(el);
      opps.set(p.id, { id: p.id, name: p.name, b: null, inc: 0, dead: false, place: null, el, canvas: cv, ctx: cv.getContext('2d'), koEl: ko });
    }
    $('tb-mode').textContent = '방 ' + roomCode + ' · ' + m.players.length + '명';
    updateTargetLabel();
    show('game-screen');
    sendBoard(true);
    countdown(m.countdown || 3000, () => beginRunning());
  }

  function beginRunning() {
    if (!game) return;
    running = true;
    game.softDrop = !!input.held.soft;
    lastFrame = performance.now();
  }

  function stopGame() {
    running = false;
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
    hideOverlay();
  }

  function endMulti(m) {
    running = false;
    if (countdownTimer) { clearTimeout(countdownTimer); countdownTimer = null; }
    if (mode !== 'multi') return;
    const win = m.winner === myId;
    let html = '<h2>' + (win ? '🏆 우승!' : '게임 종료') + '</h2><ol class="rank">';
    for (const r of m.ranking) {
      html += '<li class="' + (r.id === myId ? 'me' : '') + '"><span>' + r.place + '위 ' + esc(r.name) +
              '</span><span>KO ' + r.kos + '</span></li>';
    }
    html += '</ol><div class="ov-btns"><button class="btn primary" data-act="room">대기실로</button></div>' +
            '<p class="hint">방장이 다시 시작하면 바로 다음 판이 시작됩니다</p>';
    showOverlay(html);
  }

  // 오버레이 버튼 (터치/마우스 공용)
  $('overlay').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'retry') startSolo();
    else if (act === 'lobby') { stopGame(); mode = null; show('lobby'); exitFullscreen(); }
    else if (act === 'room') { stopGame(); mode = null; show('room'); renderRoom(); exitFullscreen(); }
  });

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ------------------------------------------------------------------ 연출
  function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); }
  function hideOverlay() { $('overlay').classList.add('hidden'); }

  function onClear(e) {
    const names = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'];
    let html = '';
    if (e.spin) {
      html += '<div class="big spin">T-SPIN' + (e.spin === 'mini' ? ' MINI' : '') + (e.lines ? ' ' + names[e.lines] : '') + '</div>';
    } else if (e.lines >= 2) {
      html += '<div class="big">' + names[e.lines] + '</div>';
    }
    if (e.lines > 0 && (e.lines === 4 || e.spin) && e.b2b > 0) html += '<div class="b2b">B2B ×' + e.b2b + '</div>';
    if (e.combo > 0) html += '<div class="combo">' + e.combo + ' COMBO</div>';
    if (e.pc) html += '<div class="pc">ALL CLEAR</div>';
    if (html) showAction(html);
    if (mode === 'solo' && game.stats.lines >= 40) finishSprint();
  }
  function showAction(html) {
    const a = $('action'); a.innerHTML = html;
    a.classList.remove('show'); void a.offsetWidth; a.classList.add('show');
  }

  function finishSprint() {
    running = false;
    input.releaseAll();
    const t = game.time;
    let best = 0;
    try { best = parseFloat(localStorage.getItem('tetris-best40') || '0'); } catch (e) { /* ignore */ }
    const isBest = !best || t < best;
    if (isBest) { try { localStorage.setItem('tetris-best40', String(t)); } catch (e) { /* ignore */ } }
    showOverlay('<h2>40줄 완료!</h2><div class="count" style="font-size:2.6em">' + fmtTime(t) + '</div>' +
      '<p>' + (isBest ? '🎉 개인 최고 기록!' : '최고 기록 ' + fmtTime(best)) + '</p>' +
      '<p class="hint">PPS ' + (game.stats.pieces / (t / 1000)).toFixed(2) + ' · 블록 ' + game.stats.pieces + '개</p>' + soloButtons());
  }
  function fmtTime(ms) {
    const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  // ------------------------------------------------------------------ 공격 대상
  const TARGET_ORDER = ['random', 'even', 'kos', 'attackers'];
  const TARGET_MODES = { Digit1: 'random', Digit2: 'even', Digit3: 'kos', Digit4: 'attackers' };
  const TARGET_LABEL = { random: '무작위', even: '골고루', kos: '위험한 상대', attackers: '나를 공격한 상대' };
  function updateTargetLabel() {
    const b = $('tb-target');
    b.classList.toggle('hidden', mode !== 'multi');
    b.innerHTML = '공격 대상: <b>' + TARGET_LABEL[targeting] + '</b> <small>' + (padEnabled() ? '(눌러서 변경)' : '(1~4 키)') + '</small>';
  }
  $('tb-target').addEventListener('click', () => {
    targeting = TARGET_ORDER[(TARGET_ORDER.indexOf(targeting) + 1) % TARGET_ORDER.length];
    updateTargetLabel();
  });
  function updateOppMarks() {
    const now = performance.now();
    for (const o of opps.values()) {
      const t = attackersOnMe.get(o.id);
      o.el.classList.toggle('targeting', !!t && now - t < 5000 && !o.dead);
      o.el.classList.toggle('my-target', o.id === myTarget && !o.dead);
    }
  }
  function markOpp(o) {
    o.koEl.classList.remove('hidden');
    o.koEl.textContent = o.left ? '나감' : 'KO·' + o.place + '위';
    updateOppMarks();
  }

  // ------------------------------------------------------------------ 입력 (DAS / ARR)
  // held 는 "누르고 있는 입력원 개수" (키보드와 터치를 동시에 써도 꼬이지 않도록)
  const input = {
    held: {}, dir: 0, das: 0, arr: 0,
    resetMotion() { this.das = 0; this.arr = 0; },
    press(a) {
      const was = this.held[a] > 0;
      this.held[a] = (this.held[a] || 0) + 1;
      if (was) return;
      if (a === 'left' || a === 'right') { this.dir = a === 'left' ? -1 : 1; this.das = 0; this.arr = 0; }
      if (a === 'retry') { if (mode === 'solo') startSolo(); return; }
      if (!game || !running || game.dead) return;
      switch (a) {
        case 'left': game.move(-1); break;
        case 'right': game.move(1); break;
        case 'soft': game.softDrop = true; break;
        case 'hard': game.hardDrop(); break;
        case 'cw': game.rotate(1); break;
        case 'ccw': game.rotate(-1); break;
        case 'r180': game.rotate(2); break;
        case 'hold': game.hold(); break;
      }
    },
    release(a) {
      if (!this.held[a]) return;
      this.held[a]--;
      if (this.held[a] > 0) return;
      if (a === 'left' && this.dir === -1) { this.dir = this.held.right ? 1 : 0; this.das = 0; this.arr = 0; }
      if (a === 'right' && this.dir === 1) { this.dir = this.held.left ? -1 : 0; this.das = 0; this.arr = 0; }
      if (a === 'soft' && game) game.softDrop = false;
    },
    releaseAll() {
      this.held = {}; this.dir = 0;
      if (game) game.softDrop = false;
      for (const b of document.querySelectorAll('.pbtn.down')) b.classList.remove('down');
    },
    update(dt) {
      if (!this.dir) return;
      this.das += dt;
      if (this.das < settings.das) return;
      if (settings.arr === 0) { while (game.move(this.dir)); return; }
      this.arr += dt;
      while (this.arr >= settings.arr) {
        this.arr -= settings.arr;
        if (!game.move(this.dir)) { this.arr = 0; break; }
      }
    },
  };

  let rebinding = null;
  document.addEventListener('keydown', e => {
    if (rebinding) { e.preventDefault(); finishRebind(e.code); return; }
    if (!$('game-screen').classList.contains('active')) return;
    if (e.code === 'Escape') { if (mode === 'solo') { stopGame(); mode = null; show('lobby'); } return; }
    if (mode === 'multi' && TARGET_MODES[e.code]) { targeting = TARGET_MODES[e.code]; updateTargetLabel(); return; }
    const a = keyMap[e.code];
    if (!a) return;
    e.preventDefault();
    if (e.repeat) return;
    input.press(a);
  });
  document.addEventListener('keyup', e => {
    const a = keyMap[e.code];
    if (a) { e.preventDefault(); input.release(a); }
  });
  window.addEventListener('blur', () => input.releaseAll());
  document.addEventListener('visibilitychange', () => { if (document.hidden) input.releaseAll(); });

  // ------------------------------------------------------------------ 터치 키패드
  //  왼쪽:   [  ]  [⤓ 하드]  [  ]        오른쪽:  [HOLD] [180]
  //          [◀]  [↓ 소프트] [▶]                  [↺]    [↻]
  const PAD_LEFT = [['hard', '⤓', '드롭'], ['left', '◀', ''], ['soft', '▼', ''], ['right', '▶', '']];
  const PAD_RIGHT = [['hold', 'HOLD', ''], ['r180', '180°', ''], ['ccw', '↺', ''], ['cw', '↻', '']];
  function buildPad(el, list) {
    for (const [a, sym, sub] of list) {
      const b = document.createElement('button');
      b.className = 'pbtn p-' + a; b.style.gridArea = a; b.type = 'button';
      b.setAttribute('aria-label', (ACTIONS.find(x => x[0] === a) || [, a])[1]);
      b.innerHTML = '<span class="sym">' + sym + '</span>' + (sub ? '<span class="sub">' + sub + '</span>' : '');
      const pointers = new Set();
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        if (pointers.has(e.pointerId)) return;
        pointers.add(e.pointerId);
        b.classList.add('down');
        if (settings.vibrate && navigator.vibrate) { try { navigator.vibrate(8); } catch (_) { /* ignore */ } }
        input.press(a);
      });
      const up = e => {
        if (!pointers.delete(e.pointerId)) return;
        if (!pointers.size) b.classList.remove('down');
        input.release(a);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      el.append(b);
    }
  }
  buildPad($('pad-left'), PAD_LEFT);
  buildPad($('pad-right'), PAD_RIGHT);
  // 게임 화면에서 스크롤·확대·길게 누르기 메뉴 막기
  const gs = $('game-screen');
  for (const ev of ['touchstart', 'touchmove']) {
    gs.addEventListener(ev, e => { if (!e.target.closest('button, a, input, select')) e.preventDefault(); }, { passive: false });
  }
  $('pads').addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  gs.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('gesturestart', e => e.preventDefault());   // iOS 핀치 확대

  // 전체 화면
  const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  function enterFullscreen() {
    const el = document.documentElement;
    const f = el.requestFullscreen || el.webkitRequestFullscreen;
    if (f) { try { const p = f.call(el); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ } }
  }
  function exitFullscreen() {
    const fe = document.fullscreenElement || document.webkitFullscreenElement;
    const f = document.exitFullscreen || document.webkitExitFullscreen;
    if (fe && f) { try { const p = f.call(document); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ } }
  }
  $('btn-fs').onclick = () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) exitFullscreen(); else enterFullscreen();
  };
  document.addEventListener('fullscreenchange', () => setTimeout(layout, 50));
  document.addEventListener('webkitfullscreenchange', () => setTimeout(layout, 50));

  // ------------------------------------------------------------------ 설정 창
  function openSettings() {
    $('s-das').value = settings.das; $('s-arr').value = settings.arr; $('s-sdf').value = settings.sdf;
    $('s-ghost').checked = settings.ghost;
    $('s-pad').value = settings.pad; $('s-padscale').value = settings.padScale; $('s-vibrate').checked = settings.vibrate;
    refreshSettingLabels(); renderBinds();
    $('settings-modal').classList.remove('hidden');
  }
  function refreshSettingLabels() {
    $('v-das').textContent = $('s-das').value + 'ms (' + (($('s-das').value / 16.67).toFixed(1)) + 'F)';
    $('v-arr').textContent = $('s-arr').value + 'ms (' + (($('s-arr').value / 16.67).toFixed(1)) + 'F)';
    $('v-sdf').textContent = $('s-sdf').value >= 41 ? '∞ (즉시)' : $('s-sdf').value + '×';
    $('v-padscale').textContent = $('s-padscale').value + '%';
  }
  for (const id of ['s-das', 's-arr', 's-sdf', 's-padscale']) $(id).oninput = refreshSettingLabels;
  function renderBinds() {
    const box = $('bind-list'); box.innerHTML = '';
    for (const [a, label] of ACTIONS) {
      const d = document.createElement('div'); d.className = 'bind';
      const l = document.createElement('span'); l.textContent = label;
      const b = document.createElement('button'); b.className = 'btn small';
      b.textContent = (settings.binds[a] || []).map(keyName).join(' / ') || '(없음)';
      b.onclick = () => { rebinding = a; b.textContent = '키를 누르세요…'; b.classList.add('wait'); };
      d.append(l, b); box.append(d);
    }
  }
  function finishRebind(code) {
    if (code !== 'Escape') {
      for (const [a] of ACTIONS) settings.binds[a] = (settings.binds[a] || []).filter(k => k !== code);
      settings.binds[rebinding] = [code];
    }
    rebinding = null; renderBinds();
  }
  $('btn-settings').onclick = openSettings;
  $('s-reset').onclick = () => {
    settings = JSON.parse(JSON.stringify(DEFAULTS));
    openSettings();
  };
  $('s-close').onclick = () => {
    settings.das = +$('s-das').value; settings.arr = +$('s-arr').value; settings.sdf = +$('s-sdf').value;
    settings.ghost = $('s-ghost').checked;
    settings.pad = $('s-pad').value; settings.padScale = +$('s-padscale').value; settings.vibrate = $('s-vibrate').checked;
    saveSettings();
    if (game) game.sdf = settings.sdf;
    $('settings-modal').classList.add('hidden');
    if ($('game-screen').classList.contains('active')) layout();
  };

  // ------------------------------------------------------------------ 레이아웃
  // desktop: [나] [상대들]
  // portrait(세로 모바일): 상대들(위) / 나 / 키패드(아래)
  // landscape(가로 모바일): [왼쪽 키패드] [나] [상대들] [오른쪽 키패드]
  let cell = 28, meterW = 18, pc = 20, sideW = 96;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  function sizeCanvas(c, w, h) {
    c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
    c.style.width = w + 'px'; c.style.height = h + 'px';
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // 상대 보드를 aw x ah 안에 모두 넣을 수 있는 가장 큰 칸 크기
  function fitOpps(n, aw, ah, maxC) {
    for (let c = maxC; c >= 3; c--) {
      const label = c >= 7 ? 16 : 0;
      const bw = c * W + 6 + 8, bh = c * ROWS + label + 6;
      const cols = Math.floor(aw / bw); if (cols < 1) continue;
      if (Math.ceil(n / cols) * bh <= ah) return c;
    }
    return 3;
  }
  let bctx, hctx, nctx;
  function layout() {
    const touch = padEnabled();
    const vw = window.innerWidth, vh = window.innerHeight;
    const arena = $('arena');
    const nOpp = mode === 'multi' ? opps.size : 0;
    const lm = !touch ? 'desktop' : (vw > vh * 1.1 ? 'landscape' : 'portrait');
    arena.className = lm;
    $('pads').classList.toggle('hidden', !touch);
    $('btn-fs').classList.toggle('hidden', !(touch && fsSupported));
    $('me').classList.toggle('compact', touch);
    updateTargetLabel();
    const topH = $('topbar').offsetHeight || 36;
    const ratio = touch ? 0.55 : 0.72;                  // hold/next 블록 크기 비율
    const perCell = W + 0.45 + 2 * 4.8 * ratio;          // 내 영역 가로 폭(칸 단위)
    const extra = 4 + 2 * 10 + 4;                         // 미터 여백 + 간격
    const scale = (settings.padScale || 100) / 100;
    let oppArea = null;

    if (lm === 'desktop') {
      const availH = vh - topH - 20;
      cell = clamp(Math.min(Math.floor(availH / ROWS), Math.floor((vw * (nOpp ? 0.5 : 1) - extra) / perCell)), 10, 34);
      if (nOpp) {
        const meW = cell * perCell + extra;
        oppArea = [vw - meW - 60, availH];
      }
    } else if (lm === 'portrait') {
      const b = Math.round(clamp(Math.min((vw - 40) / 6.4, vh * 0.085), 42, 76) * scale);
      const gap = Math.round(b * 0.14);
      $('pads').style.setProperty('--b', b + 'px'); $('pads').style.setProperty('--gap', gap + 'px');
      const padsH = 2 * b + gap + 14;
      const oppH = nOpp ? Math.round(clamp(vh * 0.15, 56, 140)) : 0;
      $('opponents').style.height = nOpp ? oppH + 'px' : '0px';
      const availH = vh - topH - padsH - oppH - 18;
      cell = clamp(Math.min(Math.floor(availH / ROWS), Math.floor((vw - 8 - extra) / perCell)), 7, 34);
      if (nOpp) oppArea = [vw - 12, oppH];
    } else { // landscape
      const availH = vh - topH - 8;
      const b = Math.round(clamp(Math.min(availH / 3.3, vw * 0.1), 40, 80) * scale);
      const gap = Math.round(b * 0.14);
      $('pads').style.setProperty('--b', b + 'px'); $('pads').style.setProperty('--gap', gap + 'px');
      $('opponents').style.height = '';
      const padsW = (3 * b + 2 * gap) + (2 * b + gap) + 40;
      cell = clamp(Math.min(Math.floor(availH / ROWS), Math.floor((vw - padsW - extra - (nOpp ? 80 : 0)) / perCell)), 7, 34);
      if (nOpp) oppArea = [vw - padsW - (cell * perCell + extra) - 16, availH];
    }

    meterW = Math.round(cell * 0.45) + 4;
    pc = Math.max(5, Math.round(cell * ratio));
    sideW = pc * 4.8;
    bctx = sizeCanvas($('board'), meterW + W * cell, ROWS * cell);
    hctx = sizeCanvas($('hold'), sideW, pc * 3.2);
    nctx = sizeCanvas($('next'), sideW, pc * 3 * 5 + pc * 0.4);
    $('stats').style.width = sideW + 'px';
    $('action').style.left = meterW + 'px';
    $('action').style.fontSize = Math.max(10, cell * 0.55) + 'px';
    $('overlay').style.left = meterW + 'px';
    $('overlay').style.top = 2 * cell + 'px';
    $('overlay').style.fontSize = clamp(cell * 0.6, 11, 18) + 'px';

    if (nOpp && oppArea) {
      const oc = fitOpps(nOpp, Math.max(40, oppArea[0]), Math.max(40, oppArea[1]), Math.min(26, cell));
      for (const o of opps.values()) {
        o.cell = oc;
        o.ctx = sizeCanvas(o.canvas, oc * W + 6, oc * ROWS);
        o.el.style.width = (oc * W + 6) + 'px';
        o.el.classList.toggle('tiny', oc < 7);
        drawOpp(o);
      }
    }
    if (game) game.dirty = true;
  }
  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if ($('game-screen').classList.contains('active')) layout(); }, 60);
  });
  window.addEventListener('orientationchange', () => setTimeout(() => { if ($('game-screen').classList.contains('active')) layout(); }, 250));

  // ------------------------------------------------------------------ 렌더링
  function drawCell(ctx, x, y, s, color, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = color; ctx.fillRect(x, y, s, s);
    if (s >= 6) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x, y, s, Math.max(1, s * 0.14));
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x, y + s * 0.86, s, s * 0.14);
    }
    ctx.globalAlpha = 1;
  }
  function drawField(ctx, ox, s, getCell, dead) {
    ctx.fillStyle = '#0a0d14'; ctx.fillRect(ox, 2 * s, W * s, (ROWS - 2) * s);
    if (s >= 10) {
      ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 1; x < W; x++) { ctx.moveTo(ox + x * s + 0.5, 2 * s); ctx.lineTo(ox + x * s + 0.5, ROWS * s); }
      for (let y = 3; y < ROWS; y++) { ctx.moveTo(ox, y * s + 0.5); ctx.lineTo(ox + W * s, y * s + 0.5); }
      ctx.stroke();
    }
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < W; x++) {
      const v = getCell(x, y);
      if (v) drawCell(ctx, ox + x * s, y * s, s, dead ? '#3b3f4a' : COLORS[v]);
    }
    ctx.strokeStyle = '#3a4256'; ctx.lineWidth = s >= 8 ? 2 : 1;
    ctx.strokeRect(ox - 1, 2 * s - 1, W * s + 2, (ROWS - 2) * s + 2);
  }
  function drawMeter(ctx, w, s, entries) {
    ctx.fillStyle = '#0a0d14'; ctx.fillRect(0, 2 * s, w - 4, (ROWS - 2) * s);
    let y = ROWS * s;
    for (const g of entries) {
      const h = Math.min(g.n * s, y - 2 * s); if (h <= 0) break;
      ctx.fillStyle = g.delay > 0 ? '#ff9f43' : '#ff3b3b';
      ctx.fillRect(1, y - h, w - 6, h - 1);
      y -= h;
    }
  }

  function drawMain() {
    const ctx = bctx; if (!ctx) return;
    const s = cell;
    ctx.clearRect(0, 0, meterW + W * s, ROWS * s);
    if (!game) return;
    const b = game.board;
    drawField(ctx, meterW, s, (x, y) => b[(y + TOP) * W + x], game.dead);
    drawMeter(ctx, meterW, s, game.incoming);
    if (!game.dead && game.cur) {
      const c = game.cur, cells = ROTS[c.type][c.rot], col = COLORS[COLOR_ID[c.type]];
      if (settings.ghost) {
        const gy = game.ghostY();
        for (const [cx, cy] of cells) { const y = gy + cy - TOP; if (y >= 0) drawCell(ctx, meterW + (c.x + cx) * s, y * s, s, col, 0.25); }
      }
      // 락 딜레이가 진행될수록 살짝 어둡게
      const fade = game.grounded() ? 1 - 0.4 * Math.min(1, game.lockTimer / game.lockDelay) : 1;
      for (const [cx, cy] of cells) { const y = c.y + cy - TOP; if (y >= 0) drawCell(ctx, meterW + (c.x + cx) * s, y * s, s, col, fade); }
    }
  }

  function drawPiece(ctx, type, cx, cy, s, color) {
    const cells = ROTS[type][0];
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    for (const [x, y] of cells) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const w = (maxX - minX + 1) * s, h = (maxY - minY + 1) * s;
    for (const [x, y] of cells) drawCell(ctx, cx - w / 2 + (x - minX) * s, cy - h / 2 + (y - minY) * s, s, color);
  }
  function drawSide() {
    if (!hctx || !game) return;
    hctx.clearRect(0, 0, sideW, pc * 3.2);
    if (game.holdType) drawPiece(hctx, game.holdType, sideW / 2, pc * 1.6, pc, game.holdUsed ? '#4a4e58' : COLORS[COLOR_ID[game.holdType]]);
    nctx.clearRect(0, 0, sideW, pc * 15.4);
    for (let i = 0; i < 5; i++) {
      const t = game.queue[i];
      drawPiece(nctx, t, sideW / 2, pc * (1.7 + i * 3), pc, COLORS[COLOR_ID[t]]);
    }
  }
  function drawStats() {
    if (!game) return;
    const st = game.stats, sec = Math.max(0.001, game.time / 1000);
    let h = '<span>시간</span><b>' + fmtTime(game.time) + '</b>' +
            '<span>PPS</span><b>' + (st.pieces / sec).toFixed(2) + '</b>';
    if (mode === 'multi') {
      h += '<span>APM</span><b>' + (st.attack / sec * 60).toFixed(1) + '</b>' +
           '<span>보낸 줄</span><b>' + st.sent + '</b>' +
           '<span>KO</span><b>' + st.kos + '</b>';
      if (myPlace) h += '<span>순위</span><b>' + myPlace + '위</b>';
    } else {
      h += '<span>남은 줄</span><b>' + Math.max(0, 40 - st.lines) + '</b>' +
           '<span>블록</span><b>' + st.pieces + '</b>';
    }
    $('stats').innerHTML = h;
  }

  function drawOpp(o) {
    const ctx = o.ctx, s = o.cell || 8; if (!ctx) return;
    const mw = 6;
    ctx.clearRect(0, 0, s * W + mw, s * ROWS);
    const b = o.b;
    drawField(ctx, mw, s, (x, y) => b ? (b.charCodeAt(y * W + x) - 48) : 0, o.dead);
    const inc = Math.min(o.inc || 0, ROWS - 2);
    ctx.fillStyle = '#0a0d14'; ctx.fillRect(0, 2 * s, mw - 2, (ROWS - 2) * s);
    if (inc) { ctx.fillStyle = '#ff3b3b'; ctx.fillRect(0, (ROWS - inc) * s, mw - 2, inc * s); }
  }

  // ------------------------------------------------------------------ 보드 전송
  function sendBoard(force) {
    if (mode !== 'multi' || !game) return;
    const now = performance.now();
    if (!force && (!game.dirty || now - lastBoardSent < 70)) return;
    lastBoardSent = now; game.dirty = false;
    send({ t: 'board', b: game.snapshot(), h: game.stackHeight(), inc: game.pendingGarbage() });
  }

  // ------------------------------------------------------------------ 메인 루프
  let lastFrame = performance.now(), statTimer = 0;
  function frame(now) {
    const dt = Math.min(100, now - lastFrame); lastFrame = now;
    if (game && running && !game.dead) {
      input.update(dt);
      game.update(dt);
      sendBoard(false);
    }
    if ($('game-screen').classList.contains('active')) {
      drawMain(); drawSide();
      statTimer += dt;
      if (statTimer > 100) { statTimer = 0; drawStats(); if (mode === 'multi') updateOppMarks(); }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  connect();
})();
