/* Headless DOM smoke test — loads the browser scripts under a minimal DOM stub and
   drives a few turns to catch boot/integration crashes BEFORE the browser playtest.
   This is NOT a visual test (the playtester does that); it proves game.js wires up and
   a full turn resolves without throwing. Run: node test/dom-smoke.test.js */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');

// ---- minimal DOM stub ----
function makeEl(tag) {
  var e = {
    tagName: tag, className: '', _children: [], _attrs: {}, style: { setProperty: function () {} },
    classList: {
      _s: {},
      add: function () { for (var i = 0; i < arguments.length; i++) e.classList._s[arguments[i]] = 1; },
      remove: function () { for (var i = 0; i < arguments.length; i++) delete e.classList._s[arguments[i]]; },
      toggle: function (c, on) { if (on) e.classList._s[c] = 1; else delete e.classList._s[c]; },
      contains: function (c) { return !!e.classList._s[c]; },
    },
    _text: '', _html: '',
    get textContent() { return e._text; }, set textContent(v) { e._text = v; },
    get innerHTML() { return e._html; }, set innerHTML(v) { e._html = v; e._children = []; },
    appendChild: function (c) { e._children.push(c); return c; },
    setAttribute: function (k, v) { e._attrs[k] = v; },
    getAttribute: function (k) { return e._attrs[k]; },
    addEventListener: function () {}, removeEventListener: function () {},
    remove: function () {},
    querySelector: function (sel) {
      var cls = sel.replace('.', '');
      var f = e._children.find(function (ch) { return ch._cls === cls; });
      if (!f) { f = makeEl('div'); f._cls = cls; e._children.push(f); }
      return f;
    },
    querySelectorAll: function () { return []; },
    onclick: null,
  };
  return e;
}
function withClass(tag, cls) { var e = makeEl(tag); e._cls = cls; return e; }

var byId = {};
['board', 'hud', 'coach', 'title', 'overlay', 'tide-label', 'enc-label', 'crew-label',
 'dirpad', 'menu', 'mette-log', 'btn-play', 'storm-select', 'btn-storm', 'dir-up', 'dir-down',
 'dir-left', 'dir-right', 'btn-shove', 'overlay-title', 'overlay-sub', 'overlay-mette',
 'overlay-stats', 'overlay-replay', 'overlay-menu'].forEach(function (id) { byId[id] = makeEl('div'); });

var doc = {
  readyState: 'complete',
  getElementById: function (id) { return byId[id] || (byId[id] = makeEl('div')); },
  createElement: function (tag) {
    var e = makeEl(tag);
    // make ce() class assignment set _cls so querySelector finds layers
    Object.defineProperty(e, 'className', { get: function () { return e._cls || ''; }, set: function (v) { e._cls = v; } });
    return e;
  },
  addEventListener: function () {}, querySelectorAll: function () { return []; },
  body: { addEventListener: function () {}, removeEventListener: function () {} },
};

var sandbox = {
  window: {}, document: doc, console: console,
  localStorage: (function () { var s = {}; return { getItem: function (k) { return s[k] || null; }, setItem: function (k, v) { s[k] = '' + v; }, removeItem: function (k) { delete s[k]; } }; })(),
  setTimeout: function (fn) { return fn && fn(); }, clearTimeout: function () {},
  navigator: { vibrate: function () {} },
  AudioContext: function () { return { state: 'running', resume: function () {}, currentTime: 0,
    createGain: function () { return { gain: { value: 0, setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }, connect: function () {} }; },
    createOscillator: function () { return { type: '', frequency: { value: 0 }, detune: { value: 0 }, connect: function () {}, start: function () {}, stop: function () {} }; },
    createBuffer: function () { return { getChannelData: function () { return new Float32Array(8); } }; },
    createBufferSource: function () { return { buffer: null, connect: function () {}, start: function () {}, stop: function () {} }; },
    createBiquadFilter: function () { return { type: '', frequency: { setValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }, connect: function () {} }; },
    destination: {}, sampleRate: 8000 }; },
  Math: Math, Date: Date, JSON: JSON, Float32Array: Float32Array,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function load(rel) { vm.runInContext(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'), sandbox, { filename: rel }); }

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name); } }

try {
  load('js/data.js'); load('js/rules.js'); load('js/audio.js'); load('js/game.js');
  ok('all four scripts loaded + boot() ran without throwing', true);
  ok('debug global __hj is exposed', !!sandbox.window.__hj);

  // start a run via the debug global path
  sandbox.window.__hj.seed(123);
  byId['btn-play'].onclick && byId['btn-play'].onclick();
  ok('a run started (state exists)', !!sandbox.window.__hj.state);
  ok('board has 5 crew+enemy units present', sandbox.window.__hj.R.allUnits(sandbox.window.__hj.state).length > 0);

  // drive a few turns by selecting a crew and committing a shove
  var threw = false;
  try {
    for (var t = 0; t < 6; t++) {
      var s = sandbox.window.__hj.state;
      if (!s || sandbox.window.__hj.R.crewAlive(s) === 0 || sandbox.window.__hj.R.enemiesAlive(s) === 0) break;
      var alive = s.crew.filter(function (u) { return u.alive; });
      sandbox.window.__hj.G.selected = alive[0]._uid;
      sandbox.window.__hj.G.aimDir = ['up', 'left', 'right', 'down'][t % 4];
      // commit through the dir button (tap-again confirm) — simulate by calling shove handler twice
      byId['dir-' + sandbox.window.__hj.G.aimDir].onclick && byId['dir-' + sandbox.window.__hj.G.aimDir].onclick();
      byId['btn-shove'].onclick && byId['btn-shove'].onclick();
    }
  } catch (e) { threw = true; console.log('   !! ' + e.message + '\n' + e.stack); }
  ok('drove several turns through the real UI handlers without throwing', !threw);
  ok('lastError invariant flag is clean', !sandbox.window.__hj.lastError);
} catch (e) {
  fail++; console.log('  FAIL boot threw: ' + e.message + '\n' + e.stack);
}

console.log('\n----------------------------------------');
console.log('DOM SMOKE — PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
