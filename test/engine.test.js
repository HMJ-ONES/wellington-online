// Wellington Online engine tests — extracts the pure engine <script>
// from index.html and runs it in Node. No DOM needed.
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

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
function card(rank, suit) { return { id: rank === 'Joker' ? 'Joker-' + suit : rank + suit, rank, suit }; }
function finishPeek(st) {
  // Every player peeks 2 (slots 0,1) and presses Done.
  for (const p of st.players) {
    let r = E.applyAction(st, p.id, { type: 'peek', slot: 0 }); if (!r.ok) throw new Error('peek 0: ' + r.error);
    r = E.applyAction(st, p.id, { type: 'peek', slot: 1 }); if (!r.ok) throw new Error('peek 1: ' + r.error);
    r = E.applyAction(st, p.id, { type: 'peekDone' }); if (!r.ok) throw new Error('peekDone: ' + r.error);
  }
  if (st.phase !== 'play') throw new Error('expected play phase after peek, got ' + st.phase);
}
// Put the game in 'play' with controlled hands. hands: array of [rank,suit] arrays.
// discardTop: [rank,suit] or null. turnIdx: whose turn.
function riggedGame(hands, opts) {
  opts = opts || {};
  const names = hands.map((h, i) => 'P' + i);
  const st = E.newGame(names, 7);
  finishPeek(st);
  st.players.forEach((p, i) => {
    p.cards = hands[i].map(([r, s]) => card(r, s));
    p.known = {};
    // The player knows their first two cards (as if peeked).
    p.cards.slice(0, 2).forEach(c => { p.known[c.id] = true; });
    p.peekedSlots = [0, 1]; p.peekedCount = 2; p.peekDone = true;
  });
  if (opts.discardTop) { st.discard = [card(opts.discardTop[0], opts.discardTop[1])]; st.snapWindow = { open: true, topRank: opts.discardTop[0] }; }
  if (opts.deck) st.deck = opts.deck.map(([r, s]) => card(r, s));
  if (opts.turnIdx !== undefined) st.turnIdx = opts.turnIdx;
  if (opts.phase) st.phase = opts.phase;
  if (opts.turnCount !== undefined) st.turnCount = opts.turnCount;
  return st;
}
function setKnown(st, playerIdx, slot) {
  const p = st.players[playerIdx];
  p.known[p.cards[slot].id] = true;
}

console.log('Deck & deal:');
{
  const deck = E.buildDeck();
  check('deck has 54 cards', deck.length === 54);
  check('deck has exactly 2 jokers', deck.filter(c => c.rank === 'Joker').length === 2);
  check('deck has 4 suits x 13 ranks', new Set(deck.map(c => c.id)).size === 54);
  const st = E.newGame(['A', 'B', 'C'], 42);
  check('3 players each dealt 4 cards', st.players.every(p => p.cards.length === 4));
  check('deck has 54-12 = 42 left after dealing 3x4', st.deck.length === 42);
  check('game starts in peek phase', st.phase === 'peek');
  const a = JSON.stringify(E.newGame(['A', 'B'], 99).players.map(p => p.cards));
  const b = JSON.stringify(E.newGame(['A', 'B'], 99).players.map(p => p.cards));
  check('same seed reproduces identical deal', a === b);
  let threw = false;
  try { E.newGame(['Solo'], 1); } catch (e) { threw = true; }
  check('1 player rejected (needs 2-6)', threw);
  threw = false;
  try { E.newGame(['a','b','c','d','e','f','g'], 1); } catch (e) { threw = true; }
  check('7 players rejected (needs 2-6)', threw);
  const st6 = E.newGame(['a','b','c','d','e','f'], 1);
  check('6 players allowed', st6.players.length === 6 && st6.players.every(p => p.cards.length === 4));
}

console.log('Points table (CARD_POINTS — editable const):');
{
  check('numbered 2-10 are 10', ['2','3','4','5','6','7','8','9','10'].every(r => E.cardPoints(card(r, '♠')) === 10));
  check('J and Q are 11', E.cardPoints(card('J', '♠')) === 11 && E.cardPoints(card('Q', '♠')) === 11);
  check('Joker is 0', E.cardPoints(card('Joker', '♥')) === 0);
  check('K is -1', E.cardPoints(card('K', '♠')) === -1);
  check('A is -2', E.cardPoints(card('A', '♠')) === -2);
  check('CARD_POINTS is exported and editable', E.CARD_POINTS['K'] === -1 && E.CARD_POINTS['A'] === -2);
  check('scoreOf sums a hand', E.scoreOf([card('A','♠'), card('K','♥'), card('5','♦'), card('Joker','♥')]) === -2 + -1 + 10 + 0);
}

console.log('Peek phase:');
{
  const st = E.newGame(['A', 'B'], 5);
  const r1 = E.applyAction(st, 'p0', { type: 'peek', slot: 0 });
  check('peek slot 0 ok, reveals that card', r1.ok && r1.revealed && r1.revealed.rank === st.players[0].cards[0].rank);
  check('third peek rejected (max 2)', E.applyAction(st, 'p0', { type: 'peek', slot: 1 }).ok && !E.applyAction(st, 'p0', { type: 'peek', slot: 2 }).ok);
  check('re-peeking same slot rejected', !E.applyAction(st, 'p0', { type: 'peek', slot: 0 }).ok);
  check('draw rejected during peek phase', !E.applyAction(st, 'p0', { type: 'draw' }).ok);
  check('peek after peekDone rejected', (() => { E.applyAction(st, 'p0', { type: 'peekDone' }); return !E.applyAction(st, 'p0', { type: 'peek', slot: 3 }).ok; })());
  const st2 = E.newGame(['A', 'B'], 5);
  finishPeek(st2);
  check('all peekDone -> play phase, P0 starts', st2.phase === 'play' && st2.turnIdx === 0);
}

console.log('Turn: draw + discard, draw + blind swap:');
{
  // P0 draws a 3 (deck top) and discards it; turn passes to P1.
  const st = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['5','♣']],
  ], { deck: [['7','♥'],['3','♠']] }); // NB: draws pop from the END — 3♠ is drawn first, then 7♥
  const before = st.players[1].cards.length;
  let r = E.applyAction(st, 'p0', { type: 'draw' });
  check('draw ok, drawn card is deck top (3♠)', r.ok && r.drawn && r.drawn.rank === '3' && st.phase === 'drawn');
  check('draw out of turn rejected', !E.applyAction(st, 'p1', { type: 'discardDrawn' }).ok);
  r = E.applyAction(st, 'p0', { type: 'discardDrawn' });
  check('discard drawn ok, lands in middle', r.ok && st.discard.length === 1 && st.discard[0].rank === '3');
  check('turn passes to P1 after discard', st.turnIdx === 1 && st.phase === 'play');
  check('P0 hand unchanged by discarding drawn card', st.players[0].cards.length === 4);
  // Swap: P1 draws 7♥, swaps it in for slot 0 (2♠, blind) — 2♠ lands in middle.
  r = E.applyAction(st, 'p1', { type: 'draw' });
  check('P1 draws 7♥', r.ok && r.drawn.rank === '7');
  r = E.applyAction(st, 'p1', { type: 'swap', slot: 0 });
  check('blind swap ok', r.ok && r.swappedOut.rank === '2');
  check('swapped-out card lands in middle', st.discard[st.discard.length - 1].rank === '2');
  check('drawn card now sits in slot 0', st.players[1].cards[0].rank === '7');
  check('P1 still has 4 cards', st.players[1].cards.length === 4);
  check('turn passes back to P0', st.turnIdx === 0);
  check('cannot swap without drawing first', !E.applyAction(st, 'p0', { type: 'swap', slot: 0 }).ok);
}

console.log('Card effects on a NORMAL turn discard (exactly one effect):');
{
  // Discarding a drawn 5 -> peekOwn effect; resolves, then turn passes.
  function discardDrawnRank(rank) {
    const st = riggedGame([
      [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
      [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
    ], { deck: [['7','♥'],[rank,'♠']] }); // draws pop from the END
    const r = E.applyAction(st, 'p0', { type: 'draw' });
    if (!r.ok) throw new Error('draw: ' + r.error);
    const d = E.applyAction(st, 'p0', { type: 'discardDrawn' });
    return { st, d };
  }
  let t = discardDrawnRank('5');
  check('discarding a drawn 5 triggers peekOwn, turn does NOT pass yet', t.d.ok && t.d.effect === 'peekOwn' && t.st.phase === 'effect' && t.st.turnIdx === 0);
  check('other actions blocked while effect pending', !E.applyAction(t.st, 'p0', { type: 'draw' }).ok);
  let r = E.applyAction(t.st, 'p0', { type: 'effectPeekOwn', slot: 2 });
  check('5 resolves by peeking own card, reveals it', r.ok && r.revealed && r.revealed.rank === '9');
  check('turn passes after 5 resolves', t.st.turnIdx === 1 && t.st.phase === 'play');
  // 6 -> peekOther
  t = discardDrawnRank('6');
  check('discarding a drawn 6 triggers peekOther', t.d.effect === 'peekOther' && t.st.phase === 'effect');
  r = E.applyAction(t.st, 'p0', { type: 'effectPeekOther', targetPlayerId: 'p1', slot: 0 });
  check('6 resolves by peeking opponent card', r.ok && r.revealed && r.revealed.rank === '2');
  check('turn passes after 6 resolves', t.st.turnIdx === 1);
  // 6 cannot target yourself
  t = discardDrawnRank('6');
  check('6 cannot target yourself', !E.applyAction(t.st, 'p0', { type: 'effectPeekOther', targetPlayerId: 'p0', slot: 0 }).ok);
  // 7 -> blind swap (two steps), neither card revealed
  t = discardDrawnRank('7');
  check('discarding a drawn 7 triggers swapBlind', t.d.effect === 'swapBlind');
  r = E.applyAction(t.st, 'p0', { type: 'effectSwapOwn', slot: 0 });
  check('7 step 1 (own card) ok, blind — nothing revealed', r.ok && !r.revealed);
  r = E.applyAction(t.st, 'p0', { type: 'effectSwapOther', targetPlayerId: 'p1', slot: 0 });
  check('7 step 2 swaps blind', r.ok && t.st.players[0].cards[0].rank === '2' && t.st.players[1].cards[0].rank === 'A');
  check('turn passes after 7 resolves', t.st.turnIdx === 1);
  // 8 -> seen swap, both cards revealed
  t = discardDrawnRank('8');
  check('discarding a drawn 8 triggers swapSeen', t.d.effect === 'swapSeen');
  r = E.applyAction(t.st, 'p0', { type: 'effectSwapOwn', slot: 1 });
  check('8 step 1 reveals own card (K)', r.ok && r.revealedOwn && r.revealedOwn.rank === 'K');
  r = E.applyAction(t.st, 'p0', { type: 'effectSwapOther', targetPlayerId: 'p1', slot: 3 });
  check('8 step 2 reveals both cards', r.ok && r.revealed && r.revealed.own.rank === 'K' && r.revealed.other.rank === '6');
  check('8 swapped the cards', t.st.players[0].cards[1].rank === '6' && t.st.players[1].cards[3].rank === 'K');
  // Swapped-OUT table card also triggers its effect (it is the card placed in the middle).
  const st2 = riggedGame([
    [['5','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
  ], { deck: [['7','♥'],['10','♠']] });
  E.applyAction(st2, 'p0', { type: 'draw' });
  const sw = E.applyAction(st2, 'p0', { type: 'swap', slot: 0 });
  check('swapping out a 5 triggers peekOwn (swapped-out card is the discard)', sw.ok && sw.effect === 'peekOwn' && st2.phase === 'effect');
  E.applyAction(st2, 'p0', { type: 'effectPeekOwn', slot: 1 });
  check('turn passes after swapped-out 5 effect resolves', st2.turnIdx === 1);
  // Non-effect rank triggers nothing.
  t = discardDrawnRank('9');
  check('discarding a 9 triggers no effect, turn passes at once', t.d.ok && !t.d.effect && t.st.turnIdx === 1 && t.st.phase === 'play');
  // effectSkip is allowed
  t = discardDrawnRank('5');
  r = E.applyAction(t.st, 'p0', { type: 'effectSkip' });
  check('effect may be skipped', r.ok && r.skipped && t.st.turnIdx === 1);
}

console.log('Snap — correct, wrong, multiple, and snaps NEVER trigger effects:');
{
  // Correct snap: top is 9♦, P1 holds a 9 (slot 2, known). Snaps it out.
  let st = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['9','♠'],['6','♣']],
  ], { discardTop: ['9','♦'], turnIdx: 0 });
  setKnown(st, 1, 2);
  let r = E.applyAction(st, 'p1', { type: 'snap', slot: 2 });
  check('correct snap ok', r.ok && r.correct && r.snapped.rank === '9');
  check('snapped card leaves hand (4 -> 3)', st.players[1].cards.length === 3);
  check('snapped card lands in middle, window stays open on 9', st.discard[st.discard.length - 1].rank === '9' && st.snapWindow.open && st.snapWindow.topRank === '9');
  check('snap does not pass the turn', st.turnIdx === 0 && st.phase === 'play');
  // MULTIPLE SNAPS: same player holds TWO 9s; snaps both in one window.
  st = riggedGame([
    [['A','♠'],['K','♥'],['2','♦'],['3','♣']],
    [['9','♠'],['9','♥'],['4','♦'],['6','♣']],
  ], { discardTop: ['9','♦'], turnIdx: 0 });
  setKnown(st, 1, 0); setKnown(st, 1, 1);
  r = E.applyAction(st, 'p1', { type: 'snap', slot: 0 });
  check('multiple snaps: first 9 snaps', r.ok && r.correct && st.players[1].cards.length === 3);
  // After removing slot 0, the second 9 is now at slot 0.
  r = E.applyAction(st, 'p1', { type: 'snap', slot: 0 });
  check('multiple snaps: second 9 snaps in the SAME window', r.ok && r.correct && st.players[1].cards.length === 2);
  check('multiple snaps: window still open on 9 afterwards', st.snapWindow.open && st.snapWindow.topRank === '9');
  // Snapped 5/6/7/8 trigger NO effect — one test per rank.
  for (const rank of ['5', '6', '7', '8']) {
    st = riggedGame([
      [['A','♠'],['K','♥'],['2','♦'],['3','♣']],
      [[rank,'♠'],['9','♥'],['4','♦'],['6','♣']],
    ], { discardTop: [rank,'♦'], turnIdx: 0 });
    setKnown(st, 1, 0);
    r = E.applyAction(st, 'p1', { type: 'snap', slot: 0 });
    check('snap of a ' + rank + ' triggers NO effect (effect=null, no pending effect, phase stays play)',
      r.ok && r.correct && r.effect === null && !st.pendingEffect && st.phase === 'play');
  }
  // Snap by the player whose turn it is, before drawing, also effect-free.
  st = riggedGame([
    [['5','♠'],['K','♥'],['2','♦'],['3','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
  ], { discardTop: ['5','♦'], turnIdx: 0 });
  setKnown(st, 0, 0);
  r = E.applyAction(st, 'p0', { type: 'snap', slot: 0 });
  check('turn player snapping a 5: no effect, still their turn to draw', r.ok && r.correct && !st.pendingEffect && st.phase === 'play' && st.turnIdx === 0);
  // Wrong snap: P1 tries a 3 against a 9 — card returns, penalty card drawn.
  st = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
  ], { discardTop: ['9','♦'], turnIdx: 0, deck: [['K','♠'],['7','♥']] });
  setKnown(st, 1, 1); // P1 knows slot 1 is a 3
  r = E.applyAction(st, 'p1', { type: 'snap', slot: 1 });
  check('wrong snap ok:false? no — ok:true, correct:false', r.ok && r.correct === false);
  check('wrong snap: attempted card shown', r.attempted && r.attempted.rank === '3');
  check('wrong snap: card returns to its slot (still 4 cards + penalty = 5)', st.players[1].cards.length === 5 && st.players[1].cards[1].rank === '3');
  check('wrong snap: penalty card added face-down and LOCKED', st.players[1].cards[4].locked === true);
  check('wrong snap: window stays open on 9 (no discard happened)', st.snapWindow.open && st.snapWindow.topRank === '9');
  check('wrong snap: turn does not pass', st.turnIdx === 0);
  // No snap window -> snap rejected.
  const st2 = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
  ], { turnIdx: 0 });
  check('snap with empty discard pile rejected', !E.applyAction(st2, 'p1', { type: 'snap', slot: 0 }).ok);
}

console.log('Penalty card: locked at once, normal from next turn on (owner correction #1):');
{
  // P1 wrong-snaps, gets a locked penalty card. It cannot be snapped or
  // swapped out right away; from P1's next turn on it is a normal card.
  const st = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
  ], { discardTop: ['9','♦'], turnIdx: 0, deck: [['7','♥'],['8','♣'],['10','♦'],['9','♠']] });
  // Pop order: 9♠ = penalty card, 10♦ = P0's draw (no effect), 8♣ = P1's draw.
  setKnown(st, 1, 1);
  let r = E.applyAction(st, 'p1', { type: 'snap', slot: 1 });
  if (!r.ok || r.correct !== false) throw new Error('setup wrong snap failed');
  const penSlot = 4; // penalty card appended at the end
  const penId = st.players[1].cards[penSlot].id;
  check('penalty card is present and locked', st.players[1].cards[penSlot].locked === true);
  // The penalty card happens to be a 9 (deck top) — same rank as the window.
  // Trying to snap it RIGHT AWAY must be rejected, not a second wrong snap.
  r = E.applyAction(st, 'p1', { type: 'snap', slot: penSlot });
  check('penalty card CANNOT be snapped immediately (rejected, not a wrong snap)', !r.ok && /penalty|next turn/i.test(r.error || ''));
  check('rejected snap attempt drew NO second penalty card', st.players[1].cards.length === 5);
  // Play P0's turn out (draw + discard) so the turn passes to P1.
  // P0 draws 10♦ (no effect) and discards it.
  r = E.applyAction(st, 'p0', { type: 'draw' });
  check('P0 draws (setup)', r.ok);
  r = E.applyAction(st, 'p0', { type: 'discardDrawn' });
  check('P0 discards, turn passes to P1', r.ok && st.turnIdx === 1);
  check('penalty card unlocked at the start of P1\'s next turn', st.players[1].cards[penSlot].locked !== true);
  // Now P1's turn: draw, then swap the (now normal) penalty card out.
  r = E.applyAction(st, 'p1', { type: 'draw' });
  check('P1 draws on their next turn', r.ok && st.phase === 'drawn');
  const drawnRank = r.drawn.rank;
  r = E.applyAction(st, 'p1', { type: 'swap', slot: penSlot });
  check('penalty card CAN be swapped out from the next turn on', r.ok && r.swappedOut && r.swappedOut.id === penId);
  check('swapped-out penalty card landed in the middle', st.discard[st.discard.length - 1].id === penId);
  // Same-turn lock: a penalty taken DURING your own turn stays locked
  // for the rest of that turn (it is not your "next turn" yet).
  const st2 = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
  ], { discardTop: ['9','♦'], turnIdx: 0, deck: [['7','♥'],['3','♠']] });
  // P0 draws first (phase drawn, holding 3♠), then wrong-snaps with slot 1 (K vs 9).
  E.applyAction(st2, 'p0', { type: 'draw' });
  setKnown(st2, 0, 1);
  r = E.applyAction(st2, 'p0', { type: 'snap', slot: 1 }); // K vs 9: wrong
  check('wrong snap during own drawn phase gives penalty', r.ok && r.correct === false && st2.players[0].cards.length === 5);
  check('penalty taken mid-turn is still locked this turn', st2.players[0].cards[4].locked === true);
  r = E.applyAction(st2, 'p0', { type: 'swap', slot: 4 });
  check('penalty card CANNOT be swapped out in the same turn it was taken', !r.ok);
  r = E.applyAction(st2, 'p0', { type: 'discardDrawn' });
  check('player can still finish the turn by discarding the drawn card', r.ok);
}

console.log('Wellington:');
{
  // P0 calls Wellington on their turn before drawing. P1 gets one last
  // turn, then the game ends. Caller protection + button-once enforced.
  const st = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
    [['10','♠'],['10','♥'],['10','♦'],['10','♣']],
  ], { deck: [['3','♠'],['7','♥'],['8','♦']] });
  check('Wellington rejected when not your turn', !E.applyAction(st, 'p1', { type: 'wellington' }).ok);
  E.applyAction(st, 'p0', { type: 'draw' });
  check('Wellington rejected after drawing', !E.applyAction(st, 'p0', { type: 'wellington' }).ok);
  // Reset: fresh game, call before drawing.
  const st2 = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
    [['10','♠'],['10','♥'],['10','♦'],['10','♣']],
  ], { deck: [['8','♦'],['7','♥'],['3','♠']] }); // pops: 3♠ (P1), 7♥ (P2)
  let r = E.applyAction(st2, 'p0', { type: 'wellington' });
  check('Wellington call ok', r.ok);
  check('final round starts, turn goes to next player (P1)', st2.phase === 'final' && st2.turnIdx === 1);
  check('remaining final turns = every other player (P1, P2)', st2.wellington.remaining.join(',') === 'p1,p2');
  // Caller protection: 6 cannot target P0.
  E.applyAction(st2, 'p1', { type: 'draw' }); // P1 draws 3♠
  const d = E.applyAction(st2, 'p1', { type: 'discardDrawn' }); // 3, no effect
  check('P1 final turn completes, turn goes to P2', st2.turnIdx === 2 && st2.phase === 'final');
  // P2 draws 7♥, discards it -> effect 7, try to target the caller P0.
  E.applyAction(st2, 'p2', { type: 'draw' });
  const d2 = E.applyAction(st2, 'p2', { type: 'discardDrawn' });
  check('P2 discarding a 7 triggers the effect even in the final round', d2.effect === 'swapBlind' && st2.phase === 'effect');
  E.applyAction(st2, 'p2', { type: 'effectSwapOwn', slot: 0 });
  r = E.applyAction(st2, 'p2', { type: 'effectSwapOther', targetPlayerId: 'p0', slot: 0 });
  check('7 CANNOT target the Wellington caller', !r.ok);
  r = E.applyAction(st2, 'p2', { type: 'effectSwapOther', targetPlayerId: 'p1', slot: 0 });
  check('7 CAN target another non-caller player', r.ok);
  check('game ends after the last final turn', st2.phase === 'over' && !!st2.winners);
  check('Wellington can only be called once (game over anyway)', !E.applyAction(st2, 'p1', { type: 'wellington' }).ok);
  // Button-once in a live game: after a call, a second call is rejected.
  const st3 = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
  ], { deck: [['3','♠'],['7','♥']] });
  E.applyAction(st3, 'p0', { type: 'wellington' });
  check('second Wellington call rejected while final round runs', !E.applyAction(st3, 'p1', { type: 'wellington' }).ok);
  // Caller-last-in-order still gives every other player one turn.
  const st4 = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
    [['10','♠'],['10','♥'],['10','♦'],['10','♣']],
  ], { turnIdx: 2, deck: [['8','♦'],['9','♠'],['4','♦'],['3','♠']] }); // pops: 3♠ (P0), 4♦ (P1) — both effect-free
  r = E.applyAction(st4, 'p2', { type: 'wellington' });
  check('caller is last in order: remaining wraps to P0, P1', r.ok && st4.wellington.remaining.join(',') === 'p0,p1');
  E.applyAction(st4, 'p0', { type: 'draw' }); E.applyAction(st4, 'p0', { type: 'discardDrawn' });
  check('after P0 final turn, P1 is next (not game over yet)', st4.phase === 'final' && st4.turnIdx === 1);
  E.applyAction(st4, 'p1', { type: 'draw' }); E.applyAction(st4, 'p1', { type: 'discardDrawn' });
  check('after P1 final turn the game ends', st4.phase === 'over');
}

console.log('Deck reshuffle & exhaustion:');
{
  const st = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
  ], { deck: [['3','♠']] });
  st.discard = [card('4','♠'), card('5','♥'), card('6','♦')]; // top is 6♦
  st.snapWindow = { open: true, topRank: '6' };
  let r = E.applyAction(st, 'p0', { type: 'draw' }); // takes the last deck card
  check('draw last deck card ok', r.ok && st.deck.length === 0);
  E.applyAction(st, 'p0', { type: 'discardDrawn' }); // 3♠ on top; discard now 4 cards
  r = E.applyAction(st, 'p1', { type: 'draw' }); // deck empty -> reshuffle (top 3♠ stays)
  check('draw triggers reshuffle when deck is empty', r.ok && r.drawn);
  check('reshuffle kept the top discard card in the middle', st.discard.length === 1 && st.discard[0].rank === '3');
  check('reshuffled deck has the other discards minus the one just drawn', st.deck.length === 2);
  // Both exhausted: deck empty + only 1 discard card -> draw ends the game.
  const st2 = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['2','♠'],['3','♥'],['4','♦'],['6','♣']],
  ], { deck: [] });
  st2.discard = [card('7','♠')]; st2.snapWindow = { open: true, topRank: '7' };
  r = E.applyAction(st2, 'p0', { type: 'draw' });
  check('draw with deck + discard both exhausted ends the game', r.ok && st2.phase === 'over');
}

console.log('0-card instant end & lowest-wins incl. ties:');
{
  // P1 snaps their last card (only 1 card left) -> game ends at once, P1 scores 0.
  const st = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],
    [['9','♠']],
  ], { discardTop: ['9','♦'], turnIdx: 0 });
  // Rigged game gave P1 4 cards; trim to 1 and mark it known.
  st.players[1].cards = [card('9','♠')];
  st.players[1].known = { '9♠': true };
  const r = E.applyAction(st, 'p1', { type: 'snap', slot: 0 });
  check('snapping last card ends the game immediately', r.ok && r.gameOver && st.phase === 'over');
  check('0-card player scores 0 and wins', st.winners.join(',') === 'p1' && st.scores.find(s => s.playerId === 'p1').total === 0);
  // Lowest wins; tie shares.
  const st2 = riggedGame([
    [['A','♠'],['K','♥'],['9','♦'],['9','♣']],   // -2-1+10+10 = 17
    [['A','♠'],['K','♥'],['2','♦'],['3','♣']],   // -2-1+10+10 = 17
    [['10','♠'],['10','♥'],['10','♦'],['10','♣']], // 40
  ], { turnIdx: 0 });
  E.applyAction(st2, 'p0', { type: 'wellington' });
  E.applyAction(st2, 'p1', { type: 'draw' }); // deck top is random here; just discard
  E.applyAction(st2, 'p1', { type: 'discardDrawn' });
  // P2's final turn may hit an effect; resolve generically.
  let guard = 0;
  while (st2.phase !== 'over' && guard++ < 10) {
    const cur = st2.players[st2.turnIdx];
    if (st2.pendingEffect) { E.applyAction(st2, st2.pendingEffect.by, { type: 'effectSkip' }); continue; }
    if (st2.phase === 'drawn') { E.applyAction(st2, cur.id, { type: 'discardDrawn' }); continue; }
    E.applyAction(st2, cur.id, { type: 'draw' });
  }
  check('game ended after final round', st2.phase === 'over');
  check('lowest total wins', st2.winners.length === 2 && st2.winners.indexOf('p0') >= 0 && st2.winners.indexOf('p1') >= 0, 'winners=' + (st2.winners || []).join(','));
  check('scores computed per player', st2.scores.find(s => s.playerId === 'p2').total === 40);
}

console.log('Filtered view never leaks hidden cards:');
{
  const st = E.newGame(['Alice', 'Bob'], 11);
  finishPeek(st);
  // Alice peeked slots 0,1 only; Bob's cards are all hidden to her.
  const view = E.filteredView(st, 'p0');
  const bobView = view.players[1];
  check('opponent cards are backs (rank null) when unseen', bobView.cards.every(c => c.rank === null && c.suit === null));
  check('own peeked cards ARE visible to owner', view.players[0].cards[0].rank !== null && view.players[0].cards[1].rank !== null);
  check('own unpeeked cards are backs', view.players[0].cards[2].rank === null && view.players[0].cards[3].rank === null);
  const json = JSON.stringify(view);
  // Bob's actual card ranks must not appear anywhere except as discard
  // ranks (discard is empty here) — check his unpeeked card ids are absent.
  const bobIds = st.players[1].cards.map(c => c.id);
  check('view JSON contains no hidden opponent card id', bobIds.every(id => json.indexOf(id) < 0));
  check('view hides the draw pile (count only)', view.deckCount === st.deck.length && !('deck' in view));
  check('view hides the raw known map', !('known' in view.players[0]) && json.indexOf('"known":{') < 0);
  // After reveal, everything is visible.
  E.applyAction(st, 'p0', { type: 'wellington' });
  let guard = 0;
  while (st.phase !== 'over' && guard++ < 10) {
    const cur = st.players[st.turnIdx];
    if (st.pendingEffect) { E.applyAction(st, st.pendingEffect.by, { type: 'effectSkip' }); continue; }
    if (st.phase === 'drawn') { E.applyAction(st, cur.id, { type: 'discardDrawn' }); continue; }
    E.applyAction(st, cur.id, { type: 'draw' });
  }
  const overView = E.filteredView(st, 'p0');
  check('at reveal every card value is shown', overView.phase === 'over' && overView.players.every(p => p.cards.every(c => c.rank !== null)));
  // Serialization round-trip.
  const st3 = E.newGame(['A', 'B'], 3);
  const s2 = E.deserializeState(E.serializeState(st3));
  check('state survives serialize/deserialize', JSON.stringify(s2.players) === JSON.stringify(st3.players) && s2.phase === st3.phase);
}

console.log('legalActions helper:');
{
  const st = E.newGame(['A', 'B'], 5);
  const acts = E.legalActions(st, 'p0');
  check('peek phase offers peek + peekDone', acts.some(a => a.type === 'peek') && acts.some(a => a.type === 'peekDone'));
  finishPeek(st);
  const acts2 = E.legalActions(st, 'p0');
  check('turn player offered draw + wellington', acts2.some(a => a.type === 'draw') && acts2.some(a => a.type === 'wellington'));
  const acts3 = E.legalActions(st, 'p1');
  check('non-turn player offered neither draw nor wellington', !acts3.some(a => a.type === 'draw') && !acts3.some(a => a.type === 'wellington'));
}

console.log('Public rooms directory (headless — PeerJS part is code-verified only):');
{
  check('10 directory slots', E.DIRECTORY_SLOTS === 10);
  check('directory peer ids are wellington-directory-v1-1..10',
    E.directoryPeerId(1) === 'wellington-directory-v1-1' && E.directoryPeerId(10) === 'wellington-directory-v1-10');
  const info = E.createRoomInfo({ code: 'kq7b', hostName: 'Henrique', players: 3, maxPlayers: 4, bots: 1, status: 'waiting' });
  check('room info normalises code to uppercase', info.code === 'KQ7B');
  check('room info keeps host/players/max/bots/status', info.hostName === 'Henrique' && info.players === 3 && info.maxPlayers === 4 && info.bots === 1 && info.status === 'waiting');
  check('maxPlayers clamps to 2-6 (9 -> 6, 1 -> 2)', E.createRoomInfo({ code: 'A', maxPlayers: 9 }).maxPlayers === 6 && E.createRoomInfo({ code: 'A', maxPlayers: 1 }).maxPlayers === 2);
  check('room info defaults to waiting + max 6', E.createRoomInfo({ code: 'B' }).status === 'waiting' && E.createRoomInfo({ code: 'B' }).maxPlayers === 6);
  check('players never exceeds maxPlayers', E.createRoomInfo({ code: 'C', players: 9, maxPlayers: 4 }).players === 4);
  const open = E.createRoomInfo({ code: 'D', players: 2, maxPlayers: 4, bots: 1, status: 'waiting' });
  check('canJoinRoom: waiting room with a free seat admits', E.canJoinRoom(open, 2).ok);
  check('canJoinRoom: full room rejects (bots count toward the total)', !E.canJoinRoom(open, 4).ok && /full/i.test(E.canJoinRoom(open, 4).error));
  check('canJoinRoom: 1 host + 2 bots in a max-3 room is full', !E.canJoinRoom(E.createRoomInfo({ code: 'E', players: 3, maxPlayers: 3, bots: 2 }), 3).ok);
  check('canJoinRoom: playing room rejects', !E.canJoinRoom(E.createRoomInfo({ code: 'F', players: 2, maxPlayers: 6, status: 'playing' }), 2).ok);
  check('canJoinRoom: unknown room rejects', !E.canJoinRoom(null, 0).ok);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
