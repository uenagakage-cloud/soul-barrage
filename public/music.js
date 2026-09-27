// SOUL BARRAGE - ボスごとの専用BGM（Web Audio でその場で演奏するチップチューン。音声ファイル不要）
//
// 曲の構成：Aメロ(mel, 4小節) → Bメロ(melB, 4小節) の8小節をループ
// 曲データの書き方（1小節 = 16トークン = 16分音符×16）
//   mel   : Aメロ。'C5' などの音名 / '-' 前の音を伸ばす / '.' 休符
//   melB / chordsB / gtrB / drmB : Bメロ用（gtrB・drmB を省略すると Bメロ用の標準パターン / Aと同じドラム）
//   chords: 小節ごとのコード（ベース・ギター・分散和音を自動生成）。'Am' 'F' 'C+' 'Bdim' など
//   gtr   : 歪んだパワーコード（ギター）の刻み。X=強く / x=短く / -=伸ばす / .=なし
//   bass  : ベースの刻み方 drive / rock16 / syncop / oompah / halftime
//   drm   : ドラム。k=キック s=スネア h=ハイハット o=オープンハイハット t=タム .=なし
//   lead  : メロディの音色 saw2(厚いノコギリ波) / pulse12・pulse25(細いパルス) / square / triangle
//   harm  : 2周目以降に重ねるハモリの音程（半音。-5 = 4度下）
// 演奏中の変化：A・Bの頭でクラッシュ、Bメロは常にハモリ（Aメロは2周目以降）、Bへ入る前と曲の終わりにドラムのフィル。
// 第2形態（ボスのHPが半分以下）ではテンポが上がり、半音上に転調する。
(() => {
'use strict';

const SONGS = {
  // ===== STAGE 1 =====
  slime: {
    title: 'スライミー「ゲル・ランペイジ」', bpm: 156, lead: 'pulse25', leadVol: 0.05, harm: -5,
    chords: ['Em', 'C', 'D', 'B'], bass: 'syncop', arp: null,
    mel: [
      'E5 . E5 G5 . E5 A5 . G5 . E5 . D5 E5 . .',
      'C5 . C5 E5 . C5 G5 . F#5 . E5 . D5 . B4 .',
      'D5 . D5 F#5 . D5 A5 . B5 . A5 . F#5 . D5 .',
      'D#5 . F#5 . B5 . A5 G5 F#5 . D#5 . B4 . . .',
    ],
    gtr: 'X . . x . x x . X . . x . x . x',
    drm: 'k . h . s . h k . k h . s . h h',
    // --- Bメロ ---
    chordsB: ['Am', 'C', 'D', 'B'],
    melB: [
      'A5 - - G5 A5 - C6 - B5 - A5 - G5 - E5 -',
      'G5 - - F#5 G5 - C6 - B5 - G5 - E5 - C5 -',
      'D5 . F#5 . A5 . D6 . C6 . B5 . A5 . F#5 .',
      'B5 - - - A5 - - - F#5 - - - D#5 . B4 .',
    ],
  },
  ghost: {
    title: 'フワリン「ファントム・ラン」', bpm: 164, lead: 'saw2', leadVol: 0.03, echo: true, harm: -5,
    chords: ['Am', 'F', 'G', 'E'], bass: 'drive', arp: null,
    mel: [
      'A5 . . E5 . . A5 . C6 . B5 . A5 . G5 .',
      'F5 . . C5 . . F5 . A5 . G5 . F5 . E5 .',
      'G5 . . D5 . . G5 . B5 . A5 . G5 . F5 .',
      'E5 . G#5 . B5 . E6 . D6 . B5 . G#5 . E5 .',
    ],
    gtr: 'X . x . X . x . X . x . X . x x',
    drm: 'k . h h s . h . k k h . s . h o',
    // --- Bメロ ---
    chordsB: ['Dm', 'Am', 'Bb', 'E'],
    melB: [
      'D6 - - C6 A5 - - F5 D5 . F5 . A5 . D6 .',
      'C6 - - B5 A5 - - E5 C5 . E5 . A5 . C6 .',
      'Bb5 - - A5 F5 - - D5 Bb4 . D5 . F5 . Bb5 .',
      'B5 - - - G#5 - - - E5 . F5 . G#5 . B5 .',
    ],
  },
  frog: {
    title: 'ピョンタ「ジャンピング・ビート」', bpm: 170, lead: 'pulse12', leadVol: 0.05, harm: -3,
    chords: ['Dm', 'G', 'Dm', 'C'], bass: 'rock16', arp: null,
    mel: [
      'D5 . F5 D5 . G5 . A5 . . C6 A5 . G5 F5 .',
      'G5 . B5 G5 . A5 . B5 . . D6 B5 . A5 G5 .',
      'D5 . F5 D5 . G5 . A5 . C6 . A5 . F5 . D5',
      'E5 . G5 . C6 . . B5 . G5 . E5 . C5 . .',
    ],
    gtr: 'x x . x x . x . x x . x X . . .',
    drm: 'k . h k s . h . k . h k s . h h',
    // --- Bメロ ---
    chordsB: ['Bb', 'C', 'Am', 'A'],
    melB: [
      'F5 . . F5 . D5 . F5 . A5 . G5 . F5 . D5',
      'E5 . . E5 . C5 . E5 . G5 . A5 . G5 . E5',
      'C5 . E5 . A5 . E5 . C6 . B5 . A5 . E5 .',
      'C#5 . E5 . A5 . C#6 . E6 - - - C#6 . A5 .',
    ],
  },
  // ===== STAGE 2 =====
  knight: {
    title: 'ホネナイト「ボーン・クラッシャー」', bpm: 176, lead: 'square', leadVol: 0.04, harm: -5,
    chords: ['Dm', 'Bb', 'C', 'A'], bass: 'rock16', arp: null,
    mel: [
      'D5 D5 . D5 F5 . E5 . D5 . C5 . A4 . C5 .',
      'Bb4 Bb4 . Bb4 D5 . C5 . Bb4 . A4 . F4 . A4 .',
      'C5 C5 . C5 E5 . D5 . C5 . Bb4 . G4 . Bb4 .',
      'A4 . C#5 . E5 . A5 . G5 . E5 . C#5 . E5 .',
    ],
    gtr: 'X . x x . x x . X . x x . x x x',
    drm: 'k k h . s . h k k . h k s . h h',
    // --- Bメロ ---
    chordsB: ['Gm', 'Dm', 'Eb', 'A'],
    gtrB: 'X - - - X - - - X - x x X - x x',
    melB: [
      'G5 - - - Bb5 - - - A5 - G5 - F5 - D5 -',
      'F5 - - - A5 - - - G5 - F5 - E5 - D5 -',
      'Eb5 - - - G5 - - - Bb5 - - - Eb6 - - -',
      'E5 . E5 . A5 . A5 . C#6 . C#6 . E6 . . .',
    ],
  },
  spider: {
    title: 'アラク「ヴェノム・ウェブ」', bpm: 150, lead: 'pulse25', leadVol: 0.05, stacc: true, harm: -5,
    chords: ['Em', 'F', 'Em', 'D'], bass: 'syncop', arp: null,
    mel: [
      'E5 . F5 . E5 . B4 . E5 . F5 . G5 . F5 .',
      'F5 . G5 . F5 . C5 . F5 . G5 . A5 . G5 .',
      'E5 . F5 . E5 . B4 . G5 . F5 . E5 . B4 .',
      'D5 . E5 . F#5 . A5 . D6 . C6 . A5 . F5 .',
    ],
    gtr: 'X . . x . . X . . x . . X . x .',
    drm: 'k . h . s . h k . . h k s . h .',
    // --- Bメロ ---
    chordsB: ['C', 'Am', 'F', 'B'],
    melB: [
      'G5 - - E5 C5 - - E5 G5 . A5 . G5 . E5 .',
      'A5 - - E5 C5 - - E5 A5 . B5 . C6 . A5 .',
      'F5 . A5 . C6 . F6 . E6 . C6 . A5 . F5 .',
      'D#5 - - - F#5 - - - B5 - - - A5 . F#5 .',
    ],
  },
  snowman: {
    title: 'ユキダルマン「ブリザード・ドライブ」', bpm: 168, lead: 'pulse12', leadVol: 0.05, echo: true, harm: -5,
    chords: ['Bm', 'G', 'A', 'F#'], bass: 'drive', arp: 'triangle', arpOct: 6,
    mel: [
      'B5 . F#5 . D5 . F#5 . B5 . C#6 . D6 . C#6 .',
      'B5 . G5 . D5 . G5 . B5 . A5 . G5 . F#5 .',
      'A5 . E5 . C#5 . E5 . A5 . B5 . C#6 . E6 .',
      'F#5 . A#5 . C#6 . F#6 . E6 . C#6 . A#5 . F#5 .',
    ],
    gtr: 'X . x . x . X . x . X . x . x .',
    drm: 'k . h h s . h h k . h h s . h o',
    // --- Bメロ ---
    chordsB: ['Em', 'G', 'D', 'F#'],
    melB: [
      'E6 - - D6 B5 - - G5 E5 . G5 . B5 . D6 .',
      'D6 - - B5 G5 - - D5 B4 . D5 . G5 . B5 .',
      'A5 . F#5 . D5 . F#5 . A5 . D6 . F#6 . D6 .',
      'C#6 - - - A#5 - - - F#5 - - - C#5 . . .',
    ],
  },
  // ===== STAGE 3 =====
  witch: {
    title: 'ヒノカ「インフェルノ・ブルーム」', bpm: 184, lead: 'saw2', leadVol: 0.03, harm: -5,
    chords: ['Am', 'F', 'Dm', 'E'], bass: 'rock16', arp: null,
    mel: [
      'A5 . E5 . A5 C6 . B5 . A5 . G#5 . A5 . E5',
      'F5 . C5 . F5 A5 . G5 . F5 . E5 . F5 . C5',
      'D5 . A4 . D5 F5 . E5 . D5 . C5 . D5 . F5',
      'E5 . G#5 . B5 . D6 . C6 . B5 . G#5 . E5 .',
    ],
    gtr: 'X x . x X . x . X x . x X . x x',
    drm: 'k h s h k h s h k h s h k h s h',
    // --- Bメロ ---
    chordsB: ['Dm', 'G', 'C', 'E'],
    gtrB: 'X x . x X x . x X x . x X x x x',
    melB: [
      'F5 . A5 . D6 . A5 . F5 . D5 . F5 . A5 .',
      'G5 . B5 . D6 . B5 . G5 . D5 . G5 . B5 .',
      'C6 - - B5 C6 - E6 - D6 - C6 - B5 - G5 -',
      'G#5 . A5 . B5 . D6 . E6 - - - B5 . G#5 .',
    ],
  },
  dragon: {
    title: 'ドラコ「ドラゴン・ハート」', bpm: 160, lead: 'saw2', leadVol: 0.03, echo: true, harm: -5,
    chords: ['Cm', 'Ab', 'Bb', 'G'], bass: 'drive', arp: null,
    mel: [
      'C5 - - G4 C5 . Eb5 . G5 - - F5 Eb5 . D5 .',
      'Eb5 - - C5 Ab4 . C5 . Eb5 - - D5 C5 . Bb4 .',
      'Bb4 - - D5 F5 . Bb5 . Ab5 - - G5 F5 . D5 .',
      'G5 - - - B4 - - - D5 . F5 . G5 . B5 .',
    ],
    gtr: 'X - - - X - - - X - - x X . x .',
    drm: 'k . h . s . h . k k h . s . h h',
    // --- Bメロ ---
    chordsB: ['Fm', 'Cm', 'Ab', 'G'],
    melB: [
      'F5 - - - Ab5 - - - C6 - - Bb5 Ab5 - G5 -',
      'Eb5 - - - G5 - - - C6 - - Bb5 G5 - Eb5 -',
      'Ab5 - - G5 Ab5 - C6 - Eb6 - - - D6 - C6 -',
      'B5 - - - G5 - - - D6 - - - F6 . G6 .',
    ],
  },
  mage: {
    title: 'ライデン「サンダー・ストライク」', bpm: 190, lead: 'pulse12', leadVol: 0.05, harm: -5,
    chords: ['F#m', 'D', 'E', 'C#'], bass: 'rock16', arp: null,
    mel: [
      'F#5 F#5 . A5 . F#5 C#6 . B5 . A5 . G#5 . F#5 .',
      'D5 D5 . F#5 . D5 A5 . G#5 . F#5 . E5 . D5 .',
      'E5 E5 . G#5 . E5 B5 . A5 . G#5 . F#5 . E5 .',
      'C#5 . F5 . G#5 . C#6 . B5 . G#5 . F5 . C#5 .',
    ],
    gtr: 'x x x x X . x x x x x x X . x x',
    drm: 'k h s h k h s h k h s h k h s h',
    // --- Bメロ ---
    chordsB: ['Bm', 'E', 'A', 'C#'],
    melB: [
      'D6 . C#6 . B5 . F#5 . D6 . C#6 . B5 . D6 .',
      'B5 . A5 . G#5 . E5 . B5 . A5 . G#5 . B5 .',
      'C#6 . B5 . A5 . E5 . C#6 . E6 . A6 . E6 .',
      'F6 - - - C#6 - - - G#5 . F5 . C#5 . F5 .',
    ],
  },
  // ===== STAGE 4 =====
  robot: {
    title: 'ギアロイド「メタル・プロトコル」', bpm: 144, lead: 'square', leadVol: 0.04, harm: -12,
    chords: ['Cm', 'Cm', 'Ab', 'G'], bass: 'syncop', arp: 'square', arpOct: 5,
    mel: [
      'C5 . . C5 . . Eb5 . . C5 . . G5 . F5 .',
      'C5 . . C5 . . Eb5 . . G5 . . Bb5 . G5 .',
      'Ab5 . . Ab5 . . G5 . . F5 . . Eb5 . C5 .',
      'B4 . D5 . F5 . G5 . B5 . D6 . B5 . G5 .',
    ],
    gtr: 'X . . X . . X . . X . . X . X .',
    drm: 'k . h k s . h . k . h k s k h .',
    // --- Bメロ ---
    chordsB: ['Fm', 'Ab', 'Eb', 'G'],
    melB: [
      'F5 . F5 . Ab5 . F5 . C6 . Ab5 . F5 . Ab5 .',
      'Ab5 . Ab5 . C6 . Ab5 . Eb6 . C6 . Ab5 . C6 .',
      'G5 . G5 . Bb5 . G5 . Eb6 . Bb5 . G5 . Eb5 .',
      'D6 . B5 . G5 . D5 . F5 . G5 . B5 . D6 .',
    ],
  },
  mirror: {
    title: 'ミラージュ「クリスタル・ミラージュ」', bpm: 150, lead: 'pulse12', leadVol: 0.05, echo: true, harm: -5,
    chords: ['Dm', 'Bb', 'Gm', 'A'], bass: 'drive', arp: 'square', arpOct: 5,
    mel: [
      'D6 . A5 . F5 . A5 . D6 . E6 . F6 . E6 .',
      'D6 . Bb5 . F5 . Bb5 . D6 . C6 . Bb5 . A5 .',
      'G5 . Bb5 . D6 . Bb5 . G5 . A5 . Bb5 . D6 .',
      'C#6 . A5 . E5 . A5 . C#6 . E6 . A6 . E6 .',
    ],
    gtr: '. . . . X - - - . . . . X - x .',
    drm: 'k . h . s . h . k . h . s . h h',
    // --- Bメロ ---
    chordsB: ['F', 'C', 'Bb', 'A'],
    gtrB: 'X - - - - - - - X - - - X - x x',
    melB: [
      'A5 - - - C6 - - - F6 - - - E6 - C6 -',
      'G5 - - - C6 - - - E6 - - - D6 - C6 -',
      'D6 - - - F6 - - - D6 - Bb5 - F5 - D5 -',
      'E5 - - - A5 - - - C#6 - - - E6 - - -',
    ],
  },
  clown: {
    title: 'ピエロット「マッド・カーニバル」', bpm: 188, lead: 'square', leadVol: 0.04, harm: -5,
    chords: ['Em', 'Am', 'B', 'Em'], bass: 'oompah', arp: null,
    mel: [
      'E5 D#5 E5 . G5 . B5 . A#5 B5 . G5 . E5 . .',
      'A5 G#5 A5 . C6 . E6 . D#6 E6 . C6 . A5 . .',
      'B5 A#5 B5 . F#5 . D#5 . F#5 . B5 . A5 . F#5 .',
      'E5 . G5 . B5 . E6 . B5 . G5 . E5 . . .',
    ],
    gtr: 'X . x . X . x . X . x . X . x .',
    drm: 'k . s . k . s h k . s . k h s s',
    // --- Bメロ ---
    chordsB: ['C', 'G', 'Am', 'B'],
    melB: [
      'G5 F#5 G5 . E5 . C5 . E5 . G5 . C6 . . .',
      'B5 A#5 B5 . G5 . D5 . G5 . B5 . D6 . . .',
      'C6 B5 C6 . A5 . E5 . A5 . C6 . E6 . D#6 .',
      'D#6 . B5 . F#5 . D#5 . F#5 . A5 . B5 . . .',
    ],
  },
  // ===== STAGE 5 =====
  king: {
    title: 'ソウルキング「キング・オブ・ソウルズ」', bpm: 172, lead: 'saw2', leadVol: 0.032, echo: true, harm: -5,
    chords: ['Bm', 'G', 'A', 'F#'], bass: 'rock16', arp: 'square', arpOct: 5,
    mel: [
      'B4 . F#5 . B5 - - A5 B5 . D6 . C#6 . A5 .',
      'G5 . D5 . G5 - - F#5 G5 . B5 . A5 . F#5 .',
      'A5 . E5 . A5 - - G#5 A5 . C#6 . E6 . C#6 .',
      'A#5 . C#6 . F#6 - - E6 C#6 . A#5 . F#5 . C#5 .',
    ],
    gtr: 'X . x x X . x x X . x x X x x x',
    drm: 'k h s h k k s h k h s h k k s s',
    // --- Bメロ ---
    chordsB: ['Em', 'D', 'G', 'F#'],
    melB: [
      'G5 - - F#5 E5 - - D5 E5 - G5 - B5 - E6 -',
      'F#5 - - E5 D5 - - C#5 D5 - F#5 - A5 - D6 -',
      'B5 - - A5 G5 - - F#5 G5 - B5 - D6 - G6 -',
      'F#6 - - - E6 - - - C#6 - - - A#5 - - -',
    ],
  },
  angel: {
    title: 'ルシエル「フォールン・レクイエム」', bpm: 148, lead: 'saw2', leadVol: 0.03, vib: 5, echo: true, harm: -5,
    chords: ['F#m', 'D', 'E', 'C#'], bass: 'drive', arp: 'triangle', arpOct: 5,
    mel: [
      'F#5 - - - C#6 - A5 - F#5 - E5 - F#5 - A5 -',
      'D6 - - - A5 - F#5 - D5 - E5 - F#5 - A5 -',
      'E6 - - - B5 - G#5 - E5 - F#5 - G#5 - B5 -',
      'C#6 - - - G#5 - F5 - C#5 - - - - - - -',
    ],
    gtr: 'X . . x . . X . . x . . X . x x',
    drm: 'k . h . s . h k k . h . s . h h',
    // --- Bメロ ---
    chordsB: ['Bm', 'A', 'D', 'C#'],
    melB: [
      'D6 - - - C#6 - - - B5 - A5 - F#5 - D5 -',
      'C#6 - - - B5 - - - A5 - E5 - C#5 - E5 -',
      'F#5 - - - A5 - - - D6 - - - F#6 - - -',
      'F6 - - - - - - - C#6 - - - G#5 - - -',
    ],
  },
  void: {
    title: 'ヴォイド「アビス」', bpm: 120, lead: 'saw2', leadVol: 0.028, vib: 3, echo: true, harm: -6,
    chords: ['Cm', 'Db', 'Cm', 'Gb'], bass: 'halftime', arp: 'triangle', arpOct: 4,
    mel: [
      'C5 . . . Db5 . . . C5 . . . G4 . . .',
      'Db5 . . . F5 . . . Ab5 - - - G5 . . .',
      'C5 . Eb5 . G5 . C6 . B5 . G5 . Eb5 . C5 .',
      'Gb5 - - - F5 - - - Eb5 - - - Db5 - - -',
    ],
    gtr: 'X - - - - - x x X - - - - - x x',
    drm: 'k . . . . . . . s . . . . . k .',
    // --- Bメロ ---
    chordsB: ['Ab', 'Db', 'Gb', 'G'],
    melB: [
      'Eb5 - - - C5 - - - Ab4 - - - C5 - Eb5 -',
      'F5 - - - Db5 - - - Ab4 - - - Db5 - F5 -',
      'Gb5 - - - Db5 - - - Bb4 - - - Db5 - Gb5 -',
      'G5 - - - B4 - - - D5 - - - F5 . G5 .',
    ],
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
  return { root, tones: q.map(i => root + i), fifth: m[3] === 'dim' ? 6 : m[3] === '+' ? 8 : 7 };
}
const toks = (str) => { const t = str.trim().split(/\s+/).slice(0, 16); while (t.length < 16) t.push('.'); return t; };

// 曲データを「ステップごとの発音リスト」に変換
const GTR_B = 'X - - x X - - x X - - x X . x x'; // Bメロ標準：伸ばし気味のパワーコード
function compile(song) {
  const melA = song.mel, melB = song.melB || [];
  const barsA = melA.length, bars = barsA + melB.length, steps = bars * 16;
  const chords = [...song.chords, ...(song.chordsB || [])];
  const mt = [...melA, ...melB].flatMap(toks);
  const lead = new Array(steps).fill(null);
  for (let i = 0; i < steps; i++) {
    const midi = midiOf(mt[i]);
    if (midi == null) continue;
    let len = 1;
    while (i + len < steps && mt[i + len] === '-') len++;
    lead[i] = { midi, len };
  }
  const gtA = toks(song.gtr), gtB = toks(song.gtrB || GTR_B);
  const dmA = toks(song.drm), dmB = toks(song.drmB || song.drm);
  const bass = new Array(steps).fill(null), gtr = new Array(steps).fill(null), arp = new Array(steps).fill(null), drm = new Array(steps).fill('.');
  for (let b = 0; b < bars; b++) {
    const isB = b >= barsA, gt = isB ? gtB : gtA, dm = isB ? dmB : dmA;
    const ch = chordOf(chords[b % chords.length]);
    const r1 = 28 + ((ch.root + 8) % 12), r2 = r1 + 12; // ベースは E1〜D#2 あたりに収める
    for (let s = 0; s < 16; s++) {
      const i = b * 16 + s;
      let n = null;
      switch (song.bass) {
        case 'drive': if (s % 2 === 0) n = { midi: s === 14 ? r2 : r1, len: 2 }; break;
        case 'rock16': n = { midi: s % 8 === 6 ? r2 : r1, len: 1, acc: s % 4 === 0 }; break;
        case 'syncop': if ([0, 3, 6, 8, 11, 14].includes(s)) n = { midi: s === 6 || s === 14 ? r2 : r1, len: 2 }; break;
        case 'oompah': if (s % 4 === 0) n = { midi: r1, len: 1 }; else if (s % 4 === 2) n = { midi: r1 + ch.fifth + 12, len: 1 }; break;
        case 'halftime': if (s === 0) n = { midi: r1, len: 6 }; else if (s === 6 || s === 7) n = { midi: r1, len: 1 }; else if (s === 10) n = { midi: r1 + 1, len: 6 }; break;
      }
      bass[i] = n;
      drm[i] = dm[s];
      // ギター（パワーコード＝ルート+5度+オクターブ）
      const g = gt[s];
      if (g === 'X' || g === 'x') {
        let len = 1;
        while (s + len < 16 && gt[s + len] === '-') len++;
        gtr[i] = { root: 40 + ((ch.root + 8) % 12), fifth: ch.fifth, len: g === 'X' ? Math.max(len, 2) : 1, hard: g === 'X' };
      }
      if (song.arp) {
        const oct = 12 * ((song.arpOct || 5) + 1);
        arp[i] = { midi: oct + ch.tones[s % 3] + (s % 6 >= 3 ? 12 : 0) };
      }
    }
  }
  return { steps, barsA, bars, lead, bass, gtr, arp, drm };
}

// ===== 演奏エンジン =====
let AC = null, master = null, noise = null, waves = null, shaperCurve = null;
let cur = null, timer = null, volume = 0.5;

function ensureOut(ac) {
  if (AC === ac && master) return;
  AC = ac;
  // マスター：コンプレッサーで音圧を上げる
  const comp = AC.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
  master = AC.createGain(); master.gain.value = volume;
  comp.connect(master).connect(AC.destination);
  master.input = comp;
  const len = AC.sampleRate * 1.2, buf = AC.createBuffer(1, len, AC.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noise = buf;
  // パルス波（デューティ比 12.5% / 25%）
  const pulse = (duty) => {
    const n = 64, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    return AC.createPeriodicWave(re, im);
  };
  waves = { pulse12: pulse(0.125), pulse25: pulse(0.25) };
  // ギター用の歪み
  shaperCurve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; shaperCurve[i] = Math.tanh(x * 6); }
}

function mkOsc(type, f, t) {
  const o = AC.createOscillator();
  if (waves[type]) o.setPeriodicWave(waves[type]); else o.type = type;
  o.frequency.setValueAtTime(f, t);
  return o;
}

function env(g, t, vol, dur, attack = 0.006) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.setValueAtTime(vol * 0.85, t + Math.max(attack + 0.005, dur * 0.7));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function leadNote(bus, t, midi, dur, song, vol) {
  const f = freqOf(midi), g = AC.createGain();
  const types = song.lead === 'saw2' ? [['sawtooth', -9], ['sawtooth', 9]] : [[song.lead, 0]];
  for (const [type, cents] of types) {
    const o = mkOsc(type, f, t);
    o.detune.value = cents;
    if (song.vib) {
      const l = AC.createOscillator(), lg = AC.createGain();
      l.frequency.value = song.vib; lg.gain.value = 18; // セント単位のビブラート
      l.connect(lg).connect(o.detune); l.start(t + 0.12); l.stop(t + dur + 0.05);
    }
    o.connect(g); o.start(t); o.stop(t + dur + 0.03);
  }
  env(g, t, vol, dur);
  g.connect(bus.lead);
}

function bassNote(bus, t, midi, dur, acc) {
  const o = mkOsc('sawtooth', freqOf(midi), t), f = AC.createBiquadFilter(), g = AC.createGain();
  f.type = 'lowpass'; f.Q.value = 6;
  f.frequency.setValueAtTime(acc ? 1400 : 900, t); f.frequency.exponentialRampToValueAtTime(250, t + dur);
  env(g, t, 0.11, dur, 0.004);
  o.connect(f).connect(g).connect(bus.out); o.start(t); o.stop(t + dur + 0.03);
}

function gtrHit(bus, t, root, fifth, dur, hard) {
  const g = AC.createGain(), sh = AC.createWaveShaper(), lp = AC.createBiquadFilter(), pre = AC.createGain();
  sh.curve = shaperCurve; pre.gain.value = 1.2;
  lp.type = 'lowpass'; lp.frequency.value = hard ? 2600 : 1800;
  for (const [iv, det] of [[0, -6], [0, 6], [fifth, 0], [12, 0]]) {
    const o = mkOsc('sawtooth', freqOf(root + iv), t);
    o.detune.value = det;
    o.connect(pre); o.start(t); o.stop(t + dur + 0.03);
  }
  pre.connect(sh).connect(lp).connect(g).connect(bus.out);
  env(g, t, hard ? 0.05 : 0.04, dur, 0.003);
}

function drum(bus, t, k, accent) {
  const out = bus.out;
  if (k === 'k') {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.22);
  } else if (k === 't') {
    const f0 = typeof accent === 'number' && accent > 0 ? accent : 180;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.18);
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.22);
  } else {
    const P = {
      s: ['bandpass', 1900, 0.16, 0.16], h: ['highpass', 8000, 0.04, 0.035],
      o: ['highpass', 7000, 0.22, 0.04], c: ['highpass', 4500, 1.1, 0.07],
    }[k];
    if (!P) return;
    const src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
    src.buffer = noise;
    f.type = P[0]; f.frequency.value = P[1];
    g.gain.setValueAtTime(P[3] * (accent === true ? 1.3 : 1), t); g.gain.exponentialRampToValueAtTime(0.0001, t + P[2]);
    src.connect(f).connect(g).connect(out); src.start(t); src.stop(t + P[2] + 0.02);
    if (k === 's') { // スネアの胴鳴り
      const o = AC.createOscillator(), og = AC.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
      og.gain.setValueAtTime(0.12, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(og).connect(out); o.start(t); o.stop(t + 0.12);
    }
  }
}

// 曲ごとの出力バス（リード用のエコー付き）
function makeBus(song, stepDur) {
  const out = AC.createGain(); out.gain.value = 1; out.connect(master.input);
  const lead = AC.createGain(); lead.connect(out);
  if (song.echo) {
    const d = AC.createDelay(1), fb = AC.createGain(), wet = AC.createGain();
    d.delayTime.value = Math.min(0.9, stepDur * 3); fb.gain.value = 0.3; wet.gain.value = 0.28;
    lead.connect(d); d.connect(fb).connect(d); d.connect(wet).connect(out);
  }
  return { out, lead };
}

const FILL_TOM = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 220, 0, 160, 0];

function schedule(horizon) {
  if (!cur || !AC) return;
  const { song, data } = cur;
  const until = horizon ?? AC.currentTime + 0.15;
  while (cur.nextT < until) {
    const i = cur.step % data.steps, loop = Math.floor(cur.step / data.steps), bar = Math.floor(i / 16), s = i % 16;
    if (s === 0 && cur.pending) { cur.phase = cur.pending; cur.pending = 0; } // 形態変化は小節の頭で
    const p2 = cur.phase === 2, tr = p2 ? 1 : 0;           // 第2形態は半音上へ転調
    const stepDur = 60 / (song.bpm * (p2 ? 1.12 : 1)) / 4;   // 16分音符の長さ（第2形態はテンポアップ）
    const t = cur.nextT, bus = cur.bus;
    // メロディ（偶数ループはハモリを重ねる）
    const L = data.lead[i];
    if (L) {
      const dur = L.len * stepDur * (song.stacc ? 0.5 : 0.92);
      leadNote(bus, t, L.midi + tr, dur, song, song.leadVol);
      if (song.harm && (bar >= data.barsA || loop % 2 === 1)) leadNote(bus, t, L.midi + tr + song.harm, dur, song, song.leadVol * 0.55);
    }
    const B = data.bass[i];
    if (B) bassNote(bus, t, B.midi + tr, B.len * stepDur * 0.9, B.acc);
    const Gt = data.gtr[i];
    if (Gt) gtrHit(bus, t, Gt.root + tr, Gt.fifth, Gt.len * stepDur * (Gt.hard ? 0.95 : 0.55), Gt.hard);
    const A = data.arp[i];
    if (A) leadNote(bus, t, A.midi + tr, stepDur * 0.7, { lead: song.arp === 'square' ? 'pulse25' : 'triangle' }, song.arp === 'square' ? 0.012 : 0.03);
    // ドラム：A・Bの頭でクラッシュ。Bへ入る直前（2周目以降）と曲の最後の小節の後半はフィル
    const fill = s >= 12 && (bar === data.bars - 1 || (bar === data.barsA - 1 && loop % 2 === 1));
    if (s === 0 && (bar === 0 || bar === data.barsA)) drum(bus, t, 'c');
    if (fill) { drum(bus, t, s % 2 ? 's' : 't', FILL_TOM[s]); if (s === 12) drum(bus, t, 'k'); }
    else { const d = data.drm[i]; if (d && d !== '.') drum(bus, t, d, s % 4 === 0); }
    cur.nextT += stepDur;
    cur.step++;
  }
}

function stop(fade = 0.4) {
  if (!cur) return;
  const old = cur.bus;
  cur = null;
  clearInterval(timer); timer = null;
  if (old && AC) { // フェードアウトしてから切り離す
    old.out.gain.setTargetAtTime(0.0001, AC.currentTime, fade / 3);
    setTimeout(() => { try { old.out.disconnect(); } catch {} }, fade * 1000 + 300);
  }
}

function play(key, phase) {
  const song = SONGS[key];
  if (!song) return stop();
  cur = { key, song, data: compile(song), step: 0, nextT: AC.currentTime + 0.1, phase, bus: makeBus(song, 60 / song.bpm / 4) };
  clearInterval(timer);
  timer = setInterval(() => schedule(), 25);
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
  if (master && AC) master.gain.setTargetAtTime(volume, AC.currentTime, 0.05);
}

// 検証用：曲をオフラインで書き出して音量を測る（スピーカー不要）
async function render(key, seconds = 4, phase = 1, startBar = 0) {
  const saved = { AC, master, noise, waves, shaperCurve, cur, timer };
  const off = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
  AC = null; master = null; ensureOut(off);
  const song = SONGS[key];
  cur = { key, song, data: compile(song), step: startBar * 16, nextT: 0.05, phase, bus: makeBus(song, 60 / song.bpm / 4) };
  schedule(seconds);
  ({ AC, master, noise, waves, shaperCurve, cur, timer } = saved);
  return off.startRendering();
}

window.SBMusic = { update, setVolume, stop, render, songs: Object.keys(SONGS).map(k => ({ key: k, title: SONGS[k].title })) };
})();
