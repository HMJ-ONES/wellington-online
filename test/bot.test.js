// Wellington bot stress test: bot-only games must always terminate with a
// winner, never hang, never throw, never act out of turn. Run: node test/bot.test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const engineSrc = blocks.find(s => s.includes('module.exports'));
if (!engineSrc) { console.error('FAIL: engine script block not found'); process.exit(1); }

const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(engineSrc, sandbox);
const E = sandbox.module.exports;

let failures = 0;
let games = 0, steps = 0, botActions = 0, wins = 0, ties = 0;
let maxStepMs = 0;
const fail = (msg) => { failures++; console.log('FAIL: ' + msg); };

// Drive one bot-only game to completion. Polls every player in seat order:
// each bot either snaps (40% when it KNOWS a match), peeks, draws,
// swaps/discards, resolves effects, or calls Wellington. The loop never
// assumes strict turn alternation — snaps and effects interleave.
function playBotGame(nPlayers, seed) {
  const names = [];
  for (let i = 0; i < nPlayers; i++) names.push('Bot' + i);
  const st = E.newGame(names.map(n => ({ name: n, isBot: true })), seed);
  let guard = 0;
  while (!st.over && st.phase !== 'over' && guard++ < 4000) {
    let acted = false;
    for (const p of st.players) {
      if (st.phase === 'over') break;
      const t0 = Date.now();
      let a;
      try { a = E.botChooseAction(st, p.id); }
      catch (e) { fail(`botChooseAction threw (${e.message}) players=${nPlayers} seed=${seed}`); return; }
      const dt = Date.now() - t0; if (dt > maxStepMs) maxStepMs = dt;
      if (dt > 2000) { fail(`botChooseAction slow: ${dt}ms players=${nPlayers} seed=${seed}`); return; }
      if (!a) continue;
      let r;
      try { r = E.applyAction(st, p.id, a); }
      catch (e) { fail(`applyAction threw (${e.message}) action=${JSON.stringify(a)} players=${nPlayers} seed=${seed}`); return; }
      if (!r.ok) {
        // The bot must never propose an illegal action. (Snaps that miss
        // the 40% roll return null, not an illegal action.)
        fail(`bot proposed illegal action ${JSON.stringify(a)} -> ${r.error} players=${nPlayers} seed=${seed} phase=${st.phase}`);
        return;
      }
      botActions++; steps++; acted = true;
      // A bot that just snapped may hold a second matching card — let the
      // poll loop come back around; the window is still open.
      if (st.phase === 'over') break;
    }
    if (!acted) {
      fail(`deadlock: no bot acted players=${nPlayers} seed=${seed} phase=${st.phase} turn=${st.turnIdx} pending=${st.pendingEffect ? st.pendingEffect.kind : 'none'}`);
      return;
    }
  }
  games++;
  if (st.phase !== 'over') { fail(`game did not terminate players=${nPlayers} seed=${seed} phase=${st.phase} guard=${guard}`); return; }
  if (!st.winners || !st.winners.length) { fail(`game over with no winner players=${nPlayers} seed=${seed}`); return; }
  if (st.winners.length > 1) ties++; else wins++;
  // Scores must be consistent: winners hold the minimum total.
  const min = Math.min.apply(null, st.scores.map(s => s.total));
  for (const s of st.scores) {
    if (s.total !== st.players.find(p => p.id === s.playerId).cards.reduce((t, c) => t + E.cardPoints(c), 0)) {
      fail(`score mismatch for ${s.playerId} players=${nPlayers} seed=${seed}`); return;
    }
    if (st.winners.indexOf(s.playerId) >= 0 && s.total !== min) { fail(`winner does not hold the minimum players=${nPlayers} seed=${seed}`); return; }
  }
}

for (const n of [2, 3, 4, 5, 6]) {
  for (let seed = 1; seed <= 40; seed++) playBotGame(n, seed * 7919 + n);
}

console.log(`\nbot games: ${games}, bot actions: ${botActions}, outright wins: ${wins}, ties: ${ties}`);
console.log(`max botChooseAction: ${maxStepMs}ms`);
console.log(failures === 0 ? 'BOT TEST: ALL OK' : `BOT TEST: ${failures} FAILURE(S)`);

// Scripted bot behaviour: a bot swaps in a low drawn card and discards a high one.
console.log('\nScripted bot decisions:');
let sPass = 0, sFail = 0;
function scheck(name, cond, extra) {
  if (cond) { sPass++; console.log('  ok  ' + name); }
  else { sFail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
{
  // Bot knows its own cards: A(0), K(-1), 9(9), 10(10). Draws a Joker (-2).
  // Joker -2 < highest known 10 -> bot should swap it in for a 10.
  const st = E.newGame([{ name: 'B0', isBot: true }, { name: 'B1', isBot: true }], 21);
  for (const p of st.players) {
    E.applyAction(st, p.id, { type: 'peek', slot: 0 });
    E.applyAction(st, p.id, { type: 'peek', slot: 1 });
    E.applyAction(st, p.id, { type: 'peekDone' });
  }
  st.players[0].cards = [
    { id: 'A♠', rank: 'A', suit: '♠' }, { id: 'K♥', rank: 'K', suit: '♥' },
    { id: '9♦', rank: '9', suit: '♦' }, { id: '10♣', rank: '10', suit: '♣' },
  ];
  st.players[0].known = { 'A♠': true, 'K♥': true, '9♦': true, '10♣': true };
  st.deck = [{ id: 'Joker-♥', rank: 'Joker', suit: '♥' }];
  const a1 = E.botChooseAction(st, 'p0');
  scheck('bot draws on its turn', a1 && a1.type === 'draw');
  E.applyAction(st, 'p0', a1);
  const a2 = E.botChooseAction(st, 'p0');
  scheck('bot swaps a low drawn Joker in for a high known card', a2 && a2.type === 'swap' && (a2.slot === 2 || a2.slot === 3), 'got ' + JSON.stringify(a2));
  // Bot draws a Queen (11) with the same hand: 11 is not lower than 10 -> discard it.
  const st2 = E.newGame([{ name: 'B0', isBot: true }, { name: 'B1', isBot: true }], 22);
  for (const p of st2.players) {
    E.applyAction(st2, p.id, { type: 'peek', slot: 0 });
    E.applyAction(st2, p.id, { type: 'peek', slot: 1 });
    E.applyAction(st2, p.id, { type: 'peekDone' });
  }
  st2.players[0].cards = [
    { id: 'A♠', rank: 'A', suit: '♠' }, { id: 'K♥', rank: 'K', suit: '♥' },
    { id: '9♦', rank: '9', suit: '♦' }, { id: '10♣', rank: '10', suit: '♣' },
  ];
  st2.players[0].known = { 'A♠': true, 'K♥': true, '9♦': true, '10♣': true };
  st2.deck = [{ id: 'Q♠', rank: 'Q', suit: '♠' }];
  E.applyAction(st2, 'p0', { type: 'draw' });
  const b2 = E.botChooseAction(st2, 'p0');
  scheck('bot discards a high drawn Queen instead of swapping it in', b2 && b2.type === 'discardDrawn', 'got ' + JSON.stringify(b2));
  // Bot with a very low known total calls Wellington instead of drawing.
  const st3 = E.newGame([{ name: 'B0', isBot: true }, { name: 'B1', isBot: true }], 23);
  for (const p of st3.players) {
    E.applyAction(st3, p.id, { type: 'peek', slot: 0 });
    E.applyAction(st3, p.id, { type: 'peek', slot: 1 });
    E.applyAction(st3, p.id, { type: 'peekDone' });
  }
  st3.players[0].cards = [
    { id: 'A♠', rank: 'A', suit: '♠' }, { id: 'A♥', rank: 'A', suit: '♥' },
    { id: 'K♦', rank: 'K', suit: '♦' }, { id: 'Joker-♥', rank: 'Joker', suit: '♥' },
  ];
  st3.players[0].known = { 'A♠': true, 'A♥': true, 'K♦': true, 'Joker-♥': true };
  const c = E.botChooseAction(st3, 'p0');
  scheck('bot calls Wellington with known total -5', c && c.type === 'wellington', 'got ' + JSON.stringify(c));
  // Bot snaps only when it KNOWS the matching rank (never blind).
  const st4 = E.newGame([{ name: 'B0', isBot: true }, { name: 'B1', isBot: true }], 24);
  for (const p of st4.players) {
    E.applyAction(st4, p.id, { type: 'peek', slot: 0 });
    E.applyAction(st4, p.id, { type: 'peek', slot: 1 });
    E.applyAction(st4, p.id, { type: 'peekDone' });
  }
  st4.discard = [{ id: '9♦', rank: '9', suit: '♦' }];
  st4.snapWindow = { open: true, topRank: '9' };
  st4.players[1].cards = [
    { id: '2♠', rank: '2', suit: '♠' }, { id: '3♥', rank: '3', suit: '♥' },
    { id: '4♦', rank: '4', suit: '♦' }, { id: '6♣', rank: '6', suit: '♣' },
  ];
  st4.players[1].known = {}; // bot knows none of its cards
  let snapped = false;
  for (let i = 0; i < 20; i++) {
    const a = E.botChooseAction(st4, 'p1');
    if (a && a.type === 'snap') { snapped = true; break; }
    if (a) break; // any non-snap, non-null action is also wrong here (not its turn)
  }
  scheck('bot never snaps blind (no known matching card)', !snapped);
  // Cross-player bot snaps (owner change, Nov 21): bots snap only cards
  // they KNOW match — their own (worth 0+, or last card) or an
  // opponent's NEGATIVE card (Joker/King) when the opponent holds 2+.
  {
    const mkSnapGame = (seed, topRank) => {
      const st = E.newGame([{ name: 'B0', isBot: true }, { name: 'B1', isBot: true }], seed);
      for (const p of st.players) {
        E.applyAction(st, p.id, { type: 'peek', slot: 0 });
        E.applyAction(st, p.id, { type: 'peek', slot: 1 });
        E.applyAction(st, p.id, { type: 'peekDone' });
      }
      st.discard = [{ id: topRank + '♦', rank: topRank, suit: '♦' }];
      st.snapWindow = { open: true, topRank };
      return st;
    };
    const C = (rank, suit) => ({ id: rank === 'Joker' ? 'Joker-' + suit : rank + suit, rank, suit });
    // A: bot does NOT snap its own Joker (negative — removing it would RAISE its total).
    let st = mkSnapGame(31, 'Joker');
    st.players[0].cards = [C('Joker', '♥'), C('2', '♠'), C('3', '♥'), C('4', '♦')];
    st.players[0].known = { 'Joker-♥': true };
    st.players[1].cards = [C('2', '♣'), C('3', '♦'), C('4', '♠'), C('5', '♣')];
    scheck('bot never snaps its own negative card (Joker)', E.botSnapChoice(st, 'p0', () => 0) === null);
    // B: bot DOES snap an opponent's known Joker (raises their total).
    st = mkSnapGame(32, 'Joker');
    st.players[0].cards = [C('2', '♠'), C('3', '♥'), C('4', '♦'), C('5', '♣')];
    st.players[0].known = { 'Joker-♠': true };
    st.players[1].cards = [C('Joker', '♠'), C('2', '♣'), C('3', '♦'), C('4', '♠')];
    let a = E.botSnapChoice(st, 'p0', () => 0);
    scheck('bot snaps an opponent\'s known Joker', a && a.type === 'snap' && a.targetPlayerId === 'p1' && a.slot === 0, 'got ' + JSON.stringify(a));
    a = E.botChooseAction(st, 'p0', () => 0);
    scheck('botChooseAction returns the cross-player snap', a && a.type === 'snap' && a.targetPlayerId === 'p1', 'got ' + JSON.stringify(a));
    a = E.botMaybeSnap(st, 'p0', () => 0);
    scheck('botMaybeSnap returns the cross-player snap', a && a.type === 'snap' && a.targetPlayerId === 'p1', 'got ' + JSON.stringify(a));
    // C: bot does NOT snap an opponent's LAST card (would gift the 0-card win).
    st = mkSnapGame(33, 'Joker');
    st.players[0].cards = [C('2', '♠'), C('3', '♥'), C('4', '♦'), C('5', '♣')];
    st.players[0].known = { 'Joker-♠': true };
    st.players[1].cards = [C('Joker', '♠')];
    scheck('bot never snaps an opponent\'s last card', E.botSnapChoice(st, 'p0', () => 0) === null);
    // D: bot does NOT snap an opponent's high card (would lower their total).
    st = mkSnapGame(34, '9');
    st.players[0].cards = [C('2', '♠'), C('3', '♥'), C('4', '♦'), C('5', '♣')];
    st.players[0].known = { '9♠': true };
    st.players[1].cards = [C('9', '♠'), C('2', '♣'), C('3', '♦'), C('4', '♠')];
    scheck('bot never snaps an opponent\'s high card', E.botSnapChoice(st, 'p0', () => 0) === null);
    // E: bot DOES snap its own last card (0 cards wins at once).
    st = mkSnapGame(35, '9');
    st.players[0].cards = [C('9', '♠')];
    st.players[0].known = { '9♠': true };
    st.players[1].cards = [C('2', '♣'), C('3', '♦'), C('4', '♠'), C('5', '♣')];
    a = E.botSnapChoice(st, 'p0', () => 0);
    scheck('bot snaps its own last matching card (instant win)', a && a.type === 'snap' && a.slot === 0 && !a.targetPlayerId, 'got ' + JSON.stringify(a));
  }
  // ...but snaps when it knows it holds the rank (deterministic rnd=0 beats the 40% roll).
  st4.players[1].cards[0] = { id: '9♠', rank: '9', suit: '♠' };
  st4.players[1].known = { '9♠': true };
  const d = E.botChooseAction(st4, 'p1', () => 0);
  scheck('bot snaps when it KNOWS it holds the matching rank', d && d.type === 'snap' && d.slot === 0, 'got ' + JSON.stringify(d));
  // Bot 8: looks at both, then CONFIRMS only when the opponent card is lower.
  // Bot holds 10 as its highest known card; opponent holds A(0), known.
  const st5 = E.newGame([{ name: 'B0', isBot: true }, { name: 'B1', isBot: true }], 25);
  for (const p of st5.players) {
    E.applyAction(st5, p.id, { type: 'peek', slot: 0 });
    E.applyAction(st5, p.id, { type: 'peek', slot: 1 });
    E.applyAction(st5, p.id, { type: 'peekDone' });
  }
  st5.players[0].cards = [
    { id: 'A♠', rank: 'A', suit: '♠' }, { id: 'K♥', rank: 'K', suit: '♥' },
    { id: '9♦', rank: '9', suit: '♦' }, { id: '10♣', rank: '10', suit: '♣' },
  ];
  st5.players[0].known = { 'A♠': true, 'K♥': true, '9♦': true, '10♣': true };
  st5.players[1].cards = [
    { id: 'A♦', rank: 'A', suit: '♦' }, { id: '3♥', rank: '3', suit: '♥' },
    { id: '4♦', rank: '4', suit: '♦' }, { id: '6♣', rank: '6', suit: '♣' },
  ];
  st5.players[0].known['A♦'] = true; // bot has seen the opponent's Ace
  st5.deck = [{ id: '8♠', rank: '8', suit: '♠' }];
  E.applyAction(st5, 'p0', { type: 'draw' });
  E.applyAction(st5, 'p0', { type: 'discardDrawn' }); // 8 -> swapSeen effect (offered first)
  let b = E.botChooseAction(st5, 'p0');
  scheck('bot 8 accepts the offered effect first (Yes)', b && b.type === 'effectAccept', 'got ' + JSON.stringify(b));
  E.applyAction(st5, 'p0', b);
  b = E.botChooseAction(st5, 'p0');
  scheck('bot 8 picks its highest own card first', b && b.type === 'effectSwapOwn' && (b.slot === 2 || b.slot === 3), 'got ' + JSON.stringify(b));
  const ownSlot8 = b.slot;
  E.applyAction(st5, 'p0', b);
  b = E.botChooseAction(st5, 'p0');
  scheck('bot 8 picks the known-lower opponent Ace', b && b.type === 'effectSwapOther' && b.targetPlayerId === 'p1' && b.slot === 0, 'got ' + JSON.stringify(b));
  const r8 = E.applyAction(st5, 'p0', b);
  scheck('bot 8 pair reveal waits for the choice (no swap yet)', r8.ok && r8.awaitingDecision === true && st5.players[0].cards[ownSlot8].rank !== 'A' && st5.players[1].cards[0].rank === 'A', 'got ' + JSON.stringify(r8));
  b = E.botChooseAction(st5, 'p0');
  scheck('bot 8 CONFIRMS when the opponent card is lower', b && b.type === 'effectSwapConfirm', 'got ' + JSON.stringify(b));
  E.applyAction(st5, 'p0', b);
  scheck('bot 8 confirm swapped the Ace in', st5.players[0].cards.some(c => c.id === 'A♦') && st5.phase === 'play');
  // Bot 8 DECLINES when the opponent card is higher: bot's best own card
  // is an Ace (0); every opponent card it knows is 9+ (9–11), so it keeps.
  const st6 = E.newGame([{ name: 'B0', isBot: true }, { name: 'B1', isBot: true }], 26);
  for (const p of st6.players) {
    E.applyAction(st6, p.id, { type: 'peek', slot: 0 });
    E.applyAction(st6, p.id, { type: 'peek', slot: 1 });
    E.applyAction(st6, p.id, { type: 'peekDone' });
  }
  st6.players[0].cards = [
    { id: 'A♠', rank: 'A', suit: '♠' }, { id: 'A♥', rank: 'A', suit: '♥' },
    { id: 'K♦', rank: 'K', suit: '♦' }, { id: 'Joker-♥', rank: 'Joker', suit: '♥' },
  ];
  st6.players[0].known = { 'A♠': true, 'A♥': true, 'K♦': true, 'Joker-♥': true };
  st6.players[1].cards = [
    { id: '9♠', rank: '9', suit: '♠' }, { id: '10♥', rank: '10', suit: '♥' },
    { id: 'J♦', rank: 'J', suit: '♦' }, { id: 'Q♣', rank: 'Q', suit: '♣' },
  ];
  // Bot knows all four opponent cards (all 10+ points).
  st6.players[1].cards.forEach(c => { st6.players[0].known[c.id] = true; });
  st6.deck = [{ id: '8♠', rank: '8', suit: '♠' }];
  E.applyAction(st6, 'p0', { type: 'draw' });
  E.applyAction(st6, 'p0', { type: 'discardDrawn' }); // 8 -> swapSeen effect (offered first)
  b = E.botChooseAction(st6, 'p0');
  scheck('bot 8 (decline case) accepts the offered effect first (Yes)', b && b.type === 'effectAccept', 'got ' + JSON.stringify(b));
  E.applyAction(st6, 'p0', b);
  b = E.botChooseAction(st6, 'p0');
  scheck('bot 8 (decline case) picks a highest own card (Ace, 0)', b && b.type === 'effectSwapOwn' && (b.slot === 0 || b.slot === 1), 'got ' + JSON.stringify(b));
  E.applyAction(st6, 'p0', b);
  b = E.botChooseAction(st6, 'p0', () => 0.99); // deterministic: random pick path
  scheck('bot 8 picks some opponent card to look at', b && b.type === 'effectSwapOther' && b.targetPlayerId === 'p1', 'got ' + JSON.stringify(b));
  const r8b = E.applyAction(st6, 'p0', b);
  scheck('bot 8 (decline case) pair reveal waits for the choice', r8b.ok && r8b.awaitingDecision, 'got ' + JSON.stringify(r8b));
  b = E.botChooseAction(st6, 'p0');
  scheck('bot 8 DECLINES when the opponent card is higher', b && b.type === 'effectSwapDecline', 'got ' + JSON.stringify(b));
  const before6 = JSON.stringify(st6.players[0].cards) + JSON.stringify(st6.players[1].cards);
  E.applyAction(st6, 'p0', b);
  scheck('bot 8 decline leaves both hands unchanged', before6 === JSON.stringify(st6.players[0].cards) + JSON.stringify(st6.players[1].cards) && st6.phase === 'play');
}

console.log(`\nscripted: ${sPass} passed, ${sFail} failed`);
if (sFail) failures += sFail;
process.exit(failures === 0 ? 0 : 1);
