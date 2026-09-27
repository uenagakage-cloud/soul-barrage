// SOUL BARRAGE クライアント
(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d');
const COLORS = ['#ff2d55', '#ffd60a', '#32d74b', '#64d2ff', '#bf5af2', '#ff9f0a', '#ff6ec7', '#ffffff'];
const K = { NORMAL: 0, BIG: 1, SHOT: 2, BLUE: 3, ORANGE: 4, SP: 5 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// 再接続時に成績（勝利数など）を引き継ぐための端末ID
let myToken = store.get('sb_token', '');
if (!myToken) { myToken = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('sb_token', myToken); }

// ===== 通信 =====
const socket = io({ transports: ['websocket', 'polling'] });
let C = null, myId = null, roomId = null, isPublic = false, joinInfo = null;
let offset = 0, ping = 0;
const clockSamples = [];
const sNow = () => Date.now() + offset;

function syncClock() {
  const t0 = Date.now();
  socket.timeout(3000).emit('ping2', t0, (err, s) => {
    if (err) return;
    const t1 = Date.now(), rtt = t1 - t0;
    clockSamples.push({ rtt, off: s - (t0 + rtt / 2) });
    if (clockSamples.length > 10) clockSamples.shift();
    const best = clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    offset = best.off;
    ping = rtt;
    $('ping').textContent = ping + 'ms';
  });
}
setInterval(() => { if (socket.connected) syncClock(); }, 2000);

socket.on('connect', () => {
  $('conn').classList.add('hidden');
  clockSamples.length = 0;
  for (let i = 0; i < 4; i++) setTimeout(syncClock, i * 150);
  setStatus('');
  $('btnQuick').disabled = $('btnCreate').disabled = $('btnCode').disabled = false;
  // 再接続時は同じ部屋に戻る
  if (joinInfo && roomId) join({ ...joinInfo, mode: 'code', code: roomId }, true);
});
socket.on('disconnect', () => { if (roomId) $('conn').classList.remove('hidden'); });
socket.on('connect_error', () => setStatus('サーバーに接続中…（初回は起動に時間がかかることがあります）'));

// ===== ゲーム状態 =====
const G = {
  st: 'none', su: 0, rs: 0, rd: 0,
  players: new Map(),   // id -> {x,y,tx,ty,hp,alive,inv,cd}
  roster: new Map(),    // id -> {name,color,wins,kills}
  items: [],
  bullets: new Map(),
  particles: [], texts: [], emotes: new Map(),
  result: null,
};
const me = { x: 240, y: 240, invUntil: 0, needSnap: true, moving: false, lastSend: 0, cdEnd: 0, hp: 20, alive: false, sp: 0 };
let spPressed = 0;
let shake = 0, flash = 0;

socket.on('roster', (list) => {
  G.roster = new Map(list.map(p => [p.id, p]));
  for (const id of [...G.players.keys()]) if (!G.roster.has(id)) G.players.delete(id);
  updateLobby();
});

socket.on('round', () => {
  G.bullets.clear(); G.particles.length = 0; G.texts.length = 0;
  me.needSnap = true; me.invUntil = 0;
  hide('result');
});

socket.on('s', (s) => {
  const prevSt = G.st;
  G.st = s.st; G.su = s.su; G.rs = s.rs; G.rd = s.rd; G.md = s.md;
  const seen = new Set();
  for (const [id, x, y, hp, alive, inv, cd, sp] of s.p) {
    seen.add(id);
    let p = G.players.get(id);
    if (!p) { p = { x, y, tx: x, ty: y }; G.players.set(id, p); }
    p.tx = x; p.ty = y; p.hp = hp; p.alive = !!alive; p.inv = inv; p.cd = cd; p.sp = sp;
    if (id === myId) {
      me.hp = hp; me.alive = !!alive;
      me.cdEnd = sNow() + cd;
      if (sp >= C.SP_MAX && me.sp < C.SP_MAX && G.st === 'play' && performance.now() - spPressed > 600) { sfx('spReady'); toast('必殺技ゲージMAX！ SPボタンで発動'); }
      me.sp = sp;
      if (me.needSnap || !alive || G.st !== 'play') { me.x = x; me.y = y; }
      if (G.st === 'play' && me.needSnap) me.needSnap = false;
    }
  }
  for (const id of [...G.players.keys()]) if (!seen.has(id)) G.players.delete(id);
  G.items = s.it;
  if (prevSt !== G.st) onStateChange(prevSt, G.st);
});

socket.on('b', (list) => {
  for (const a of list) {
    G.bullets.set(a[0], { id: a[0], x0: a[1], y0: a[2], vx: a[3], vy: a[4], ax: a[5], ay: a[6], r: a[7], t0: a[8], life: a[9], kind: a[10], owner: a[11], warn: a[12], x: a[1], y: a[2], grazed: false });
  }
});

socket.on('fx', (f) => {
  const col = colorOf(f.id);
  if (f.t === 'hit') {
    burst(f.x, f.y, col, 10, 120);
    G.texts.push({ x: f.x, y: f.y - 14, text: 'HIT', color: '#ff453a', life: 0.8 });
    if (f.id !== myId) sfx('hitOther');
    if (f.by === myId && f.id !== myId) { toast(`${nameOf(f.id)} に命中！`); sfx('confirm'); }
  } else if (f.t === 'dead') {
    shatter(f.x, f.y, col);
    sfx('break');
    if (f.id === myId) { toast(f.by ? `${nameOf(f.by)} にやられた…` : 'やられた…'); vibrate([60, 40, 120]); }
    else if (f.by === myId) toast(`${nameOf(f.id)} を倒した！`);
    else toast(`${nameOf(f.id)} が脱落`);
  } else if (f.t === 'fire') {
    ringFx(f.x, f.y, col);
    if (f.id === myId) sfx('shoot'); else sfx('shootOther');
  } else if (f.t === 'item') {
    burst(f.x, f.y, f.item === 'heal' ? '#32d74b' : '#ffd60a', 12, 90);
    G.texts.push({ x: f.x, y: f.y - 12, text: f.item === 'heal' ? 'HP UP' : 'CHARGE!', color: f.item === 'heal' ? '#32d74b' : '#ffd60a', life: 1 });
    if (f.id === myId) sfx('item');
  } else if (f.t === 'special') {
    // 周囲の敵弾を消す（自分の弾は残す）
    const now = sNow();
    for (const [bid, b] of G.bullets) {
      if (b.owner === f.id) continue;
      bulletPos(b, now);
      if (b.t >= 0 && Math.hypot(b.x - f.x, b.y - f.y) < f.r) { burst(b.x, b.y, '#fff', 2, 60); G.bullets.delete(bid); }
    }
    G.particles.push({ x: f.x, y: f.y, ring: true, big: f.r, life: 0.5, max: 0.5, color: col, size: 0 });
    G.texts.push({ x: f.x, y: f.y - 24, text: 'SOUL BURST!', color: col, life: 1.2 });
    shake = Math.max(shake, 8);
    if (f.id === myId) { me.invUntil = Math.max(me.invUntil, now + f.inv); vibrate([30, 30, 60]); }
    sfx('special');
  } else if (f.t === 'emote') {
    G.emotes.set(f.id, { e: f.e, until: performance.now() + 1800 });
    sfx('emote');
  }
});

socket.on('result', (r) => { G.result = r; showResult(r); });

function colorOf(id) { const r = G.roster.get(id); return r ? r.color : '#fff'; }
function nameOf(id) { const r = G.roster.get(id); return r ? r.name : '???'; }

function onStateChange(prev, st) {
  if (st === 'countdown') { hide('lobby'); hide('result'); }
  if (st === 'play') { sfx('go'); }
  if (st === 'lobby') { hide('result'); show('lobby'); updateLobby(); G.bullets.clear(); }
  if (st !== 'lobby') hide('lobby');
}

// ===== タイトル画面 =====
let myColor = store.get('sb_color', COLORS[0]);
$('nameIn').value = store.get('sb_name', '');
const heartSvg = (c) => `<svg viewBox="0 0 20 18"><path fill="${c}" d="M10 17 1.5 8.5C-1 6-.5 1.5 3.5.8 6 .4 8 1.6 10 4c2-2.4 4-3.6 6.5-3.2 4 .7 4.5 5.2 2 7.7Z"/></svg>`;
function renderSwatches() {
  $('swatches').innerHTML = COLORS.map(c => `<button class="sw ${c === myColor ? 'sel' : ''}" data-c="${c}" aria-label="色">${heartSvg(c)}</button>`).join('');
}
renderSwatches();
$('swatches').addEventListener('click', (e) => {
  const b = e.target.closest('.sw'); if (!b) return;
  myColor = b.dataset.c; store.set('sb_color', myColor); renderSwatches();
});
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) { $('codeIn').value = urlRoom.toUpperCase(); $('btnCode').classList.add('hl'); }
$('btnQuick').disabled = $('btnCreate').disabled = $('btnCode').disabled = true;

function setStatus(t, err) { const s = $('status'); s.textContent = t; s.classList.toggle('err', !!err); }

function join(info, isRejoin) {
  audioInit();
  const name = $('nameIn').value.trim() || 'ななし';
  store.set('sb_name', name);
  info = { name, color: myColor, token: myToken, ...info };
  if (!socket.connected) { setStatus('サーバーに接続中…少し待ってね'); return; }
  setStatus('参加中…');
  socket.emit('join', info, (res) => {
    if (!res || !res.ok) {
      if (isRejoin) { leave(); toast('部屋が閉じられました'); return; }
      setStatus((res && res.error) || '参加できませんでした', true); return;
    }
    joinInfo = { name: info.name, color: info.color };
    C = res.C; myId = res.id; roomId = res.room; isPublic = res.isPublic;
    me.needSnap = true;
    G.players.clear(); G.bullets.clear();
    $('roomChip').textContent = isPublic ? 'PUBLIC' : `ROOM ${roomId}`;
    $('btnShare').classList.toggle('hidden', isPublic);
    hide('title'); show('hud'); show('plist'); show('emotes');
    if (!isPublic) history.replaceState(null, '', `?room=${roomId}`);
    setStatus('');
    resize();
    if (res.state === 'play' && !isRejoin) toast('試合中のため観戦します。次の試合から参戦！');
  });
}
$('btnQuick').onclick = () => join({ mode: 'quick' });
$('btnCreate').onclick = () => join({ mode: 'create' });
$('btnCode').onclick = () => {
  const code = $('codeIn').value.trim().toUpperCase();
  if (!code) return setStatus('へやコードを入力してね', true);
  join({ mode: 'code', code });
};
$('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnCode').click(); });

function leave() {
  roomId = null; joinInfo = null; myId = null; G.st = 'none';
  socket.disconnect(); socket.connect();
  history.replaceState(null, '', location.pathname);
  hide('hud'); hide('plist'); hide('emotes'); hide('lobby'); hide('result'); $('conn').classList.add('hidden');
  show('title'); loadTop();
}
$('btnLeave').onclick = () => { if (confirm('部屋から退出しますか？')) leave(); };
$('btnStart').onclick = () => { socket.emit('start'); audioInit(); };
$('btnReady').onclick = () => { socket.emit('ready'); audioInit(); };
$('btnShare').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${roomId}`;
  try {
    if (navigator.share) await navigator.share({ title: 'SOUL BARRAGE', text: `弾幕バトルしよう！ へやコード: ${roomId}`, url });
    else { await navigator.clipboard.writeText(url); toast('招待リンクをコピーしました'); }
  } catch { /* キャンセル */ }
};
$('emotes').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) socket.emit('emote', b.dataset.e);
});

async function loadTop() {
  try {
    const list = await (await fetch('/api/top')).json();
    $('topScores').innerHTML = list.length
      ? list.map(s => `<li>${esc(s.name)} — ${(s.ms / 1000).toFixed(1)}秒</li>`).join('')
      : '<li>まだ記録がありません</li>';
  } catch {}
}
loadTop();

// ===== オーバーレイ =====
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
let toastTimer = 0;
function toast(t) {
  const el = $('toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

const amHost = () => { const r = G.roster.get(myId); return !!(r && r.host); };

function updateLobby() {
  if (G.st !== 'lobby') return;
  const list = [...G.roster.values()];
  $('lobbyList').innerHTML = list.map(p => {
    const tag = p.host ? '<span class="tag host">ホスト</span>'
      : p.ready ? '<span class="tag ok">準備OK</span>' : '<span class="tag wait">待機中</span>';
    return `<div class="plrow"><span style="width:20px;display:inline-block">${heartSvg(p.color)}</span>${esc(p.name)}${p.id === myId ? '（あなた）' : ''} ${tag}<span class="r">★${p.wins} / KO ${p.kills}</span></div>`;
  }).join('');
  $('lobbyCode').innerHTML = isPublic ? '' : `へやコード <b>${esc(roomId)}</b>`;
  const mine = G.roster.get(myId);
  const others = list.filter(p => !p.host);
  const readyN = others.filter(p => p.ready).length;
  // プライベート: ホストだけがスタートボタン、他は準備OKボタン / 公開: 全員準備OKボタン
  $('btnStart').classList.toggle('hidden', isPublic || !amHost());
  $('btnReady').classList.toggle('hidden', !isPublic && amHost());
  $('btnStart').textContent = others.length ? `▶ スタート（準備OK ${readyN}/${others.length}）` : '▶ スタート';
  $('btnReady').textContent = mine && mine.ready ? '✔ 準備OK（押すと取消）' : '準備OK';
  $('btnReady').classList.toggle('primary', !!(mine && mine.ready));
}
function updateLobbyNote() {
  if (G.st !== 'lobby') return;
  const n = G.roster.size;
  let t = n <= 1 ? '1人ならソロで生存記録に挑戦。2人以上でバトロワ！' : `${n}人でバトロワ！ 最後まで残った人の勝ち`;
  if (isPublic) t += G.su ? `<br>全員準備OK、または ${Math.max(0, Math.ceil((G.su - sNow()) / 1000))} 秒でスタート` : '';
  else if (amHost()) t += '<br>みんなが揃ったらスタートを押してね。「招待」で友達にリンクを送れます';
  else t += '<br>ホストがスタートするのを待っています';
  $('lobbyNote').innerHTML = t;
}

function showResult(r) {
  let title;
  if (r.mode === 'versus') title = r.winner ? `<span class="win">${esc(nameOf(r.winner))} の勝利！</span>` : '引き分け';
  else title = `記録 <span class="win">${((r.ranking[0] ? r.ranking[0].time : 0) / 1000).toFixed(1)}秒</span>`;
  $('resTitle').innerHTML = title;
  $('resList').innerHTML = r.ranking.map((p, i) =>
    `<div class="plrow"><b>${i + 1}</b><span style="width:20px;display:inline-block">${heartSvg(p.color)}</span>${esc(p.name)}<span class="r">${(p.time / 1000).toFixed(1)}s · KO${p.kills} · GRAZE${p.grazes}</span></div>`).join('');
  $('resNote').innerHTML = r.mode === 'solo' && r.top.length
    ? 'ソロ記録TOP: ' + r.top.slice(0, 3).map(s => `${esc(s.name)} ${(s.ms / 1000).toFixed(1)}s`).join(' / ')
    : 'まもなくロビーに戻ります';
  show('result');
  const iWon = r.winner === myId;
  sfx(iWon ? 'win' : 'end');
}

let plistTimer = 0;
function updatePlist() {
  const rows = [...G.roster.values()].map(r => {
    const p = G.players.get(r.id) || {};
    const hp = p.hp ?? (C ? C.MAX_HP : 20);
    const pct = C ? (hp / C.MAX_HP * 100) : 100;
    return `<div class="pr ${p.alive ? '' : 'dead'}"><span style="width:14px;display:inline-block">${heartSvg(r.color)}</span>${esc(r.name)}<span class="bar"><i style="width:${pct}%"></i></span>${r.wins ? '★' + r.wins : ''}</div>`;
  });
  $('plist').innerHTML = rows.join('');
}

// ===== 入力 =====
const input = { x: 0, y: 0 };
const keys = new Set();
const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const L = { w: 0, h: 0, bx: 0, by: 0, bs: 300, sc: 1, fire: { x: 0, y: 0, r: 46 }, stickHome: { x: 0, y: 0 }, stickR: 52, portrait: true };

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.code);
  if ((e.code === 'Space' || e.code === 'KeyZ' || e.code === 'KeyJ') && !e.repeat) tryFire(keyboardAimAngle());
  if ((e.code === 'KeyX' || e.code === 'KeyK') && !e.repeat) trySpecial();
  if (e.code === 'Enter' && G.st === 'lobby' && roomId && !e.repeat) (!isPublic && amHost() ? $('btnStart') : $('btnReady')).click();
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));

// ===== スティック感度 =====
// 全体: 最高速に達するまでの倒し幅 / 横・縦: その軸だけの効き具合。どの設定でも最高速は同じ（ベクトル長を1で頭打ち）
const SENS_DEF = [
  { k: 'all', label: '全体の感度', hint: '高いほど少し倒すだけで最高速に' },
  { k: 'x', label: '横（左右）の感度', hint: '高いほど左右に速く反応' },
  { k: 'y', label: '縦（上下）の感度', hint: '高いほど上下に速く反応' },
];
const sens = {};
for (const d of SENS_DEF) sens[d.k] = clamp(parseInt(store.get(d.k === 'all' ? 'sb_sens' : 'sb_sens_' + d.k, '5'), 10) || 5, 1, 10);
const stickReach = () => L.stickR * (1.6 - sens.all * 0.12);   // 1:1.48倍 / 5:1.0倍 / 10:0.4倍
const axisMul = (lv) => 0.6 + lv * 0.08;                          // 1:0.68倍 / 5:1.0倍 / 10:1.4倍
const STICK_DEAD = 6;
// 各軸で最高速になる倒し幅（px）。点線の楕円として表示する
const stickReachXY = () => {
  const r = stickReach() - STICK_DEAD;
  return { rx: STICK_DEAD + r / axisMul(sens.x), ry: STICK_DEAD + r / axisMul(sens.y) };
};
function buildSensUI() {
  document.querySelectorAll('.sensBox').forEach(box => {
    box.innerHTML = SENS_DEF.map(d => `
      <div class="sens">
        <label>${d.label} <b class="sensVal" data-k="${d.k}">${sens[d.k]}</b></label>
        <input type="range" class="sensIn" data-k="${d.k}" min="1" max="10" step="1" value="${sens[d.k]}">
        <p class="sensHint">${d.hint}</p>
      </div>`).join('') + '<button class="btn sensReset" type="button">感度を標準（5）に戻す</button>';
  });
}
function setSens(k, v) {
  sens[k] = clamp(parseInt(v, 10) || 5, 1, 10);
  store.set(k === 'all' ? 'sb_sens' : 'sb_sens_' + k, String(sens[k]));
  document.querySelectorAll(`.sensIn[data-k="${k}"]`).forEach(el => { el.value = sens[k]; });
  document.querySelectorAll(`.sensVal[data-k="${k}"]`).forEach(el => { el.textContent = sens[k]; });
}
buildSensUI();
document.addEventListener('input', (e) => { if (e.target.classList.contains('sensIn')) setSens(e.target.dataset.k, e.target.value); });
document.addEventListener('click', (e) => { if (e.target.classList.contains('sensReset')) SENS_DEF.forEach(d => setSens(d.k, 5)); });
$('btnSettings').onclick = () => { resetInput(); show('settings'); };
$('btnSettingsClose').onclick = () => hide('settings');

// ===== タッチ入力（スティック + SHOTボタン） =====
// スマホは Touch Events で指ごとに追跡し、毎イベントで「その指がまだ画面にあるか」を確認する。
// （指を離したイベントを取りこぼしても、次のタッチ操作で必ず解除される＝入りっぱなし防止）
// SHOTボタン: タップ＝一番近い敵を自動で狙う / スライド＝その方向に撃つ / スライドして中央に戻す＝キャンセル
const AIM_TH = 16;
const aim = { id: null, x: 0, y: 0, dragged: false, angle: 0 };
let firePressed = 0;
const onFireBtn = (x, y) => Math.hypot(x - L.fire.x, y - L.fire.y) < L.fire.r * 1.35;
const onSpBtn = (x, y) => L.sp && Math.hypot(x - L.sp.x, y - L.sp.y) < L.sp.r * 1.3;

function pointerDown(id, x, y) {
  if (!roomId) return;
  audioInit();
  if (onSpBtn(x, y)) { trySpecial(); return; }
  if (onFireBtn(x, y)) {
    if (aim.id === null) { aim.id = id; aim.x = x; aim.y = y; aim.dragged = false; firePressed = performance.now(); }
    return;
  }
  if (stick.id === null) { stick.id = id; stick.ox = stick.x = x; stick.oy = stick.y = y; }
}
function pointerMove(id, x, y) {
  if (id === aim.id) {
    aim.x = x; aim.y = y;
    const dx = x - L.fire.x, dy = y - L.fire.y;
    if (Math.hypot(dx, dy) > AIM_TH) { aim.dragged = true; aim.angle = Math.atan2(dy, dx); }
    return;
  }
  if (id !== stick.id) return;
  stick.x = x; stick.y = y;
  // 指が離れすぎたら基点ごと追従（フローティングスティック）
  const { rx, ry } = stickReachXY();
  const dx = stick.x - stick.ox, dy = stick.y - stick.oy, d = Math.hypot(dx, dy), lim = Math.max(L.stickR * 1.6, rx + 10, ry + 10);
  if (d > lim) { stick.ox = stick.x - dx / d * lim; stick.oy = stick.y - dy / d * lim; }
}
function pointerUp(id) {
  if (id === aim.id) {
    const inCenter = Math.hypot(aim.x - L.fire.x, aim.y - L.fire.y) <= AIM_TH;
    if (!aim.dragged) tryFire(autoAimAngle());
    else if (!inCenter) tryFire(aim.angle);
    else toast('ショットをキャンセル');
    aim.id = null;
  }
  if (id === stick.id) releaseStick();
}
function releaseStick() { stick.id = null; }
function cancelAim() { aim.id = null; }
function syncTouches(e) {
  const alive = new Set([...e.touches].map(t => t.identifier));
  if (stick.id !== null && stick.id !== 'mouse' && !alive.has(stick.id)) releaseStick();
  if (aim.id !== null && aim.id !== 'mouse' && !alive.has(aim.id)) cancelAim(); // 取りこぼし時は誤射しない
}

cv.addEventListener('touchstart', (e) => {
  e.preventDefault();
  syncTouches(e);
  for (const t of e.changedTouches) pointerDown(t.identifier, t.clientX, t.clientY);
}, { passive: false });
addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) pointerMove(t.identifier, t.clientX, t.clientY);
  syncTouches(e);
  if (e.target === cv) e.preventDefault();
}, { passive: false });
addEventListener('touchend', (e) => { for (const t of e.changedTouches) pointerUp(t.identifier); syncTouches(e); });
addEventListener('touchcancel', (e) => { for (const t of e.changedTouches) { if (t.identifier === aim.id) cancelAim(); if (t.identifier === stick.id) releaseStick(); } syncTouches(e); });

// PC（マウス）: SHOTボタンをドラッグで狙える。Space/Z はマウスカーソルの方向へ（ボックス外なら自動エイム）
const mouse = { x: -1, y: -1 };
cv.addEventListener('mousedown', (e) => { if (e.button === 0) pointerDown('mouse', e.clientX, e.clientY); });
addEventListener('mousemove', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  if (stick.id === 'mouse' || aim.id === 'mouse') {
    if (!(e.buttons & 1)) { if (aim.id === 'mouse') cancelAim(); releaseStick(); }
    else pointerMove('mouse', e.clientX, e.clientY);
  }
});
addEventListener('mouseup', () => pointerUp('mouse'));

// アプリ切替・通知・画面ロックなどで入力をリセット
function resetInput() { releaseStick(); cancelAim(); keys.clear(); }
addEventListener('blur', resetInput);
addEventListener('pagehide', resetInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

function readInput() {
  let x = 0, y = 0;
  if (stick.id !== null) {
    const dx = stick.x - stick.ox, dy = stick.y - stick.oy, d = Math.hypot(dx, dy);
    if (d > STICK_DEAD) {
      const span = stickReach() - STICK_DEAD, k = (d - STICK_DEAD) / d;
      x = dx * k / span * axisMul(sens.x);
      y = dy * k / span * axisMul(sens.y);
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; } // 最高速は変えない
    }
  }
  let kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  let ky = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
  if (kx || ky) {
    const d = Math.hypot(kx, ky), slow = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 0.45 : 1;
    x = kx / d * slow; y = ky / d * slow;
  }
  input.x = x; input.y = y;
  if (Math.hypot(x, y) > 0.2) me.lastDir = Math.atan2(y, x);
}

// 自動エイム：一番近い生存中の敵。いなければ最後に動いた方向（初期は上）
function autoTarget() {
  let best = null, bd = Infinity;
  for (const [id, p] of G.players) {
    if (id === myId || !p.alive) continue;
    const d = Math.hypot(p.x - me.x, p.y - me.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function autoAimAngle() {
  const t = autoTarget();
  if (t) return Math.atan2(t.y - me.y, t.x - me.x);
  return me.lastDir ?? -Math.PI / 2;
}
function keyboardAimAngle() {
  // マウスがボックス内にあればカーソル方向へ
  if (mouse.x >= L.bx && mouse.x <= L.bx + L.bs && mouse.y >= L.by && mouse.y <= L.by + L.bs) {
    const mx = (mouse.x - L.bx) / L.sc, my = (mouse.y - L.by) / L.sc;
    return Math.atan2(my - me.y, mx - me.x);
  }
  return autoAimAngle();
}

function trySpecial() {
  spPressed = performance.now();
  if (!roomId || G.st !== 'play' || !me.alive) return;
  if (me.sp < C.SP_MAX) { sfx('deny'); return; }
  socket.emit('special');
  me.sp = 0; // 見た目の即時反映
}

function tryFire(angle) {
  if (!roomId || G.st !== 'play' || !me.alive) return;
  if (sNow() < me.cdEnd - 60) { sfx('deny'); return; }
  socket.emit('fire', +angle.toFixed(3));
  me.cdEnd = sNow() + C.SHOT_CD; // 見た目の即時反映
}

// ===== エフェクト =====
function burst(x, y, color, n, spd) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random() * 0.6);
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.3, max: 0.8, color, size: 2 + Math.random() * 2 });
  }
}
function shatter(x, y, color) {
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    G.particles.push({ x, y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 160, g: 400, life: 1.4, max: 1.4, color, size: 4, shard: true });
  }
}
function ringFx(x, y, color) { G.particles.push({ x, y, ring: true, life: 0.35, max: 0.35, color, size: 0 }); }
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }

// ===== サウンド（WebAudioで生成） =====
let AC = null, soundOn = store.get('sb_sound', '1') === '1';
$('btnSound').textContent = soundOn ? '♪' : '×';
$('btnSound').onclick = () => { soundOn = !soundOn; store.set('sb_sound', soundOn ? '1' : '0'); $('btnSound').textContent = soundOn ? '♪' : '×'; };
function audioInit() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
}
function tone(freq, dur, type = 'square', vol = 0.08, slide = 0, delay = 0) {
  if (!AC || !soundOn) return;
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
}
let lastSfx = {};
function sfx(n) {
  const now = performance.now();
  if (lastSfx[n] && now - lastSfx[n] < 40) return;
  lastSfx[n] = now;
  switch (n) {
    case 'hurt': tone(220, 0.18, 'square', 0.12, -120); break;
    case 'hitOther': tone(300, 0.06, 'square', 0.03, -100); break;
    case 'confirm': tone(880, 0.08, 'square', 0.06); tone(1320, 0.1, 'square', 0.05, 0, 0.07); break;
    case 'break': tone(160, 0.3, 'sawtooth', 0.1, -100); tone(90, 0.4, 'square', 0.08, -40, 0.12); break;
    case 'shoot': tone(700, 0.12, 'square', 0.06, 500); break;
    case 'shootOther': tone(500, 0.08, 'square', 0.025, 300); break;
    case 'graze': tone(1600, 0.03, 'triangle', 0.04); break;
    case 'item': tone(660, 0.08, 'square', 0.06); tone(990, 0.12, 'square', 0.06, 0, 0.08); break;
    case 'deny': tone(120, 0.08, 'square', 0.04); break;
    case 'tick': tone(440, 0.08, 'square', 0.06); break;
    case 'go': tone(880, 0.25, 'square', 0.07); break;
    case 'spReady': [660, 880, 1100].forEach((f, i) => tone(f, 0.1, 'triangle', 0.06, 0, i * 0.08)); break;
    case 'special': tone(200, 0.5, 'sawtooth', 0.09, 800); tone(100, 0.6, 'square', 0.07, -40, 0.05); break;
    case 'emote': tone(1000, 0.05, 'triangle', 0.04); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, 'square', 0.06, 0, i * 0.12)); break;
    case 'end': [392, 330, 262].forEach((f, i) => tone(f, 0.2, 'square', 0.05, 0, i * 0.15)); break;
  }
}

// ===== レイアウト =====
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  L.w = innerWidth; L.h = innerHeight;
  cv.width = Math.round(L.w * dpr); cv.height = Math.round(L.h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  L.portrait = L.h > L.w * 1.1;
  const top = 52, hpLine = 34;
  const plist = $('plist'), em = $('emotes');
  if (L.portrait) {
    const ctrlH = clamp(L.h * 0.27, 150, 240);
    const avail = L.h - top - hpLine - ctrlH - 8;
    L.bs = Math.max(160, Math.min(L.w - 20, avail));
    L.bx = (L.w - L.bs) / 2; L.by = top + Math.max(0, (avail - L.bs) / 2);
    const cy = L.h - ctrlH / 2 - 4;
    L.fire = { x: L.w - 78, y: cy, r: 44 };
    L.sp = { x: L.fire.x - 72, y: cy - 46, r: 27 };
    L.stickHome = { x: 88, y: cy };
    plist.style.cssText = `left:${L.bx + 6}px;top:${L.by + 6}px;opacity:.75`;
    em.style.cssText = `left:50%;transform:translateX(-50%);bottom:calc(6px + env(safe-area-inset-bottom))`;
  } else {
    L.bs = Math.max(160, Math.min(L.h - top - hpLine - 10, L.w - 360));
    L.bx = (L.w - L.bs) / 2; L.by = top;
    L.fire = { x: L.w - 86, y: L.h - 96, r: 48 };
    L.sp = { x: L.fire.x - 78, y: L.fire.y - 50, r: 30 };
    L.stickHome = { x: 100, y: L.h - 110 };
    plist.style.cssText = `left:12px;top:${top + 6}px`;
    em.style.cssText = `right:12px;top:${top + 6}px`;
  }
  L.stickR = L.portrait ? 50 : 56;
  L.sc = C ? L.bs / C.W : 1;
}
addEventListener('resize', resize);
resize();

// ===== 更新 =====
// バトロワのエリア縮小（サーバーと同じ式）
function insetNow(now) {
  if (!C || G.md !== 'versus' || G.st !== 'play') return 0;
  return clamp((now - G.rs - C.SHRINK_START) / 1000 * C.SHRINK_RATE, 0, C.SHRINK_MAX);
}

function bulletPos(b, now) {
  const t = (now - b.t0) / 1000;
  b.t = t;
  b.x = b.x0 + b.vx * t + 0.5 * b.ax * t * t;
  b.y = b.y0 + b.vy * t + 0.5 * b.ay * t * t;
}

function update(dt) {
  if (!C) return;
  const now = sNow();
  readInput();
  const playing = G.st === 'play' && me.alive && !me.needSnap;
  me.moving = playing && Math.hypot(input.x, input.y) > 0.12;

  if (playing) {
    const m = insetNow(now) + C.SOUL_R;
    me.x = clamp(me.x + input.x * C.SPEED * dt, m, C.W - m);
    me.y = clamp(me.y + input.y * C.SPEED * dt, m, C.H - m);
    if (now - me.lastSend > 50) { socket.volatile.emit('pos', { x: +me.x.toFixed(1), y: +me.y.toFixed(1), m: me.moving ? 1 : 0 }); me.lastSend = now; }
  }

  // 他プレイヤーの補間
  for (const [id, p] of G.players) {
    if (id === myId) { p.x = me.x; p.y = me.y; continue; }
    const k = Math.min(1, dt * 14);
    p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
  }

  // 弾の更新と当たり判定（自分のハートのみ判定）
  const myP = G.players.get(myId);
  const invincible = now < me.invUntil || (myP && myP.inv > 0);
  for (const [id, b] of G.bullets) {
    bulletPos(b, now);
    if (b.t * 1000 > b.life || (b.t > 0.3 && (b.x < -50 || b.x > C.W + 50 || b.y < -50 || b.y > C.H + 50))) { G.bullets.delete(id); continue; }
    if (!playing || b.t < 0 || b.owner === myId) continue;
    const d = Math.hypot(b.x - me.x, b.y - me.y);
    const harmful = b.kind === K.BLUE ? me.moving : b.kind === K.ORANGE ? !me.moving : true;
    if (d < b.r + C.SOUL_R - 1.5) {
      if (harmful && !invincible && now >= me.invUntil) {
        socket.emit('hit', b.id);
        me.invUntil = now + C.IFRAME;
        shake = 10; flash = 0.25;
        vibrate(70); sfx('hurt');
        if (b.kind === K.SHOT || b.kind === K.SP) G.bullets.delete(id);
      }
    } else if (d < b.r + C.SOUL_R + C.GRAZE_R && !b.grazed && harmful && !invincible) {
      b.grazed = true;
      socket.emit('graze');
      me.cdEnd -= C.GRAZE_CUT;
      G.texts.push({ x: me.x + 10, y: me.y - 10, text: 'GRAZE', color: '#aaa', life: 0.5, small: true });
      burst(me.x, me.y, '#fff', 3, 60);
      sfx('graze');
    }
  }

  // パーティクル
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.life -= dt;
    if (p.life <= 0) { G.particles.splice(i, 1); continue; }
    if (!p.ring) { p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98; p.vy *= p.g ? 1 : 0.98; }
  }
  for (let i = G.texts.length - 1; i >= 0; i--) { const t = G.texts[i]; t.life -= dt; t.y -= 20 * dt; if (t.life <= 0) G.texts.splice(i, 1); }
  shake = Math.max(0, shake - dt * 40);
  flash = Math.max(0, flash - dt);

  // カウントダウン音
  if (G.st === 'countdown') {
    const n = Math.ceil((G.su - now) / 1000);
    if (n !== lastCount && n > 0) { lastCount = n; sfx('tick'); }
  } else lastCount = -1;
}
let lastCount = -1;

// ===== 描画 =====
function heartPath(x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.5);
  ctx.bezierCurveTo(x - s * 0.15, y + s * 0.35, x - s * 0.62, y + s * 0.05, x - s * 0.55, y - s * 0.22);
  ctx.bezierCurveTo(x - s * 0.48, y - s * 0.58, x - s * 0.06, y - s * 0.58, x, y - s * 0.24);
  ctx.bezierCurveTo(x + s * 0.06, y - s * 0.58, x + s * 0.48, y - s * 0.58, x + s * 0.55, y - s * 0.22);
  ctx.bezierCurveTo(x + s * 0.62, y + s * 0.05, x + s * 0.15, y + s * 0.35, x, y + s * 0.5);
  ctx.closePath();
}

const BCOL = { [K.NORMAL]: '#ffffff', [K.BIG]: '#ffffff', [K.BLUE]: '#2aa7ff', [K.ORANGE]: '#ff9a1f' };

function draw() {
  const now = sNow(), pnow = performance.now();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, L.w, L.h);
  if (!C || !roomId) return;
  const sc = L.sc = L.bs / C.W;

  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  // ---- バトルボックス内（論理座標） ----
  ctx.save();
  ctx.translate(L.bx, L.by);
  ctx.beginPath(); ctx.rect(0, 0, L.bs, L.bs); ctx.clip();
  ctx.scale(sc, sc);

  // 背景グリッド（うっすら）
  ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  for (let i = 40; i < C.W; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, C.H); ctx.moveTo(0, i); ctx.lineTo(C.W, i); ctx.stroke(); }

  // 予告
  for (const b of G.bullets.values()) {
    if (!b.warn || b.t >= 0 || b.t < -1.6) continue;
    const blink = Math.floor(pnow / 100) % 2 === 0;
    const x = clamp(b.x0, 12, C.W - 12), y = clamp(b.y0, 12, C.H - 12);
    ctx.globalAlpha = blink ? 0.9 : 0.4;
    ctx.strokeStyle = b.kind === K.BLUE ? '#2aa7ff' : b.kind === K.ORANGE ? '#ff9a1f' : '#ff453a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('!', x, y + 1);
    ctx.globalAlpha = 1;
  }

  // アイテム
  for (const [, type, x, y] of G.items) {
    const bob = Math.sin(pnow / 200) * 2;
    ctx.fillStyle = type === 'heal' ? '#32d74b' : '#ffd60a';
    ctx.beginPath(); ctx.arc(x, y + bob, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(type === 'heal' ? '+' : '★', x, y + bob + 1);
  }

  // 弾
  for (const b of G.bullets.values()) {
    if (b.t < 0) continue;
    if (b.kind === K.SP) {
      ctx.fillStyle = colorOf(b.owner);
      ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.5, 0, Math.PI * 2); ctx.fill();
    } else if (b.kind === K.SHOT) {
      ctx.fillStyle = colorOf(b.owner);
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = BCOL[b.kind] || '#fff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      if (b.kind === K.BIG) { ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.35, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // プレイヤー
  for (const [id, p] of G.players) {
    if (!p.alive) continue;
    const isMe = id === myId;
    const inv = isMe ? (now < me.invUntil || p.inv > 0) : p.inv > 0;
    if (inv && Math.floor(pnow / 80) % 2 === 0) continue; // 無敵中は点滅
    const col = colorOf(id);
    if (isMe) { heartPath(p.x, p.y, 21); ctx.fillStyle = '#fff'; ctx.fill(); }
    heartPath(p.x, p.y, 16); ctx.fillStyle = col; ctx.fill();
    ctx.font = '11px DotGothic16, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.7)';
    ctx.fillText(isMe ? 'YOU' : nameOf(id), p.x, p.y - 12);
    // 他プレイヤーのHP
    if (!isMe) {
      ctx.fillStyle = '#600'; ctx.fillRect(p.x - 12, p.y + 11, 24, 3);
      ctx.fillStyle = '#ffd60a'; ctx.fillRect(p.x - 12, p.y + 11, 24 * (p.hp / C.MAX_HP), 3);
    }
    const em = G.emotes.get(id);
    if (em && em.until > pnow) {
      ctx.fillStyle = '#fff'; ctx.fillRect(p.x + 8, p.y - 34, 30, 18);
      ctx.fillStyle = '#000'; ctx.font = 'bold 12px DotGothic16, monospace'; ctx.textBaseline = 'middle';
      ctx.fillText(em.e, p.x + 23, p.y - 25);
    }
  }

  // 照準（SHOTボタン操作中）
  if (aim.id !== null && G.st === 'play' && me.alive) drawAim(now);

  // パーティクル
  for (const p of G.particles) {
    const a = p.life / p.max;
    ctx.globalAlpha = a;
    if (p.ring) {
      ctx.strokeStyle = p.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10 + (1 - a) * (p.big || 40), 0, Math.PI * 2); ctx.stroke();
    } else if (p.shard) {
      ctx.fillStyle = p.color; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 8);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); ctx.restore();
    } else {
      ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;
  for (const t of G.texts) {
    ctx.globalAlpha = Math.min(1, t.life * 2);
    ctx.fillStyle = t.color; ctx.font = `${t.small ? 10 : 14}px DotGothic16, monospace`; ctx.textAlign = 'center';
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // 被弾フラッシュ
  if (flash > 0) { ctx.fillStyle = `rgba(255,0,0,${flash * 0.8})`; ctx.fillRect(L.bx, L.by, L.bs, L.bs); }

  // ボックスの枠（Undertale風）。エリア縮小中は外側を赤く塗り、内側に新しい枠を描く
  const ins = insetNow(now) * sc;
  if (ins > 0) {
    ctx.fillStyle = 'rgba(255,40,40,0.18)';
    ctx.fillRect(L.bx, L.by, L.bs, ins); ctx.fillRect(L.bx, L.by + L.bs - ins, L.bs, ins);
    ctx.fillRect(L.bx, L.by + ins, ins, L.bs - ins * 2); ctx.fillRect(L.bx + L.bs - ins, L.by + ins, ins, L.bs - ins * 2);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
    ctx.strokeRect(L.bx - 2, L.by - 2, L.bs + 4, L.bs + 4);
  }
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 4;
  ctx.strokeRect(L.bx + ins - 2, L.by + ins - 2, L.bs - ins * 2 + 4, L.bs - ins * 2 + 4);
  ctx.restore();

  // ---- ボックス中央のメッセージ ----
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cx = L.bx + L.bs / 2, cy = L.by + L.bs / 2;
  if (G.st === 'countdown') {
    const n = Math.max(1, Math.ceil((G.su - now) / 1000));
    ctx.fillStyle = '#ffd60a'; ctx.font = `${Math.round(L.bs * 0.25)}px DotGothic16, monospace`;
    ctx.fillText(String(n), cx, cy);
    ctx.font = '16px DotGothic16, monospace'; ctx.fillStyle = '#fff';
    ctx.fillText(G.md === 'versus' ? 'BATTLE ROYALE - 最後の1人になれ！' : 'SOLO - 生き残れ！', cx, cy + L.bs * 0.2);
  } else if (G.st === 'play') {
    const el = Math.max(0, (now - G.rs) / 1000);
    ctx.font = '14px DotGothic16, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.textAlign = 'right';
    ctx.fillText(`${el.toFixed(1)}s`, L.bx + L.bs - 8, L.by + 14);
    if (el < 1.2) { ctx.textAlign = 'center'; ctx.fillStyle = '#ffd60a'; ctx.font = `${Math.round(L.bs * 0.14)}px DotGothic16, monospace`; ctx.fillText('START!', cx, cy); }
    if (G.md === 'versus') {
      const toShrink = (C.SHRINK_START - (now - G.rs)) / 1000;
      ctx.textAlign = 'center'; ctx.font = '14px DotGothic16, monospace';
      if (toShrink > 0 && toShrink <= 5) { ctx.fillStyle = '#ff453a'; ctx.fillText(`エリア縮小まで ${Math.ceil(toShrink)}`, cx, L.by + 16); }
      else if (toShrink <= 0 && toShrink > -3) { ctx.fillStyle = '#ff453a'; ctx.fillText('エリア縮小開始！', cx, L.by + 16); }
      const alive = [...G.players.values()].filter(p => p.alive).length;
      ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`残り ${alive}人`, L.bx + 8, L.by + L.bs - 12);
    }
  }

  drawHpLine();
  drawControls(now);
}

function drawAim(now) {
  const ready = me.cdEnd - now <= 0;
  const col = ready ? '#ffd60a' : '#888';
  ctx.save();
  if (!aim.dragged) {
    // タップ＝自動エイム：狙う相手にマーカー
    const t = autoTarget();
    if (t) {
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.x, t.y, 16, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(t.x - 22, t.y); ctx.lineTo(t.x - 10, t.y); ctx.moveTo(t.x + 10, t.y); ctx.lineTo(t.x + 22, t.y);
      ctx.moveTo(t.x, t.y - 22); ctx.lineTo(t.x, t.y - 10); ctx.moveTo(t.x, t.y + 10); ctx.lineTo(t.x, t.y + 22); ctx.stroke();
    }
    ctx.restore(); return;
  }
  if (Math.hypot(aim.x - L.fire.x, aim.y - L.fire.y) <= AIM_TH) { ctx.restore(); return; } // キャンセル位置
  // 単発の弾道を1本の線で表示
  const len = 230;
  ctx.globalAlpha = 0.9; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
  const ca = Math.cos(aim.angle), sa = Math.sin(aim.angle);
  for (let i = 0; i < C.SHOT_N; i++) {
    const off = (i - (C.SHOT_N - 1) / 2) * C.SHOT_GAP, ox = -sa * off, oy = ca * off;
    ctx.globalAlpha = off === 0 ? 0.9 : 0.5;
    ctx.beginPath(); ctx.moveTo(me.x + ox, me.y + oy); ctx.lineTo(me.x + ox + ca * len, me.y + oy + sa * len); ctx.stroke();
  }
  ctx.restore();
}

function drawHpLine() {
  const y = L.by + L.bs + 20, x = L.bx;
  const r = G.roster.get(myId);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.font = '15px DotGothic16, monospace'; ctx.fillStyle = '#fff';
  const name = r ? r.name : '';
  ctx.fillText(name, x, y);
  const nw = Math.min(ctx.measureText(name).width + 14, L.bs * 0.4);
  ctx.fillText('HP', x + nw, y);
  const bw = Math.min(110, L.bs * 0.32), bx = x + nw + 28;
  ctx.fillStyle = '#c00'; ctx.fillRect(bx, y - 8, bw, 16);
  ctx.fillStyle = '#ffd60a'; ctx.fillRect(bx, y - 8, bw * clamp(me.hp / C.MAX_HP, 0, 1), 16);
  ctx.fillStyle = '#fff';
  ctx.fillText(`${me.hp} / ${C.MAX_HP}`, bx + bw + 10, y);
}

function drawControls(now) {
  // スティック
  const active = stick.id !== null;
  const ox = active ? stick.ox : L.stickHome.x, oy = active ? stick.oy : L.stickHome.y;
  ctx.globalAlpha = active ? 0.9 : 0.35;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(ox, oy, L.stickR, 0, Math.PI * 2); ctx.stroke();
  // 最高速になる位置（感度で変わる）を点線で表示
  ctx.setLineDash([4, 5]); ctx.lineWidth = 2;
  const { rx, ry } = stickReachXY();
  ctx.beginPath(); ctx.ellipse(ox, oy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  let kx = ox, ky = oy;
  if (active) {
    // ノブは指の位置（外枠までで止める）
    const dx = stick.x - ox, dy = stick.y - oy, d = Math.hypot(dx, dy), k = d > L.stickR ? L.stickR / d : 1;
    kx = ox + dx * k; ky = oy + dy * k;
  }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(kx, ky, L.stickR * 0.42, 0, Math.PI * 2); ctx.fill();
  if (!active) { ctx.fillStyle = '#000'; ctx.font = '11px DotGothic16, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('MOVE', kx, ky); }
  ctx.globalAlpha = 1;

  // SPボタン（必殺技ゲージ）
  if (L.sp && G.st === 'play' && me.alive) {
    const s = L.sp, full = me.sp >= C.SP_MAX, pulse = full ? 0.5 + 0.5 * Math.sin(performance.now() / 120) : 0;
    const pr = performance.now() - spPressed < 120;
    ctx.fillStyle = full ? (pr ? '#fff' : `rgba(191,90,242,${0.35 + pulse * 0.4})`) : '#111';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = full ? '#fff' : '#bf5af2';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, me.sp / C.SP_MAX)); ctx.stroke();
    ctx.fillStyle = full ? '#fff' : '#bf5af2';
    ctx.font = `${full ? 14 : 12}px DotGothic16, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(full ? 'SP!' : Math.floor(me.sp) + '%', s.x, s.y);
  }

  // SHOTボタン（クールタイムをリングで表示）
  const f = L.fire;
  const remain = Math.max(0, me.cdEnd - now);
  const ready = remain <= 0 && G.st === 'play' && me.alive;
  const pressed = performance.now() - firePressed < 120;
  ctx.fillStyle = ready ? (pressed ? '#ffd60a' : '#000') : '#111';
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = ready ? '#ffd60a' : '#555'; ctx.lineWidth = 4;
  ctx.stroke();
  if (remain > 0 && G.st === 'play') {
    ctx.strokeStyle = '#ff9f0a'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r - 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - remain / C.SHOT_CD)); ctx.stroke();
  }
  let label = remain > 0 && G.st === 'play' ? (remain / 1000).toFixed(1) : 'SHOT', lx = f.x, ly = f.y;
  if (aim.id !== null) {
    const dx = aim.x - f.x, dy = aim.y - f.y, d = Math.hypot(dx, dy), k = d > f.r * 0.7 ? f.r * 0.7 / d : 1;
    lx = f.x + dx * k; ly = f.y + dy * k;
    const cancel = aim.dragged && d <= AIM_TH;
    ctx.fillStyle = cancel ? '#ff453a' : ready ? '#ffd60a' : '#777';
    ctx.beginPath(); ctx.arc(lx, ly, f.r * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    if (cancel) label = '×'; else if (!aim.dragged) label = 'AUTO';
  } else ctx.fillStyle = ready ? (pressed ? '#000' : '#ffd60a') : '#777';
  ctx.font = '15px DotGothic16, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, lx, ly);
}

// ===== ループ =====
let last = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  update(dt);
  draw();
  if (roomId && t - plistTimer > 200) {
    plistTimer = t; updatePlist(); updateLobbyNote();
    // 観戦バナー（途中参加 or 脱落）
    const r = G.roster.get(myId), banner = $('specBanner');
    const watching = (G.st === 'play' || G.st === 'countdown') && !me.alive;
    banner.classList.toggle('hidden', !watching);
    if (watching) {
      banner.textContent = r && r.spec ? '観戦中 — 次の試合から参戦します' : '脱落… 観戦中（次の試合を待とう）';
      banner.style.top = (L.by + 30) + 'px';
    }
  } else if (!roomId) $('specBanner').classList.add('hidden');
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
