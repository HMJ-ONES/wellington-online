// i18n — 7-language switcher (en pt es zh ja fr ko).
// Loads the real page in jsdom (like test/online.test.js) and checks the
// dictionary, the switcher, switching, persistence, and log translation.
// Run: node test/i18n.test.js
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('i18n test skipped: jsdom not installed (npm install --save-dev jsdom)'); process.exit(0); }
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const uiSrc = blocks.find(s => s.includes('BOT_PACE'));
const engineSrc = blocks.find(s => s.includes('module.exports'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

function makeWindow(beforeParse) {
  return new JSDOM(html, {
    url: 'https://wellington-online.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) { if (beforeParse) beforeParse(window); },
  });
}
const evalIn = (dom, expr) => dom.window.eval(expr);
const text = (dom, sel) => { const el = dom.window.document.querySelector(sel); return el ? el.textContent : null; };

(async () => {
  console.log('Dictionary (extracted from the UI script block):');
  const dom = makeWindow();
  await new Promise(r => setTimeout(r, 50));
  const I18N = evalIn(dom, 'I18N');
  const LANGS = evalIn(dom, 'LANGS');
  check('7 languages: en pt es zh ja fr ko', JSON.stringify(LANGS) === JSON.stringify(['en','pt','es','zh','ja','fr','ko']));
  const enKeys = Object.keys(I18N.en);
  check('English has 300+ keys', enKeys.length >= 300, 'keys=' + enKeys.length);
  let parityOk = true, emptyOk = true;
  for (const l of LANGS) {
    const keys = Object.keys(I18N[l]);
    if (keys.length !== enKeys.length) parityOk = false;
    for (const k of enKeys) {
      if (!(k in I18N[l])) parityOk = false;
      const v = I18N[l][k];
      if (typeof v !== 'string' || v.trim() === '') emptyOk = false;
    }
  }
  check('every key present in all 7 languages', parityOk);
  check('no empty translation in any language', emptyOk);
  // Spot-check: the same key differs across languages (real translations,
  // not copies of the English text).
  check('pt menu title is translated', I18N.pt.menu_title !== I18N.en.menu_title && /Jogar/.test(I18N.pt.menu_title));
  check('zh menu title is translated', /玩/.test(I18N.zh.menu_title));
  check('ja menu title is translated', /遊ぶ/.test(I18N.ja.menu_title));
  check('ko menu title is translated', /플레이/.test(I18N.ko.menu_title));
  check('fr menu title is translated', /Jouer/.test(I18N.fr.menu_title));
  check('es menu title is translated', /Jugar/.test(I18N.es.menu_title));
  // Game title stays as-is in every language.
  check('"Wellington" is never translated', LANGS.every(l => I18N[l].btn_wellington.indexOf('WELLINGTON') >= 0));

  console.log('Switcher placement:');
  check('language <select> exists in the header', /<header>[\s\S]*?<select id="langSelect"[\s\S]*?<\/header>/.test(html));
  check('select offers all 7 languages', ['en','pt','es','zh','ja','fr','ko'].every(l => new RegExp('value="' + l + '"').test(html)));
  check('header is sticky (switcher reachable without scrolling)', /header\{[^}]*position:sticky/.test(html));
  check('switcher is NOT inside the table (never overlaps drag-to-snap)', !/class="table-wrap"[\s\S]*?id="langSelect"/.test(html) && html.indexOf('id="langSelect"') < html.indexOf('class="table-wrap"'));
  check('switcher has an accessible label', /aria-label="Language"/.test(html));

  console.log('Default language + switching (live page):');
  check('default is English (navigator en-US, no stored choice)', text(dom, '[data-i18n="menu_title"]') === 'Play Wellington');
  check('document lang is en on load', dom.window.document.documentElement.lang === 'en');
  const sel = dom.window.document.getElementById('langSelect');
  sel.value = 'pt';
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  check('switching to PT changes visible text', text(dom, '[data-i18n="menu_title"]') === 'Jogar Wellington', 'got=' + text(dom, '[data-i18n="menu_title"]'));
  check('document lang follows the switch', dom.window.document.documentElement.lang === 'pt');
  check('choice persists in localStorage under key lang', dom.window.localStorage.getItem('lang') === 'pt');
  check('switching to PT translates the rules button', text(dom, '#btnRules') === '📖 Regras e pontos', 'got=' + text(dom, '#btnRules'));
  sel.value = 'ja';
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  check('switching to JA changes visible text', text(dom, '[data-i18n="menu_title"]') === 'Wellingtonで遊ぶ', 'got=' + text(dom, '[data-i18n="menu_title"]'));
  sel.value = 'en';
  sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  check('switching back to EN restores English', text(dom, '[data-i18n="menu_title"]') === 'Play Wellington');

  console.log('Stored choice wins on load:');
  const dom2 = makeWindow(w => { w.localStorage.setItem('lang', 'es'); });
  await new Promise(r => setTimeout(r, 50));
  check('stored es loads Spanish', text(dom2, '[data-i18n="menu_title"]') === 'Jugar a Wellington', 'got=' + text(dom2, '[data-i18n="menu_title"]'));
  check('stored choice sets document lang', dom2.window.document.documentElement.lang === 'es');

  console.log('t() fallback + parameters:');
  check('missing key falls back to the key itself', evalIn(dom, "t('no_such_key_xyz')") === 'no_such_key_xyz');
  check('parameter substitution works', evalIn(dom, "t('menu_creating', {code: 'KQ7B'})") === 'Creating lobby KQ7B…');
  check('plural {s} renders for 1 and many', evalIn(dom, "t('rooms_bots', {n: 1, plural: 1})") === '1 bot' && evalIn(dom, "t('rooms_bots', {n: 3, plural: 3})") === '3 bots');
  // No unreplaced {token} in any parameterized string, in any language.
  const paramKeys = ['menu_creating','status_over','snap_banner','log_discarded','log_snapped','rooms_open_other','effect_offer','lobby_players','cognac_sips'];
  let tokensOk = true;
  for (const l of LANGS) {
    evalIn(dom, 'currentLang="' + l + '"');
    for (const k of paramKeys) {
      const out = evalIn(dom, "t('" + k + "', {code:'KQ7B', names:'Ana', plural:2, rank:'7', name:'Ana', target:'Bob', whose:'their', ord:'1st', ord2:'2nd', card:'7♠', n:3, deck:10, discard:2, max:6, tips:'ON', label:'Tipsy', time:'2:59', desc:'Peek at one of your own cards'})");
      if (/\{[a-z0-9]+\}/.test(out)) { tokensOk = false; console.log('  leftover token [' + l + '][' + k + ']: ' + out); }
    }
  }
  evalIn(dom, 'currentLang="en"');
  check('no unreplaced {token} in parameterized strings (all languages)', tokensOk);

  console.log('Log translation (real engine log lines, render-time):');
  // Build real log lines with the engine, then translate them in the page.
  const vm = require('vm');
  const sb = { module: { exports: {} }, console };
  vm.createContext(sb);
  vm.runInContext(engineSrc, sb);
  const E = sb.module.exports;
  const st = E.newGame(['Ana', 'Bob'], 5);
  for (const p of st.players) { E.applyAction(st, p.id, { type: 'peek', slot: 0 }); E.applyAction(st, p.id, { type: 'peek', slot: 1 }); E.applyAction(st, p.id, { type: 'peekDone' }); }
  E.applyAction(st, 'p0', { type: 'draw' });
  E.applyAction(st, 'p0', { type: 'discardDrawn' });
  const top = E.topDiscard(st);
  st.players[0].cards[0] = { id: '9' + top.suit, rank: top.rank, suit: top.suit };
  st.players[0].known[st.players[0].cards[0].id] = true;
  E.applyAction(st, 'p0', { type: 'snap', slot: 0 });
  const lines = [...st.log];
  lines.push("Ana called WELLINGTON! Everyone else gets exactly one last turn. Nobody may touch Ana's cards now.");
  lines.push("Bob SNAPPED their 1st card — a 7! (Bob has 3 cards left)");
  lines.push("Ana tried to snap Bob's 2nd card (a 9) — wrong! It was not a 7. The card goes back to Bob; penalty card drawn.");
  lines.push("Ana used the 8 to look at their 1st card and Bob's 3rd card, and kept them as they were.");
  lines.push("Ana used the 7 to swap their 2nd card with Bob's 1st card (blind).");
  lines.push("Ana called Wellington. Lowest score wins: Ana (4).");
  lines.push("Ana disconnected — 10 seconds to rejoin before their seat is withdrawn.");
  let logOk = true;
  for (const l of LANGS) {
    if (l === 'en') continue;
    evalIn(dom, 'currentLang="' + l + '"');
    for (const line of lines) {
      const out = evalIn(dom, 'translateLogLine(' + JSON.stringify(line) + ')');
      if (out === line) { logOk = false; console.log('  untranslated [' + l + ']: ' + line); }
      if (/\{[a-z0-9]+\}/.test(out)) { logOk = false; console.log('  leftover token [' + l + ']: ' + out); }
      if (out.indexOf('Ana') < 0 && line.indexOf('Ana') >= 0) { logOk = false; console.log('  player name lost [' + l + ']: ' + out); }
    }
  }
  evalIn(dom, 'currentLang="en"');
  check('every sampled engine log line translates (6 languages, names kept)', logOk);
  check('English log lines pass through untouched', evalIn(dom, "translateLogLine('Ana drew a card.')") === 'Ana drew a card.');
  check('unknown log line falls back to English', evalIn(dom, "currentLang='fr'; translateLogLine('Some future log line nobody knows.')") === 'Some future log line nobody knows.');

  console.log('Engine errors translate:');
  check('known engine error translates', (() => { evalIn(dom, "currentLang='es'"); const o = evalIn(dom, "translateEngineError('not your turn')"); evalIn(dom, "currentLang='en'"); return o === 'no es tu turno'; })());
  check('room-full error keeps its numbers', (() => { evalIn(dom, "currentLang='zh'"); const o = evalIn(dom, "translateEngineError('room is full (4/6 players, bots included)')"); evalIn(dom, "currentLang='en'"); return o.indexOf('4/6') >= 0 && o.indexOf('room is full') < 0; })());
  check('unknown error passes through in English', evalIn(dom, "translateEngineError('weird new error')") === 'weird new error');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
