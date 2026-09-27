// SOUL BARRAGE - オンライン弾幕サバイバル サーバー
// 弾は「発射パラメータ」だけを配信し、各クライアントが同じ式で位置を計算する（通信量が少なく、スマホでも軽い）
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/api/top', (req, res) => res.json(highScores));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ===== ゲーム定数（クライアントにも送る） =====
const C = {
  W: 480, H: 480,          // バトルボックスの論理サイズ
  SOUL_R: 6,               // ソウル（ハート）の当たり判定半径
  SPEED: 170,              // 移動速度 px/s
  MAX_HP: 20,
  IFRAME: 1000,            // 被弾後の無敵時間 ms
  SHOT_CD: 2000,           // プレイヤーショット（狙い撃ち）のクールタイム ms
  GRAZE_CUT: 250,          // グレイズ1回でクールタイム短縮 ms
  GRAZE_R: 14,             // グレイズ判定の追加半径
  SHOT_N: 3,               // 1発ごとに正面へ扇状（ショットガン）に広がる弾の数
  SHOT_SPREAD: 0.7,        // 扇の開き（ラジアン、約40度）
  SHOT_BURST: 3,           // 連続で撃つ回数
  SHOT_INTERVAL: 150,      // 連射の間隔 ms
  SHOT_SPEED: 290,
  SHOT_DMG: 4,
  // 必殺技メーター（0〜100）
  SP_MAX: 100,
  SP_TIME: 2.5,            // 生存中、1秒ごとに溜まる量
  SP_HIT: 15,              // 相手に弾を当てたとき
  SP_DAMAGED: 12,          // ダメージを受けたとき
  SP_GRAZE: 1,             // グレイズしたとき
  SP_WAVES: 2,             // 必殺技：全方位リングの波の数
  SP_RING: 20,             // 1波あたりの弾数
  SP_DMG: 5,
  SP_CLEAR_R: 120,         // 必殺技で周囲の敵弾を消す半径
  SP_INV: 1500,            // 必殺技発動時の無敵時間 ms
  AUTO_DMG: 3,
  HEAL: 6,
  MAX_PLAYERS: 8,
  SHRINK_START: 40000,     // 対戦開始からエリア縮小が始まるまで ms
  SHRINK_RATE: 3,          // 縮小速度（片側 px/s）
  SHRINK_MAX: 130,         // 最大縮小幅（片側 px）
};
const TICK = 50;              // 20Hz
const COUNTDOWN = 3000;
const RESULT_TIME = 6000;
const LOBBY_AUTO = 15000;     // 公開ルームの自動スタートまで
const COLORS = ['#ff2d55', '#ffd60a', '#32d74b', '#64d2ff', '#bf5af2', '#ff9f0a', '#ff6ec7', '#ffffff'];

// 弾の種類
const K = { NORMAL: 0, BIG: 1, SHOT: 2, BLUE: 3, ORANGE: 4, SP: 5 };

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let highScores = []; // ソロ生存時間のトップ10（メモリ保持。サーバー再起動でリセット）
function submitScore(name, ms) {
  highScores.push({ name, ms, at: Date.now() });
  highScores.sort((a, b) => b.ms - a.ms);
  highScores = highScores.slice(0, 10);
}

const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => pick(chars.split(''))).join(''); } while (rooms.has(c));
  return c;
}

class Room {
  constructor(id, isPublic) {
    this.id = id;
    this.isPublic = isPublic;
    this.players = new Map();
    this.bullets = new Map(); // id -> {owner, kind, expire}  当たり報告の検証用
    this.items = [];
    this.bid = 1;
    this.iid = 1;
    this.round = 0;
    this.state = 'lobby';
    // 公開ルームだけ自動スタート。プライベートはホストがスタートするまで待つ
    this.stateUntil = 0;
    this.hostId = null;
    this.sessions = new Map(); // token -> {wins, kills}  再接続時に成績を引き継ぐ
    this.roundStart = 0;
    this.nextPattern = 0;
    this.nextItem = 0;
    this.mode = 'solo';
    this.result = null;
    this.emptySince = 0;
  }

  emit(ev, data) { io.to(this.id).emit(ev, data); }

  roster() {
    return [...this.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, wins: p.wins, kills: p.kills,
      host: p.id === this.hostId, ready: p.ready, spec: p.spectating,
    }));
  }
  sendRoster() { this.emit('roster', this.roster()); }

  addPlayer(socket, name, color, token) {
    const used = new Set([...this.players.values()].map(p => p.color));
    if (used.has(color)) color = COLORS.find(c => !used.has(c)) || color;
    const saved = token && this.sessions.get(token);
    const p = {
      id: socket.id, token, name, color,
      x: C.W / 2, y: C.H / 2, moving: false,
      hp: C.MAX_HP, alive: false, iframeUntil: 0, cdUntil: 0, sp: 0,
      kills: saved ? saved.kills : 0, wins: saved ? saved.wins : 0, grazes: 0, roundKills: 0,
      deathAt: 0, lastPosAt: Date.now(), grazeWindow: [],
      ready: false, spectating: false,
    };
    this.players.set(socket.id, p);
    socket.join(this.id);
    if (!this.isPublic && (!this.hostId || (saved && saved.host && !this.players.has(this.hostId)))) this.hostId = p.id;
    if (this.state === 'countdown') {
      // カウントダウン中の参加は次のラウンドに間に合う
      p.x = rand(60, C.W - 60); p.y = rand(60, C.H - 60);
      p.hp = C.MAX_HP; p.alive = true;
      if (this.players.size >= 2) this.mode = 'versus';
      this.emit('round', { round: this.round, mode: this.mode });
    } else if (this.state === 'play') {
      // 試合中の途中参加は観戦。次の試合から参戦
      p.spectating = true;
    }
    if (this.state === 'lobby' && this.isPublic && !this.stateUntil) this.stateUntil = Date.now() + LOBBY_AUTO;
    this.sendRoster();
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.token) this.sessions.set(p.token, { wins: p.wins, kills: p.kills, host: id === this.hostId });
    this.players.delete(id);
    if (this.hostId === id) {
      const next = this.players.values().next().value;
      this.hostId = next ? next.id : null;
    }
    this.sendRoster();
    if (this.players.size === 0) { this.emptySince = Date.now(); if (this.isPublic) this.stateUntil = 0; }
    else this.checkAllReady();
  }

  // プライベート: ホストのみスタート可能 / 公開: 全員「準備OK」か時間切れでスタート
  requestStart(p) {
    if (this.state !== 'lobby') return;
    if (!this.isPublic && p.id === this.hostId) this.startCountdown();
  }

  toggleReady(p) {
    if (this.state !== 'lobby') return;
    p.ready = !p.ready;
    this.sendRoster();
    this.checkAllReady();
  }

  checkAllReady() {
    if (this.state !== 'lobby' || !this.isPublic || this.players.size === 0) return;
    if ([...this.players.values()].every(p => p.ready)) this.startCountdown();
  }

  startCountdown() {
    this.state = 'countdown';
    this.stateUntil = Date.now() + COUNTDOWN;
    this.round++;
    this.bullets.clear();
    this.items = [];
    const list = [...this.players.values()];
    // 円形に並べて配置
    list.forEach((p, i) => {
      const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      const rr = list.length > 1 ? 120 : 0;
      p.x = C.W / 2 + Math.cos(a) * rr;
      p.y = C.H / 2 + Math.sin(a) * rr;
      p.hp = C.MAX_HP; p.alive = true; p.iframeUntil = 0; p.cdUntil = 0;
      p.grazes = 0; p.roundKills = 0; p.deathAt = 0; p.sp = 0;
      p.ready = false; p.spectating = false;
    });
    this.mode = list.length >= 2 ? 'versus' : 'solo';
    this.emit('round', { round: this.round, mode: this.mode });
    this.sendRoster();
  }

  // バトロワのエリア縮小：対戦モードでは一定時間後にボックスが縮んでいく
  inset(now) {
    if (this.mode !== 'versus' || this.state !== 'play') return 0;
    return clamp((now - this.roundStart - C.SHRINK_START) / 1000 * C.SHRINK_RATE, 0, C.SHRINK_MAX);
  }

  startPlay(now) {
    this.state = 'play';
    this.roundStart = now;
    this.nextPattern = now + 800;
    this.nextItem = now + 7000;
  }

  endRound(now) {
    const list = [...this.players.values()].filter(p => p.deathAt || p.alive);
    for (const p of list) if (p.alive) p.deathAt = now;
    const ranking = list
      .map(p => ({ id: p.id, name: p.name, color: p.color, time: p.deathAt - this.roundStart, kills: p.roundKills, grazes: p.grazes, alive: p.alive }))
      .sort((a, b) => (b.alive - a.alive) || (b.time - a.time));
    let winner = null;
    if (this.mode === 'versus') {
      const alive = list.filter(p => p.alive);
      if (alive.length === 1) { winner = alive[0].id; alive[0].wins++; }
    } else if (ranking[0]) {
      submitScore(ranking[0].name, ranking[0].time);
    }
    for (const p of this.players.values()) p.alive = false;
    this.items = [];
    this.result = { mode: this.mode, winner, ranking, top: highScores.slice(0, 5) };
    this.state = 'result';
    this.stateUntil = now + RESULT_TIME;
    this.emit('result', this.result);
    this.sendRoster();
  }

  // ===== 弾の生成 =====
  spawn(list) {
    const out = [];
    for (const b of list) {
      const id = this.bid++;
      const life = b.life || 7000;
      this.bullets.set(id, { owner: b.owner || null, kind: b.kind || 0, expire: b.t0 + life + 2000 });
      // [id, x, y, vx, vy, ax, ay, r, t0, life, kind, owner, warn]
      out.push([id, Math.round(b.x), Math.round(b.y), +b.vx.toFixed(1), +b.vy.toFixed(1),
        +(b.ax || 0).toFixed(1), +(b.ay || 0).toFixed(1), b.r || 7, b.t0, life, b.kind || 0, b.owner || 0, b.warn ? 1 : 0]);
    }
    if (out.length) this.emit('b', out);
  }

  alivePlayers() { return [...this.players.values()].filter(p => p.alive); }

  runPattern(now) {
    const el = (now - this.roundStart) / 1000;
    const d = 1 + el / 25;                        // 難易度（時間とともに上昇）
    const sp = Math.min(1.9, 0.85 + d * 0.12);    // 弾速倍率
    const pool = [
      ['rain', 3], ['sweep', 3], ['ring', 3], ['aimed', 2],
      ['fountain', d >= 1.6 ? 2 : 0], ['spiral', d >= 1.8 ? 2 : 0],
      ['blueorange', d >= 2.0 ? 2 : 0], ['cross', d >= 2.6 ? 2 : 0],
    ].filter(([, w]) => w > 0);
    let total = pool.reduce((s, [, w]) => s + w, 0), r = Math.random() * total, name = pool[0][0];
    for (const [n, w] of pool) { if ((r -= w) <= 0) { name = n; break; } }
    const dur = PATTERNS[name](this, now, d, sp);
    const gap = Math.max(450, 1900 - el * 18);
    this.nextPattern = now + (dur || 0) * 0.6 + gap;
  }

  // ===== メインループ =====
  tick(now) {
    // 期限切れ弾の掃除
    for (const [id, b] of this.bullets) if (b.expire < now) this.bullets.delete(id);

    if (this.state === 'lobby') {
      if (this.players.size > 0 && this.stateUntil && now >= this.stateUntil) this.startCountdown();
    } else if (this.state === 'countdown') {
      if (now >= this.stateUntil) this.startPlay(now);
    } else if (this.state === 'play') {
      if (now >= this.nextPattern) this.runPattern(now);
      if (now >= this.nextItem) {
        this.nextItem = now + rand(7000, 11000);
        if (this.items.length < 2) {
          const m = 40 + this.inset(now);
          this.items.push({ id: this.iid++, type: Math.random() < 0.6 ? 'heal' : 'charge', x: rand(m, C.W - m), y: rand(m, C.H - m), until: now + 12000 });
        }
      }
      this.items = this.items.filter(it => it.until > now);
      // アイテム取得
      for (const p of this.alivePlayers()) {
        for (let i = this.items.length - 1; i >= 0; i--) {
          const it = this.items[i];
          if (Math.hypot(it.x - p.x, it.y - p.y) < C.SOUL_R + 12) {
            this.items.splice(i, 1);
            if (it.type === 'heal') p.hp = Math.min(C.MAX_HP, p.hp + C.HEAL);
            else p.cdUntil = 0;
            this.emit('fx', { t: 'item', id: p.id, item: it.type, x: it.x, y: it.y });
          }
        }
      }
      for (const p of this.alivePlayers()) this.addSp(p, C.SP_TIME * TICK / 1000); // 時間経過で溜まる
      const alive = this.alivePlayers().length;
      if ((this.mode === 'versus' && alive <= 1) || alive === 0) this.endRound(now);
    } else if (this.state === 'result') {
      if (now >= this.stateUntil) {
        this.state = 'lobby';
        this.stateUntil = this.isPublic ? now + LOBBY_AUTO : 0;
      }
    }

    this.emit('s', {
      st: this.state, su: this.stateUntil, rs: this.roundStart, rd: this.round, md: this.mode, now,
      p: [...this.players.values()].map(p => [p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.hp, p.alive ? 1 : 0, Math.max(0, p.iframeUntil - now), Math.max(0, p.cdUntil - now), Math.floor(p.sp)]),
      it: this.items.map(it => [it.id, it.type, Math.round(it.x), Math.round(it.y)]),
    });
  }

  // ===== クライアントからの入力 =====
  onPos(p, x, y, moving, now) {
    if (!p.alive || this.state !== 'play') return;
    const dt = Math.max(0.02, (now - p.lastPosAt) / 1000);
    p.lastPosAt = now;
    const m = Math.max(0, this.inset(now) - 4) + C.SOUL_R; // 通信遅延ぶん少し甘めに
    x = clamp(+x || 0, m, C.W - m);
    y = clamp(+y || 0, m, C.H - m);
    // スピードハックの簡易対策
    const maxD = C.SPEED * Math.min(dt, 0.5) * 1.6 + 8;
    const dx = x - p.x, dy = y - p.y, dist = Math.hypot(dx, dy);
    if (dist > maxD) { x = p.x + dx / dist * maxD; y = p.y + dy / dist * maxD; }
    p.x = x; p.y = y; p.moving = !!moving;
  }

  addSp(p, v) { if (p && p.alive) p.sp = Math.min(C.SP_MAX, p.sp + v); }

  onHit(p, bid, now) {
    if (!p.alive || this.state !== 'play' || now < p.iframeUntil) return;
    const b = this.bullets.get(bid);
    if (!b || b.owner === p.id) return;
    const dmg = b.kind === K.SP ? C.SP_DMG : b.kind === K.SHOT ? C.SHOT_DMG : b.kind === K.BIG ? C.AUTO_DMG + 1 : C.AUTO_DMG;
    p.hp = Math.max(0, p.hp - dmg);
    p.iframeUntil = now + C.IFRAME;
    if (b.owner) p.lastHitBy = b.owner;
    // 必殺技メーター：食らった側と当てた側の両方に加算
    this.addSp(p, C.SP_DAMAGED);
    if (b.owner) this.addSp(this.players.get(b.owner), C.SP_HIT);
    this.emit('fx', { t: 'hit', id: p.id, by: b.owner, x: p.x, y: p.y });
    if (p.hp <= 0) {
      p.alive = false;
      p.deathAt = now;
      const killer = b.owner ? this.players.get(b.owner) : null;
      if (killer) { killer.kills++; killer.roundKills++; }
      this.emit('fx', { t: 'dead', id: p.id, by: killer ? killer.id : null, x: p.x, y: p.y });
    }
  }

  // 狙い撃ち：指定角度（正面）にショットガンを3連射。角度がなければ一番近い敵を自動で狙う
  onFire(p, now, angle) {
    if (!p.alive || this.state !== 'play' || now < p.cdUntil) return;
    p.cdUntil = now + C.SHOT_CD;
    let a0 = typeof angle === 'number' ? angle : NaN;
    if (!Number.isFinite(a0)) {
      let best = null, bd = Infinity;
      for (const q of this.alivePlayers()) {
        if (q === p) continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bd) { bd = d; best = q; }
      }
      a0 = best ? Math.atan2(best.y - p.y, best.x - p.x) : -Math.PI / 2;
    }
    // ショットガン（扇状に3発）を SHOT_INTERVAL ごとに3連射。2射目以降はその時点の自分の位置から
    const round = this.round;
    const shoot = () => {
      if (!p.alive || this.state !== 'play' || this.round !== round || !this.players.has(p.id)) return;
      const list = [];
      for (let i = 0; i < C.SHOT_N; i++) {
        const a = a0 + (C.SHOT_N > 1 ? (i / (C.SHOT_N - 1) - 0.5) * C.SHOT_SPREAD : 0);
        list.push({ x: p.x, y: p.y, vx: Math.cos(a) * C.SHOT_SPEED, vy: Math.sin(a) * C.SHOT_SPEED, r: 6, t0: Date.now() + 40, life: 2500, kind: K.SHOT, owner: p.id });
      }
      this.spawn(list);
      this.emit('fx', { t: 'fire', id: p.id, x: p.x, y: p.y, a: a0 });
    };
    for (let i = 0; i < C.SHOT_BURST; i++) {
      if (i === 0) shoot(); else setTimeout(shoot, i * C.SHOT_INTERVAL);
    }
  }

  // 必殺技「ソウルバースト」：メーターを全部使い、全方位リング弾＋周囲の敵弾を消去＋短い無敵
  onSpecial(p, now) {
    if (!p.alive || this.state !== 'play' || p.sp < C.SP_MAX) return;
    p.sp = 0;
    p.iframeUntil = Math.max(p.iframeUntil, now + C.SP_INV);
    const list = [];
    for (let w = 0; w < C.SP_WAVES; w++) {
      const off = w * Math.PI / C.SP_RING;
      for (let i = 0; i < C.SP_RING; i++) {
        const a = off + (i / C.SP_RING) * Math.PI * 2;
        list.push({ x: p.x, y: p.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, r: 9, t0: now + 60 + w * 250, life: 3000, kind: K.SP, owner: p.id });
      }
    }
    this.spawn(list);
    this.emit('fx', { t: 'special', id: p.id, x: p.x, y: p.y, r: C.SP_CLEAR_R, inv: C.SP_INV });
  }

  onGraze(p, now) {
    if (!p.alive || this.state !== 'play') return;
    p.grazeWindow = p.grazeWindow.filter(t => now - t < 1000);
    if (p.grazeWindow.length >= 10) return; // 連打対策
    p.grazeWindow.push(now);
    p.grazes++;
    p.cdUntil = Math.max(now, p.cdUntil - C.GRAZE_CUT);
    this.addSp(p, C.SP_GRAZE);
  }
}

// ===== 弾幕パターン（戻り値: パターンの長さ ms） =====
const W = C.W, H = C.H;
const PATTERNS = {
  // 上から降る雨
  rain(room, now, d, sp) {
    const n = Math.floor(8 + d * 4), list = [];
    for (let i = 0; i < n; i++) {
      list.push({ x: rand(0, W), y: -10, vx: rand(-25, 25), vy: rand(110, 170) * sp, r: rand(5, 8), t0: now + 200 + rand(0, 1400) });
    }
    room.spawn(list);
    return 1600;
  },
  // 隙間のある壁が四方のどこかから迫る
  sweep(room, now, d, sp) {
    const waves = d > 2.2 ? 3 : 2, list = [];
    for (let w = 0; w < waves; w++) {
      const side = Math.floor(Math.random() * 4);
      const gap = rand(60, W - 60), gapW = Math.max(56, 90 - d * 6);
      const t0 = now + 500 + w * 900;
      for (let s = 12; s < W; s += 22) {
        if (Math.abs(s - gap) < gapW / 2) continue;
        const v = 120 * sp;
        const b = [
          { x: s, y: -10, vx: 0, vy: v }, { x: s, y: H + 10, vx: 0, vy: -v },
          { x: -10, y: s, vx: v, vy: 0 }, { x: W + 10, y: s, vx: -v, vy: 0 },
        ][side];
        list.push({ ...b, r: 7, t0, warn: true, kind: K.BIG });
      }
    }
    room.spawn(list);
    return 900 * waves;
  },
  // ボックス内のランダム地点から円形に拡散（予告あり）
  ring(room, now, d, sp) {
    const count = d > 2 ? 3 : 2, list = [];
    for (let k = 0; k < count; k++) {
      const cx = rand(60, W - 60), cy = rand(60, H - 60);
      const n = Math.floor(12 + d * 2), off = Math.random() * Math.PI;
      const t0 = now + 900 + k * 500;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        list.push({ x: cx, y: cy, vx: Math.cos(a) * 105 * sp, vy: Math.sin(a) * 105 * sp, r: 6, t0, warn: i === 0 });
      }
    }
    room.spawn(list);
    return 900 + count * 500;
  },
  // ランダムな生存プレイヤーを狙う自機狙い弾
  aimed(room, now, d, sp) {
    const targets = room.alivePlayers();
    if (!targets.length) return 500;
    const list = [];
    const shooters = Math.floor(2 + d);
    for (let s = 0; s < shooters; s++) {
      const tgt = pick(targets);
      const side = Math.floor(Math.random() * 4);
      const [x, y] = [[rand(0, W), -10], [rand(0, W), H + 10], [-10, rand(0, H)], [W + 10, rand(0, H)]][side];
      const a = Math.atan2(tgt.y - y, tgt.x - x);
      for (let k = 0; k < 3; k++) {
        list.push({ x, y, vx: Math.cos(a) * 190 * sp, vy: Math.sin(a) * 190 * sp, r: 6, t0: now + 600 + s * 300 + k * 130, warn: k === 0 });
      }
    }
    room.spawn(list);
    return 600 + shooters * 300;
  },
  // 下から放物線で噴き上がる
  fountain(room, now, d, sp) {
    const n = Math.floor(10 + d * 3), list = [];
    const cx = rand(120, W - 120);
    for (let i = 0; i < n; i++) {
      list.push({ x: cx + rand(-30, 30), y: H + 10, vx: rand(-110, 110), vy: -rand(330, 420), ay: 260 * sp, r: 6, t0: now + 700 + i * 70, warn: i === 0 });
    }
    room.spawn(list);
    return 700 + n * 70;
  },
  // 回転する渦巻き
  spiral(room, now, d, sp) {
    const cx = W / 2 + rand(-80, 80), cy = H / 2 + rand(-80, 80);
    const arms = d > 2.8 ? 4 : 3, steps = 22, list = [];
    const dir = Math.random() < 0.5 ? 1 : -1;
    for (let s = 0; s < steps; s++) {
      for (let a = 0; a < arms; a++) {
        const ang = dir * s * 0.28 + (a / arms) * Math.PI * 2;
        list.push({ x: cx, y: cy, vx: Math.cos(ang) * 95 * sp, vy: Math.sin(ang) * 95 * sp, r: 5, t0: now + 900 + s * 90, warn: s === 0 && a === 0 });
      }
    }
    room.spawn(list);
    return 900 + steps * 90;
  },
  // Undertale名物：青い弾は「動くと」当たる、オレンジは「止まると」当たる
  blueorange(room, now, d, sp) {
    const kind = Math.random() < 0.5 ? K.BLUE : K.ORANGE;
    const fromTop = Math.random() < 0.5, list = [];
    const t0 = now + 900;
    for (let s = 8; s < W; s += 12) {
      list.push(fromTop
        ? { x: s, y: -10, vx: 0, vy: 95 * sp, r: 7, t0, kind, warn: s === 8 }
        : { x: -10, y: s, vx: 95 * sp, vy: 0, r: 7, t0, kind, warn: s === 8 });
    }
    room.spawn(list);
    return 1800;
  },
  // 十字砲火：四方から同時に壁
  cross(room, now, d, sp) {
    const list = [];
    const gx = rand(80, W - 80), gy = rand(80, H - 80);
    const t0 = now + 1000;
    for (let s = 12; s < W; s += 26) {
      if (Math.abs(s - gx) > 34) list.push({ x: s, y: -10, vx: 0, vy: 100 * sp, r: 6, t0, warn: s === 12 });
      if (Math.abs(s - gy) > 34) list.push({ x: -10, y: s, vx: 100 * sp, vy: 0, r: 6, t0: t0 + 500 });
    }
    room.spawn(list);
    return 2000;
  },
};

// ===== 接続処理 =====
function findPublicRoom() {
  for (const r of rooms.values()) {
    if (r.isPublic && r.players.size < C.MAX_PLAYERS) return r;
  }
  const r = new Room('P' + makeCode(), true);
  rooms.set(r.id, r);
  return r;
}

io.on('connection', (socket) => {
  let room = null, me = null;

  socket.on('ping2', (t, cb) => { if (typeof cb === 'function') cb(Date.now()); });

  socket.on('join', (data, cb) => {
    if (room) return;
    data = data || {};
    const name = String(data.name || 'ななし').replace(/[<>]/g, '').slice(0, 10) || 'ななし';
    const color = COLORS.includes(data.color) ? data.color : pick(COLORS);
    let r;
    if (data.mode === 'create') {
      r = new Room(makeCode(), false);
      rooms.set(r.id, r);
    } else if (data.mode === 'code') {
      r = rooms.get(String(data.code || '').toUpperCase().trim());
      if (!r) return cb && cb({ ok: false, error: '部屋が見つかりません' });
    } else {
      r = findPublicRoom();
    }
    if (r.players.size >= C.MAX_PLAYERS) return cb && cb({ ok: false, error: '満員です（最大8人）' });
    room = r;
    const token = typeof data.token === 'string' ? data.token.slice(0, 40) : null;
    me = r.addPlayer(socket, name, color, token);
    cb && cb({ ok: true, id: socket.id, room: r.id, isPublic: r.isPublic, C, state: r.state });
  });

  socket.on('start', () => { if (room && me) room.requestStart(me); });
  socket.on('ready', () => { if (room && me) room.toggleReady(me); });
  socket.on('pos', (d) => { if (room && me && d) room.onPos(me, d.x, d.y, d.m, Date.now()); });
  socket.on('hit', (bid) => { if (room && me) room.onHit(me, +bid, Date.now()); });
  socket.on('fire', (angle) => { if (room && me) room.onFire(me, Date.now(), angle); });
  socket.on('special', () => { if (room && me) room.onSpecial(me, Date.now()); });
  socket.on('graze', () => { if (room && me) room.onGraze(me, Date.now()); });
  socket.on('emote', (e) => {
    const now = Date.now();
    if (!room || !me || now - (me.lastEmote || 0) < 800) return; // 連打対策
    me.lastEmote = now;
    if (['!', '?', '♥', 'GG', 'w'].includes(e)) room.emit('fx', { t: 'emote', id: me.id, e });
  });

  socket.on('disconnect', () => {
    if (room) room.removePlayer(socket.id);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (r.players.size === 0) {
      if (now - r.emptySince > 60000) rooms.delete(id);
      continue;
    }
    r.tick(now);
  }
}, TICK);

server.listen(PORT, () => console.log(`SOUL BARRAGE server listening on http://localhost:${PORT}`));
