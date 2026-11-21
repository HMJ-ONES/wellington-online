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
  // Bot knows its own cards: A(-2), K(-1), 9(10), 10(10). Draws a Joker (0).
  // Joker 0 < highest known 10 -> bot should swap it in for a 10.
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
  // ...but snaps when it knows it holds the rank (deterministic rnd=0 beats the 40% roll).
  st4.players[1].cards[0] = { id: '9♠', rank: '9', suit: '♠' };
  st4.players[1].known = { '9♠': true };
  const d = E.botChooseAction(st4, 'p1', () => 0);
  scheck('bot snaps when it KNOWS it holds the matching rank', d && d.type === 'snap' && d.slot === 0, 'got ' + JSON.stringify(d));
}

console.log(`\nscripted: ${sPass} passed, ${sFail} failed`);
if (sFail) failures += sFail;
process.exit(failures === 0 ? 0 : 1);
