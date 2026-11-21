// Round-table layout — headless tests for the pure layout functions.
// layoutModeFor + seatPositionsFor are extracted by regex from the UI
// script block and run in Node — no DOM needed. The CSS/media rules and
// the matchMedia wiring are checked statically. Real-device visual
// checking in landscape/desktop browsers is still unverified.
// Run: node test/layout.test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const uiSrc = blocks.find(s => s.includes('layoutModeFor'));
if (!uiSrc) { console.error('FAIL: UI script block with layoutModeFor not found'); process.exit(1); }

const modeSrc = (uiSrc.match(/function layoutModeFor\(width, height\)\{[\s\S]*?\n\}/) || [])[0];
const seatSrc = (uiSrc.match(/function seatPositionsFor\(n, cx, cy, rx, ry\)\{[\s\S]*?\n\}/) || [])[0];
if (!modeSrc || !seatSrc) { console.error('FAIL: could not extract layoutModeFor/seatPositionsFor from UI script'); process.exit(1); }

const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(modeSrc + '\n' + seatSrc + '\nmodule.exports={layoutModeFor, seatPositionsFor};', sandbox);
const { layoutModeFor, seatPositionsFor } = sandbox.module.exports;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('Layout mode (landscape + wide = round, else stacked):');
check('desktop 1200x800 = round', layoutModeFor(1200, 800) === 'round');
check('desktop 1920x1080 = round', layoutModeFor(1920, 1080) === 'round');
check('landscape 1024x768 = round', layoutModeFor(1024, 768) === 'round');
check('landscape exactly 700 wide = round', layoutModeFor(700, 600) === 'round');
check('699 wide landscape = stacked (too narrow)', layoutModeFor(699, 500) === 'stacked');
check('square 800x800 = stacked (not landscape)', layoutModeFor(800, 800) === 'stacked');
check('portrait phone 500x900 = stacked', layoutModeFor(500, 900) === 'stacked');
check('portrait tablet 800x1200 = stacked', layoutModeFor(800, 1200) === 'stacked');

console.log('Seat positions on the ellipse (2–6 players):');
for (let n = 2; n <= 6; n++) {
  const spots = seatPositionsFor(n, 50, 50, 36, 38);
  check(n + ' players: ' + n + ' positions', spots.length === n);
  check(n + ' players: seat 0 (you) is at the bottom, centred', Math.abs(spots[0].x - 50) < 0.01 && spots[0].y === Math.max.apply(null, spots.map(s => s.y)), 'seat0=' + JSON.stringify(spots[0]));
  check(n + ' players: all seats inside the table (5–95%)', spots.every(s => s.x >= 5 && s.x <= 95 && s.y >= 5 && s.y <= 95));
  const onEllipse = spots.every(s => Math.abs(Math.pow((s.x - 50) / 36, 2) + Math.pow((s.y - 50) / 38, 2) - 1) < 0.001);
  check(n + ' players: every seat sits ON the ellipse', onEllipse);
  let minDist = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y);
    if (d < minDist) minDist = d;
  }
  check(n + ' players: seats are distinct and spread out (min centre distance ' + minDist.toFixed(1) + ' > 25)', minDist > 25);
  if (n >= 3) check(n + ' players: first step from the bottom goes left (clockwise order)', spots[1].x < 50);
  // Non-overlap: model each seat as a box — yours is the big one at the
  // bottom (32% wide x 22% tall), opponents are mini rows (18% x 14%).
  const boxes = spots.map((s, i) => {
    const w = i === 0 ? 32 : 18, h = i === 0 ? 22 : 14;
    return { x0: s.x - w / 2, x1: s.x + w / 2, y0: s.y - h / 2, y1: s.y + h / 2 };
  });
  let overlap = null;
  for (let i = 0; i < n && !overlap; i++) for (let j = i + 1; j < n; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) overlap = i + ' vs ' + j;
  }
  check(n + ' players: no seat boxes overlap', !overlap, overlap ? 'overlap: ' + overlap : '');
}
{
  // Exact spot-check: 4 players sit at bottom / left / top / right.
  const s4 = seatPositionsFor(4, 50, 50, 36, 38);
  check('4 players: bottom, left, top, right',
    Math.abs(s4[0].x - 50) < 0.01 && Math.abs(s4[0].y - 88) < 0.01 &&
    Math.abs(s4[1].x - 14) < 0.01 && Math.abs(s4[1].y - 50) < 0.01 &&
    Math.abs(s4[2].x - 50) < 0.01 && Math.abs(s4[2].y - 12) < 0.01 &&
    Math.abs(s4[3].x - 86) < 0.01 && Math.abs(s4[3].y - 50) < 0.01);
  // 2 players sit opposite: bottom + top.
  const s2 = seatPositionsFor(2, 50, 50, 36, 38);
  check('2 players: bottom + top, opposite each other',
    Math.abs(s2[0].y - 88) < 0.01 && Math.abs(s2[1].y - 12) < 0.01 && Math.abs(s2[0].x - s2[1].x) < 0.01);
}

console.log('Round-table wiring (static):');
check('round-table CSS positions the table + seats', /body\.round-table \.table-wrap\{[^}]*height:540px/.test(html) && /body\.round-table \.seat\{[^}]*position:absolute/.test(html));
check('centre piles sit in the middle in round mode', /body\.round-table \.center-row\{[^}]*left:50%/.test(html));
check('media query is landscape + min-width 700px', html.indexOf("'(orientation: landscape) and (min-width: 700px)'") >= 0);
check('JS toggles the round-table class via matchMedia', /matchMedia/.test(uiSrc) && /classList\.toggle\('round-table'/.test(uiSrc));
check('render() positions the seats (positionRoundSeats)', /positionRoundSeats\(\)/.test(uiSrc));
check('layout change re-renders', /onLayoutChange/.test(uiSrc));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
