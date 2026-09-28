# SOUL BARRAGE ♥

An online bullet-hell survival game in the style of the Undertale battle scenes. Works on phones.

## Local check

```
npm install
npm start
```
Open http://localhost:3000 in a browser.
(Other devices on the same Wi-Fi can play at `http://<this PC's IP>:3000`.)

## Putting it in the cloud (Render.com, free)

1. Create a new repository on GitHub and push this `soul-barrage` folder to it.
2. Sign in to https://render.com with your GitHub account.
3. Choose **New → Blueprint** and pick that repository. It sets itself up automatically from `render.yaml`.
   (You can also use **New → Web Service** with Build `npm install` and Start `npm start`.)
4. Once the deploy finishes, you get a URL like `https://soul-barrage-xxxx.onrender.com`. Open it on your phone to play.

> On Render's free plan, the server goes to sleep after about 15 minutes with no activity.
> The first visit after that takes 30–60 seconds to start up.
> Paid plans, Railway, or Fly.io avoid the sleep. It runs anywhere Node.js does.

## Files

- `server.js` … game server (rooms, bullet patterns, damage checks, rankings)
- `public/index.html` … screens and UI
- `public/game.js` … drawing, virtual stick, sound, network sync

## Tuning

Change the `C` constants near the top of `server.js` (HP, move speed, cooldown, damage, and so on).
Add new bullet patterns to the `PATTERNS` object.

## Modes and difficulty

- **Battle**: solo survival (1 player) / battle royale (2+ players)
- **Story (co-op)**: defeat 5 stages of bosses in order. Each stage picks 1 of 5 bosses at random (25 total). Works solo or with friends. Knocked-out players revive at the next boss. If everyone goes down, you retry from that boss.
- Each boss has its own **signature attack** (drawn in the boss color) as its main move.
- **Difficulty**: easy / normal / hard / oni / god (the host chooses in the lobby). On god, bosses roam the whole field.
- Stages 4 and 5 get extra layers of difficulty (the `STAGE_BOOST` table in `server.js`). Stage 5 is by far the hardest: attacks are stronger with shorter gaps, 60–90% of them get a second attack layered on, and aimed shots keep coming from the edges. At 25% HP the boss enters a "last stand" phase with even more layering.

The difficulty numbers are in `DIFFS` in `server.js`. Boss HP, lines and attack patterns are in `BOSSES`.

## BGM

Each boss has its own chiptune in `public/music.js`, generated live in the browser with Web Audio (no audio files).
Song structure: intro (A-section backing, first time only) → A → B → A → C → B (climax) → back to A, repeating. The C section is a bridge with half-time drums, ending in a snare roll into the climax.
Battle mode (solo survival / battle royale) also plays one boss song picked at random each round (the same one for everyone in the room), switching to the second-form arrangement after 40 seconds.
You can listen to every song in the in-game settings (⚙) under "サウンドテスト" (sound test).

## Button layout

In settings (⚙) → "ボタンの位置・サイズを変更" (change button position and size), you can drag the stick, SHOT and SP buttons to move them and change their size (60–160%). The layout is saved per device, separately for portrait and landscape.
