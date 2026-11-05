# ⚡ Color Blitz

A fast online multiplayer color-matching card game for **2–10 players**. It runs entirely on **GitHub Pages** (no server, no accounts).

## Play with friends

1. Open the game, enter your name and click **Create a room**.
2. Share the 5-letter code or the **invite link**. Friends open it, type a name and click **Join**.
3. Add bots if you like, pick the room rules and press **Start game**.

The host's browser runs the game, so **the host keeps their tab open**. Players who disconnect are covered by a bot until they rejoin, and the host can resume a room after a reload.

## Rules in short

- Match the top card's **color** or **number/symbol**. Wilds go on anything.
- Action cards: **Skip**, **Reverse**, **+2**, **Wild**, **Wild +4**.
- Optional **stacking**: answer +2 with +2 (or +4) to pass the penalty on.
- Press **BLITZ!** when playing your second-last card. Forget, and anyone can **Catch!** you for +2 cards.
- Round winner scores everyone else's leftover cards. Play to 100, 300 or 500 points, or a single round.
- Optional turn timer (auto draw/pass when it runs out).

## Deploy on GitHub Pages

1. Upload everything in this folder to the root of a GitHub repository.
2. Go to **Settings → Pages → Deploy from a branch**, select `main` and `/ (root)`, and save.
3. Play at `https://<username>.github.io/<repo>/`.

## How online play works (free, no accounts)

Players reach the host through **free public MQTT relays** (EMQX, HiveMQ, Mosquitto) over secure WebSockets, with **direct peer-to-peer (PeerJS/WebRTC)** as a fallback. The host listens on all of them at once, so one service being down doesn't stop the game. Each player only receives **their own hand**; other hands and the deck order are never sent to them. Public relays are shared, so don't put anything private in chat.

## Editing the code

The page loads `dist/game.js`. After changing files in `js/`, rebuild:

```bash
npx esbuild js/main.js --bundle --format=iife --target=es2020 --outfile=dist/game.js
```

## Credits

Original game design, card art and code. Icons: Font Awesome Free 6.5.2 (CC BY 4.0 / SIL OFL). Fonts: Fredoka, Inter (SIL OFL). Libraries: GSAP 3.12.5, canvas-confetti (ISC), PeerJS (MIT), MQTT.js (MIT).
Color Blitz is an original game and is not affiliated with or endorsed by the makers of any commercial card game.
