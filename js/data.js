/* HØJVANDE — data tables (data-driven roster + tide patterns).
   Depth comes from INTERACTIONS, not numbers. Everything here is plain data
   read by the pure rules engine (rules.js). Safe to load in Node or browser. */

(function (root) {
  'use strict';

  // ---- Crew (your pawns). You never attack; your verb is SHOVE. ----
  // `weight`  : how many tiles a shove pushes a thing it collides into a chain (1 = normal).
  // `power`   : how far THIS crew member can shove (tiles). Most are 1; the Bosun shoves 2.
  // `tideHurt`: true = drowns if a flood reaches its tile (all crew are mortal — fair self-danger).
  const CREW = [
    { id: 'deckhand', name: 'Dækshånd',  glyph: 'D', color: '#5bd6c8', power: 1, role:
      'Skubber én ting ét felt.' },
    { id: 'bosun',    name: 'Bådsmand',  glyph: 'B', color: '#7fb2ff', power: 2, role:
      'Skubber to felter — længere kæder.' },
    { id: 'diver',    name: 'Dykker',    glyph: 'Y', color: '#9d7bff', power: 1, swim: true, role:
      'Overlever lavt vand — men drukner i DYBT vand ligesom de andre.' },
  ];

  // ---- Enemies. Deterministic, telegraphed intents. No to-hit RNG. ----
  // intent kinds (resolved AFTER the player commits a shove, in order):
  //   'step'  : moves up to `range` tiles toward the nearest crew (telegraphed exact target tile).
  //   'pull'  : drags the nearest crew/enemy in a straight line one tile TOWARD the puller.
  //   'shove' : shoves the nearest adjacent unit one tile AWAY (can chain / drown your crew).
  //   'wait'  : a heavy unit that holds position (a wall you must use the tide on).
  const ENEMIES = [
    { id: 'crab',    name: 'Krabbe',     glyph: 'c', color: '#ff8a5b', intent: 'step',  range: 1,
      desc: 'Kravler ét felt mod nærmeste besætning.' },
    { id: 'lurker',  name: 'Dybhage',    glyph: 'h', color: '#ff5b7f', intent: 'pull',  range: 4,
      desc: 'Trækker nærmeste enhed ét felt MOD sig — mad til et skub.' },
    { id: 'brute',   name: 'Stødtand',   glyph: 'T', color: '#ffd05b', intent: 'shove', range: 1,
      desc: 'Skubber en nabo ét felt VÆK — kan skubbe DIN besætning i havet.' },
    { id: 'hulk',    name: 'Vragkæmpe',  glyph: 'H', color: '#b0b8c4', intent: 'wait',  range: 0,
      heavy: true, desc: 'Rør sig ikke. Tung — kun tidevandet kan tage den.' },
  ];

  // ---- Encounters: a short escalating run (~4–7 min). Each is one cleared board. ----
  // tide: starting flood ring schedule. `floodStart` = turn the first ring floods.
  // Enemies given as [enemyId, col, row]. Crew spawn columns chosen by the engine on row 4.
  const ENCOUNTERS = [
    { name: 'Lavvande',   tideStart: 3, tideEvery: 2, enemies: [['crab', 1, 1], ['crab', 3, 0]] },
    { name: 'Strøms.',    tideStart: 3, tideEvery: 2, enemies: [['crab', 0, 1], ['lurker', 4, 1], ['crab', 2, 0]] },
    { name: 'Brænding',   tideStart: 2, tideEvery: 2, enemies: [['brute', 2, 1], ['crab', 0, 0], ['lurker', 4, 0]] },
    { name: 'Revlen',     tideStart: 2, tideEvery: 2, enemies: [['hulk', 2, 2], ['brute', 0, 1], ['crab', 4, 1], ['lurker', 1, 0]] },
    { name: 'Højvande',   tideStart: 2, tideEvery: 1, enemies: [['brute', 1, 1], ['brute', 3, 1], ['lurker', 2, 0], ['crab', 0, 0], ['crab', 4, 0]] },
  ];

  // ---- Storm-tides: opt-in higher tiers that change RULES, never just numbers. ----
  // Each is a flag the engine reads. Never auto-easier.
  const STORMS = [
    { id: 'none',   name: 'Roligt hav',   desc: 'Standardreglerne.' },
    { id: 'fast',   name: 'Springflod',   desc: 'Tidevandet stiger HVER tur fra start.', tideEvery: 1, tideStart: 2 },
    { id: 'deep',   name: 'Dybt vand',    desc: 'To ringe oversvømmer ad gangen.', floodWidth: 2 },
    { id: 'narrow', name: 'Smult vande',  desc: 'Tidevandet stiger fra MIDTEN og udad.', fromCenter: true },
  ];

  // ---- Mette's weather-log: a non-power replay hook. One line gains per run-end. ----
  const METTE_LOG = [
    'Mette skriver: "Første hold ud. Havet tog to. Vinden lugtede af salt og jern."',
    'Mette skriver: "De lærer at læse vandet nu. Krabberne kom tidligt."',
    'Mette skriver: "En dybhage trak Bådsmanden — men hun vendte den mod dem."',
    'Mette skriver: "Stødtanden skubbede en af vores ud. Vi sang ikke den aften."',
    'Mette skriver: "Vragkæmpen står endnu derude. Kun tidevandet rører den."',
    'Mette skriver: "Springfloden kom. Vi nåede revlen før vandet nåede os."',
    'Mette skriver: "Dybt vand i nat. To ringe ad gangen. Holdet holdt fast."',
    'Mette skriver: "Vandet steg fra midten — som om havet åndede udad."',
    'Mette skriver: "Endnu et hold hjemme. Loggen bliver tungere end fyret."',
  ];

  root.HJ_DATA = { CREW, ENEMIES, ENCOUNTERS, STORMS, METTE_LOG };

})(typeof module !== 'undefined' && module.exports ? module.exports : (this.window || this));
