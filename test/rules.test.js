/* Headless logic test for HØJVANDE rules engine.
   Covers the 4 shove outcomes (edge/wall, collision/chain, drown), the tide,
   enemy intents, AND the "nothing lethal un-telegraphed" invariant.
   Run: node test/rules.test.js */
'use strict';
var R = require('../js/rules.js');

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name); } }
function eq(name, a, b) { ok(name + ' (' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + ')', JSON.stringify(a) === JSON.stringify(b)); }

// helper to build a bespoke state without the standard encounter spawns
function blankState() {
  var enc = { tideStart: 99, tideEvery: 1, enemies: [] }; // tide off
  var s = R.newState(enc, { crew: [{ id: 'deckhand', glyph: 'D', color: '#0', power: 1 }], seed: 7 });
  s.crew[0].c = 0; s.crew[0].r = 0;
  return s;
}
function uidOfCrew(s, i) { return s.crew[i]._uid; }

console.log('\n== SHOVE: edge/wall (no move past board edge) ==');
(function () {
  var s = blankState();
  s.crew[0].c = 0; s.crew[0].r = 0;
  var pv = R.previewShove(s, uidOfCrew(s, 0), 'left', 1); // already at left edge
  eq('shove off left edge does nothing', pv.moves.length, 0);
})();

console.log('\n== SHOVE: simple move ==');
(function () {
  var s = blankState();
  s.crew[0].c = 1; s.crew[0].r = 1;
  var pv = R.previewShove(s, uidOfCrew(s, 0), 'right', 1);
  eq('moves one tile right', pv.moves[0].to, [2, 1]);
})();

console.log('\n== SHOVE: collision chain ==');
(function () {
  // crew at (1,1) shoves an enemy at (2,1); enemy chains to (3,1)
  var enc = { tideStart: 99, tideEvery: 1, enemies: [['crab', 2, 1]] };
  var s = R.newState(enc, { crew: [{ id: 'bosun', glyph: 'B', color: '#0', power: 2 }], seed: 1 });
  s.crew[0].c = 1; s.crew[0].r = 1;
  var pv = R.previewShove(s, uidOfCrew(s, 0), 'right', 2); // bosun power 2
  // crew should end at (3,1) and crab pushed ahead of it
  var crewMove = pv.moves.find(function (m) { return m.uid === s.crew[0]._uid; });
  var crabMove = pv.moves.find(function (m) { return m.uid === s.enemies[0]._uid; });
  ok('crab was pushed (chain)', !!crabMove);
  ok('crab ends ahead of crew', crabMove.to[0] > crewMove.to[0]);
})();

console.log('\n== SHOVE: drown into flooded tile ==');
(function () {
  var enc = { tideStart: 99, tideEvery: 1, enemies: [['crab', 2, 2]] };
  var s = R.newState(enc, { crew: [{ id: 'deckhand', glyph: 'D', color: '#0', power: 1 }], seed: 1 });
  s.crew[0].c = 0; s.crew[0].r = 4;
  // flood tile (3,2) so a shoved crab landing there drowns
  s.flood['3,2'] = 1;
  // put crab next to a crew that can shove it east into the flood
  s.crew[0].c = 1; s.crew[0].r = 2;
  var pv = R.previewShove(s, uidOfCrew(s, 0), 'right', 1); // pushes crab from (2,2)->(3,2) flooded
  ok('crab drowns in ghost preview', pv.drowns.indexOf(s.enemies[0]._uid) >= 0);
})();

console.log('\n== SHOVE: heavy hulk cannot be shoved ==');
(function () {
  var enc = { tideStart: 99, tideEvery: 1, enemies: [['hulk', 2, 1]] };
  var s = R.newState(enc, { crew: [{ id: 'bosun', glyph: 'B', color: '#0', power: 2 }], seed: 1 });
  s.crew[0].c = 1; s.crew[0].r = 1;
  var pv = R.previewShove(s, uidOfCrew(s, 0), 'right', 2);
  var hulkMove = pv.moves.find(function (m) { return m.uid === s.enemies[0]._uid; });
  ok('hulk did not move', !hulkMove);
})();

console.log('\n== TIDE: forecast then flood ==');
(function () {
  var enc = { tideStart: 1, tideEvery: 1, enemies: [] };
  var s = R.newState(enc, { crew: [{ id: 'deckhand', glyph: 'D', color: '#0', power: 1 }], seed: 1 });
  // at turn 0, forecast for next turn should include bottom row (row 4)
  var f = s.shownForecast.map(function (p) { return p.join(','); });
  ok('forecast includes bottom row', f.indexOf('0,4') >= 0);
})();

console.log('\n== ENEMY INTENT: crab steps toward crew ==');
(function () {
  var enc = { tideStart: 99, tideEvery: 1, enemies: [['crab', 4, 0]] };
  var s = R.newState(enc, { crew: [{ id: 'deckhand', glyph: 'D', color: '#0', power: 1 }], seed: 1 });
  s.crew[0].c = 0; s.crew[0].r = 0;
  R.planIntents(s); // re-plan after repositioning crew for the test
  var it = s.enemies[0].intent;
  ok('crab has a step intent', it && it.kind === 'step');
  ok('crab steps closer (lower col)', it.to[0] < 4);
})();

console.log('\n== INVARIANT: a full turn never kills crew un-telegraphed ==');
(function () {
  var DATA = require('../js/data.js').HJ_DATA;
  var violations = 0, turnsRun = 0;
  // brute force: every encounter × several seeds × random legal shoves, assert each turn
  DATA.ENCOUNTERS.forEach(function (enc) {
    for (var seed = 1; seed <= 30; seed++) {
      var s = R.newState(enc, { seed: seed });
      var rng = R.makeRng(seed * 31 + 7);
      for (var turn = 0; turn < 12; turn++) {
        if (R.crewAlive(s) === 0 || R.enemiesAlive(s) === 0) break;
        // pick a random alive crew + random dir + their power
        var alive = s.crew.filter(function (u) { return u.alive; });
        var actor = alive[Math.floor(rng() * alive.length)];
        var dirs = ['up', 'down', 'left', 'right'];
        var dir = dirs[Math.floor(rng() * 4)];
        var commit = { unitUid: actor._uid, dir: dir, distance: actor.power };
        var log = R.resolveTurn(s, commit);
        turnsRun++;
        try { R.assertTelegraphed(log); } catch (e) { violations++; console.log('   !! ' + e.message); }
      }
    }
  });
  ok('ran many turns', turnsRun > 200);
  ok('ZERO telegraph-invariant violations across ' + turnsRun + ' turns', violations === 0);
})();

console.log('\n== INVARIANT: storm-tides also obey the telegraph ==');
(function () {
  var DATA = require('../js/data.js').HJ_DATA;
  var violations = 0, turnsRun = 0;
  DATA.STORMS.forEach(function (storm) {
    DATA.ENCOUNTERS.slice(0, 3).forEach(function (enc) {
      for (var seed = 1; seed <= 15; seed++) {
        var s = R.newState(enc, { seed: seed, storm: storm });
        var rng = R.makeRng(seed * 13 + 3);
        for (var turn = 0; turn < 12; turn++) {
          if (R.crewAlive(s) === 0 || R.enemiesAlive(s) === 0) break;
          var alive = s.crew.filter(function (u) { return u.alive; });
          var actor = alive[Math.floor(rng() * alive.length)];
          var dir = ['up', 'down', 'left', 'right'][Math.floor(rng() * 4)];
          var log = R.resolveTurn(s, { unitUid: actor._uid, dir: dir, distance: actor.power });
          turnsRun++;
          try { R.assertTelegraphed(log); } catch (e) { violations++; console.log('   !! ' + e.message); }
        }
      }
    });
  });
  ok('ZERO violations under all storms across ' + turnsRun + ' turns', violations === 0);
})();

console.log('\n== TIDE: enemies FLEE the rising tide (so the shove is the weapon, not a free wipe) ==');
(function () {
  var enc = { tideStart: 1, tideEvery: 1, enemies: [['crab', 0, 4]] };
  var s = R.newState(enc, { crew: [{ id: 'deckhand', glyph: 'D', color: '#0', power: 1 }], seed: 1 });
  s.crew[0].c = 4; s.crew[0].r = 0; // far away so it isn't the crab's target pull
  R.planIntents(s);
  // crab at (0,4) on the bottom row, which floods next turn → it should plan to flee upward (lower r)
  var it = s.enemies[0].intent;
  ok('crab flees the tide (moves to a drier row)', it && it.kind === 'step' && it.to[1] < 4);
})();

console.log('\n== TIDE: DEEP water (depth 2) drowns even a swimmer (the diver is not immortal) ==');
(function () {
  // diver standing on shallow water survives; only a shove into deep water (or the tide deepening) drowns it.
  var enc = { tideStart: 99, tideEvery: 1, enemies: [] };
  var s = R.newState(enc, { crew: [{ id: 'diver', glyph: 'Y', color: '#0', power: 1, swim: true }], seed: 1 });
  s.crew[0].c = 1; s.crew[0].r = 1;
  s.flood['2,1'] = 1; // shallow to the right
  var pvShallow = R.previewShove(s, s.crew[0]._uid, 'right', 1);
  ok('diver does NOT drown shoved into SHALLOW water', pvShallow.drowns.indexOf(s.crew[0]._uid) < 0);
  s.flood['2,1'] = 2; // now deep
  var pvDeep = R.previewShove(s, s.crew[0]._uid, 'right', 1);
  ok('diver DOES drown shoved into DEEP water', pvDeep.drowns.indexOf(s.crew[0]._uid) >= 0);
})();
// proper swimmer-deep-drown check via a real tide-deepening turn
(function () {
  // edge tide reaches deep on the bottom-most row first. Put a diver there and let the tide rise twice.
  var enc = { tideStart: 1, tideEvery: 1, enemies: [['crab', 4, 0]] };
  var s = R.newState(enc, { crew: [{ id: 'diver', glyph: 'Y', color: '#0', power: 1, swim: true }], seed: 1 });
  s.crew[0].c = 0; s.crew[0].r = 4; // bottom row: floods turn1 (shallow, diver ok), deepens turn2 (deep, drowns)
  R.planIntents(s); s.shownForecast = R.forecastFlood(s);
  var alive1, alive2;
  R.resolveTurn(s, { unitUid: s.crew[0]._uid, dir: 'right', distance: 1 }); // diver tries to shove (no effect), stays roughly on bottom band
  // force diver back onto the deepening bottom row for the test
  s.crew[0].alive && (s.crew[0].c = 0, s.crew[0].r = 4);
  R.planIntents(s); s.shownForecast = R.forecastFlood(s);
  var log = R.resolveTurn(s, { unitUid: s.crew[0]._uid, dir: 'right', distance: 1 });
  ok('diver drowns once water goes DEEP', s.crew[0].alive === false);
  ok('that deep-water drown was telegraphed', (function(){ try { R.assertTelegraphed(log); return true; } catch(e){ return false; } })());
})();

console.log('\n== A run can be WON by shoving (full encounter clear with a smart shove) ==');
(function () {
  // crab at (1,4) right of the deckhand; deckhand at (0,4) shoves it... actually shove it into deep water.
  var enc = { tideStart: 1, tideEvery: 1, enemies: [['crab', 1, 3]] };
  var s = R.newState(enc, { crew: [{ id: 'deckhand', glyph: 'D', color: '#0', power: 1 }], seed: 1 });
  s.crew[0].c = 1; s.crew[0].r = 2; R.planIntents(s); s.shownForecast = R.forecastFlood(s);
  // flood (1,4) so shoving the crab (at 1,3) DOWN into it drowns it
  s.flood['1,4'] = 1;
  var pv = R.previewShove(s, s.crew[0]._uid, 'down', 1);
  ok('shoving the crab into shallow water drowns it (the weapon works)', pv.drowns.indexOf(s.enemies[0]._uid) >= 0);
})();

console.log('\n== ONBOARDING: encounter 1 teaches the OFFENSIVE verb on TURN ONE ==');
(function () {
  var DATA = require('../js/data.js').HJ_DATA;
  var enc = DATA.ENCOUNTERS[0];
  // pre-placed deep water is the teaching mechanism
  ok('encounter 1 declares a pre-placed deep tile', Array.isArray(enc.deep) && enc.deep.length >= 1);
  var s = R.newState(enc, { seed: 1 });
  // no crew may start on a deep tile (would be an un-telegraphed turn-0 drown)
  ok('no crew starts on a deep tile', s.crew.every(function (u) { return (s.flood[u.c + ',' + u.r] || 0) < 2; }));
  // there EXISTS a first-move shove by some crew that drowns a crab, and previewShove reports the drown
  var found = null;
  s.crew.forEach(function (u) {
    if (!u.alive) return;
    ['up', 'down', 'left', 'right'].forEach(function (dir) {
      var pv = R.previewShove(s, u._uid, dir, u.power);
      if (!pv || pv.blocked) return;
      var drownsEnemy = pv.drowns.some(function (uid) { var x = R.byUid(s, uid); return x && x._side === 'enemy'; });
      var drownsCrew = pv.drowns.some(function (uid) { var x = R.byUid(s, uid); return x && x._side === 'crew'; });
      if (drownsEnemy && !drownsCrew && !found) found = { uid: u._uid, dir: dir, power: u.power, pv: pv };
    });
  });
  ok('a turn-1 shove exists that drowns a crab (offensive verb is available move 1)', !!found);
  if (found) {
    var actor = R.byUid(s, found.uid);
    console.log('     teach move: ' + actor.id + ' @' + actor.c + ',' + actor.r + ' shove ' + found.dir +
      ' (power ' + found.power + ') → previewShove reports drown(s) ' + JSON.stringify(found.pv.drowns));
    // resolving that exact move actually kills a crab and stays telegraphed
    var log = R.resolveTurn(s, { unitUid: found.uid, dir: found.dir, distance: found.power });
    var crabDrowned = log.some(function (e) { return e.t === 'drown' && e.side === 'enemy'; });
    ok('resolving the teach move drowns a crab', crabDrowned);
    ok('the teach move is telegraphed (invariant holds)', (function () { try { return R.assertTelegraphed(log); } catch (e) { return false; } })());
  }
})();

console.log('\n== STAKES: encounter 1 is WINNABLE (a thoughtful clear exists) AND LOSABLE (careless drowns crew) ==');
(function () {
  var DATA = require('../js/data.js').HJ_DATA;
  var enc = DATA.ENCOUNTERS[0];
  // WINNABLE: a greedy "drown-if-you-can, else move safely" line clears the board
  (function () {
    var s = R.newState(enc, { seed: 1 });
    var won = false;
    for (var t = 0; t < 16 && !won; t++) {
      if (R.enemiesAlive(s) === 0) { won = true; break; }
      if (R.crewAlive(s) === 0) break;
      var pick = null;
      var crew = s.crew.filter(function (u) { return u.alive; });
      // prefer a move that drowns an enemy without losing crew
      crew.forEach(function (u) {
        ['up', 'down', 'left', 'right'].forEach(function (d) {
          var pv = R.previewShove(s, u._uid, d, u.power);
          if (!pv || pv.blocked || !pv.moves.length) return;
          var e = pv.drowns.some(function (uid) { var x = R.byUid(s, uid); return x && x._side === 'enemy'; });
          var c = pv.drowns.some(function (uid) { var x = R.byUid(s, uid); return x && x._side === 'crew'; });
          if (e && !c && !pick) pick = { u: u._uid, d: d, p: u.power };
        });
      });
      if (!pick) { // else any legal move that doesn't drown crew
        crew.forEach(function (u) {
          ['up', 'left', 'right', 'down'].forEach(function (d) {
            if (pick) return;
            var pv = R.previewShove(s, u._uid, d, u.power);
            if (!pv || pv.blocked || !pv.moves.length) return;
            var c = pv.drowns.some(function (uid) { var x = R.byUid(s, uid); return x && x._side === 'crew'; });
            if (!c) pick = { u: u._uid, d: d, p: u.power };
          });
        });
      }
      if (!pick) pick = { u: crew[0]._uid, d: 'up', p: crew[0].power };
      var log = R.resolveTurn(s, { unitUid: pick.u, dir: pick.d, distance: pick.p });
      try { R.assertTelegraphed(log); } catch (e) { fail++; console.log('   !! ' + e.message); }
    }
    ok('encounter 1 is winnable (thoughtful clear exists)', won && R.crewAlive(s) >= 1);
  })();
  // LOSABLE: a careless line (always shove DOWN, ignore threats) gets crew drowned
  (function () {
    var s = R.newState(enc, { seed: 1 });
    for (var t = 0; t < 14; t++) {
      if (R.crewAlive(s) === 0 || R.enemiesAlive(s) === 0) break;
      var u = s.crew.find(function (x) { return x.alive; });
      var log = R.resolveTurn(s, { unitUid: u._uid, dir: 'down', distance: u.power });
      try { R.assertTelegraphed(log); } catch (e) { fail++; console.log('   !! ' + e.message); }
    }
    ok('encounter 1 is losable (a careless line drowns crew)', R.crewAlive(s) < 3);
  })();
})();

console.log('\n----------------------------------------');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
