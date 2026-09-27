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

// ===== 難易度（全モード共通） =====
// speed: 弾速 / dens: 弾の数 / gap: 攻撃の間隔 / dmg: 被ダメージ / bossHp: ボスHP / iframe: 被弾後の無敵 ms / item: アイテム出現間隔
const DIFFS = [
  { name: '簡単', speed: 0.75, dens: 0.6, gap: 1.45, dmg: 2, bossHp: 0.7, iframe: 1300, item: 0.7 },
  { name: '普通', speed: 1.0, dens: 1.0, gap: 1.0, dmg: 3, bossHp: 1.0, iframe: 1000, item: 1.0 },
  { name: '難しい', speed: 1.15, dens: 1.3, gap: 0.85, dmg: 4, bossHp: 1.3, iframe: 1000, item: 1.2 },
  { name: '鬼', speed: 1.3, dens: 1.6, gap: 0.7, dmg: 5, bossHp: 1.6, iframe: 850, item: 1.5 },
  { name: '神', speed: 1.5, dens: 2.0, gap: 0.55, dmg: 6, bossHp: 2.0, iframe: 700, item: 2.0, roam: true }, // roam: ボスがフィールド全体を動き回る
];

// ===== ゲーム定数（クライアントにも送る） =====
const C = {
  W: 480, H: 480,          // バトルボックスの論理サイズ
  SOUL_R: 6,               // ソウル（ハート）の当たり判定半径
  SPEED: 170,              // 移動速度 px/s
  MAX_HP: 20,
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
  SP_BOSS_HIT: 2,          // ボスに弾を当てたとき（1発ごと）
  SP_DAMAGED: 12,          // ダメージを受けたとき
  SP_GRAZE: 1,             // グレイズしたとき
  SP_WAVES: 2,             // 必殺技：全方位リングの波の数
  SP_RING: 20,             // 1波あたりの弾数
  SP_DMG: 5,
  SP_CLEAR_R: 120,         // 必殺技で周囲の敵弾を消す半径
  SP_INV: 1500,            // 必殺技発動時の無敵時間 ms
  HEAL: 6,
  MAX_PLAYERS: 8,
  SHRINK_START: 40000,     // 対戦開始からエリア縮小が始まるまで ms
  SHRINK_RATE: 3,          // 縮小速度（片側 px/s）
  SHRINK_MAX: 130,         // 最大縮小幅（片側 px）
  DIFFS,
};
const TICK = 50;              // 20Hz
const COUNTDOWN = 3000;
const RESULT_TIME = 6000;
const LOBBY_AUTO = 15000;     // 公開ルームの自動スタートまで
const STAGE_CLEAR_TIME = 3500;
const COLORS = ['#ff2d55', '#ffd60a', '#32d74b', '#64d2ff', '#bf5af2', '#ff9f0a', '#ff6ec7', '#ffffff'];

// 弾の種類
const K = { NORMAL: 0, BIG: 1, SHOT: 2, BLUE: 3, ORANGE: 4, SP: 5 };

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const W = C.W, H = C.H;

// ===== ストーリーモードのボス =====
// 各ステージに5体の候補がいて、ステージ開始時にランダムで1体が登場する
// move: ボスの動き（x = 中央 + sin(t*fx)*ax, y = y + sin(t*fy)*ay）
// patterns: 通常時の攻撃 / p2: HPが半分を切った後に追加される攻撃
const BOSSES = [
  // ---- STAGE 1 ----
  [
    {
      key: 'slime', name: 'スライミー', color: '#32d74b', hp: 260, r: 34,
      move: { ax: 130, fx: 0.55, ay: 14, fy: 1.3, y: 90 },
      intro: ['* スライミーが ぷるぷると あらわれた！', '* 「ぷるるん… ここは とおさないぞ！」'],
      phase2: '* スライミーは ふくれあがった！',
      defeat: '* スライミーは とけて きえていった…',
      patterns: [['bossDrip', 3], ['rain', 2], ['bossRing', 2]],
      p2: [['bossRing', 2], ['fountain', 2]],
    },
    {
      key: 'ghost', name: 'おばけのフワリン', color: '#f2f2f7', hp: 250, r: 32,
      move: { ax: 160, fx: 0.45, ay: 30, fy: 0.9, y: 100 },
      intro: ['* フワリンが ふわふわと ただよってきた…', '* 「うらめしや〜… なんちゃって」'],
      phase2: '* フワリンは すこし ほんきに なった！',
      defeat: '* フワリンは すうっと きえていった…',
      patterns: [['bossBoomerang', 3], ['rain', 2], ['bossAim', 1]],
      p2: [['bossRing', 2], ['ring', 2]],
    },
    {
      key: 'frog', name: 'カエルのピョンタ', color: '#a4e05a', hp: 270, r: 32,
      move: { ax: 170, fx: 0.8, ay: 34, fy: 2.4, y: 95 },
      intro: ['* ピョンタが ぴょこんと とびだした！', '* 「ケロケロ！ いっしょに あそぼうケロ！」'],
      phase2: '* ピョンタは ほっぺを ふくらませた！',
      defeat: '* ピョンタは いけに かえっていった…',
      patterns: [['fountain', 2], ['bossDrip', 2], ['ring', 2], ['bossAim', 1]],
      p2: [['bossBoomerang', 2], ['bossRing', 2]],
    },
    {
      key: 'mushroom', name: 'キノコのポコタ', color: '#ff6b6b', hp: 255, r: 32,
      move: { ax: 140, fx: 0.6, ay: 12, fy: 2.2, y: 92 },
      intro: ['* ポコタが ぽこっと はえてきた！', '* 「ほうしを すったら くしゃみが とまらないよ〜」'],
      phase2: '* ポコタの かさが まっかに ふくらんだ！',
      defeat: '* ポコタは しぼんで つちに かえった…',
      patterns: [['bossSnow', 2], ['bossDrip', 2], ['ring', 2]],
      p2: [['bossRing', 2], ['fountain', 2]],
    },
    {
      key: 'bat', name: 'コウモリのバッティ', color: '#9b59b6', hp: 245, r: 30,
      move: { ax: 190, fx: 1.0, ay: 34, fy: 2.0, y: 95 },
      intro: ['* バッティが ばさばさと とびまわる！', '* 「キキッ！ おまえの タマシイ あじみ させろ！」'],
      phase2: '* バッティの めが あかく ひかった！',
      defeat: '* バッティは よるの そらへ にげていった…',
      patterns: [['bossAim', 2], ['bossBoomerang', 2], ['rain', 2]],
      p2: [['bossWeb', 2], ['aimed', 2]],
    },
  ],
  // ---- STAGE 2 ----
  [
    {
      key: 'knight', name: 'ホネナイト', color: '#e5e5ea', hp: 340, r: 32,
      move: { ax: 150, fx: 0.4, ay: 10, fy: 0.9, y: 85 },
      intro: ['* ホネナイトが カタカタと たちはだかる！', '* 「青い骨は うごくな。オレンジは とまるな。わかったか？」'],
      phase2: '* ホネナイトの めが あやしく ひかった！',
      defeat: '* ホネナイトは ほねを おって たおれた…',
      patterns: [['bossBones', 3], ['sweep', 2], ['blueorange', 2]],
      p2: [['bossAim', 2], ['cross', 2]],
    },
    {
      key: 'spider', name: 'クモの女王アラク', color: '#af52de', hp: 330, r: 30,
      move: { ax: 150, fx: 0.3, ay: 40, fy: 0.6, y: 90 },
      intro: ['* クモの女王 アラクが いとを つたって おりてきた！', '* 「わたしの あみから にげられるかしら？」'],
      phase2: '* アラクは あみを はりめぐらせた！',
      defeat: '* アラクは いとを きって にげていった…',
      patterns: [['bossWeb', 3], ['aimed', 2], ['bossAim', 2]],
      p2: [['cross', 2], ['bossBoomerang', 2]],
    },
    {
      key: 'snowman', name: 'ユキダルマン', color: '#9fd8ff', hp: 350, r: 34,
      move: { ax: 120, fx: 0.35, ay: 8, fy: 1.0, y: 90 },
      intro: ['* ユキダルマンが ころころと ころがってきた！', '* 「さむいのは すきかい？ ぼくは だいすき！」'],
      phase2: '* ふぶきが つよく なってきた！',
      defeat: '* ユキダルマンは とけて みずたまりに なった…',
      patterns: [['bossSnow', 3], ['blueorange', 2], ['bossRing', 2]],
      p2: [['sweep', 2], ['bossBones', 2]],
    },
    {
      key: 'golem', name: '岩の巨人ガンセキ', color: '#a0826d', hp: 360, r: 36,
      move: { ax: 100, fx: 0.25, ay: 6, fy: 0.8, y: 88 },
      intro: ['* ガンセキが ずしんと たちあがった！', '* 「……オレ、カタイ。オマエ、ツブス」'],
      phase2: '* ガンセキの からだに ひびが はいった… おこっている！',
      defeat: '* ガンセキは くずれて ただの いしに なった…',
      patterns: [['bossQuake', 3], ['sweep', 2], ['bossBones', 2]],
      p2: [['cross', 2], ['bossRing', 2]],
    },
    {
      key: 'jelly', name: 'クラゲのゆらら', color: '#ff9ff3', hp: 330, r: 32,
      move: { ax: 130, fx: 0.35, ay: 36, fy: 0.7, y: 100 },
      intro: ['* ゆららが ゆらゆらと ただよってきた…', '* 「しびれるの… きもちいいよ…？」'],
      phase2: '* ゆららの しょくしゅが でんきを おびた！',
      defeat: '* ゆららは うみの そこへ しずんでいった…',
      patterns: [['bossDrip', 2], ['bossBoomerang', 2], ['blueorange', 2]],
      p2: [['bossSpiral', 2], ['bossThunder', 2]],
    },
  ],
  // ---- STAGE 3 ----
  [
    {
      key: 'witch', name: '炎の魔女ヒノカ', color: '#ff9f0a', hp: 420, r: 30,
      move: { ax: 160, fx: 0.7, ay: 24, fy: 1.1, y: 95 },
      intro: ['* 炎の魔女ヒノカが ほうきで まいおりた！', '* 「わたしの ほのおで まっくろこげに してあげる」'],
      phase2: '* ヒノカの ほのおが あおく もえあがる！',
      defeat: '* ヒノカは けむりに なって きえた…',
      patterns: [['bossSpiral', 3], ['fountain', 2], ['bossAim', 2]],
      p2: [['bossRing', 2], ['spiral', 2]],
    },
    {
      key: 'dragon', name: '子竜ドラコ', color: '#ff453a', hp: 440, r: 34,
      move: { ax: 170, fx: 0.5, ay: 18, fy: 1.4, y: 90 },
      intro: ['* 子竜ドラコが つばさを ひろげた！', '* 「ガオー！ ボクだって りっぱな ドラゴンだぞ！」'],
      phase2: '* ドラコの からだが まっかに もえている！',
      defeat: '* ドラコは そらの かなたへ とんでいった…',
      patterns: [['bossLaser', 2], ['fountain', 2], ['bossRing', 2]],
      p2: [['bossSpiral', 2], ['rain', 2]],
    },
    {
      key: 'mage', name: '雷の魔術師ライデン', color: '#ffd60a', hp: 410, r: 30,
      move: { ax: 180, fx: 0.9, ay: 12, fy: 1.8, y: 85 },
      intro: ['* 雷の魔術師ライデンが いなずまと ともに あらわれた！', '* 「ビリビリ しびれさせて やろう」'],
      phase2: '* ライデンの つえに かみなりが あつまる！',
      defeat: '* ライデンは でんきぎれで たおれた…',
      patterns: [['bossThunder', 3], ['aimed', 2], ['cross', 1]],
      p2: [['bossLaser', 2], ['bossAim', 2]],
    },
    {
      key: 'samurai', name: '亡霊武者カゲマル', color: '#c0392b', hp: 430, r: 32,
      move: { ax: 180, fx: 0.55, ay: 10, fy: 1.2, y: 88 },
      intro: ['* 亡霊武者カゲマルが しずかに かたなを ぬいた…', '* 「……いざ、じんじょうに しょうぶ」'],
      phase2: '* カゲマルの かたなが あかく もえあがる！',
      defeat: '* カゲマルは 「みごと…」と つぶやき きえた…',
      patterns: [['bossSlash', 3], ['bossAim', 2], ['sweep', 2]],
      p2: [['bossLaser', 2], ['cross', 2]],
    },
    {
      key: 'kraken', name: '深海のクラーケン', color: '#1abc9c', hp: 440, r: 36,
      move: { ax: 120, fx: 0.4, ay: 16, fy: 0.9, y: 95 },
      intro: ['* しんかいから クラーケンが うかびあがった！', '* 「ゴボゴボ… ひきずりこんで やる…」'],
      phase2: '* クラーケンは すみを はきだした！',
      defeat: '* クラーケンは ふかい うみへ かえっていった…',
      patterns: [['bossWeb', 2], ['fountain', 2], ['bossBoomerang', 2]],
      p2: [['bossSpiral', 2], ['bossDrip', 2]],
    },
  ],
  // ---- STAGE 4 ----
  [
    {
      key: 'robot', name: 'ギアロイド', color: '#64d2ff', hp: 500, r: 33,
      move: { ax: 170, fx: 0.35, ay: 6, fy: 2.0, y: 80 },
      intro: ['* きかいにんぎょう ギアロイドが きどうした！', '* 「ハイジョ… ハイジョ… ハイジョ…」'],
      phase2: '* ギアロイドは オーバーヒート している！',
      defeat: '* ギアロイドは ばくはつして ていしした…',
      patterns: [['bossLaser', 3], ['aimed', 2], ['sweep', 2]],
      p2: [['bossSpiral', 2], ['cross', 2]],
    },
    {
      key: 'mirror', name: '鏡の精ミラージュ', color: '#5ac8fa', hp: 490, r: 32,
      move: { ax: 190, fx: 0.6, ay: 20, fy: 0.7, y: 95 },
      intro: ['* 鏡の精ミラージュが きらめいた！', '* 「あなたの こうげき そのまま かえしてあげる」'],
      phase2: '* ミラージュは なんまいにも わかれて みえる！',
      defeat: '* ミラージュは こなごなに くだけちった…',
      patterns: [['bossBoomerang', 3], ['bossSpiral', 2], ['ring', 2]],
      p2: [['bossRing', 2], ['sweep', 2]],
    },
    {
      key: 'clown', name: '道化師ピエロット', color: '#ff375f', hp: 510, r: 32,
      move: { ax: 160, fx: 1.1, ay: 36, fy: 2.2, y: 100 },
      intro: ['* 道化師ピエロットが おじぎを した！', '* 「さあさあ ショーの はじまりだよ〜！」'],
      phase2: '* ピエロットは ジャグリングを はやめた！',
      defeat: '* ピエロットは はくしゅの なか きえていった…',
      patterns: [['bossDrip', 2], ['blueorange', 2], ['bossBones', 2], ['bossWeb', 1]],
      p2: [['bossThunder', 2], ['fountain', 2]],
    },
    {
      key: 'ufo', name: '宇宙船ゼータ', color: '#7bed9f', hp: 500, r: 34,
      move: { ax: 200, fx: 0.7, ay: 20, fy: 1.5, y: 85 },
      intro: ['* そらから うちゅうせん ゼータが おりてきた！', '* 「ピピピ… チキュウジン ノ タマシイ ヲ サンプリング スル」'],
      phase2: '* ゼータは けいかい モードに きりかわった！',
      defeat: '* ゼータは ほしの かなたへ とびさった…',
      patterns: [['bossLaser', 2], ['bossThunder', 2], ['bossRing', 2]],
      p2: [['bossSlash', 2], ['spiral', 2]],
    },
    {
      key: 'puppet', name: '人形師マリオネ', color: '#e056fd', hp: 490, r: 32,
      move: { ax: 170, fx: 0.8, ay: 26, fy: 1.6, y: 95 },
      intro: ['* にんぎょうし マリオネが いとを たらした…', '* 「あなたも わたしの おにんぎょうに なりなさい」'],
      phase2: '* マリオネの いとが ぜんぶ ほどけた！',
      defeat: '* マリオネは いとが きれて くずれおちた…',
      patterns: [['bossWeb', 2], ['bossBones', 2], ['blueorange', 2]],
      p2: [['bossBoomerang', 2], ['cross', 2]],
    },
  ],
  // ---- STAGE 5 ----
  [
    {
      key: 'king', name: '魂の王ソウルキング', color: '#bf5af2', hp: 650, r: 38,
      move: { ax: 140, fx: 0.5, ay: 20, fy: 0.8, y: 95 },
      intro: ['* 魂の王 ソウルキングが すがたを あらわした！', '* 「ここまで きたか… おまえたちの タマシイ いただこう」'],
      phase2: '* ソウルキングは ほんきを だした！',
      defeat: '* ソウルキングは ひかりに なって きえた… きみたちの かちだ！',
      patterns: [['bossRing', 2], ['bossLaser', 2], ['bossSpiral', 2], ['bossBones', 2]],
      p2: [['bossDrip', 2], ['blueorange', 2], ['cross', 2]],
    },
    {
      key: 'angel', name: '堕天使ルシエル', color: '#ffe08a', hp: 640, r: 34,
      move: { ax: 150, fx: 0.4, ay: 28, fy: 0.6, y: 100 },
      intro: ['* 堕天使ルシエルが まいおりた…', '* 「すべての タマシイは わたしの もとへ かえるのです」'],
      phase2: '* ルシエルの はねが くろく そまった！',
      defeat: '* ルシエルは ひかりの はねを のこして きえた… きみたちの かちだ！',
      patterns: [['bossThunder', 2], ['bossRing', 2], ['bossSnow', 2], ['bossLaser', 2]],
      p2: [['bossSpiral', 2], ['bossBoomerang', 2], ['cross', 2]],
    },
    {
      key: 'void', name: '虚無の眼ヴォイド', color: '#8e8e93', hp: 660, r: 38,
      move: { ax: 110, fx: 0.3, ay: 16, fy: 0.5, y: 100 },
      intro: ['* …なにも ない ばしょに めが ひらいた。', '* 「……………………ミテイル」'],
      phase2: '* ヴォイドの めが あかく そまった！',
      defeat: '* ヴォイドは とじて やみに かえった… きみたちの かちだ！',
      patterns: [['bossWeb', 2], ['bossBoomerang', 2], ['bossBones', 2], ['bossLaser', 2]],
      p2: [['bossThunder', 2], ['bossSpiral', 2], ['blueorange', 2]],
    },
    {
      key: 'dragonking', name: '竜王バハムル', color: '#ff7f50', hp: 670, r: 40,
      move: { ax: 130, fx: 0.4, ay: 18, fy: 0.7, y: 100 },
      intro: ['* 竜王バハムルが ほのおの なかから あらわれた！', '* 「ちいさき タマシイよ… わが ほのおで やきつくしてくれよう」'],
      phase2: '* バハムルは おうじゃの ほうこうを あげた！',
      defeat: '* バハムルは 「みとめよう…」と いい そらへ かえった… きみたちの かちだ！',
      patterns: [['bossLaser', 2], ['fountain', 2], ['bossSlash', 2], ['bossRing', 2]],
      p2: [['bossSpiral', 2], ['bossThunder', 2], ['cross', 2]],
    },
    {
      key: 'timekeeper', name: '時の番人クロノス', color: '#f5cd79', hp: 650, r: 38,
      move: { ax: 90, fx: 0.3, ay: 10, fy: 0.5, y: 100 },
      intro: ['* 時の番人クロノスが とけいの はりを まわした…', '* 「きみたちの じかんは ここで おわりだ」'],
      phase2: '* クロノスの はりが ぎゃくまわりを はじめた！',
      defeat: '* クロノスは とまった とけいと ともに きえた… きみたちの かちだ！',
      patterns: [['bossClock', 3], ['bossBoomerang', 2], ['bossWeb', 2]],
      p2: [['bossSlash', 2], ['bossLaser', 2], ['blueorange', 2]],
    },
  ],
];

// ===== ストーリー後半ステージの強化 =====
// d: 攻撃の強さ（弾数・弾速）の上乗せ / gap: 攻撃の間隔の倍率 / layer: 別の攻撃を重ねる確率 [第1形態, 第2形態]
// hp: ボスHPの倍率 / move: ボスの移動速度の倍率 / press: 攻撃の合間に端から飛んでくる自機狙い弾の間隔 ms [第1, 第2]
// rage: HP25%以下で「最後のあがき」（必ず2つ重ね＋50%で3つ目、さらに速く）
// heal: 回復アイテムの出現量の倍率（2 = 2倍）
const STAGE_BOOST = [
  null, null, null,
  { d: 0.6, gap: 0.7, layer: [0.3, 0.55], hp: 1.1, move: 1.15, press: [2600, 1900], rage: false }, // STAGE 4
  { d: 1.2, gap: 0.5, layer: [0.6, 0.9], hp: 1.25, move: 1.3, press: [1800, 1300], rage: true, heal: 2 }, // STAGE 5
];

let highScores = []; // ソロ生存時間のトップ10（メモリ保持。サーバー再起動でリセット）
function submitScore(name, ms, diff) {
  highScores.push({ name, ms, diff: DIFFS[diff].name, at: Date.now() });
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
  constructor(id, isPublic, game) {
    this.id = id;
    this.isPublic = isPublic;
    this.players = new Map();
    this.bullets = new Map(); // id -> {owner, kind, expire}  当たり報告の検証用
    this.pshots = [];         // ストーリー用：プレイヤー弾の軌道（ボスへの当たりをサーバーで判定）
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
    this.cfg = { game: game === 'story' ? 'story' : 'battle', diff: 1 };
    this.storyStage = 0;      // ストーリーのチェックポイント（全滅したらこのボスから再開）
    this.boss = null;
    this.result = null;
    this.emptySince = 0;
  }

  get dp() { return DIFFS[this.cfg.diff]; }
  dn(n) { return Math.max(1, Math.round(n * this.dp.dens)); } // 難易度で弾数を増減

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
      kills: saved ? saved.kills : 0, wins: saved ? saved.wins : 0, grazes: 0, roundKills: 0, dmgDealt: 0,
      deathAt: 0, lastPosAt: Date.now(), grazeWindow: [],
      ready: false, spectating: false,
    };
    this.players.set(socket.id, p);
    socket.join(this.id);
    if (!this.isPublic && (!this.hostId || (saved && saved.host && !this.players.has(this.hostId)))) this.hostId = p.id;
    if (this.state === 'countdown') {
      // カウントダウン中の参加は次のラウンドに間に合う
      p.x = rand(60, C.W - 60); p.y = rand(240, C.H - 60);
      p.hp = C.MAX_HP; p.alive = true;
      if (this.mode === 'solo' && this.players.size >= 2) this.mode = 'versus';
      this.emit('round', { round: this.round, mode: this.mode });
    } else if (this.state === 'play') {
      // 試合中の途中参加は観戦。次の試合（ストーリーなら次のボス）から参戦
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

  // ホストがロビーでモード・難易度を変更
  setConfig(p, d) {
    if (this.isPublic || p.id !== this.hostId || this.state !== 'lobby' || !d) return;
    if (d.game === 'battle' || d.game === 'story') this.cfg.game = d.game;
    if (Number.isInteger(d.diff) && d.diff >= 0 && d.diff < DIFFS.length) this.cfg.diff = d.diff;
    if (d.restart) this.storyStage = 0;
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
    this.pshots = [];
    this.items = [];
    this.boss = null;
    const list = [...this.players.values()];
    this.mode = this.cfg.game === 'story' ? 'story' : list.length >= 2 ? 'versus' : 'solo';
    list.forEach((p, i) => {
      if (this.mode === 'story') {
        // ボスは上にいるので、下側に横一列で並ぶ
        p.x = C.W / 2 + (i - (list.length - 1) / 2) * 44; p.y = C.H - 90;
      } else {
        // 円形に並べて配置
        const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
        const rr = list.length > 1 ? 120 : 0;
        p.x = C.W / 2 + Math.cos(a) * rr;
        p.y = C.H / 2 + Math.sin(a) * rr;
      }
      p.hp = C.MAX_HP; p.alive = true; p.iframeUntil = 0; p.cdUntil = 0;
      p.grazes = 0; p.roundKills = 0; p.dmgDealt = 0; p.deathAt = 0; p.sp = 0;
      p.ready = false; p.spectating = false;
    });
    this.emit('round', { round: this.round, mode: this.mode, stage: this.storyStage });
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
    this.nextItem = now + 7000 * this.dp.item;
    if (this.mode === 'story') this.startStage(now);
  }

  // ===== ストーリー：ボス戦 =====
  startStage(now) {
    const def = pick(BOSSES[this.storyStage]); // 候補5体からランダム
    const n = Math.max(1, [...this.players.values()].length);
    const boost = STAGE_BOOST[this.storyStage] || null;
    const hp = Math.round(def.hp * this.dp.bossHp * (0.6 + 0.4 * n) * (boost ? boost.hp : 1)); // 人数が多いほどボスも硬い。後半ステージはさらに上乗せ
    this.lastBossName = def.name;
    this.boss = { def, hp, max: hp, boost, rage: false, nextPress: now + 4000, t0: now, phase: 1, x: W / 2, y: def.move.y, flashUntil: 0, deadAt: 0, stageStart: now };
    // 脱落者・途中参加者も復活し、全員全回復して次のボスへ
    const list = [...this.players.values()];
    list.forEach((p, i) => {
      if (!p.alive) { p.x = C.W / 2 + (i - (list.length - 1) / 2) * 44; p.y = C.H - 90; p.deathAt = 0; }
      p.alive = true; p.spectating = false; p.hp = C.MAX_HP; p.iframeUntil = now + 1500;
    });
    this.pshots = [];
    this.nextPattern = now + 3200; // 登場セリフの間は攻撃しない
    this.nextPatternStart = this.nextPattern;
    this.nextExtraHeal = 0;
    this.talk(def.intro[0], 1600, now);
    setTimeout(() => { if (this.boss && this.boss.def === def && !this.boss.deadAt) this.talk(def.intro[1], 1800, Date.now()); }, 1600);
    this.emit('stage', { stage: this.storyStage, total: BOSSES.length, name: def.name });
    this.sendRoster();
  }

  talk(text, ms, now) { this.emit('talk', { text, until: now + ms }); }

  bossPos(now) {
    const m = this.boss.def.move, t = (now - this.boss.t0) / 1000;
    const k = (this.boss.phase === 2 ? 1.4 : 1) * (this.boss.boost ? this.boss.boost.move : 1) * (this.boss.rage ? 1.2 : 1); // 後半ステージ・最後のあがきは速い
    const x = W / 2 + Math.sin(t * m.fx * k) * m.ax, y = m.y + Math.sin(t * m.fy * k) * m.ay;
    if (!this.dp.roam) return { x, y };
    // 難易度「神」：8の字（リサージュ曲線）でフィールド全体を動き回る。
    // 登場セリフの間はいつもの位置にいて、そこから2秒かけて動き出す
    const R = this.boss.def.r, ph = m.fx * 7; // ボスごとに軌道をずらす
    const rx = W / 2 + Math.sin(t * 0.5 * k + ph) * (W / 2 - R - 12);
    const ry = H / 2 + Math.sin(t * 0.8 * k + ph * 0.7) * (H / 2 - R - 20);
    const f = clamp((t - 2.8) / 2, 0, 1), e = f * f * (3 - 2 * f);
    return { x: x + (rx - x) * e, y: y + (ry - y) * e };
  }

  tickBoss(now) {
    const b = this.boss;
    if (!b) return;
    if (b.deadAt) {
      if (now - b.deadAt >= STAGE_CLEAR_TIME) {
        if (this.storyStage >= BOSSES.length - 1) { this.endRound(now, true); return; }
        this.storyStage++;
        this.startStage(now);
      }
      return;
    }
    Object.assign(b, this.bossPos(now));
    // プレイヤー弾とボスの当たり判定（弾の軌道はサーバーも知っている）
    const r = b.def.r;
    const hitIds = [];
    this.pshots = this.pshots.filter(s => {
      const t = (now - s.t0) / 1000;
      if (t * 1000 > s.life) return false;
      if (t < 0) return true;
      const x = s.x + s.vx * t, y = s.y + s.vy * t;
      if (Math.hypot(x - b.x, y - b.y) < r + s.r) {
        const dmg = s.kind === K.SP ? C.SP_DMG : C.SHOT_DMG;
        b.hp -= dmg;
        const owner = this.players.get(s.owner);
        if (owner) { owner.dmgDealt += dmg; this.addSp(owner, C.SP_BOSS_HIT); }
        hitIds.push(s.id);
        return false;
      }
      return true;
    });
    if (hitIds.length) { b.flashUntil = now + 120; this.emit('bx', hitIds); }
    if (b.phase === 1 && b.hp <= b.max / 2) {
      b.phase = 2;
      this.talk(b.def.phase2, 2000, now);
    }
    const bo = b.boost;
    if (bo && bo.rage && !b.rage && b.hp > 0 && b.hp <= b.max / 4) {
      // 最終ステージ：HP25%以下で「最後のあがき」。攻撃がさらに重なり、動きも速くなる
      b.rage = true;
      this.talk(`* ${b.def.name}は さいごの ちからを ふりしぼった！`, 2200, now);
      this.emit('fx', { t: 'rage', x: b.x, y: b.y, color: b.def.color });
    }
    if (bo && !b.deadAt && now >= b.nextPress && now >= this.nextPatternStart) {
      // 後半ステージ：攻撃の合間も、フィールドの端から自機狙い弾が飛んでくる
      b.nextPress = now + (b.rage ? 900 : bo.press[b.phase === 2 ? 1 : 0]);
      const targets = this.alivePlayers();
      if (targets.length) {
        const tgt = pick(targets), side = Math.floor(Math.random() * 4);
        const [x, y] = [[rand(0, W), -10], [rand(0, W), H + 10], [-10, rand(0, H)], [W + 10, rand(0, H)]][side];
        const a = Math.atan2(tgt.y - y, tgt.x - x), v = 170 * this.dp.speed;
        this.spawn([0, 1].map(i => ({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 6, t0: now + 450 + i * 140, warn: i === 0 })));
      }
    }
    if (b.hp <= 0) {
      b.hp = 0; b.deadAt = now;
      this.pshots = [];
      this.emit('clear', {});
      this.emit('fx', { t: 'bossdown', x: b.x, y: b.y, color: b.def.color });
      this.talk(b.def.defeat, STAGE_CLEAR_TIME - 300, now);
    }
  }

  endRound(now, cleared) {
    const list = [...this.players.values()].filter(p => p.deathAt || p.alive);
    for (const p of list) if (p.alive) p.deathAt = now;
    const ranking = list
      .map(p => ({ id: p.id, name: p.name, color: p.color, time: p.deathAt - this.roundStart, kills: p.roundKills, grazes: p.grazes, dmg: p.dmgDealt, alive: p.alive }))
      .sort((a, b) => this.mode === 'story' ? (b.dmg - a.dmg) : ((b.alive - a.alive) || (b.time - a.time)));
    let winner = null, story = null;
    if (this.mode === 'versus') {
      const alive = list.filter(p => p.alive);
      if (alive.length === 1) { winner = alive[0].id; alive[0].wins++; }
    } else if (this.mode === 'story') {
      story = { cleared: !!cleared, stage: this.storyStage, total: BOSSES.length, boss: this.lastBossName || '', time: now - this.roundStart };
      if (cleared) { this.storyStage = 0; list.forEach(p => p.wins++); }
    } else if (ranking[0]) {
      submitScore(ranking[0].name, ranking[0].time, this.cfg.diff);
    }
    for (const p of this.players.values()) p.alive = false;
    this.items = [];
    this.boss = null;
    this.pshots = [];
    this.result = { mode: this.mode, winner, ranking, story, diff: this.cfg.diff, top: highScores.slice(0, 5) };
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
      if (this.mode === 'story' && b.owner) this.pshots.push({ id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, t0: b.t0, life, r: b.r || 6, kind: b.kind, owner: b.owner });
      // [id, x, y, vx, vy, ax, ay, r, t0, life, kind, owner, warn]
      const arr = [id, Math.round(b.x), Math.round(b.y), +b.vx.toFixed(1), +b.vy.toFixed(1),
        +(b.ax || 0).toFixed(1), +(b.ay || 0).toFixed(1), b.r || 7, b.t0, life, b.kind || 0, b.owner || 0, b.warn ? 1 : 0];
      this.bullets.set(id, { owner: b.owner || null, kind: b.kind || 0, expire: b.t0 + life + 2000, arr }); // arr は途中参加者に送る用
      out.push(arr);
    }
    if (out.length) this.emit('b', out);
  }

  alivePlayers() { return [...this.players.values()].filter(p => p.alive); }

  runPattern(now) {
    let d, pool, gap;
    if (this.mode === 'story') {
      const b = this.boss;
      if (!b || b.deadAt) { this.nextPattern = now + 500; return; }
      const p2 = b.phase === 2;
      const bo = b.boost; // ステージ4・5の強化設定（STAGE_BOOST）
      d = 1.3 + this.storyStage * 0.3 + (p2 ? 0.5 : 0) + (bo ? bo.d : 0) + (b.rage ? 0.5 : 0);
      pool = p2 ? [...b.def.patterns, ...b.def.p2] : b.def.patterns;
      gap = Math.max(bo ? 200 : 350, (1500 - this.storyStage * 100 - (p2 ? 250 : 0)) * (bo ? (b.rage ? 0.4 : bo.gap) : 1));
      // 後半ステージは別の攻撃を同時に重ねてくる（最後のあがきは必ず2つ＋50%で3つ目）
      if (bo) {
        const layers = (b.rage || Math.random() < bo.layer[p2 ? 1 : 0] ? 1 : 0) + (b.rage && Math.random() < 0.5 ? 1 : 0);
        const sp2 = Math.min(1.9, 0.85 + d * 0.12) * this.dp.speed;
        for (let L = 0; L < layers; L++) {
          const other = pool[Math.floor(Math.random() * pool.length)][0];
          setTimeout(() => { if (this.boss === b && !b.deadAt && this.state === 'play') PATTERNS[other](this, Date.now(), d, sp2); }, 250 + L * 350);
        }
      }
    } else {
      const el = (now - this.roundStart) / 1000;
      d = 1 + el / 25;                        // 難易度（時間とともに上昇）
      pool = [
        ['rain', 3], ['sweep', 3], ['ring', 3], ['aimed', 2],
        ['fountain', d >= 1.6 ? 2 : 0], ['spiral', d >= 1.8 ? 2 : 0],
        ['blueorange', d >= 2.0 ? 2 : 0], ['cross', d >= 2.6 ? 2 : 0],
      ].filter(([, w]) => w > 0);
      gap = Math.max(450, 1900 - el * 18);
    }
    const sp = Math.min(1.9, 0.85 + d * 0.12) * this.dp.speed; // 弾速倍率
    let total = pool.reduce((s, [, w]) => s + w, 0), r = Math.random() * total, name = pool[0][0];
    for (const [n, w] of pool) { if ((r -= w) <= 0) { name = n; break; } }
    const dur = PATTERNS[name](this, now, d, sp);
    this.nextPattern = now + (dur || 0) * 0.6 + gap * this.dp.gap;
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
      if (this.mode === 'story') this.tickBoss(now);
      if (this.state !== 'play') return; // 全ボス撃破で終了した
      if (now >= this.nextPattern) this.runPattern(now);
      const m = 40 + this.inset(now);
      const top = this.mode === 'story' ? 180 : m; // ストーリーではボスのいる上側を避ける
      const healX = this.mode === 'story' && this.boss && this.boss.boost ? (this.boss.boost.heal || 1) : 1;
      const maxItems = healX > 1 ? 4 : 2;
      if (now >= this.nextItem) {
        this.nextItem = now + rand(7000, 11000) * this.dp.item;
        if (this.items.length < maxItems) {
          this.items.push({ id: this.iid++, type: Math.random() < 0.6 ? 'heal' : 'charge', x: rand(m, C.W - m), y: rand(top, C.H - m), until: now + 12000 });
        }
      }
      // 回復アイテムの追加出現（ステージ5は回復だけ2倍）
      if (healX > 1 && now >= (this.nextExtraHeal || 0)) {
        const first = !this.nextExtraHeal;
        this.nextExtraHeal = now + rand(7000, 11000) * this.dp.item / 0.6 / (healX - 1); // 通常の回復（出現の60%）と同じペースをもう1本
        if (!first && this.items.length < maxItems) {
          this.items.push({ id: this.iid++, type: 'heal', x: rand(m, C.W - m), y: rand(top, C.H - m), until: now + 12000 });
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
      if ((this.mode === 'versus' && alive <= 1) || alive === 0) this.endRound(now, false);
    } else if (this.state === 'result') {
      if (now >= this.stateUntil) {
        this.state = 'lobby';
        this.stateUntil = this.isPublic ? now + LOBBY_AUTO : 0;
      }
    }

    const b = this.boss;
    this.emit('s', {
      st: this.state, su: this.stateUntil, rs: this.roundStart, rd: this.round, md: this.mode, now,
      cfg: [this.cfg.game, this.cfg.diff, this.storyStage, BOSSES.length],
      p: [...this.players.values()].map(p => [p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.hp, p.alive ? 1 : 0, Math.max(0, p.iframeUntil - now), Math.max(0, p.cdUntil - now), Math.floor(p.sp)]),
      it: this.items.map(it => [it.id, it.type, Math.round(it.x), Math.round(it.y)]),
      bs: b ? [b.def.key, Math.round(b.x), Math.round(b.y), Math.max(0, Math.ceil(b.hp)), b.max, this.storyStage, b.phase, b.flashUntil > now ? 1 : 0, b.deadAt ? 1 : 0, b.def.name, b.def.color, b.def.r] : null,
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

  damage(p, dmg, by, now) {
    p.hp = Math.max(0, p.hp - dmg);
    p.iframeUntil = now + this.dp.iframe;
    // 必殺技メーター：食らった側と当てた側の両方に加算
    this.addSp(p, C.SP_DAMAGED);
    if (by) this.addSp(this.players.get(by), C.SP_HIT);
    this.emit('fx', { t: 'hit', id: p.id, by, x: p.x, y: p.y });
    if (p.hp <= 0) {
      p.alive = false;
      p.deathAt = now;
      const killer = by ? this.players.get(by) : null;
      if (killer) { killer.kills++; killer.roundKills++; }
      this.emit('fx', { t: 'dead', id: p.id, by: killer ? killer.id : null, x: p.x, y: p.y });
    }
  }

  onHit(p, bid, now) {
    if (!p.alive || this.state !== 'play' || now < p.iframeUntil) return;
    if (bid === -1) {
      // ボスへの体当たり（サーバー側の位置でも近いか確認）
      const b = this.boss;
      if (!b || b.deadAt || Math.hypot(b.x - p.x, b.y - p.y) > b.def.r + C.SOUL_R + 30) return;
      return this.damage(p, this.dp.dmg, null, now);
    }
    const b = this.bullets.get(bid);
    if (!b || b.owner === p.id) return;
    if (this.mode === 'story' && b.owner) return; // 協力モードではフレンドリーファイアなし
    const dmg = b.kind === K.SP ? C.SP_DMG : b.kind === K.SHOT ? C.SHOT_DMG : b.kind === K.BIG ? this.dp.dmg + 1 : this.dp.dmg;
    this.damage(p, dmg, b.owner, now);
  }

  // 狙い撃ち：指定角度（正面）にショットガンを3連射。角度がなければ一番近い敵（ストーリーならボス）を自動で狙う
  onFire(p, now, angle) {
    if (!p.alive || this.state !== 'play' || now < p.cdUntil) return;
    p.cdUntil = now + C.SHOT_CD;
    let a0 = typeof angle === 'number' ? angle : NaN;
    if (!Number.isFinite(a0)) {
      let best = null, bd = Infinity;
      const cands = this.boss && !this.boss.deadAt ? [this.boss] : this.alivePlayers().filter(q => q !== p);
      for (const q of cands) {
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
// room.dn(n) で難易度に応じて弾数を増減、sp には難易度の弾速倍率が掛かっている
const PATTERNS = {
  // 上から降る雨
  rain(room, now, d, sp) {
    const n = room.dn(8 + d * 4), list = [];
    for (let i = 0; i < n; i++) {
      list.push({ x: rand(0, W), y: -10, vx: rand(-25, 25), vy: rand(110, 170) * sp, r: rand(5, 8), t0: now + 200 + rand(0, 1400) });
    }
    room.spawn(list);
    return 1600;
  },
  // 隙間のある壁が四方のどこかから迫る
  sweep(room, now, d, sp) {
    const waves = room.dn(d > 2.2 ? 3 : 2), list = [];
    const gapW = Math.max(48, (90 - d * 6) / Math.sqrt(room.dp.dens));
    for (let w = 0; w < waves; w++) {
      const side = Math.floor(Math.random() * 4);
      const gap = rand(60, W - 60);
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
      const n = room.dn(12 + d * 2), off = Math.random() * Math.PI;
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
    const shooters = room.dn(2 + d);
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
  // 下から放物線で噴き上がる（避けやすく調整：数を減らし、間隔を空け、プレイヤーから離れた所から、予告を長めに）
  fountain(room, now, d, sp) {
    const n = Math.min(12, room.dn(5 + d * 1.5)), list = [];
    // 噴き出し口は、生存プレイヤーからいちばん離れた候補地点
    const players = room.alivePlayers();
    let cx = rand(90, W - 90), best = -1;
    for (let k = 0; k < 6; k++) {
      const x = rand(90, W - 90), dist = players.length ? Math.min(...players.map(p => Math.abs(p.x - x))) : 0;
      if (dist > best) { best = dist; cx = x; }
    }
    const g = 240 * Math.min(sp, 1.3); // 重力（速くなりすぎないよう上限）
    for (let i = 0; i < n; i++) {
      list.push({ x: cx + rand(-16, 16), y: H + 10, vx: rand(-70, 70), vy: -rand(290, 350), ay: g, r: 5, t0: now + 1100 + i * 150, warn: i % 4 === 0 });
    }
    room.spawn(list);
    return 1100 + n * 150;
  },
  // 回転する渦巻き
  spiral(room, now, d, sp, origin) {
    const cx = origin ? origin.x : W / 2 + rand(-80, 80), cy = origin ? origin.y : H / 2 + rand(-80, 80);
    const arms = room.dn(d > 2.8 ? 4 : 3), steps = 22, list = [];
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

  // ----- ここからボス専用（ボスの位置から撃つ） -----
  // ボスから全方位リング（2〜3波）
  bossRing(room, now, d, sp) {
    const b = room.boss, waves = d > 2.2 ? 3 : 2, n = room.dn(14 + d * 2), list = [];
    for (let w = 0; w < waves; w++) {
      const off = Math.random() * Math.PI, t0 = now + 700 + w * 450;
      const at = room.bossPos(t0);
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        list.push({ x: at.x, y: at.y, vx: Math.cos(a) * 115 * sp, vy: Math.sin(a) * 115 * sp, r: 7, t0, warn: i === 0, kind: w % 2 ? K.BIG : K.NORMAL });
      }
    }
    room.spawn(list);
    return 700 + waves * 450;
  },
  // ボスから各プレイヤーへ自機狙いの連弾
  bossAim(room, now, d, sp) {
    const list = [], shots = room.dn(4 + d);
    for (const p of room.alivePlayers()) {
      for (let k = 0; k < shots; k++) {
        const t0 = now + 600 + k * 160, at = room.bossPos(t0);
        const a = Math.atan2(p.y - at.y, p.x - at.x) + rand(-0.08, 0.08);
        list.push({ x: at.x, y: at.y, vx: Math.cos(a) * 210 * sp, vy: Math.sin(a) * 210 * sp, r: 6, t0, warn: k === 0 });
      }
    }
    room.spawn(list);
    return 600 + shots * 160;
  },
  // ボスを中心に渦巻き
  bossSpiral(room, now, d, sp) {
    return PATTERNS.spiral(room, now, d, sp, room.bossPos(now + 900));
  },
  // ボスから重力つきのしずくが飛び散る
  bossDrip(room, now, d, sp) {
    const n = room.dn(12 + d * 3), list = [];
    for (let i = 0; i < n; i++) {
      const t0 = now + 500 + i * 90, at = room.bossPos(t0);
      list.push({ x: at.x, y: at.y + 20, vx: rand(-150, 150), vy: rand(-160, -60), ay: 280 * sp, r: rand(6, 9), t0, warn: i === 0 });
    }
    room.spawn(list);
    return 500 + n * 90;
  },
  // 床と天井から骨（弾の柱）が交互に突き出す（青い骨・オレンジの骨も混ざる）
  bossBones(room, now, d, sp) {
    const cols = room.dn(5 + d), list = [];
    const fromLeft = Math.random() < 0.5;
    for (let c = 0; c < cols; c++) {
      const x = fromLeft ? 40 + c * (400 / cols) : W - 40 - c * (400 / cols);
      const up = c % 2 === 0, len = rand(140, 260);
      const kind = d > 2 && Math.random() < 0.35 ? (Math.random() < 0.5 ? K.BLUE : K.ORANGE) : K.NORMAL;
      const t0 = now + 700 + c * 260;
      for (let y = 0; y < len; y += 14) {
        const yy = up ? H + 10 + y : -10 - y;
        list.push({ x, y: yy, vx: 0, vy: (up ? -1 : 1) * 190 * sp, r: 6, t0, kind, warn: y === 0 });
      }
    }
    room.spawn(list);
    return 700 + cols * 260;
  },
  // ブーメラン：ボスから放たれた弾がいったん止まって戻ってくる（加速度を逆向きに）
  bossBoomerang(room, now, d, sp) {
    const n = room.dn(10 + d * 2), list = [], t0 = now + 700, at = room.bossPos(t0);
    const off = Math.random() * Math.PI, v = 200 * sp, back = 1.1; // back秒で止まって戻る
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2, vx = Math.cos(a) * v, vy = Math.sin(a) * v;
      list.push({ x: at.x, y: at.y, vx, vy, ax: -vx / back, ay: -vy / back, r: 7, t0, life: 3200, warn: i === 0, kind: K.BIG });
    }
    room.spawn(list);
    return 2200;
  },
  // クモの巣：ボスから放射状に弾が伸び、少し遅れて2本目・3本目が続く
  bossWeb(room, now, d, sp) {
    const lines = room.dn(7 + d), list = [], off = Math.random() * Math.PI;
    for (let k = 0; k < 3; k++) {
      const t0 = now + 700 + k * 220, at = room.bossPos(t0);
      for (let i = 0; i < lines; i++) {
        const a = off + (i / lines) * Math.PI * 2 + k * 0.12;
        list.push({ x: at.x, y: at.y, vx: Math.cos(a) * 150 * sp, vy: Math.sin(a) * 150 * sp, r: 5, t0, warn: k === 0 && i === 0 });
      }
    }
    room.spawn(list);
    return 1500;
  },
  // 雪：左右にゆれながらゆっくり降る（横向きの加速度で流れる）
  bossSnow(room, now, d, sp) {
    const n = room.dn(18 + d * 4), list = [], wind = rand(-40, 40);
    for (let i = 0; i < n; i++) {
      list.push({ x: rand(-60, W + 60), y: -10, vx: rand(-20, 20), vy: rand(60, 100) * sp, ax: wind, ay: 15, r: rand(4, 7), t0: now + 300 + rand(0, 1800), kind: Math.random() < 0.2 ? K.BLUE : K.NORMAL });
    }
    room.spawn(list);
    return 2000;
  },
  // 雷：予告の後、縦一列に高速で落ちてくる稲妻を数本
  bossThunder(room, now, d, sp) {
    const bolts = room.dn(3 + d * 0.8), list = [], targets = room.alivePlayers();
    for (let k = 0; k < bolts; k++) {
      const x = targets.length && k % 2 === 0 ? clamp(pick(targets).x + rand(-30, 30), 10, W - 10) : rand(20, W - 20);
      const t0 = now + 900 + k * 260;
      for (let i = 0; i < 14; i++) list.push({ x: x + rand(-4, 4), y: -10, vx: 0, vy: 520 * sp, r: 6, t0: t0 + i * 22, life: 2000, warn: i === 0, kind: K.BIG });
    }
    room.spawn(list);
    return 900 + bolts * 260;
  },
  // 斬撃：予告のあと、画面を斜めに横切る速い弾の列（居合い斬り）
  bossSlash(room, now, d, sp) {
    const cuts = room.dn(2 + d * 0.5), list = [];
    for (let k = 0; k < cuts; k++) {
      const t0 = now + 900 + k * 420;
      const fromLeft = Math.random() < 0.5, y0 = rand(40, H - 40), y1 = rand(40, H - 40);
      const x0 = fromLeft ? -10 : W + 10, a = Math.atan2(y1 - y0, (fromLeft ? W : -W));
      for (let i = 0; i < 16; i++) {
        list.push({ x: x0, y: y0, vx: Math.cos(a) * 420 * sp, vy: Math.sin(a) * 420 * sp, r: 6, t0: t0 + i * 18, life: 2000, warn: i === 0, kind: K.BIG });
      }
    }
    room.spawn(list);
    return 900 + cuts * 420;
  },
  // 時計の針：ボスから2本の「針」（速さの違う弾の列）が回転しながら伸びる
  bossClock(room, now, d, sp) {
    const steps = 16, list = [], dir = room.boss && room.boss.phase === 2 ? -1 : 1, off = Math.random() * Math.PI * 2;
    const hands = room.dn(2 + (d > 2.5 ? 1 : 0));
    for (let st = 0; st < steps; st++) {
      const t0 = now + 800 + st * 110, at = room.bossPos(t0);
      for (let h = 0; h < hands; h++) {
        const a = off + dir * st * 0.26 + (h / hands) * Math.PI * 2;
        for (let k = 0; k < 4; k++) {
          const v = (70 + k * 38) * sp;
          list.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 5, t0, warn: st === 0 && h === 0 && k === 0 });
        }
      }
    }
    room.spawn(list);
    return 800 + steps * 110;
  },
  // 地震：予告のあと大きな岩が降ってきて、床から小石が跳ね上がる
  bossQuake(room, now, d, sp) {
    const rocks = room.dn(4 + d), list = [];
    for (let k = 0; k < rocks; k++) {
      const x = rand(30, W - 30), t0 = now + 800 + k * 200;
      list.push({ x, y: -20, vx: 0, vy: 150 * sp, ay: 200 * sp, r: 13, t0, warn: true, kind: K.BIG });
      for (let i = 0; i < 2; i++) list.push({ x: x + rand(-20, 20), y: H + 10, vx: rand(-70, 70), vy: -rand(190, 250), ay: 300 * Math.min(sp, 1.3), r: 5, t0: t0 + 750 });
    }
    room.spawn(list);
    return 800 + rocks * 200 + 600;
  },
  // 予告つきのレーザー（高速で密な弾の列）をプレイヤーへ
  bossLaser(room, now, d, sp) {
    const list = [], targets = room.alivePlayers();
    if (!targets.length) return 500;
    const beams = Math.min(4, room.dn(1 + d * 0.6));
    for (let k = 0; k < beams; k++) {
      const tgt = pick(targets), t0 = now + 1000 + k * 500, at = room.bossPos(t0);
      const a = Math.atan2(tgt.y - at.y, tgt.x - at.x);
      for (let i = 0; i < 18; i++) {
        list.push({ x: at.x, y: at.y, vx: Math.cos(a) * 360 * sp, vy: Math.sin(a) * 360 * sp, r: 7, t0: t0 + i * 28, life: 2500, warn: i === 0, kind: K.BIG });
      }
    }
    room.spawn(list);
    return 1000 + beams * 500;
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
      r = new Room(makeCode(), false, data.game);
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
    // 試合中に途中参加した人（観戦）には、いま画面上にある弾も送る
    if (r.state === 'play') {
      const now = Date.now(), active = [];
      for (const b of r.bullets.values()) if (b.arr && b.arr[8] + b.arr[9] > now) active.push(b.arr);
      if (active.length) setTimeout(() => socket.emit('b', active), 100);
    }
  });

  socket.on('start', () => { if (room && me) room.requestStart(me); });
  socket.on('cfg', (d) => { if (room && me) room.setConfig(me, d); });
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
