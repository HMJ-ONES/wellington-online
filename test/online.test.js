// Wellington Online two-browser test — drives the REAL page code in two
// jsdom windows (host + guest) with an in-memory fake PeerJS, so the
// host<->guest message flow is exercised end to end.
// Needs jsdom: `npm install --save-dev jsdom` in the repo (or anywhere on
// NODE_PATH). Without it the test skips with a clear note instead of
// failing — the engine/bot/cognac/layout suites still run everywhere.
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('online test skipped: jsdom not installed (npm install --save-dev jsdom)'); process.exit(0); }
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

/* ---- Fake PeerJS: in-memory, async delivery, like a real socket ---- */
const registry = new Map();
class FakeConn {
  constructor(localPeer, remotePeer) { this.peer = localPeer; this.remotePeer = remotePeer; this.open = false; this.handlers = {}; this.remote = null; }
  on(ev, cb) { (this.handlers[ev] = this.handlers[ev] || []).push(cb); return this; }
  emit(ev, ...a) { (this.handlers[ev] || []).forEach(cb => { try { cb(...a); } catch (e) { console.error('  [conn handler error]', ev, e); } }); }
  send(data) {
    if (!this.remote || !this.remote.open) return;
    setTimeout(() => { if (this.remote.open) this.remote.emit('data', JSON.parse(JSON.stringify(data))); }, 0);
  }
  close() { if (!this.open) return; this.open = false; setTimeout(() => { this.emit('close'); if (this.remote) this.remote.emit('close'); }, 0); }
}
class FakePeer {
  constructor(id) { this.id = id || ('guest-' + Math.random().toString(36).slice(2, 8)); this.handlers = {}; registry.set(this.id, this); setTimeout(() => this.emit('open', this.id), 0); }
  on(ev, cb) { (this.handlers[ev] = this.handlers[ev] || []).push(cb); return this; }
  emit(ev, ...a) { (this.handlers[ev] || []).forEach(cb => { try { cb(...a); } catch (e) { console.error('  [peer handler error]', ev, e); } }); }
  connect(remoteId) {
    const remote = registry.get(remoteId);
    const a = new FakeConn(this, remote); const b = new FakeConn(remote, this);
    a.remote = b; b.remote = a;
    if (!remote) { setTimeout(() => this.emit('error', { type: 'peer-unavailable' }), 0); return a; }
    setTimeout(() => { a.open = true; b.open = true; remote.emit('connection', b); a.emit('open'); b.emit('open'); }, 0);
    return a;
  }
  destroy() { registry.delete(this.id); }
}

function makeWindow() {
  return new JSDOM(html, {
    url: 'https://wellington-online.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) { window.Peer = FakePeer; },
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const el = (dom, id) => dom.window.document.getElementById(id);
const click = (dom, id) => { const b = el(dom, id); if (!b) throw new Error('no element ' + id); b.click(); };
const visible = (dom, id) => { const b = el(dom, id); return b && !b.classList.contains('hidden'); };
const evalIn = (dom, expr) => dom.window.eval(expr);

(async () => {
  console.log('Two-browser guest flow (fake PeerJS):');
  const host = makeWindow();
  const guest = makeWindow();
  await sleep(100);

  // Host creates a private lobby, 0 bots, max 6.
  el(host, 'nameInput').value = 'HostAlice';
  click(host, 'btnCreate'); await sleep(50);
  if (el(host, 'botPick')) el(host, 'botPick').value = '0';
  if (el(host, 'roomOptCreate') && visible(host, 'roomOptCreate')) { click(host, 'roomOptCreate'); await sleep(50); }
  if (el(host, 'roomOptCreate') && visible(host, 'roomOptCreate')) { click(host, 'roomOptCreate'); await sleep(50); }
  await sleep(100);
  const code = el(host, 'lobbyCode').textContent;
  check('host lobby created with a code', /^[A-Z0-9]{4}$/.test(code), 'code=' + code);

  // Guest joins with the code.
  el(guest, 'nameInput').value = 'GuestBob';
  el(guest, 'joinCode').value = code;
  click(guest, 'btnJoin'); await sleep(300);
  check('guest entered the lobby', visible(guest, 'lobbyScreen'));
  check('guest playMode is online after joining', evalIn(guest, 'playMode') === 'online');

  // Host starts the game.
  click(host, 'btnStartGame'); await sleep(300);
  check('guest sees the game screen in peek phase', visible(guest, 'gameScreen') && evalIn(guest, 'view && view.phase') === 'peek');
  check('guest has its seat id', evalIn(guest, 'myId') === 'p1');
  check('guest Ready button is visible', visible(guest, 'btnPeekDone'));
  check('guest Ready button says I\'m Ready', /I\'m Ready/.test(el(guest, 'btnPeekDone').textContent));

  // REGRESSION (Nov 21, friend test): the guest clicks a card to peek.
  el(guest, 'myCards').children[0].click(); await sleep(300);
  check('guest peek opens the reveal modal', visible(guest, 'revealModal'));
  check('guest peek registers on the host', evalIn(host, 'fullState.players[1].peekedCount') === 1);
  check('guest sees the peeked card as seen', evalIn(guest, '(view.players.find(p=>p.id===myId)||{}).peekedCount') === 1);
  // Close the modal, peek the second card, tap Ready.
  click(guest, 'revealClose'); await sleep(100);
  el(guest, 'myCards').children[1].click(); await sleep(300);
  check('guest second peek registers', evalIn(host, 'fullState.players[1].peekedCount') === 2);
  click(guest, 'revealClose'); await sleep(100);
  click(guest, 'btnPeekDone'); await sleep(300);
  check('guest Ready registers on the host', evalIn(host, 'fullState.players[1].peekDone') === true);
  check('game still waits for the host to ready', evalIn(host, 'fullState.phase') === 'peek');

  // Host peeks once and readies; the game starts.
  el(host, 'myCards').children[0].click(); await sleep(300);
  check('host peek still works', visible(host, 'revealModal'));
  click(host, 'revealClose'); await sleep(100);
  click(host, 'btnPeekDone'); await sleep(300);
  check('game starts once everyone is ready', evalIn(host, 'fullState.phase') === 'play' && evalIn(guest, 'view.phase') === 'play');

  // The guest can play, not just peek: it is the host's turn first, so
  // wait for the host to draw+discard, then the guest draws. The deck top
  // is rigged to a plain 9 (then a plain 3) so the discards trigger no
  // effect — otherwise the turn would stay put for the effect and the
  // turn checks below would be luck of the draw.
  evalIn(host, `(()=>{ fullState.deck[fullState.deck.length-1]={id:'9♠', rank:'9', suit:'♠'}; return true; })()`);
  el(host, 'drawPile').click(); await sleep(300);
  check('host draws (guest sees the drawn phase)', evalIn(guest, 'view.phase') === 'drawn');
  click(host, 'btnDiscardDrawn'); await sleep(300);
  check('turn passes to the guest', evalIn(guest, 'view.turnPlayerId') === 'p1');
  evalIn(host, `(()=>{ fullState.deck[fullState.deck.length-1]={id:'3♠', rank:'3', suit:'♠'}; return true; })()`);
  el(guest, 'drawPile').click(); await sleep(300);
  check('guest draw reaches the host', evalIn(host, 'fullState.phase') === 'drawn' && evalIn(host, 'fullState.drawnBy') === 'p1');

  // Drag-to-snap (Nov 21): the guest discards, then a matching card is
  // rigged into their hand. A click on it must NOT snap; dragging it to
  // the middle must; dropping it elsewhere must cancel.
  click(guest, 'btnDiscardDrawn'); await sleep(300);
  const topRank = evalIn(host, `(()=>{ const top=fullState.discard[fullState.discard.length-1]; const suit=['♠','♥','♦','♣'].find(s=>s!==top.suit); fullState.players[1].cards[0]={id:top.rank+suit, rank:top.rank, suit}; broadcastViews(); return top.rank; })()`);
  await sleep(200);
  check('rigged a matching card for the guest', typeof topRank === 'string' && evalIn(guest, 'view.players.find(p=>p.id===myId).cards.length') === 4);
  const stubMiddle = () => { el(guest, 'discardPile').getBoundingClientRect = () => ({ left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100, x: 100, y: 100 }); };
  const PE = (type, x, y) => new guest.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  const discBefore = evalIn(host, 'fullState.discard.length');
  // A plain click on the matching card snaps nothing.
  el(guest, 'myCards').children[0].click(); await sleep(200);
  check('clicking a matching card does NOT snap', evalIn(host, 'fullState.players[1].cards.length') === 4 && evalIn(host, 'fullState.discard.length') === discBefore);
  // Drag it onto the middle: pointerdown on the card, move into the
  // discard-pile zone, release.
  stubMiddle();
  el(guest, 'myCards').children[0].dispatchEvent(PE('pointerdown', 50, 500));
  guest.window.document.dispatchEvent(PE('pointermove', 150, 150));
  guest.window.document.dispatchEvent(PE('pointerup', 150, 150));
  await sleep(300);
  check('dragging a matching card to the middle snaps it', evalIn(host, 'fullState.players[1].cards.length') === 3 && evalIn(host, 'fullState.discard.length') === discBefore + 1 && evalIn(host, 'fullState.discard[fullState.discard.length-1].rank') === topRank);
  // Dropping a card outside the middle cancels — nothing happens.
  stubMiddle();
  const discAfterSnap = evalIn(host, 'fullState.discard.length');
  el(guest, 'myCards').children[0].dispatchEvent(PE('pointerdown', 50, 500));
  guest.window.document.dispatchEvent(PE('pointermove', 60, 520));
  guest.window.document.dispatchEvent(PE('pointerup', 60, 520));
  await sleep(200);
  check('dropping a card outside the middle cancels the snap', evalIn(host, 'fullState.players[1].cards.length') === 3 && evalIn(host, 'fullState.discard.length') === discAfterSnap);

  // Cross-player snap choice (owner rule, Nov 22): rig a matching card
  // into the HOST's hand; the guest drags it to the middle. The snap
  // opens a choice for the guest — give the host one of their cards, or
  // let the host draw a new one. The guest picks "draw".
  const topRank2 = evalIn(host, `(()=>{ const top=fullState.discard[fullState.discard.length-1]; const suit=['♠','♥','♦','♣'].find(s=>s!==top.suit); fullState.players[0].cards[0]={id:top.rank+suit, rank:top.rank, suit}; broadcastViews(); return top.rank; })()`);
  await sleep(200);
  stubMiddle();
  const oppCard = guest.window.document.querySelector('[data-pid="p0"][data-slot="0"]');
  check('host card is draggable for a cross-player snap', !!oppCard && oppCard.classList.contains('snapdrag'));
  oppCard.dispatchEvent(PE('pointerdown', 50, 500));
  guest.window.document.dispatchEvent(PE('pointermove', 150, 150));
  guest.window.document.dispatchEvent(PE('pointerup', 150, 150));
  await sleep(300);
  check('cross-player snap opens the choice for the snapper', evalIn(host, 'fullState.pendingSnapChoice&&fullState.pendingSnapChoice.by') === 'p1' && evalIn(host, 'fullState.pendingSnapChoice&&fullState.pendingSnapChoice.target') === 'p0' && evalIn(host, 'fullState.players[0].cards.length') === 3);
  check('guest sees the snap choice pop-up', evalIn(guest, '!!view.pendingSnapChoice') === true && visible(guest, 'snapChoiceModal'));
  click(guest, 'btnSnapDraw'); await sleep(300);
  check('choice draw: the victim draws a new card', evalIn(host, 'fullState.players[0].cards.length') === 4 && evalIn(host, 'fullState.pendingSnapChoice') === null && evalIn(guest, 'view.pendingSnapChoice') === null);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
