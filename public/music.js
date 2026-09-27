// SOUL BARRAGE - ボスごとの専用BGM（Web Audio でその場で演奏するチップチューン。音声ファイル不要）
//
// 曲データの書き方
//   mel  : メロディ。1小節 = 16トークン（16分音符）。'C5' などの音名 / '-' 前の音を伸ばす / '.' 休符
//   chords: 小節ごとのコード（ベースと分散和音を自動生成）。'Am' 'F' 'E' 'C+'(オーギュメント) 'Bdim' など
//   bass : ベースの刻み方 pump / pump16 / oompah / gallop / long / octave / staccato / drone
//   drm  : ドラム16ステップ。k=キック s=スネア h=ハイハット .=なし
//   arp  : 分散和音の音色（null なら無し）
//   第2形態（ボスのHPが半分以下）ではテンポが上がり、半音上に転調する
(() => {
'use strict';

const SONGS = {
  // ===== STAGE 1 =====
  slime: {
    title: 'スライミー「ぷるぷるマーチ」',
    bpm: 132, lead: 'square', leadVol: 0.05, bassWave: 'triangle', bass: 'pump', arp: null,
    chords: ['C', 'Am', 'F', 'G'],
    mel: [
      'C5 . E5 G5 . E5 C5 . D5 . E5 . D5 . C5 .',
      'A4 . C5 E5 . C5 A4 . B4 . C5 . B4 . A4 .',
      'F4 . A4 C5 . A4 F4 . G4 . A4 . C5 . F5 .',
      'G5 - F5 - E5 - D5 - G4 . B4 . D5 . G5 .',
    ],
    drm: 'k . h . s . h . k . h k s . h .',
  },
  ghost: {
    title: 'フワリン「よるのワルツ」',
    bpm: 108, lead: 'triangle', leadVol: 0.09, vib: 6, bassWave: 'triangle', bass: 'long', arp: 'triangle',
    chords: ['Am', 'Am', 'Dm', 'E'],
    mel: [
      'A4 - - C5 - - E5 - - D5 - - C5 - B4 -',
      'A4 - - - - - E4 - - A4 - - C5 - - -',
      'D5 - - F5 - - A5 - - G5 - - F5 - E5 -',
      'E5 - - D5 - - C5 - - B4 - - G#4 - - -',
    ],
    drm: '. . . . . . h . . . . . . . h .',
  },
  frog: {
    title: 'ピョンタ「ケロケロポルカ」',
    bpm: 152, lead: 'square', leadVol: 0.045, bassWave: 'square', bassVol: 0.035, bass: 'oompah', arp: null,
    chords: ['F', 'Bb', 'C', 'F'],
    mel: [
      'F5 . . C5 F5 . A5 . G5 . F5 . D5 . C5 .',
      'Bb4 . D5 . F5 . D5 . Bb4 . C5 . D5 . . .',
      'C5 . E5 . G5 . E5 . C5 . G4 . C5 . E5 .',
      'F5 . A5 . C6 . A5 . F5 . . . F4 . . .',
    ],
    drm: 'k . . h s . h . k . k h s . h .',
  },
  // ===== STAGE 2 =====
  knight: {
    title: 'ホネナイト「カタカタ騎士道」',
    bpm: 150, lead: 'square', leadVol: 0.05, bassWave: 'triangle', bass: 'gallop', arp: null,
    chords: ['Dm', 'Dm', 'Bb', 'C'],
    mel: [
      'D5 . A4 . D5 . F5 . E5 . D5 . A4 . C5 .',
      'D5 . A4 . D5 . F5 . G5 . F5 . E5 . C5 .',
      'Bb4 . D5 . F5 . D5 . Bb4 . A4 . Bb4 . D5 .',
      'C5 . E5 . G5 . E5 . C5 - - - E5 . C#5 .',
    ],
    drm: 'k h h h s h h h k h k h s h h h',
  },
  spider: {
    title: 'アラク「あみのなかで」',
    bpm: 128, lead: 'square', leadVol: 0.045, stacc: true, bassWave: 'triangle', bass: 'staccato', arp: null,
    chords: ['Em', 'Em', 'C', 'B'],
    mel: [
      'E5 . . F5 E5 . . D#5 E5 . G5 . F#5 . E5 .',
      'B4 . . C5 B4 . . A#4 B4 . D5 . C5 . B4 .',
      'C5 . E5 . G5 . E5 . C5 . . B4 C5 . E5 .',
      'D#5 . F#5 . A5 . F#5 . D#5 . B4 . . . . .',
    ],
    drm: 'k . . . s . . h k . . . s . h h',
  },
  snowman: {
    title: 'ユキダルマン「ゆきのベル」',
    bpm: 120, lead: 'triangle', leadVol: 0.1, bell: true, bassWave: 'triangle', bass: 'long', arp: 'triangle', arpOct: 6,
    chords: ['G', 'Em', 'C', 'D'],
    mel: [
      'B5 . G5 . D5 . G5 . B5 . A5 . G5 . . .',
      'G5 . E5 . B4 . E5 . G5 . F#5 . E5 . . .',
      'E5 . C5 . G4 . C5 . E5 . D5 . C5 . E5 .',
      'D5 . F#5 . A5 . F#5 . D5 - - - . . . .',
    ],
    drm: 'h . h . s . h . h . h . s . h h',
  },
  // ===== STAGE 3 =====
  witch: {
    title: 'ヒノカ「ほのおのほうき」',
    bpm: 162, lead: 'square', leadVol: 0.045, bassWave: 'triangle', bass: 'pump', arp: 'square',
    chords: ['Am', 'F', 'E', 'Am'],
    mel: [
      'A5 . G#5 A5 . E5 . C5 . E5 . A5 . B5 . C6',
      'A5 . F5 . C5 . F5 . A5 . G5 . F5 . E5 .',
      'G#5 . B5 . E6 . B5 . G#5 . E5 . D5 . B4 .',
      'A4 . C5 . E5 . A5 - - - . . E5 . A5 .',
    ],
    drm: 'k . h k s . h . k . h k s . h h',
  },
  dragon: {
    title: 'ドラコ「ちいさなつばさ」',
    bpm: 156, lead: 'sawtooth', leadVol: 0.035, bassWave: 'square', bassVol: 0.03, bass: 'gallop', arp: null,
    chords: ['Dm', 'Bb', 'F', 'C'],
    mel: [
      'D5 - - A4 D5 . F5 . A5 - - G5 F5 . E5 .',
      'F5 - - D5 Bb4 . D5 . F5 - - E5 D5 . C5 .',
      'C5 - - F5 A5 . C6 . A5 - - G5 F5 . A5 .',
      'G5 - - - E5 - - - C5 . E5 . G5 . C6 .',
    ],
    drm: 'k . h . s . h . k k h . s . h k',
  },
  mage: {
    title: 'ライデン「いなずまロンド」',
    bpm: 172, lead: 'sawtooth', leadVol: 0.035, bassWave: 'square', bassVol: 0.03, bass: 'pump16', arp: null,
    chords: ['Em', 'D', 'C', 'B'],
    mel: [
      'E5 E5 . G5 . E5 B5 . A5 . G5 . F#5 . E5 .',
      'D5 D5 . F#5 . D5 A5 . G5 . F#5 . E5 . D5 .',
      'C5 C5 . E5 . C5 G5 . F#5 . E5 . D5 . C5 .',
      'B4 . D#5 . F#5 . B5 . A5 . F#5 . D#5 . B4 .',
    ],
    drm: 'k . h . s . h k k . h . s . h h',
  },
  // ===== STAGE 4 =====
  robot: {
    title: 'ギアロイド「ハイジョ・プロトコル」',
    bpm: 140, lead: 'square', leadVol: 0.045, bassWave: 'square', bassVol: 0.03, bass: 'octave', arp: 'square',
    chords: ['Cm', 'Ab', 'Bb', 'G'],
    mel: [
      'C5 . C5 . G5 . C5 . Eb5 . C5 . G5 . Bb5 .',
      'Ab5 . Eb5 . C5 . Eb5 . Ab5 . G5 . Eb5 . C5 .',
      'Bb4 . D5 . F5 . Bb5 . F5 . D5 . Bb4 . D5 .',
      'G5 . G5 . F5 . Eb5 . D5 . B4 . G4 . B4 .',
    ],
    drm: 'k . h . s . h . k . h . s . k h',
  },
  mirror: {
    title: 'ミラージュ「かがみのゆめ」',
    bpm: 124, lead: 'triangle', leadVol: 0.1, vib: 4, bassWave: 'triangle', bass: 'long', arp: 'triangle', arpOct: 5,
    chords: ['C+', 'D+', 'E+', 'D+'],
    mel: [
      'C6 . A#5 . G#5 . F#5 . E5 . F#5 . G#5 . A#5 .',
      'D6 . C6 . A#5 . G#5 . F#5 - - - . . . .',
      'E5 . G#5 . C6 . G#5 . E5 . D5 . E5 . F#5 .',
      'G#5 - - - A#5 - - - C6 - - - . . . .',
    ],
    drm: 'h . . . . . h . . . h . . . . .',
  },
  clown: {
    title: 'ピエロット「おどけたサーカス」',
    bpm: 176, lead: 'square', leadVol: 0.045, bassWave: 'triangle', bass: 'oompah', arp: null,
    chords: ['C', 'G', 'C', 'G'],
    mel: [
      'E5 D#5 E5 . C5 . G4 . A4 A#4 B4 . C5 . E5 .',
      'D5 C#5 D5 . B4 . G4 . F5 E5 D5 . C5 . B4 .',
      'E5 D#5 E5 . G5 . E5 . C6 B5 A5 . G5 . E5 .',
      'D5 . G5 . F5 . D5 . C5 . . . C4 . . .',
    ],
    drm: 'k . s . k . s . k . s . k . s .',
  },
  // ===== STAGE 5 =====
  king: {
    title: 'ソウルキング「魂の玉座」',
    bpm: 150, lead: 'sawtooth', leadVol: 0.035, bassWave: 'square', bassVol: 0.03, bass: 'gallop', arp: 'square',
    chords: ['Bm', 'G', 'D', 'A'],
    mel: [
      'B4 . D5 . F#5 - - . B5 - A5 - F#5 . E5 .',
      'D5 . G5 . B5 - - . A5 - G5 - F#5 . D5 .',
      'F#5 . A5 . D6 - - . C#6 - B5 - A5 . F#5 .',
      'E5 . C#5 . A4 . C#5 . E5 . A5 . C#6 . E6 .',
    ],
    drm: 'k h h h s h h k k h k h s h h h',
  },
  angel: {
    title: 'ルシエル「おちた天使の歌」',
    bpm: 132, lead: 'triangle', leadVol: 0.11, vib: 5, bassWave: 'triangle', bass: 'long', arp: 'triangle', arpOct: 5,
    chords: ['D', 'A', 'Bm', 'G'],
    mel: [
      'F#5 - - - A5 - D6 - C#6 - - - A5 - - -',
      'E5 - - - A5 - C#6 - B5 - - - A5 - - -',
      'D5 - - - F#5 - B5 - A5 - - - F#5 - - -',
      'G5 - - - B5 - D6 - E6 - - - - - - -',
    ],
    drm: 'k . . . s . . . k . k . s . . .',
  },
  void: {
    title: 'ヴォイド「なにもない」',
    bpm: 96, lead: 'sawtooth', leadVol: 0.03, vib: 3, bassWave: 'sawtooth', bassVol: 0.025, bass: 'drone', arp: 'triangle', arpOct: 4,
    chords: ['C#m', 'Dm', 'C#m', 'G#dim'],
    mel: [
      'C#4 - - - - - - - D4 - - - - - - -',
      'C#4 - - - - - - - G4 - - - F#4 - - -',
      'E4 - - - D4 - - - C#4 - - - G#3 - - -',
      'A3 - - - - - - - G#3 - - - - - - -',
    ],
    drm: 'k . k . . . . . . . . . . . . .',
  },
};

// ===== 音名・コードの解析 =====
const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (tok) => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(tok);
  if (!m) return null;
  return 12 * (+m[3] + 1) + SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};
const freqOf = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
function chordOf(name) {
  const m = /^([A-G])(#|b)?(m|dim|\+)?/.exec(name);
  const root = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const q = m[3] === 'm' ? [0, 3, 7] : m[3] === 'dim' ? [0, 3, 6] : m[3] === '+' ? [0, 4, 8] : [0, 4, 7];
  return { root, tones: q.map(i => root + i) };
}

// 曲データを「ステップごとの発音リスト」に変換
function compile(song) {
  const bars = song.mel.length, steps = bars * 16;
  const mel = [];
  song.mel.forEach((bar, bi) => {
    const toks = bar.trim().split(/\s+/).slice(0, 16);
    while (toks.length < 16) toks.push('.');
    toks.forEach((t, si) => mel.push({ t, i: bi * 16 + si }));
  });
  // メロディ：音符ごとに長さ（'-' の数）を計算
  const lead = new Array(steps).fill(null);
  for (let i = 0; i < steps; i++) {
    const midi = midiOf(mel[i].t);
    if (midi == null) continue;
    let len = 1;
    while (i + len < steps && mel[i + len].t === '-') len++;
    lead[i] = { midi, len };
  }
  // ベース
  const bass = new Array(steps).fill(null), arp = new Array(steps).fill(null);
  for (let b = 0; b < bars; b++) {
    const ch = chordOf(song.chords[b % song.chords.length]);
    const r2 = 36 + ch.root, r3 = 48 + ch.root, fifth = 36 + ch.tones[2];
    for (let s = 0; s < 16; s++) {
      const i = b * 16 + s;
      let n = null;
      switch (song.bass) {
        case 'pump': if (s % 2 === 0) n = { midi: r2, len: 1 }; break;
        case 'pump16': n = { midi: s % 4 === 0 ? r2 : r3, len: 1 }; break;
        case 'oompah': if (s % 4 === 0) n = { midi: r2, len: 1 }; else if (s % 4 === 2) n = { midi: fifth + 12, len: 1 }; break;
        case 'gallop': if ([0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15].includes(s)) n = { midi: r2, len: 1 }; break;
        case 'long': if (s === 0) n = { midi: r2, len: 8 }; else if (s === 8) n = { midi: fifth, len: 8 }; break;
        case 'octave': if (s % 2 === 0) n = { midi: s % 4 === 0 ? r2 : r3, len: 1 }; break;
        case 'staccato': if (s % 4 === 2) n = { midi: r2, len: 1, short: true }; break;
        case 'drone': if (s === 0) n = { midi: 24 + ch.root, len: 16 }; break;
      }
      bass[i] = n;
      if (song.arp) {
        const tones = ch.tones, oct = 12 * ((song.arpOct || 5) + 1);
        arp[i] = { midi: oct + tones[s % tones.length] - 12 * (s % 6 === 5 ? 1 : 0), len: 1 };
      }
    }
  }
  const drm = song.drm.trim().split(/\s+/);
  return { steps, lead, bass, arp, drm };
}

// ===== 演奏エンジン =====
let AC = null, out = null, noise = null;
let cur = null;          // { key, song, data, step, nextT, phase }
let timer = null;
let volume = 0.5;

function ensureOut(ac) {
  if (AC === ac && out) return;
  AC = ac;
  out = AC.createGain(); out.gain.value = volume; out.connect(AC.destination);
  // ドラム用ノイズ
  const len = AC.sampleRate * 0.5, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noise = buf;
}

function note(t, f, dur, type, vol, opt = {}) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (opt.vib) { // ビブラート
    const l = AC.createOscillator(), lg = AC.createGain();
    l.frequency.value = opt.vib; lg.gain.value = f * 0.012;
    l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  if (opt.bell) g.gain.exponentialRampToValueAtTime(vol * 0.15, t + Math.min(dur, 0.35)); // 鈴のように減衰
  else g.gain.setValueAtTime(vol * 0.8, t + Math.max(0.01, dur * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur + 0.02);
}

function drum(t, k) {
  if (k === 'k') {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.16);
  } else if (k === 's' || k === 'h') {
    const src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
    src.buffer = noise;
    f.type = k === 's' ? 'bandpass' : 'highpass'; f.frequency.value = k === 's' ? 1800 : 7000;
    const dur = k === 's' ? 0.12 : 0.035, v = k === 's' ? 0.09 : 0.03;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out); src.start(t); src.stop(t + dur + 0.01);
  }
}

function schedule() {
  if (!cur || !AC) return;
  const { song, data } = cur;
  while (cur.nextT < AC.currentTime + 0.15) {
    if (cur.step % 16 === 0 && cur.pending) { cur.phase = cur.pending; cur.pending = 0; } // 形態変化は小節の頭で
    const p2 = cur.phase === 2, tr = p2 ? 1 : 0;           // 第2形態は半音上へ転調
    const stepDur = 60 / (song.bpm * (p2 ? 1.12 : 1)) / 4;   // 16分音符の長さ（第2形態はテンポアップ）
    const i = cur.step % data.steps, t = cur.nextT;
    const L = data.lead[i];
    if (L) note(t, freqOf(L.midi + tr), L.len * stepDur * (song.stacc ? 0.5 : 0.92), song.lead, song.leadVol, { vib: song.vib, bell: song.bell });
    const B = data.bass[i];
    if (B) note(t, freqOf(B.midi + tr), B.len * stepDur * (B.short ? 0.4 : 0.9), song.bassWave, song.bassVol || 0.06);
    const A = data.arp[i];
    if (A) note(t, freqOf(A.midi + tr), stepDur * 0.8, song.arp, song.arp === 'square' ? 0.012 : 0.025);
    const d = data.drm[i % data.drm.length];
    if (d && d !== '.') drum(t, d);
    cur.nextT += stepDur;
    cur.step++;
  }
}

function stop(fade = 0.4) {
  if (!cur) return;
  cur = null;
  clearInterval(timer); timer = null;
  if (out && AC) { // フェードアウトして出力を作り直す
    const old = out;
    old.gain.setTargetAtTime(0.0001, AC.currentTime, fade / 3);
    setTimeout(() => { try { old.disconnect(); } catch {} }, fade * 1000 + 200);
    out = AC.createGain(); out.gain.value = volume; out.connect(AC.destination);
  }
}

function play(key, phase) {
  const song = SONGS[key];
  if (!song) return stop();
  cur = { key, song, data: compile(song), step: 0, nextT: AC.currentTime + 0.1, phase };
  clearInterval(timer);
  timer = setInterval(schedule, 25);
  schedule();
}

// 毎フレーム呼ぶ：鳴らしたい曲（なければ null）を渡すと、切り替え・停止・第2形態を処理する
function update(ac, key, phase, enabled) {
  if (!ac || !enabled || document.hidden) { if (cur) stop(0.2); return; }
  ensureOut(ac);
  if (!key) { if (cur) stop(); return; }
  if (!cur || cur.key !== key) { stop(0.2); play(key, phase); return; }
  if (cur.phase !== phase) cur.pending = phase;
}

function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (out && AC) out.gain.setTargetAtTime(volume, AC.currentTime, 0.05);
}

window.SBMusic = { update, setVolume, stop, songs: Object.keys(SONGS).map(k => ({ key: k, title: SONGS[k].title })) };
})();
