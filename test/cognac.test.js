// Cognac button — headless tests for the pure level function.
// The UI script defines ONE editable const (COGNAC) and a small pure
// function (drunkLevelForSips) near the top of the UI script. Those are
// extracted by regex and run in Node — no DOM needed. The wobble itself
// is CSS, and the sip/sober-up wiring is UI-only (local, cosmetic).
// Run: node test/cognac.test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const uiSrc = blocks.find(s => s.includes('COGNAC'));
if (!uiSrc) { console.error('FAIL: UI script block with COGNAC not found'); process.exit(1); }

const cogSrc = (uiSrc.match(/const COGNAC = \{[^}]*\};/) || [])[0];
const fnSrc = (uiSrc.match(/function drunkLevelForSips\(sips\)\{[\s\S]*?\n\}/) || [])[0];
if (!cogSrc || !fnSrc) { console.error('FAIL: could not extract COGNAC/drunkLevelForSips from UI script'); process.exit(1); }

const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(cogSrc + '\n' + fnSrc + '\nmodule.exports={drunkLevelForSips};', sandbox);
const drunkLevelForSips = sandbox.module.exports.drunkLevelForSips;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

console.log('Cognac thresholds (COGNAC const):');
check('0 sips = sober', drunkLevelForSips(0).level === 'sober');
check('1–4 sips = sober', [1, 2, 3, 4].every(n => drunkLevelForSips(n).level === 'sober'));
check('5 sips = mild', drunkLevelForSips(5).level === 'mild');
check('6–14 sips = mild', [6, 9, 14].every(n => drunkLevelForSips(n).level === 'mild'));
check('mild lasts 3 minutes', drunkLevelForSips(5).ms === 180000);
check('15 sips = strong', drunkLevelForSips(15).level === 'strong');
check('16+ sips = strong', [16, 20, 100].every(n => drunkLevelForSips(n).level === 'strong'));
check('strong lasts 6 minutes', drunkLevelForSips(15).ms === 360000);
check('mild label is Tipsy', drunkLevelForSips(5).label === 'Tipsy');
check('strong label is Wasted', drunkLevelForSips(15).label === 'Wasted');
check('sober has no duration', drunkLevelForSips(0).ms === 0);

// The UI wiring (sip counter, timers, sober-up, wobble classes) is checked
// statically: the pieces must all be present in the UI script.
console.log('Cognac UI wiring (static):');
check('Sip button exists in the page', (html.match(/Sip Cognac/g) || []).length >= 1);
check('Sober up button exists', /Sober up/.test(html));
check('sip counter shown ("Sips:")', /Sips:/.test(html));
check('effect time shown ("left")', /left/.test(uiSrc));
check('wobble is scoped to the table/menu, not modals', /body\.drunk-mild \.table-wrap/.test(html) && /body\.drunk-strong \.table-wrap/.test(html) && !/drunk-mild[^{]*\.modal/.test(html) && !/drunk-strong[^{]*\.modal/.test(html));
check('prefers-reduced-motion disables the wobble', /@media \(prefers-reduced-motion: reduce\)/.test(html) && /animation:none/.test(html));
check('sober-up clears the effect (soberUp function)', /function soberUp/.test(uiSrc));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
