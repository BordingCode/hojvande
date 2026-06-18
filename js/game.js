/* HØJVANDE — game controller (DOM grid). Renders the pure rules-engine state,
   draws the FULL telegraph (enemy intents + shove ghost + flood-forecast + danger rim),
   animates the calm shove→drown beat, and runs the short escalating run.
   The rules live in rules.js (pure + tested). This file is presentation + flow. */
(function () {
  'use strict';
  var R = window.HJ_RULES, DATA = window.HJ_DATA, A = window.HJ_AUDIO;
  var SIZE = R.SIZE;
  var SAVE_KEY = 'hojvande.save.v1';

  // ---------- run / game state ----------
  var G = {
    state: null,            // current rules-engine state
    encIndex: 0,            // which encounter in the run
    storm: DATA.STORMS[0],  // current storm-tide tier
    crewRoster: DATA.CREW.slice(), // crew that survive carry between encounters (recoverable per-run)
    selected: null,         // selected crew _uid
    aimDir: null,           // currently-hovered shove direction
    busy: false,            // animation in flight — block input
    over: false,
    seed: 1,
  };
  var save = loadSave();

  // ---------- DOM ----------
  var el = {};
  function $(id) { return document.getElementById(id); }
  function ce(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function boot() {
    el.board = $('board'); el.hud = $('hud'); el.coach = $('coach');
    el.title = $('title'); el.overlay = $('overlay');
    el.tideLabel = $('tide-label'); el.encLabel = $('enc-label'); el.crewLabel = $('crew-label');
    el.dirpad = $('dirpad'); el.menu = $('menu'); el.log = $('mette-log');
    bindMenu();
    bindDirpad();
    showMenu();
    // unlock audio on first touch anywhere
    document.body.addEventListener('pointerdown', function once() { A.unlock(); document.body.removeEventListener('pointerdown', once); }, { once: true });
  }

  // ---------- menu ----------
  function bindMenu() {
    $('btn-play').onclick = function () { A.unlock(); startRun(DATA.STORMS[0]); };
    var sw = $('storm-select');
    DATA.STORMS.forEach(function (s, i) { var o = ce('option'); o.value = i; o.textContent = s.name + (i ? ' — ' + s.desc : ''); sw.appendChild(o); });
    $('btn-storm').onclick = function () {
      A.unlock();
      var idx = +sw.value; startRun(DATA.STORMS[idx]);
    };
    renderMetteLog();
  }
  function showMenu() { el.menu.classList.add('active'); el.overlay.classList.remove('active'); }
  function renderMetteLog() {
    var lines = save.metteLines || 0;
    el.log.innerHTML = '';
    if (!lines) { el.log.appendChild(ce('p', 'log-empty', 'Mettes vejrlog er tom endnu. Hver tur, du fuldfører, skriver hun en linje.')); return; }
    for (var i = 0; i < lines && i < DATA.METTE_LOG.length; i++) {
      el.log.appendChild(ce('p', 'log-line', DATA.METTE_LOG[i]));
    }
  }

  // ---------- run flow ----------
  function startRun(storm) {
    G.storm = storm; G.encIndex = 0; G.over = false;
    G.crewRoster = DATA.CREW.slice();
    G.seed = (Date.now() % 100000) + 1;
    el.menu.classList.remove('active');
    loadEncounter();
  }

  function loadEncounter() {
    var enc = DATA.ENCOUNTERS[G.encIndex];
    G.state = R.newState(enc, { seed: G.seed + G.encIndex * 17, storm: G.storm.id === 'none' ? null : G.storm, crew: G.crewRoster });
    G.selected = firstAliveCrew();
    G.aimDir = null; G.busy = false;
    buildBoard();
    render();
    maybeCoach();
  }
  function firstAliveCrew() { var u = G.state.crew.find(function (c) { return c.alive; }); return u ? u._uid : null; }

  // ---------- board build ----------
  var cells = []; // [r][c] -> {tile, layers...}
  function buildBoard() {
    el.board.innerHTML = ''; cells = [];
    for (var r = 0; r < SIZE; r++) {
      cells[r] = [];
      for (var c = 0; c < SIZE; c++) {
        var t = ce('button', 'tile');
        t.setAttribute('data-c', c); t.setAttribute('data-r', r);
        t.appendChild(ce('div', 'water-fill'));
        t.appendChild(ce('div', 'forecast'));
        t.appendChild(ce('div', 'danger-rim'));
        t.appendChild(ce('div', 'ghost'));
        t.appendChild(ce('div', 'intent'));
        var unit = ce('div', 'unit'); t.appendChild(unit);
        (function (cc, rr) { t.onclick = function () { onTileTap(cc, rr); }; })(c, r);
        el.board.appendChild(t);
        cells[r][c] = t;
      }
    }
  }

  // ---------- render (full telegraph) ----------
  function render() {
    var s = G.state;
    // clear per-cell layers
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
      var t = cells[r][c];
      var depth = (s.flood[c + ',' + r] || 0);
      t.classList.toggle('flooded', depth >= 1);
      t.classList.toggle('deep', depth >= 2);
      var fc = t.querySelector('.forecast'); fc.classList.remove('show', 'deep');
      var dr = t.querySelector('.danger-rim'); dr.classList.remove('show');
      var gh = t.querySelector('.ghost'); gh.className = 'ghost';
      var it = t.querySelector('.intent'); it.className = 'intent';
      var un = t.querySelector('.unit'); un.className = 'unit';
      un.textContent = '';
      t.classList.remove('selected', 'selectable');
    }
    // units
    R.allUnits(s).forEach(function (u) {
      if (!u.alive) return;
      var un = cells[u.r][u.c].querySelector('.unit');
      un.classList.add(u._side === 'crew' ? 'crew' : 'enemy');
      un.classList.add('u-' + u.id);
      un.style.setProperty('--ucol', u.color);
      un.textContent = u.glyph;
      if (u._side === 'crew' && u._uid === G.selected) cells[u.r][u.c].classList.add('selected');
    });
    // flood FORECAST overlay (tiles whose water rises next turn). p.depth = the new depth.
    (s.shownForecast || []).forEach(function (p) {
      var fc = cells[p[1]][p[0]].querySelector('.forecast');
      fc.classList.add('show');
      if (p.depth >= 2) fc.classList.add('deep');         // deepening to lethal-for-everyone
      // DANGER RIM: a unit standing here that WOULD DROWN at the incoming depth (depth-aware:
      // swimmers only flagged when it deepens to 2). Every crew death is pre-shown the turn before.
      var u = R.unitAt(s, p[0], p[1]);
      if (u && (u.swim ? p.depth >= 2 : p.depth >= 1)) cells[p[1]][p[0]].querySelector('.danger-rim').classList.add('show');
    });
    // ENEMY INTENTS (arrow + target marker)
    s.enemies.forEach(function (e) {
      if (!e.alive || !e.intent) return;
      drawIntent(e);
    });
    // selectable crew
    s.crew.forEach(function (u) { if (u.alive) cells[u.r][u.c].classList.add('selectable'); });
    // ghost preview for the current aim
    if (G.selected != null && G.aimDir) drawGhost();
    updateHud();
  }

  function drawIntent(e) {
    var it = e.intent;
    if (it.kind === 'wait') {
      var w = cells[e.r][e.c].querySelector('.intent');
      w.classList.add('show', 'wait'); w.textContent = '■';
      return;
    }
    var to = it.to;
    if (!to) return;
    if (it.kind === 'pull' || it.kind === 'shove') {
      // arrow shown ON THE VICTIM'S tile, pointing the way it gets dragged/shoved.
      var im = cells[it.from[1]][it.from[0]].querySelector('.intent');
      im.classList.add('show', it.kind);
      im.textContent = arrowFor(sign(to[0] - it.from[0]), sign(to[1] - it.from[1]));
      // mark where the victim lands — skip if it's off-board (resolution fizzles such a shove;
      // the rules engine guards inBounds, so the render path must too)
      var vrow = cells[to[1]]; var vcell = vrow && vrow[to[0]];
      if (vcell) { vcell.querySelector('.ghost').classList.add('show', 'enemy-target'); }
      return;
    }
    // step: arrow on the enemy's own tile pointing toward where it moves
    var src = cells[e.r][e.c].querySelector('.intent');
    src.classList.add('show', it.kind);
    src.textContent = arrowFor(sign(to[0] - e.c), sign(to[1] - e.r));
    var drow = cells[to[1]]; var dcell = drow && drow[to[0]];
    if (dcell) { dcell.querySelector('.ghost').classList.add('show', 'enemy-target'); }
  }
  function arrowFor(dc, dr) { if (dr < 0) return '↑'; if (dr > 0) return '↓'; if (dc < 0) return '←'; if (dc > 0) return '→'; return '·'; }
  function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }

  function drawGhost() {
    var u = R.byUid(G.state, G.selected);
    if (!u) return;
    var pv = R.previewShove(G.state, G.selected, G.aimDir, u.power);
    if (!pv || pv.blocked) return;
    pv.moves.forEach(function (m) {
      var g = cells[m.to[1]][m.to[0]].querySelector('.ghost');
      var mover = R.byUid(G.state, m.uid);
      g.classList.add('show', mover._side === 'crew' ? 'ghost-crew' : 'ghost-enemy');
      if (pv.drowns.indexOf(m.uid) >= 0) { g.classList.add('ghost-drown'); g.textContent = '☠'; }
      else g.textContent = mover.glyph;
    });
  }

  function updateHud() {
    var s = G.state;
    el.encLabel.textContent = (G.encIndex + 1) + '/' + DATA.ENCOUNTERS.length + '  ' + DATA.ENCOUNTERS[G.encIndex].name;
    el.crewLabel.textContent = '⚓ ' + R.crewAlive(s) + '  ·  fjender ' + R.enemiesAlive(s);
    // tide status
    var next = (s.shownForecast || []).length;
    el.tideLabel.textContent = next ? '🌊 stiger næste tur' : '🌊 ude';
    if (G.storm.id !== 'none') el.tideLabel.textContent += '  (' + G.storm.name + ')';
  }

  // ---------- input ----------
  function onTileTap(c, r) {
    if (G.busy || G.over) return;
    var u = R.unitAt(G.state, c, r);
    if (u && u._side === 'crew' && u.alive) { G.selected = u._uid; G.aimDir = null; A.sfx.select(); render(); }
    else if (G.selected != null) {
      // tapping a tile adjacent in a cardinal line from the selected crew = aim that way
      var me = R.byUid(G.state, G.selected);
      var dc = sign(c - me.c), dr = sign(r - me.r);
      if ((dc !== 0) !== (dr !== 0)) { // strictly cardinal
        var dir = dr < 0 ? 'up' : dr > 0 ? 'down' : dc < 0 ? 'left' : 'right';
        aim(dir);
      }
    }
  }
  function bindDirpad() {
    ['up', 'down', 'left', 'right'].forEach(function (dir) {
      var b = $('dir-' + dir);
      if (b) b.onclick = function () { aim(dir); };
    });
    $('btn-shove').onclick = function () { commit(); };
  }
  function aim(dir) {
    if (G.busy || G.over || G.selected == null) return;
    if (G.aimDir === dir) { commit(); return; } // tap again to confirm
    G.aimDir = dir; A.sfx.select(); render();
    $('btn-shove').classList.add('armed');
  }

  // ---------- commit a turn ----------
  function commit() {
    if (G.busy || G.over || G.selected == null || !G.aimDir) return;
    var u = R.byUid(G.state, G.selected);
    var pv = R.previewShove(G.state, G.selected, G.aimDir, u.power);
    if (!pv || pv.blocked || pv.moves.length === 0) { A.sfx.select(); return; }
    G.busy = true;
    $('btn-shove').classList.remove('armed');
    var commitShove = { unitUid: G.selected, dir: G.aimDir, distance: u.power };
    A.sfx.shove();
    // resolve in the pure engine, then animate the log
    var log = R.resolveTurn(G.state, commitShove);
    // INVARIANT: never let an un-telegraphed crew death resolve
    try { R.assertTelegraphed(log); }
    catch (err) { console.error(err); window.__hj && (window.__hj.lastError = err.message); }
    G.aimDir = null;
    animateLog(log, function () {
      G.busy = false;
      G.selected = firstAliveCrew();
      render();
      maybeCoach();   // turn-aware hints (the tide hint fires after the first move)
      checkOutcome();
    });
  }

  // ---------- animate the resolved log (calm: slide + foam, no shake) ----------
  function animateLog(log, done) {
    var floods = log.filter(function (e) { return e.t === 'flood'; });
    var moves = log.filter(function (e) { return e.t === 'move'; });
    var drowns = log.filter(function (e) { return e.t === 'drown'; });
    // 1) slide moves (visual: just re-render positions; CSS transition on .unit handles slide)
    render(); // positions already updated in engine → the transition animates them
    if (moves.length) A.sfx.move();
    // 2) flood rise
    setTimeout(function () {
      floods.forEach(function (f) { cells[f.at[1]][f.at[0]].classList.add('flooding'); });
      if (floods.length) { A.sfx.flood(); }
      // 3) drowns: foam splash + gulp
      setTimeout(function () {
        drowns.forEach(function (d) {
          spawnSplash(d.at[0], d.at[1], d.side);
        });
        if (drowns.length) {
          A.sfx.drown();
          if (drowns.some(function (d) { return d.side === 'crew'; })) setTimeout(function () { A.sfx.crewLost(); }, 220);
        }
        setTimeout(function () {
          floods.forEach(function (f) { cells[f.at[1]][f.at[0]].classList.remove('flooding'); });
          done();
        }, drowns.length ? 520 : 200);
      }, 200);
    }, 200);
  }

  function spawnSplash(c, r, side) {
    var t = cells[r][c];
    var fx = ce('div', 'splash' + (side === 'crew' ? ' splash-crew' : ''));
    for (var i = 0; i < 7; i++) {
      var d = ce('div', 'foam');
      var ang = (Math.PI * 2 * i) / 7 + Math.random() * 0.5;
      var dist = 14 + Math.random() * 12;
      d.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      d.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
      fx.appendChild(d);
    }
    t.appendChild(fx);
    setTimeout(function () { fx.remove(); }, 700);
  }

  // ---------- outcome ----------
  function checkOutcome() {
    var s = G.state;
    if (R.crewAlive(s) === 0) { endRun(false); return; }
    if (R.enemiesAlive(s) === 0) {
      // encounter cleared — survivors carry forward (recoverable per-run loss)
      G.crewRoster = s.crew.filter(function (u) { return u.alive; }).map(function (u) {
        return DATA.CREW.find(function (d) { return d.id === u.id; });
      });
      if (G.encIndex + 1 >= DATA.ENCOUNTERS.length) { endRun(true); return; }
      G.encIndex += 1;
      A.sfx.win();
      setTimeout(function () { loadEncounter(); }, 900);
    }
  }

  function endRun(won) {
    G.over = true;
    // Mette's weather-log gains a line each run-end (non-power replay hook)
    save.metteLines = Math.min((save.metteLines || 0) + 1, DATA.METTE_LOG.length);
    save.runs = (save.runs || 0) + 1;
    if (won) save.wins = (save.wins || 0) + 1;
    persist();
    if (won) A.sfx.win(); else A.sfx.lose();
    showOverlay(won);
  }

  function showOverlay(won) {
    el.overlay.classList.add('active');
    var newLine = (save.metteLines && DATA.METTE_LOG[save.metteLines - 1]) || '';
    $('overlay-title').textContent = won ? 'Holdet er hjemme' : 'Havet tog dem';
    $('overlay-sub').textContent = won
      ? 'Du overlevede tidevandet. Mette tilføjer en linje til vejrloggen.'
      : 'Et skub for sent. Mette tilføjer alligevel en linje — havet husker alt.';
    $('overlay-mette').textContent = newLine;
    $('overlay-stats').textContent = 'Ture: ' + (save.runs || 0) + '  ·  sejre: ' + (save.wins || 0);
    $('overlay-replay').onclick = function () { el.overlay.classList.remove('active'); startRun(G.storm); };
    $('overlay-menu').onclick = function () { el.overlay.classList.remove('active'); renderMetteLog(); showMenu(); };
  }

  // ---------- coach hints (first-run only; no tutorial wall) ----------
  function maybeCoach() {
    if (save.coachDone) return;
    var seen = save.coachSeen || {};
    if (G.encIndex === 0 && !seen.intro) {
      coach('Vælg en besætning, sigt med pilene, tryk SKUB. Du angriber ikke — du skubber fjender ud i havet, så drukner de.');
      seen.intro = true;
    } else if (G.encIndex === 0 && !seen.tide && G.state.turn >= 1) {
      coach('🌊 De stiplede blå felter oversvømmer NÆSTE tur — og fjenderne FLYGTER fra vandet. Skub dem ned i det, før de slipper væk. Rød kant = din egen besætning drukner der.');
      seen.tide = true;
    } else if (G.encIndex === 2 && !seen.deep) {
      coach('Vandet bliver DYBT (mørke felter). Dybt vand drukner ALLE — også Dykkeren. Tidevandet er dit ur: ryd brættet, før havet tager det hele.');
      seen.deep = true; save.coachDone = true; // last hint
    }
    save.coachSeen = seen; persist();
  }
  function coach(msg) {
    el.coach.textContent = msg; el.coach.classList.add('show');
    clearTimeout(coach._t);
    coach._t = setTimeout(function () { el.coach.classList.remove('show'); }, 6500);
    el.coach.onclick = function () { el.coach.classList.remove('show'); };
  }

  // ---------- save ----------
  function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; } }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

  // ---------- debug global ----------
  window.__hj = {
    get state() { return G.state; },
    get G() { return G; },
    R: R, DATA: DATA,
    seed: function (n) { G.seed = n; },
    jump: function (encIdx) { G.encIndex = encIdx | 0; loadEncounter(); },
    storm: function (id) { var s = DATA.STORMS.find(function (x) { return x.id === id; }); if (s) G.storm = s; },
    win: function () { G.state.enemies.forEach(function (e) { e.alive = false; }); checkOutcome(); },
    kill: function () { G.state.crew.forEach(function (c) { c.alive = false; }); checkOutcome(); },
    forecast: function () { return R.forecastFlood(G.state); },
    lastError: null,
    resetSave: function () { localStorage.removeItem(SAVE_KEY); save = {}; renderMetteLog(); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
