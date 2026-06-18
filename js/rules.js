/* HØJVANDE — pure rules engine. NO DOM, NO audio, NO timers.
   Deterministic + seeded so it can be brute-tested headlessly (Node).

   THE CORE INVARIANT (non-negotiable, asserted in code):
     Nothing LETHAL resolves that was not TELEGRAPHED the turn before.
     - Every enemy intent is computed and shown BEFORE the player commits.
     - The flood FORECAST for next turn is computed and shown each turn.
     - A drown is only "fair" if the killing tile was on last turn's forecast
       (for the tide) OR was the visible ghost landing of a shove the player
       themselves committed this turn.
   resolveTurn() returns an event log; assertTelegraphed() verifies every death. */

(function (root) {
  'use strict';

  var DATA = (root.HJ_DATA) || (typeof require !== 'undefined' ? require('./data.js').HJ_DATA : null);
  var ENEMIES = DATA.ENEMIES;
  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  // ---- tiny seeded RNG (mulberry32) — all randomness is UPSTREAM (placement), never resolution ----
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var SIZE = 5;
  function inBounds(c, r) { return c >= 0 && c < SIZE && r >= 0 && r < SIZE; }
  function key(c, r) { return c + ',' + r; }

  // Tiles have a flood DEPTH. depth>=1 = shallow water (non-swimmers drown).
  // depth>=2 = DEEP water (even swimmers drown). The tide deepens a tile each time
  // its ring is swept again — so the sea eventually claims the whole board: a true clock.
  function depthAt(state, c, r) { return state.flood[key(c, r)] || 0; }
  function isFlooded(state, c, r) { return depthAt(state, c, r) >= 1; }
  // Does this unit drown if it ends the turn here, given current depth?
  function drownsAt(state, u, c, r) { var d = depthAt(state, c, r); return u.swim ? d >= 2 : d >= 1; }

  // ---------- TIDE MODEL ----------
  // The tide is a steadily rising sea level. Each tile sits at a DISTANCE from the sea source
  // (edge-tide: the bottom row is distance 0; from-centre storm: the centre is distance 0).
  // After the tide has advanced `reach` steps, a tile's flood depth = clamp(reach - dist, 0, 2).
  //   depth 1 = shallow (non-swimmers drown) · depth 2 = deep (EVEN swimmers drown).
  // So the sea eventually claims the entire board — a hard clock that forbids turtling and
  // can kill any crew, including the diver. Fully deterministic + telegraphable a turn ahead.
  function tideDistFromSource(s, c, r) {
    if (s.fromCenter) return Math.max(Math.abs(c - 2), Math.abs(r - 2)); // 0 at centre
    return SIZE - 1 - r;                                                 // 0 at bottom row
  }
  function reachAtTurn(s, turn) {
    if (turn < s.start) return 0;
    var width = s.floodWidth || 1;                 // "deep water" storm advances faster
    return (Math.floor((turn - s.start) / s.every) + 1) * width;
  }
  function depthForTurn(s, c, r, turn) {
    var d = reachAtTurn(s, turn) - tideDistFromSource(s, c, r);
    return Math.max(0, Math.min(2, d));
  }

  // FORECAST shown to the player: every tile whose depth will CHANGE next turn, with the new
  // depth. The UI shows shallow-incoming (dashed) and deep-incoming (solid) differently, and a
  // unit standing on one that would drown it gets a danger rim.
  function forecastFlood(state) {
    var s = state.tide, nextTurn = state.turn + 1, out = [];
    for (var c = 0; c < SIZE; c++) for (var r = 0; r < SIZE; r++) {
      var nd = depthForTurn(s, c, r, nextTurn), cur = depthAt(state, c, r);
      if (nd > cur) { var p = [c, r]; p.depth = nd; out.push(p); }
    }
    return out;
  }

  // ---------- ENEMY INTENTS ----------
  // Deterministic. Computed and STORED on each enemy as `.intent` so the UI draws it
  // BEFORE the player commits. resolveTurn replays exactly these stored intents.
  function nearestCrew(state, c, r) {
    var best = null, bd = 1e9;
    state.crew.forEach(function (u) {
      if (!u.alive) return;
      var d = Math.abs(u.c - c) + Math.abs(u.r - r);
      if (d < bd) { bd = d; best = u; }
    });
    return best;
  }
  function nearestUnit(state, c, r, excludeId) {
    var best = null, bd = 1e9;
    allUnits(state).forEach(function (u) {
      if (!u.alive || u._uid === excludeId) return;
      var d = Math.abs(u.c - c) + Math.abs(u.r - r);
      if (d < bd && d > 0) { bd = d; best = u; }
    });
    return best;
  }
  function allUnits(state) { return state.crew.concat(state.enemies); }
  function unitAt(state, c, r) {
    return allUnits(state).find(function (u) { return u.alive && u.c === c && u.r === r; }) || null;
  }
  function defOf(e) { return ENEMIES.find(function (d) { return d.id === e.id; }); }

  // sign helper
  function sgn(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }

  // Compute & store the intent for every enemy. Returns nothing (mutates).
  function planIntents(state) {
    state.enemies.forEach(function (e) {
      if (!e.alive) { e.intent = null; return; }
      var def = defOf(e);
      if (def.intent === 'wait') { e.intent = { kind: 'wait' }; return; }
      if (def.intent === 'step') {
        // SELF-PRESERVATION FIRST: if standing on a tile that floods next turn, flee to dry land.
        // (This is why the tide is a WEAPON you aim, not a free board-wipe: foes climb away from it,
        //  so you must SHOVE them into the water — the shove stays the kill.)
        var ndHere = depthForTurn(state.tide, e.c, e.r, state.turn + 1);
        if (e.swim ? ndHere >= 2 : ndHere >= 1) {
          var flee = fleeTide(state, e);
          if (flee) { e.intent = { kind: 'step', to: flee, flee: true }; return; }
        }
        var tgt = nearestCrew(state, e.c, e.r);
        if (!tgt) { e.intent = { kind: 'wait' }; return; }
        var step = stepToward(state, e, tgt.c, tgt.r, def.range);
        e.intent = { kind: 'step', to: step, targetUid: tgt._uid };
        return;
      }
      if (def.intent === 'pull') {
        // pulls nearest unit (crew or enemy) one tile toward itself along the straight line
        var u = nearestUnit(state, e.c, e.r, e._uid);
        if (!u) { e.intent = { kind: 'wait' }; return; }
        // must be on same row or column to pull (a straight drag)
        var aligned = (u.c === e.c || u.r === e.r);
        if (!aligned || (Math.abs(u.c - e.c) + Math.abs(u.r - e.r)) > def.range) { e.intent = { kind: 'wait' }; return; }
        var dc = sgn(e.c - u.c), dr = sgn(e.r - u.r);
        e.intent = { kind: 'pull', targetUid: u._uid, from: [u.c, u.r], to: [u.c + dc, u.r + dr] };
        return;
      }
      if (def.intent === 'shove') {
        // shoves nearest ADJACENT unit one tile away from itself
        var adj = adjacentUnit(state, e);
        if (!adj) { e.intent = { kind: 'wait' }; return; }
        var sc = sgn(adj.c - e.c), sr = sgn(adj.r - e.r);
        e.intent = { kind: 'shove', targetUid: adj._uid, from: [adj.c, adj.r], to: [adj.c + sc, adj.r + sr] };
        return;
      }
      e.intent = { kind: 'wait' };
    });
  }

  // Pick the best adjacent dry tile that is also NOT flooding next turn (climb to safety,
  // preferring to move away from the rising edge). Deterministic; returns null if cornered.
  function fleeTide(state, e) {
    var opts = [];
    Object.keys(DIRS).forEach(function (d) {
      var nc = e.c + DIRS[d][0], nr = e.r + DIRS[d][1];
      if (!inBounds(nc, nr)) return;
      if (unitAt(state, nc, nr)) return;
      // refuse a tile that's already lethal to this enemy, or becomes lethal next turn
      if (drownsAt(state, e, nc, nr)) return;
      var nd = depthForTurn(state.tide, nc, nr, state.turn + 1);
      if (e.swim ? nd >= 2 : nd >= 1) return;
      opts.push([nc, nr]);
    });
    if (!opts.length) return null;
    // prefer the tile furthest from the tide source (the safest dry ground)
    opts.sort(function (a, b) {
      return tideDistFromSource(state.tide, b[0], b[1]) - tideDistFromSource(state.tide, a[0], a[1]);
    });
    return opts[0];
  }

  function stepToward(state, e, tc, tr, range) {
    var c = e.c, r = e.r;
    for (var i = 0; i < range; i++) {
      var dc = sgn(tc - c), dr = sgn(tr - r);
      // prefer the longer axis; one orthogonal step
      var nc = c, nr = r;
      if (Math.abs(tc - c) >= Math.abs(tr - r) && dc !== 0) nc = c + dc;
      else if (dr !== 0) nr = r + dr;
      else if (dc !== 0) nc = c + dc;
      if (!inBounds(nc, nr) || unitAt(state, nc, nr)) break; // blocked → stop (no overlap)
      c = nc; r = nr;
    }
    return [c, r];
  }

  function adjacentUnit(state, e) {
    var best = null;
    Object.keys(DIRS).forEach(function (d) {
      var nc = e.c + DIRS[d][0], nr = e.r + DIRS[d][1];
      var u = unitAt(state, nc, nr);
      if (u && !best) best = u;
    });
    return best;
  }

  // ---------- SHOVE (the player's verb) ----------
  // Returns a PREVIEW (ghost) of where everything lands and who drowns — pure, no mutation.
  // dir is 'up'|'down'|'left'|'right'. distance = crew power.
  // Chain rule: a shoved unit that would enter an OCCUPIED tile pushes that unit one further
  // (transferring the remaining push as a chain); a wall/edge stops the chain (no movement past it).
  function previewShove(state, unitUid, dir, distance) {
    var d = DIRS[dir];
    var actor = allUnits(state).find(function (u) { return u._uid === unitUid; });
    if (!actor || !actor.alive) return null;
    var moves = [];     // {uid, from:[c,r], to:[c,r]}
    var drowns = [];    // uid

    // We resolve the shove as a sequence of single-tile pushes, chaining on collision.
    var sim = snapshotPositions(state);
    var ok = pushChain(state, sim, actor._uid, d, distance, moves);
    if (!ok && moves.length === 0) return { moves: [], drowns: [], blocked: true };

    // Determine drowns: any unit whose final tile drowns it at the CURRENT depth.
    // (The board's current water is already telegraphed; the shove ghost shows the landing.)
    moves.forEach(function (m) {
      var u = byUid(state, m.uid);
      if (drownsAt(state, u, m.to[0], m.to[1])) drowns.push(m.uid);
    });
    // Units that DIDN'T move but a mover left/entered don't change flood status; only movers can drown here.
    return { moves: moves, drowns: drowns, blocked: false };
  }

  function pushChain(state, sim, uid, d, distance, moves) {
    var pos = sim[uid];
    var moved = false;
    for (var i = 0; i < distance; i++) {
      var nc = pos.c + d[0], nr = pos.r + d[1];
      if (!inBounds(nc, nr)) break;                 // wall stops it
      var occUid = occupantAt(sim, nc, nr);
      if (occUid) {
        var heavy = isHeavy(state, occUid);
        if (heavy) break;                            // can't shove a heavy hulk; chain stops
        // chain: push the occupant one tile in the same dir; only if THAT lands free/edge-valid
        var pushed = pushChain(state, sim, occUid, d, 1, moves);
        if (!pushed) break;                          // occupant couldn't move → we stop too
      }
      // move into the (now free) tile
      pos.c = nc; pos.r = nr; moved = true;
    }
    if (moved) recordMove(sim, uid, moves);
    return moved;
  }

  function snapshotPositions(state) {
    var sim = {};
    allUnits(state).forEach(function (u) { if (u.alive) sim[u._uid] = { uid: u._uid, c: u.c, r: u.r, oc: u.c, or: u.r }; });
    return sim;
  }
  function occupantAt(sim, c, r) {
    var found = null;
    Object.keys(sim).forEach(function (uid) { var p = sim[uid]; if (p.c === c && p.r === r) found = p.uid; });
    return found;
  }
  function recordMove(sim, uid, moves) {
    var p = sim[uid];
    var existing = moves.find(function (m) { return m.uid === p.uid; });
    if (existing) { existing.to = [p.c, p.r]; }
    else moves.push({ uid: p.uid, from: [p.oc, p.or], to: [p.c, p.r] });
  }
  function byUid(state, uid) { return allUnits(state).find(function (u) { return u._uid === uid; }); }
  function isHeavy(state, uid) { var u = byUid(state, uid); return !!(u && u.heavy); }

  // ---------- TURN RESOLUTION ----------
  // Order: (1) apply the player's committed shove → (2) drown checks from the shove →
  // (3) replay stored enemy intents (each may move/pull/shove → more drown checks) →
  // (4) raise the tide per forecast → (5) drown checks from the new flood.
  // Every drown carries a `telegraphed` reason so assertTelegraphed() can prove fairness.
  function resolveTurn(state, committedShove) {
    var log = [];
    // snapshot the forecast that was SHOWN to the player last turn (for invariant proof)
    var shownForecast = state.shownForecast || [];

    // (1) player shove
    if (committedShove) {
      var pv = previewShove(state, committedShove.unitUid, committedShove.dir, committedShove.distance);
      if (pv && !pv.blocked) {
        pv.moves.forEach(function (m) { applyMove(state, m.uid, m.to); log.push({ t: 'move', uid: m.uid, to: m.to, cause: 'shove' }); });
        pv.drowns.forEach(function (uid) {
          drown(state, uid, log, { reason: 'shove-ghost', shownForecast: shownForecast });
        });
      }
    }

    // (3) enemy intents (already telegraphed via planIntents last turn)
    state.enemies.forEach(function (e) {
      if (!e.alive || !e.intent) return;
      var it = e.intent;
      if (it.kind === 'step') {
        if (inBounds(it.to[0], it.to[1]) && !occupiedByOther(state, it.to, e._uid))
          applyMove(state, e._uid, it.to), log.push({ t: 'move', uid: e._uid, to: it.to, cause: 'enemy-step' });
      } else if (it.kind === 'pull' || it.kind === 'shove') {
        var tgt = byUid(state, it.targetUid);
        if (tgt && tgt.alive && tgt.c === it.from[0] && tgt.r === it.from[1]) {
          if (inBounds(it.to[0], it.to[1]) && !occupiedByOther(state, it.to, tgt._uid)) {
            applyMove(state, tgt._uid, it.to);
            log.push({ t: 'move', uid: tgt._uid, to: it.to, cause: 'enemy-' + it.kind });
            if (drownsAt(state, tgt, it.to[0], it.to[1]))
              drown(state, tgt._uid, log, { reason: 'enemy-' + it.kind + '-into-flood', shownForecast: shownForecast, intent: it });
          }
        }
      }
    });

    // (4) RAISE THE TIDE to the authoritative depth for the new turn. Every depth CHANGE here
    //     was on `shownForecast` (computed identically last turn) → fully telegraphed.
    var newTurn = state.turn + 1;
    for (var c = 0; c < SIZE; c++) for (var r = 0; r < SIZE; r++) {
      var nd = depthForTurn(state.tide, c, r, newTurn);
      if (nd > depthAt(state, c, r)) { state.flood[key(c, r)] = nd; log.push({ t: 'flood', at: [c, r], depth: nd }); }
    }

    // (5) drown anyone the risen water now claims
    allUnits(state).forEach(function (u) {
      if (u.alive && drownsAt(state, u, u.c, u.r)) {
        // fair iff this tile's lethal depth change was on the forecast shown last turn
        var fair = shownForecast.some(function (p) { return p[0] === u.c && p[1] === u.r; });
        drown(state, u._uid, log, { reason: 'tide', telegraphedTile: fair, shownForecast: shownForecast });
      }
    });

    // advance turn, recompute intents + the forecast to SHOW for next turn
    state.turn += 1;
    planIntents(state);
    state.shownForecast = forecastFlood(state);
    log.push({ t: 'endturn', turn: state.turn });
    return log;
  }

  function applyMove(state, uid, to) { var u = byUid(state, uid); if (u) { u.c = to[0]; u.r = to[1]; } }
  function occupiedByOther(state, to, uid) {
    var u = unitAt(state, to[0], to[1]); return !!(u && u._uid !== uid);
  }
  function drown(state, uid, log, info) {
    var u = byUid(state, uid);
    if (!u || !u.alive) return;
    u.alive = false;
    log.push({ t: 'drown', uid: uid, side: u._side, at: [u.c, u.r], info: info });
  }

  // ---------- THE INVARIANT CHECK ----------
  // Proves: every LETHAL outcome in a turn log was telegraphed before commit.
  // A crew drown is fair iff:
  //   - reason 'tide' AND the tile was on last turn's shownForecast, OR
  //   - reason starts 'enemy-' (the enemy's intent arrow was shown last turn), OR
  //   - reason 'shove-ghost' (the player committed this very shove, ghost shown pre-commit).
  // Throws if any crew death was NOT telegraphed. (Enemy drowns are always fine — that's the weapon.)
  function assertTelegraphed(log) {
    log.forEach(function (ev) {
      if (ev.t !== 'drown') return;
      if (ev.side !== 'crew') return;           // only the PLAYER must never die un-telegraphed
      var info = ev.info || {};
      var fair =
        (info.reason === 'tide' && info.telegraphedTile === true) ||
        (typeof info.reason === 'string' && info.reason.indexOf('enemy-') === 0) ||
        (info.reason === 'shove-ghost');
      if (!fair) {
        throw new Error('TELEGRAPH INVARIANT VIOLATED: crew drowned un-telegraphed: ' + JSON.stringify(ev));
      }
    });
    return true;
  }

  // ---------- SETUP ----------
  function newState(encounter, opts) {
    opts = opts || {};
    var rng = makeRng(opts.seed || 1);
    var tide = {
      start: (opts.storm && opts.storm.tideStart) || encounter.tideStart,
      every: (opts.storm && opts.storm.tideEvery) || encounter.tideEvery,
      floodWidth: (opts.storm && opts.storm.floodWidth) || 1,
      fromCenter: !!(opts.storm && opts.storm.fromCenter),
    };
    var state = { size: SIZE, turn: 0, flood: {}, tide: tide, crew: [], enemies: [], shownForecast: [], rng: rng };
    var uid = 1;
    // crew spawn on the bottom row, spread out (the shore)
    (opts.crew || DATA.CREW).forEach(function (cdef, i) {
      var col = [1, 2, 3, 0, 4][i] != null ? [1, 2, 3, 0, 4][i] : i;
      state.crew.push({ _uid: uid++, _side: 'crew', id: cdef.id, glyph: cdef.glyph, color: cdef.color,
        power: cdef.power, swim: !!cdef.swim, name: cdef.name, c: col, r: SIZE - 1, alive: true });
    });
    encounter.enemies.forEach(function (e) {
      var def = ENEMIES.find(function (d) { return d.id === e[0]; });
      state.enemies.push({ _uid: uid++, _side: 'enemy', id: def.id, glyph: def.glyph, color: def.color,
        heavy: !!def.heavy, name: def.name, c: e[1], r: e[2], alive: true, intent: null });
    });
    planIntents(state);
    state.shownForecast = forecastFlood(state);
    return state;
  }

  function crewAlive(state) { return state.crew.filter(function (u) { return u.alive; }).length; }
  function enemiesAlive(state) { return state.enemies.filter(function (u) { return u.alive; }).length; }

  var API = {
    SIZE: SIZE, DIRS: DIRS,
    makeRng: makeRng, newState: newState,
    forecastFlood: forecastFlood, planIntents: planIntents,
    previewShove: previewShove, resolveTurn: resolveTurn,
    assertTelegraphed: assertTelegraphed,
    isFlooded: isFlooded, unitAt: unitAt, byUid: byUid, allUnits: allUnits,
    crewAlive: crewAlive, enemiesAlive: enemiesAlive,
  };

  root.HJ_RULES = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof module !== 'undefined' && module.exports ? (global.window || global) : window);
