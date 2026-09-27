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
  $('btnQuick').disabled = $('btnCreate').disabled = $('btnStory').disabled = $('btnCode').disabled = false;
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
  cfg: ['battle', 1, 0, 5], // [ゲーム種別, 難易度, ストーリーの現在ステージ, 全ステージ数]
  boss: null,               // ストーリーのボス
};
const diffOf = () => (C && C.DIFFS[G.cfg[1]]) || { name: '普通', iframe: 1000 };
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
  G.boss = null;
  me.needSnap = true; me.invUntil = 0;
  hide('result');
});

// ===== ストーリー（ボス戦）のイベント =====
socket.on('stage', (s) => {
  G.bullets.clear();
  me.needSnap = true; // 復活した人は初期位置へ
  toast(`STAGE ${s.stage + 1}/${s.total}  ${s.name}`, '#ffd60a');
  sfx('stage');
});
socket.on('talk', (t) => { notify(t.text, '#fff', Math.max(1500, t.until - sNow())); sfx('talk'); });
socket.on('bx', (ids) => {
  // ボスに命中したプレイヤー弾を消す
  for (const id of ids) {
    const b = G.bullets.get(id);
    if (b) { burst(b.x, b.y, colorOf(b.owner), 3, 80); G.bullets.delete(id); }
  }
  sfx('bossHit');
});
socket.on('clear', () => {
  // ボス撃破：敵弾をすべて消す
  for (const [id, b] of G.bullets) if (!b.owner) { burst(b.x, b.y, '#fff', 1, 40); G.bullets.delete(id); }
});

socket.on('s', (s) => {
  const prevSt = G.st;
  G.st = s.st; G.su = s.su; G.rs = s.rs; G.rd = s.rd; G.md = s.md;
  const cfgChanged = s.cfg.join() !== G.cfg.join();
  G.cfg = s.cfg;
  if (cfgChanged) updateLobby();
  if (s.bs) {
    const [key, x, y, hp, max, stage, phase, flash, dead, name, color, r] = s.bs;
    if (!G.boss || G.boss.key !== key) G.boss = { key, x, y, deadSince: 0 };
    Object.assign(G.boss, { tx: x, ty: y, hp, max, stage, phase, flash, name, color, r });
    if (dead && !G.boss.dead) G.boss.deadSince = performance.now();
    G.boss.dead = !!dead;
  } else G.boss = null;
  const seen = new Set();
  for (const [id, x, y, hp, alive, inv, cd, sp] of s.p) {
    seen.add(id);
    let p = G.players.get(id);
    if (!p) { p = { x, y, tx: x, ty: y }; G.players.set(id, p); }
    p.tx = x; p.ty = y; p.hp = hp; p.alive = !!alive; p.inv = inv; p.cd = cd; p.sp = sp;
    if (id === myId) {
      me.hp = hp; me.alive = !!alive;
      me.cdEnd = sNow() + cd;
      if (sp >= C.SP_MAX && me.sp < C.SP_MAX && G.st === 'play' && performance.now() - spPressed > 600) { sfx('spReady'); toast('必殺技ゲージMAX！ SPボタンで発動', '#bf5af2'); }
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
    if (f.id !== myId) sfx('hitOther');
    if (f.by === myId && f.id !== myId) { toast(`${nameOf(f.id)} に命中！`, '#ffd60a'); sfx('confirm'); }
  } else if (f.t === 'dead') {
    shatter(f.x, f.y, col);
    sfx('break');
    if (f.id === myId) { toast(f.by ? `${nameOf(f.by)} にやられた…` : 'やられた…', '#ff453a'); vibrate([60, 40, 120]); }
    else if (f.by === myId) toast(`${nameOf(f.id)} を倒した！`, '#ffd60a');
    else toast(`${nameOf(f.id)} が脱落`, '#aaa');
  } else if (f.t === 'fire') {
    ringFx(f.x, f.y, col);
    if (f.id === myId) sfx('shoot'); else sfx('shootOther');
  } else if (f.t === 'item') {
    burst(f.x, f.y, f.item === 'heal' ? '#32d74b' : '#ffd60a', 12, 90);
    if (f.id === myId) { sfx('item'); toast(f.item === 'heal' ? 'HP回復！' : 'SHOT チャージ完了！', f.item === 'heal' ? '#32d74b' : '#ffd60a', 1500); }
  } else if (f.t === 'special') {
    // 周囲の敵弾を消す（自分の弾は残す）
    const now = sNow();
    for (const [bid, b] of G.bullets) {
      if (b.owner === f.id) continue;
      bulletPos(b, now);
      if (b.t >= 0 && Math.hypot(b.x - f.x, b.y - f.y) < f.r) { burst(b.x, b.y, '#fff', 2, 60); G.bullets.delete(bid); }
    }
    G.particles.push({ x: f.x, y: f.y, ring: true, big: f.r, life: 0.5, max: 0.5, color: col, size: 0 });
    toast(`${f.id === myId ? 'あなた' : nameOf(f.id)} のソウルバースト！`, col, 1800);
    shake = Math.max(shake, 8);
    if (f.id === myId) { me.invUntil = Math.max(me.invUntil, now + f.inv); vibrate([30, 30, 60]); }
    sfx('special');
  } else if (f.t === 'bossdown') {
    for (let i = 0; i < 4; i++) setTimeout(() => { burst(f.x + (Math.random() - 0.5) * 60, f.y + (Math.random() - 0.5) * 60, f.color, 24, 220); shake = 12; sfx('break'); }, i * 250);
    toast('STAGE CLEAR!', '#ffd60a', 3000);
    G.texts.push({ x: f.x, y: f.y, text: 'STAGE CLEAR!', color: '#ffd60a', life: 2.5, big: true }); // ボスがいた場所（上側）に表示
    vibrate([80, 60, 80, 60, 160]);
    setTimeout(() => sfx('win'), 900);
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
  if (st === 'lobby') { hide('result'); show('lobby'); updateLobby(); G.bullets.clear(); G.boss = null; }
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
$('btnQuick').disabled = $('btnCreate').disabled = $('btnStory').disabled = $('btnCode').disabled = true;

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
    hide('title'); show('hud'); show('plist'); show('emotes'); show('feed');
    if (!isPublic) history.replaceState(null, '', `?room=${roomId}`);
    setStatus('');
    resize();
    if (res.state === 'play' && !isRejoin) toast('試合中のため観戦します。次の試合から参戦！');
  });
}
$('btnQuick').onclick = () => join({ mode: 'quick' });
$('btnCreate').onclick = () => join({ mode: 'create' });
$('btnStory').onclick = () => join({ mode: 'create', game: 'story' });
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
  hide('hud'); hide('plist'); hide('emotes'); hide('feed'); hide('lobby'); hide('result'); $('feedList').innerHTML = ''; $('conn').classList.add('hidden');
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
      ? list.map(s => `<li>${esc(s.name)} — ${(s.ms / 1000).toFixed(1)}秒${s.diff ? `（${esc(s.diff)}）` : ''}</li>`).join('')
      : '<li>まだ記録がありません</li>';
  } catch {}
}
loadTop();

// ===== オーバーレイ =====
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
let toastTimer = 0;
// ゲーム中の通知は、ステージ（バトルボックス）の外にある通知エリアへ。タイトル画面などでは従来のトースト
function toast(t, color = '#fff', ms = 2600) {
  if (roomId) return notify(t, color, ms);
  const el = $('toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}
const feedMax = () => (L.portrait ? 2 : 5) - ($('feedSticky').classList.contains('hidden') ? 0 : 1);
function notify(text, color = '#fff', ms = 2600) {
  const list = $('feedList'), el = document.createElement('div');
  el.className = 'fi'; el.textContent = text; el.style.color = color;
  list.appendChild(el);
  while (list.children.length > Math.max(1, feedMax())) list.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
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
  // モード・難易度（プライベートのホストだけ変更可能）
  const [game, diff, stage, total] = G.cfg;
  const canEdit = !isPublic && amHost();
  const diffs = C ? C.DIFFS : [];
  let cfgHtml;
  if (canEdit) {
    cfgHtml = `<div class="cfgRow"><span>モード</span>
        <button class="opt ${game === 'battle' ? 'on' : ''}" data-cfg="game" data-v="battle">バトル</button>
        <button class="opt ${game === 'story' ? 'on' : ''}" data-cfg="game" data-v="story">ストーリー（協力）</button></div>
      <div class="cfgRow"><span>難易度</span>${diffs.map((d, i) =>
        `<button class="opt d${i} ${diff === i ? 'on' : ''}" data-cfg="diff" data-v="${i}">${d.name}</button>`).join('')}</div>`;
    if (game === 'story' && stage > 0) cfgHtml += `<div class="cfgRow"><span>再開</span>STAGE ${stage + 1}/${total} から <button class="opt" data-cfg="restart">最初からにする</button></div>`;
  } else {
    cfgHtml = `<div class="cfgRow"><span>モード</span><b>${game === 'story' ? `ストーリー（協力）STAGE ${stage + 1}/${total}` : 'バトル'}</b></div>
      <div class="cfgRow"><span>難易度</span><b class="d${diff}">${diffs[diff] ? diffs[diff].name : ''}</b></div>`;
  }
  $('lobbyCfg').innerHTML = cfgHtml;
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
  let t = G.cfg[0] === 'story'
    ? (n <= 1 ? '1人でボスに挑戦！ 友達を招待すれば協力プレイ' : `${n}人で協力してボスを倒そう！`)
    : n <= 1 ? '1人ならソロで生存記録に挑戦。2人以上でバトロワ！' : `${n}人でバトロワ！ 最後まで残った人の勝ち`;
  if (isPublic) t += G.su ? `<br>全員準備OK、または ${Math.max(0, Math.ceil((G.su - sNow()) / 1000))} 秒でスタート` : '';
  else if (amHost()) t += '<br>みんなが揃ったらスタートを押してね。「招待」で友達にリンクを送れます';
  else t += '<br>ホストがスタートするのを待っています';
  $('lobbyNote').innerHTML = t;
}

function showResult(r) {
  let title, note = 'まもなくロビーに戻ります';
  const dname = C.DIFFS[r.diff] ? C.DIFFS[r.diff].name : '';
  if (r.mode === 'story') {
    const s = r.story;
    title = s.cleared ? '<span class="win">ALL CLEAR!</span>' : 'GAME OVER';
    note = s.cleared
      ? `全${s.total}体のボスを討伐！（難易度: ${dname} / ${(s.time / 1000).toFixed(0)}秒）`
      : `STAGE ${s.stage + 1}/${s.total}「${esc(s.boss)}」で全滅… 次はこのボスから再開できます`;
  } else if (r.mode === 'versus') title = r.winner ? `<span class="win">${esc(nameOf(r.winner))} の勝利！</span>` : '引き分け';
  else title = `記録 <span class="win">${((r.ranking[0] ? r.ranking[0].time : 0) / 1000).toFixed(1)}秒</span>`;
  $('resTitle').innerHTML = title;
  $('resList').innerHTML = r.ranking.map((p, i) =>
    `<div class="plrow"><b>${i + 1}</b><span style="width:20px;display:inline-block">${heartSvg(p.color)}</span>${esc(p.name)}<span class="r">${
      r.mode === 'story' ? `ボスへのダメージ ${p.dmg} · GRAZE${p.grazes}` : `${(p.time / 1000).toFixed(1)}s · KO${p.kills} · GRAZE${p.grazes}`}</span></div>`).join('');
  if (r.mode === 'solo' && r.top.length) note = 'ソロ記録TOP: ' + r.top.slice(0, 3).map(s => `${esc(s.name)} ${(s.ms / 1000).toFixed(1)}s(${esc(s.diff || '')})`).join(' / ');
  $('resNote').innerHTML = note;
  show('result');
  const iWon = r.winner === myId || (r.story && r.story.cleared);
  sfx(iWon ? 'win' : 'end');
}

// ロビーの設定ボタン（ホストのみ）
$('lobbyCfg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cfg]'); if (!b) return;
  const k = b.dataset.cfg;
  if (k === 'game') socket.emit('cfg', { game: b.dataset.v });
  else if (k === 'diff') socket.emit('cfg', { diff: +b.dataset.v });
  else if (k === 'restart') socket.emit('cfg', { restart: true });
});

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
    else toast('ショットをキャンセル', '#aaa', 1200);
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
  if (G.md === 'story') return G.boss && !G.boss.dead ? G.boss : null; // ストーリーはボスを狙う
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
    case 'talk': tone(520, 0.04, 'square', 0.03); break;
    case 'stage': [392, 523, 659].forEach((f, i) => tone(f, 0.12, 'square', 0.06, 0, i * 0.1)); break;
    case 'bossHit': tone(180 + Math.random() * 60, 0.05, 'square', 0.04, -60); break;
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
  const top = 52, hpLine = 34, msgH = 44;
  const plist = $('plist'), em = $('emotes'), feed = $('feed');
  if (L.portrait) {
    const ctrlH = clamp(L.h * 0.27, 150, 240);
    const avail = L.h - top - hpLine - msgH - ctrlH - 8;
    L.bs = Math.max(160, Math.min(L.w - 20, avail));
    L.bx = (L.w - L.bs) / 2; L.by = top + Math.max(0, (avail - L.bs) / 2);
    const cy = L.h - ctrlH / 2 - 4;
    L.fire = { x: L.w - 78, y: cy, r: 44 };
    L.sp = { x: L.fire.x - 72, y: cy - 46, r: 27 };
    L.stickHome = { x: 88, y: cy };
    plist.style.cssText = `left:${L.bx + 6}px;top:${L.by + 6}px;opacity:.75`;
    em.style.cssText = `left:50%;transform:translateX(-50%);bottom:calc(6px + env(safe-area-inset-bottom))`;
    feed.style.cssText = `left:${L.bx}px;width:${L.bs}px;top:${L.by + L.bs + hpLine}px;height:${msgH}px;text-align:center`;
  } else {
    L.bs = Math.max(160, Math.min(L.h - top - hpLine - 10, L.w - 360));
    L.bx = (L.w - L.bs) / 2; L.by = top;
    L.fire = { x: L.w - 86, y: L.h - 96, r: 48 };
    L.sp = { x: L.fire.x - 78, y: L.fire.y - 50, r: 30 };
    L.stickHome = { x: 100, y: L.h - 110 };
    plist.style.cssText = `left:12px;top:${top + 6}px`;
    em.style.cssText = `right:12px;top:${top + 6}px`;
    feed.style.cssText = `left:10px;width:${Math.max(120, L.bx - 20)}px;top:${top + 80}px;height:${Math.max(60, L.h - 110 - 56 - 10 - top - 80)}px;text-align:left`;
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

  // ボスの補間
  const B = G.boss;
  if (B) { const k = Math.min(1, dt * 12); B.x += (B.tx - B.x) * k; B.y += (B.ty - B.y) * k; }

  // 弾の更新と当たり判定（自分のハートのみ判定）
  const myP = G.players.get(myId);
  const invincible = now < me.invUntil || (myP && myP.inv > 0);
  const takeHit = (bid) => {
    socket.emit('hit', bid);
    me.invUntil = now + diffOf().iframe;
    shake = 10; flash = 0.25;
    vibrate(70); sfx('hurt');
  };
  // ボスへの体当たり
  if (playing && B && !B.dead && !invincible && Math.hypot(B.x - me.x, B.y - me.y) < B.r * 0.85 + C.SOUL_R) takeHit(-1);
  const coop = G.md === 'story';
  for (const [id, b] of G.bullets) {
    bulletPos(b, now);
    if (b.t * 1000 > b.life || (b.t > 0.3 && (b.x < -50 || b.x > C.W + 50 || b.y < -50 || b.y > C.H + 50))) { G.bullets.delete(id); continue; }
    if (!playing || b.t < 0 || b.owner === myId || (coop && b.owner)) continue; // 協力モードは味方の弾に当たらない
    const d = Math.hypot(b.x - me.x, b.y - me.y);
    const harmful = b.kind === K.BLUE ? me.moving : b.kind === K.ORANGE ? !me.moving : true;
    if (d < b.r + C.SOUL_R - 1.5) {
      if (harmful && !invincible && now >= me.invUntil) {
        takeHit(b.id);
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

  // ボス（弾より奥に描く）
  if (G.boss) drawBoss(G.boss, pnow);

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
    ctx.fillStyle = t.color; ctx.font = `${t.big ? 32 : t.small ? 10 : 14}px DotGothic16, monospace`; ctx.textAlign = 'center';
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  if (G.md === 'story' && (G.st === 'play')) drawStoryUI(now);
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
    ctx.fillText(G.md === 'story' ? `STORY STAGE ${G.cfg[2] + 1}/${G.cfg[3]} - 協力してボスを倒せ！` : G.md === 'versus' ? 'BATTLE ROYALE - 最後の1人になれ！' : 'SOLO - 生き残れ！', cx, cy + L.bs * 0.2);
    ctx.fillStyle = '#aaa'; ctx.font = '14px DotGothic16, monospace';
    ctx.fillText(`難易度: ${diffOf().name}`, cx, cy + L.bs * 0.2 + 22);
  } else if (G.st === 'play') {
    const el = Math.max(0, (now - G.rs) / 1000);
    ctx.font = '14px DotGothic16, monospace'; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.textAlign = 'right';
    if (G.md !== 'story') ctx.fillText(`${diffOf().name}  ${el.toFixed(1)}s`, L.bx + L.bs - 8, L.by + 14);
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

// ===== ボスの描画（ボスごとに形が違う） =====
function drawBoss(b, pnow) {
  const t = pnow / 1000, R = b.r, c = b.color, p2 = b.phase === 2;
  let alpha = 1, scale = 1;
  if (b.dead) { // 撃破演出：点滅しながら膨らんで消える
    const k = Math.min(1, (pnow - b.deadSince) / 1500);
    alpha = (1 - k) * (Math.floor(pnow / 60) % 2 ? 0.5 : 1); scale = 1 + k * 0.6;
  }
  const eyes = (dx, y, r, col) => {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(-dx, y, r, 0, Math.PI * 2); ctx.arc(dx, y, r, 0, Math.PI * 2); ctx.fill();
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(b.x, b.y);
  ctx.scale(scale, scale);
  // 第2形態はオーラをまとう
  if (p2 && !b.dead) {
    ctx.globalAlpha = alpha * (0.25 + 0.15 * Math.sin(t * 8));
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, R * 1.45, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha;
  }
  switch (b.key) {
    case 'slime': {
      const w = Math.sin(t * 4) * 3;
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 6, R + w, R * 0.8 - w, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(-R * 0.4, -R * 0.15, R * 0.25, R * 0.14, -0.5, 0, Math.PI * 2); ctx.fill();
      eyes(11, 2, 5, p2 ? '#ff453a' : '#000');
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 12, 6, 0.2, Math.PI - 0.2); ctx.stroke();
      break;
    }
    case 'knight': {
      ctx.fillStyle = '#c0392b'; ctx.fillRect(-4, -R - 12, 8, 16); // 兜の飾り
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, -4, R * 0.85, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(-R * 0.55, R * 0.45, R * 1.1, R * 0.45); // あご
      ctx.fillStyle = '#000'; for (let i = -2; i <= 2; i++) ctx.fillRect(i * 7 - 1.5, R * 0.5, 3, R * 0.35);
      eyes(11, -6, 7, '#000');
      const glow = p2 ? (Math.floor(t * 2) % 2 ? '#2aa7ff' : '#ff9a1f') : '#2aa7ff';
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(11, -6, 3, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'witch': {
      for (let i = 0; i < 6; i++) { // 周りの炎
        const a = t * 2 + i * Math.PI / 3, fr = R * 1.15;
        ctx.fillStyle = p2 ? '#64d2ff' : '#ff9f0a';
        ctx.beginPath(); ctx.arc(Math.cos(a) * fr, Math.sin(a) * fr, 5 + Math.sin(t * 10 + i) * 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#ffd7b5'; ctx.beginPath(); ctx.arc(0, 4, R * 0.75, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1c1c1e'; // 帽子
      ctx.beginPath(); ctx.moveTo(-R, -R * 0.2); ctx.lineTo(R, -R * 0.2); ctx.lineTo(6, -R * 1.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = c; ctx.fillRect(-R * 0.6, -R * 0.42, R * 1.2, 5);
      eyes(9, 6, 3.5, '#000');
      ctx.fillStyle = '#ff453a'; ctx.beginPath(); ctx.arc(0, 16, 3, 0, Math.PI); ctx.fill();
      break;
    }
    case 'robot': {
      ctx.strokeStyle = '#aaa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(0, -R - 12); ctx.stroke();
      ctx.fillStyle = Math.floor(t * 3) % 2 ? '#ff453a' : '#400'; ctx.beginPath(); ctx.arc(0, -R - 14, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c; ctx.fillRect(-R, -R, R * 2, R * 2);
      ctx.fillStyle = '#1c1c1e'; ctx.fillRect(-R * 0.8, -R * 0.45, R * 1.6, R * 0.4); // バイザー
      const sx = Math.sin(t * 3) * R * 0.55;
      ctx.fillStyle = p2 ? '#ff9f0a' : '#ff453a'; ctx.fillRect(sx - 6, -R * 0.38, 12, R * 0.26);
      ctx.fillStyle = '#1c1c1e'; for (let i = -2; i <= 2; i++) ctx.fillRect(i * 9 - 3, R * 0.35, 6, R * 0.4);
      break;
    }
    case 'ghost': {
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = c; ctx.beginPath();
      ctx.arc(0, -4, R * 0.8, Math.PI, 0);
      for (let i = 0; i <= 6; i++) { // すそのギザギザ（ゆらゆら）
        const x = R * 0.8 - i * (R * 1.6 / 6), y = R * 0.7 + (i % 2 ? -7 : 0) + Math.sin(t * 5 + i) * 3;
        ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p2 ? '#ff453a' : '#000';
      ctx.beginPath(); ctx.ellipse(-10, -6, 4, 7, 0, 0, Math.PI * 2); ctx.ellipse(10, -6, 4, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(0, 12, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'frog': {
      const hop = Math.abs(Math.sin(t * 3)) * 5;
      ctx.translate(0, -hop);
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 6, R, R * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-R * 0.5, -R * 0.45, 11, 0, Math.PI * 2); ctx.arc(R * 0.5, -R * 0.45, 11, 0, Math.PI * 2); ctx.fill();
      eyes(R * 0.5, -R * 0.45, 7, '#fff');
      eyes(R * 0.5, -R * 0.42, 4, p2 ? '#ff453a' : '#000');
      ctx.strokeStyle = '#1c3d10'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 6, R * 0.55, 0.3, Math.PI - 0.3); ctx.stroke();
      ctx.fillStyle = '#ff9eb5'; ctx.beginPath(); ctx.arc(-R * 0.6, 10, 5, 0, Math.PI * 2); ctx.arc(R * 0.6, 10, 5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'spider': {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(0, -200); ctx.stroke(); // 糸
      ctx.strokeStyle = c; ctx.lineWidth = 4;
      for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 4; i++) { // 脚
        const a = (i - 1.5) * 0.45 + Math.sin(t * 6 + i) * 0.12;
        ctx.beginPath(); ctx.moveTo(s * R * 0.4, 0);
        ctx.lineTo(s * R * 1.1, Math.sin(a) * R * 0.9 - 8); ctx.lineTo(s * R * 1.45, Math.sin(a) * R * 1.2 + 12); ctx.stroke();
      }
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 8, R * 0.62, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -R * 0.35, R * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p2 ? '#ff453a' : '#ffd60a';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(-9 + i * 6, -R * 0.4 + (i % 2) * 3, 2.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = '#ff375f'; ctx.fillRect(-4, 2, 8, 14); ctx.fillRect(-9, 7, 18, 4); // 背中の模様
      break;
    }
    case 'snowman': {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, R * 0.35, R * 0.7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -R * 0.55, R * 0.48, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff453a'; ctx.fillRect(-R * 0.5, -R * 0.2, R, 7); // マフラー
      ctx.fillStyle = '#1c1c1e'; ctx.fillRect(-R * 0.4, -R * 1.2, R * 0.8, 6); ctx.fillRect(-R * 0.25, -R * 1.55, R * 0.5, R * 0.38); // 帽子
      eyes(8, -R * 0.62, 3, p2 ? '#2aa7ff' : '#000');
      ctx.fillStyle = '#ff9f0a'; ctx.beginPath(); ctx.moveTo(0, -R * 0.5); ctx.lineTo(14, -R * 0.44); ctx.lineTo(0, -R * 0.38); ctx.fill();
      ctx.fillStyle = '#000'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, R * 0.1 + i * 10, 2.5, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'dragon': {
      const flap = Math.sin(t * 6) * 0.35;
      ctx.fillStyle = '#8b1a1a';
      for (const s of [-1, 1]) { // 翼
        ctx.save(); ctx.scale(s, 1); ctx.rotate(-flap);
        ctx.beginPath(); ctx.moveTo(R * 0.4, -4); ctx.lineTo(R * 1.6, -R * 0.9); ctx.lineTo(R * 1.3, -R * 0.1); ctx.lineTo(R * 1.5, R * 0.3); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 4, R * 0.75, R * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.moveTo(-14, -R * 0.6); ctx.lineTo(-9, -R * 1.05); ctx.lineTo(-5, -R * 0.62); ctx.moveTo(14, -R * 0.6); ctx.lineTo(9, -R * 1.05); ctx.lineTo(5, -R * 0.62); ctx.fill(); // 角
      ctx.fillStyle = '#ffe3a3'; ctx.beginPath(); ctx.ellipse(0, 12, R * 0.4, R * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      eyes(11, -6, 4.5, '#fff'); eyes(11, -6, 2.5, p2 ? '#ff9f0a' : '#000');
      break;
    }
    case 'mage': {
      ctx.fillStyle = '#3a2d7a'; // ローブ
      ctx.beginPath(); ctx.moveTo(-R * 0.8, R); ctx.lineTo(R * 0.8, R); ctx.lineTo(0, -R * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd7b5'; ctx.beginPath(); ctx.arc(0, -R * 0.35, R * 0.38, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3a2d7a'; ctx.beginPath(); ctx.moveTo(-R * 0.55, -R * 0.55); ctx.lineTo(R * 0.55, -R * 0.55); ctx.lineTo(4, -R * 1.45); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.moveTo(-R * 0.3, -R * 0.2); ctx.lineTo(R * 0.3, -R * 0.2); ctx.lineTo(0, R * 0.45); ctx.closePath(); ctx.fill(); // ひげ
      eyes(6, -R * 0.4, 2.5, '#000');
      ctx.strokeStyle = '#a2845e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(R * 0.8, R); ctx.lineTo(R * 0.95, -R * 0.7); ctx.stroke(); // 杖
      ctx.fillStyle = c; ctx.globalAlpha = alpha * (0.6 + 0.4 * Math.sin(t * (p2 ? 20 : 8)));
      ctx.beginPath(); ctx.arc(R * 0.95, -R * 0.8, 7, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = alpha;
      break;
    }
    case 'mirror': {
      const n = p2 ? 3 : 1;
      for (let k = n - 1; k >= 0; k--) { // 第2形態は残像が増える
        const ox = k ? Math.sin(t * 3 + k * 2) * 26 : 0;
        ctx.globalAlpha = alpha * (k ? 0.3 : 1);
        ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(ox, -R); ctx.lineTo(ox + R * 0.75, 0); ctx.lineTo(ox, R); ctx.lineTo(ox - R * 0.75, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.moveTo(ox - 4, -R * 0.7); ctx.lineTo(ox + 10, -R * 0.2); ctx.lineTo(ox - 4, -R * 0.1); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = alpha;
      eyes(9, 2, 4, '#0a3d62');
      break;
    }
    case 'clown': {
      for (let i = 0; i < 3; i++) { // ジャグリングの玉
        const a = t * (p2 ? 5 : 3) + i * 2.1;
        ctx.fillStyle = ['#ff453a', '#ffd60a', '#32d74b'][i];
        ctx.beginPath(); ctx.arc(Math.cos(a) * R * 1.2, -R * 0.8 + Math.sin(a) * R * 0.5, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-R * 0.75, -R * 0.35); ctx.lineTo(R * 0.75, -R * 0.35); ctx.lineTo(0, -R * 1.4); ctx.closePath(); ctx.fill(); // 帽子
      ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.arc(0, -R * 1.4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff453a'; ctx.beginPath(); ctx.arc(0, 4, 6, 0, Math.PI * 2); ctx.fill(); // 鼻
      ctx.fillStyle = '#5856d6'; ctx.beginPath(); ctx.moveTo(-12, -14); ctx.lineTo(-8, -2); ctx.lineTo(-16, -2); ctx.fill(); ctx.beginPath(); ctx.moveTo(12, -14); ctx.lineTo(16, -2); ctx.lineTo(8, -2); ctx.fill();
      ctx.strokeStyle = '#ff453a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 10, 12, 0.2, Math.PI - 0.2); ctx.stroke();
      break;
    }
    case 'angel': {
      const flap = Math.sin(t * 3) * 0.2;
      for (const s of [-1, 1]) { // 翼（第2形態で黒く）
        ctx.save(); ctx.scale(s, 1); ctx.rotate(flap);
        ctx.fillStyle = p2 ? '#2c2c2e' : '#fff';
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(R * 0.9 + i * 8, -6 + i * 10, R * 0.75, 9, -0.4 + i * 0.3, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, -R * 1.05, 16, 5, 0, 0, Math.PI * 2); ctx.stroke(); // 輪
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(-R * 0.6, R); ctx.lineTo(R * 0.6, R); ctx.lineTo(0, -R * 0.2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffe9d6'; ctx.beginPath(); ctx.arc(0, -R * 0.4, R * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2; // 閉じた目
      ctx.beginPath(); ctx.arc(-7, -R * 0.42, 4, 0, Math.PI); ctx.moveTo(11, -R * 0.42); ctx.arc(7, -R * 0.42, 4, 0, Math.PI); ctx.stroke();
      break;
    }
    case 'void': {
      for (let i = 0; i < 8; i++) { // 闇の触手
        const a = i * Math.PI / 4 + t * 0.6;
        ctx.strokeStyle = '#3a3a3c'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8);
        ctx.quadraticCurveTo(Math.cos(a + 0.4) * R * 1.3, Math.sin(a + 0.4) * R * 1.3, Math.cos(a + Math.sin(t * 2 + i) * 0.4) * R * 1.55, Math.sin(a + Math.sin(t * 2 + i) * 0.4) * R * 1.55);
        ctx.stroke();
      }
      ctx.fillStyle = '#1c1c1e'; ctx.beginPath(); ctx.arc(0, 0, R * 0.95, 0, Math.PI * 2); ctx.fill();
      const open = 0.55 + 0.45 * Math.abs(Math.sin(t * 0.8)); // まばたき
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, 0, R * 0.75, R * 0.45 * open, 0, 0, Math.PI * 2); ctx.fill();
      const lx = clamp((me.x - b.x) / 20, -10, 10), ly = clamp((me.y - b.y) / 30, -5, 5); // こちらを見る
      ctx.fillStyle = p2 ? '#ff453a' : '#bf5af2'; ctx.beginPath(); ctx.arc(lx, ly * open, R * 0.3 * Math.min(1, open + 0.2), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(lx, ly * open, R * 0.13, 0, Math.PI * 2); ctx.fill();
      break;
    }
    default: { // king
      heartPath(0, 4, R * 2.1); ctx.fillStyle = c; ctx.fill();
      ctx.fillStyle = '#ffd60a'; // 王冠
      ctx.beginPath(); ctx.moveTo(-18, -R * 0.55); ctx.lineTo(-18, -R * 0.95); ctx.lineTo(-9, -R * 0.75); ctx.lineTo(0, -R * 1.1);
      ctx.lineTo(9, -R * 0.75); ctx.lineTo(18, -R * 0.95); ctx.lineTo(18, -R * 0.55); ctx.closePath(); ctx.fill();
      eyes(12, -2, 5, '#fff');
      ctx.fillStyle = p2 ? '#ff453a' : '#000'; ctx.beginPath(); ctx.arc(-12, -1, 2.5, 0, Math.PI * 2); ctx.arc(12, -1, 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (b.flash && !b.dead) { // 被弾で白く光る
    ctx.globalAlpha = 0.6; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ストーリーのUI（ボスのHP・ステージ・セリフ）
function drawStoryUI(now) {
  const b = G.boss;
  ctx.textBaseline = 'middle';
  if (b) {
    ctx.font = '13px DotGothic16, monospace'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    ctx.fillText(`STAGE ${b.stage + 1}/${G.cfg[3]}  ${b.name}`, 60, 14);
    ctx.textAlign = 'right'; ctx.fillStyle = '#aaa';
    ctx.fillText(diffOf().name, 420, 14);
    const pct = b.max ? b.hp / b.max : 0;
    ctx.fillStyle = '#400'; ctx.fillRect(60, 24, 360, 9);
    ctx.fillStyle = pct > 0.5 ? '#32d74b' : pct > 0.2 ? '#ffd60a' : '#ff453a';
    ctx.fillRect(60, 24, 360 * pct, 9);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(60, 24, 360, 9);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.moveTo(240, 22); ctx.lineTo(240, 35); ctx.stroke(); // 第2形態の境目
  }
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
  // ショットガンの扇（薄い塗り）＋各弾道の線
  const half = C.SHOT_SPREAD / 2;
  ctx.globalAlpha = 0.2; ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.arc(me.x, me.y, len, aim.angle - half, aim.angle + half); ctx.closePath(); ctx.fill();
  for (let i = 0; i < C.SHOT_N; i++) {
    const a = aim.angle + (C.SHOT_N > 1 ? (i / (C.SHOT_N - 1) - 0.5) * C.SHOT_SPREAD : 0);
    ctx.globalAlpha = a === aim.angle ? 0.9 : 0.55;
    ctx.beginPath(); ctx.moveTo(me.x, me.y); ctx.lineTo(me.x + Math.cos(a) * len, me.y + Math.sin(a) * len); ctx.stroke();
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
    // ストーリーではボスのHPバーと重ならないよう、縦画面のプレイヤー一覧をボックスの下側へ
    if (L.portrait) $('plist').style.top = (G.md === 'story' && G.st !== 'lobby'
      ? L.by + L.bs - $('plist').offsetHeight - 8 : L.by + 6) + 'px';
    // 観戦中の表示（途中参加 or 脱落）は通知エリアの固定行に
    const r = G.roster.get(myId), sticky = $('feedSticky');
    const watching = (G.st === 'play' || G.st === 'countdown') && !me.alive;
    sticky.classList.toggle('hidden', !watching);
    if (watching) sticky.textContent = r && r.spec ? '観戦中 — 次の試合から参戦します'
      : G.md === 'story' ? '脱落… 次のボスで復活します' : '脱落… 観戦中（次の試合を待とう）';
    // 横画面：通知エリアはプレイヤー一覧のすぐ下
    if (!L.portrait) {
      const pl = $('plist'), ft = pl.offsetTop + pl.offsetHeight + 10;
      $('feed').style.top = ft + 'px';
      $('feed').style.height = Math.max(60, L.stickHome.y - L.stickR - 14 - ft) + 'px';
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();
