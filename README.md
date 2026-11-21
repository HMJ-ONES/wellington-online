# 🃏 Wellington Online

**A free browser card game for 2–6 players. Lowest score wins.**

Play it right now — no sign-up, no download, no cost. PC and mobile.

## The game

Each player gets **4 cards face-down** in a row. Peek at 2 of your own, then take turns drawing and swapping — blind. Lowest total when the game ends wins.

### Points

| Card | Points |
|---|---|
| 2 – 10 | 10 each |
| Jack, Queen | 11 |
| Joker | 0 |
| King | −1 |
| Ace | −2 |

**The owner isn't sure about these values** — so they live in one easily-editable const at the top of the engine in `index.html` (`CARD_POINTS`, marked `EDIT THESE`). Change a number there and the scoring, the in-game Rules table, and the bots all follow. Lowest total wins; ties share the win.

### How a turn works

1. **Peek (once, at the start):** look at any 2 of your own 4 cards, then put them back. Click 2 of your cards, then Done.
2. **Your turn (clockwise):** draw the top card of the draw pile and look at it — only you see it. Then choose exactly one:
   - **Swap blind** — pick one of your table cards *without* looking at it; the drawn card goes face-down into that slot and the old card goes face-up in the middle; or
   - **Discard the drawn card** face-up in the middle.
   
   Exactly one discard per turn.
3. **Card effects — only on a normal turn discard** (the drawn card you discard, or the table card you swap out). Exactly one effect per turn discard:
   - **5** — look at 1 of your own cards.
   - **6** — look at 1 of another player's cards.
   - **7** — exchange 1 of your cards with 1 of another player's, looking at **neither** (blind swap).
   - **8** — exchange 1 of your cards with 1 of another player's, looking at **both** first (and no other card).
   
   The effect must resolve before the turn passes.
4. **Snap!** Whenever a card lands in the middle, **any** player may discard a card of the **same rank** from their own table, at any moment before the next card lands in the middle. Click one of your own cards while the SNAP banner is showing. If you hold two of that rank, you may snap **twice in a row** in the same window.
   
   **Snapped cards never trigger effects** — not even a snapped 5, 6, 7 or 8. Snaps are effect-free discards only.
   
   **Wrong snap:** the card you picked is shown, goes back to its slot, and you must take a **penalty card** from the deck (an extra face-down card in your row).
5. **WELLINGTON:** on your turn, **before drawing**, hit the big WELLINGTON button when you think you're lowest. Your turn ends at once and every other player gets exactly **one last turn**, in clockwise order, then all cards are revealed and scored. Only one player can call it, once per game — after that the button is disabled for everyone. During the final round **nobody may touch the caller's cards** in any way (6/7/8 can't target them), but 5/6/7/8 may still be used on other players.
6. **Deck runs out?** The discard pile (except its top card) is reshuffled into a new draw pile. If deck and discard are both exhausted, the game ends and cards are revealed.
7. **0 cards:** snapping your last card ends the game immediately — you score 0.

## Interpretations (where the rules as given left a gap)

These are the calls made while building; they are also stated in the in-game Rules:

1. **Penalty card (owner correction #1):** a wrong snap's penalty card **cannot be discarded immediately** when drawn — not by snapping it, not by swapping it out on the same turn, not by a 7/8 swap. It **becomes a normal card from the player's next turn on**: from then it can be swapped out on a turn or snapped in a later window. Implementation: the card is `locked` until the start of its holder's next turn (a penalty taken *during* your own turn stays locked for the rest of that turn). A locked card's snap attempt is rejected, not counted as a second wrong snap. The penalty card is drawn face-down and **not** looked at, even by its owner.
2. **Snaps never trigger effects (owner correction #2, overrides the earlier snap-effect idea):** only the card placed in the middle by the player whose turn it is triggers an effect — one effect per normal discard. A snapped 5/6/7/8 is just a discard.
3. **Multiple snaps:** a player holding more than one card of the top rank may snap them one after another in the same window; the window stays open (top rank unchanged) until the next normal turn discard.
4. **Peek:** each player peeks at the start (2 cards, own only). In online play you only ever see your own cards. The game starts once everyone presses Done (a player may press Done having peeked at fewer than 2).
5. **Effects on other players:** 6/7/8 may target any player except the Wellington caller during the final round. An effect may be skipped (e.g. an 8 with no beneficial swap).
6. **Wrong snap while an effect is pending:** snaps stay allowed; the pending effect still has to resolve before the turn passes.
7. **Snap window:** the window is "open" whenever there is a top discard card, and it closes only in the sense that the *next* discard replaces the rank to match. A wrong snap does not close it.
8. **Ties:** tied lowest totals share the win.
9. **Bots and memory:** bots only act on cards they have *seen* (their peeks, drawn cards, 5/6/8 peeks, cards shown by a wrong snap). Unknown slots are estimated at ~8 (the deck average).

## How to play

| Button | What it does |
|---|---|
| **Create lobby** | Pick how many bots to add (0–5), then choose **Private** (code-only) or **Public** (listed) and a **max players** (2–6, bots included). You get a 4-letter code + shareable link (`?room=CODE`). Players join; you press Start with 2–6 total. |
| **Join lobby** | Enter a friend's lobby code. |
| **Browse public rooms** | Shows open public lobbies (host, code, players / max, bots, waiting/playing). **Tap one to join** — there is never any automatic matchmaking or auto-join. |
| **Play vs bots** | Pick 1–5 bots. Fully local, works offline. |

A lobby link also works: open `https://<your-site>/?room=KQ7B` and the code is filled in for you.

### Public rooms — how the list works (no server)

The list is PeerJS-only, same $0 approach as the rest of the game:

- A public-room host **also claims one directory slot**: a fixed PeerJS peer ID `wellington-directory-v1-1` … `wellington-directory-v1-10` (first free one wins).
- Your browser **asks all 10 slots** and shows the rooms that answer with `{code, hostName, players, maxPlayers, bots, status}`. A slot with no answer is skipped.
- The host **unregisters when the game starts or the room closes**, so the list only shows lobbies still waiting for players. (A game already in progress can't be joined mid-game.)
- **Limits, stated honestly:** the list depends on hosts being online — if the directory doesn't answer, the page says so ("couldn't load the list — join with a code instead") and code-join still works. With 10 slots, at most 10 public rooms can be listed at once. There is no auto-join and no Play Anyone button, by design.

### Max players

The host sets the max (2–6) when creating the lobby. Bots count toward it: the create screen won't let you pick a max below host + bots, and the host **rejects joins when full** (the joiner gets a "room is full" message). The lobby screen always shows `players / max`.

## Bots

Bots peek 2 cards at the start, remember everything they have seen, estimate unknown slots at ~8, and:

- swap a drawn card in for their highest-value slot when the drawn card is lower, else discard it;
- use 5 to peek an unknown own card, 6 to peek an unknown opponent card, 7 to blind-swap their highest card with a random opponent card, 8 to swap only when the opponent's card is known-lower;
- snap when they *know* they hold the matching rank (~40% of chances, so humans can beat them to it — and they may snap twice in one window);
- call Wellington when their estimated total is ≤ 2, or when all their cards are known and the total is ≤ 5;
- never act out of turn, never touch the Wellington caller's cards, and never snap or swap a locked penalty card.

## $0 architecture — how multiplayer is free

There is **no game server**. The whole game is one static file (`index.html`):

- **Hosting:** Cloudflare Pages (free tier) serves the static site.
- **Multiplayer:** peer-to-peer WebRTC via [PeerJS](https://peerjs.com/)'s free public broker (`0.peerjs.com`). Lobby codes are PeerJS peer IDs; actions travel directly between browsers. Nothing about your game is stored anywhere.
- **Host-authoritative, hidden-info safe:** the host holds the true state and validates every action through one `applyAction()` choke point. Each player only ever receives a **filtered view** of the state — their own cards only where they have seen them, opponents' cards as backs (with opaque IDs, so even the card ID can't leak the rank). The draw pile is count-only; the discard pile is public. After every action the host broadcasts fresh filtered views, clients acknowledge, and both sides compare fingerprints every few seconds — a lost message repairs itself instead of desyncing the game.
- **Cost:** $0. No database, no backend to keep awake, no accounts.

Because the game is fully client-side, it also works offline for bot games (once loaded).

## Run it locally

```bash
# any static server works — the game is a single file
python3 -m http.server 8000
# open http://localhost:8000/
```

Tests (engine + bots, no browser needed):

```bash
node test/engine.test.js   # 135 checks: deck/deal, points, peek, turns, effects 5-8,
                           #   snaps (correct/wrong/multiple/effect-free), penalty lock,
                           #   Wellington, reshuffle, 0-card end, ties, hidden-info views,
                           #   public-rooms helpers
node test/bot.test.js      # 200 bot-only games (2-6 players) + scripted bot decisions
```

## Deploy to Cloudflare Pages ($0)

**Option A — dashboard (easiest, 2 minutes)**
1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Pick this repo. Framework preset: **None**. Build command: *(empty)*. Output directory: `/` (the repo root — `index.html` is there).
4. Deploy. You get `https://wellington-online.pages.dev` free.

**Option B — CLI**
```bash
npm install -g wrangler
wrangler login
wrangler pages deploy . --project-name wellington-online
```

**Custom domain (optional):** Pages → Custom domains → add yours. Still free.

## Files

```
index.html            the whole game (engine + UI + multiplayer), single file
test/engine.test.js   engine unit tests (node)
test/bot.test.js      bot stress test: 200 bot-only games + scripted decisions (node)
wrangler.toml         Cloudflare Pages config (Pages needs no config; no Worker)
README.md             this file
LICENSE               MIT
```

## License

MIT — do what you want with it.
