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
- **Story (co-op)**: defeat 5 stages of bosses in order. Each stage picks 1 of 3 bosses at random. Works solo or with friends. Knocked-out players revive at the next boss. If everyone goes down, you retry from that boss.
- **Difficulty**: easy / normal / hard / oni / god (the host chooses in the lobby)

The difficulty numbers are in `DIFFS` in `server.js`. Boss HP, lines and attack patterns are in `BOSSES`.
