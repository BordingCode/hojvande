# HØJVANDE — project guide for Claude

A vanilla HTML/CSS/JS PWA (NO build step). A **5×5 perfect-information turn-based
tactics roguelite**: you command a small CREW; your only verb is **SHOVE** (push a
unit one+ tiles); a **rising TIDE** is weapon + clock + threat. Phone-first, DOM-grid
of `<button>` tiles. Calm "thinking-game" feel (no screenshake). Theme/UI text: Danish.

## Before working
Read the shared game-dev knowledge base: **`~/cc/gamedev-kb/INDEX.md`** (lowercase `cc`),
especially `reference/field-notes.md` → "Perfect-information turn-based tactics roguelite".

## Architecture (load order in index.html)
- `js/data.js` — DATA-DRIVEN roster: `HJ_DATA` = {CREW, ENEMIES, ENCOUNTERS, STORMS, METTE_LOG}.
  Depth comes from INTERACTIONS, not numbers. Edit a table to add content.
- `js/rules.js` — **PURE, seeded, Node-testable** rules engine (`HJ_RULES`). No DOM/audio/timers.
  Shove/chain/drown, deterministic telegraphed enemy intents, the tide-depth model.
- `js/audio.js` — procedural Web Audio (`HJ_AUDIO`), calm palette (adapted from ASTRA).
- `js/game.js` — DOM controller: render + the full telegraph + animations + run flow + save.

## THE CORE INVARIANT (non-negotiable)
**Nothing LETHAL resolves that was not TELEGRAPHED the turn before.** Enemy intents
(arrows + target), the shove GHOST preview, the flood-FORECAST overlay, and the red
DANGER RIM are all shown before the player commits. `rules.js` `assertTelegraphed(log)`
throws on any un-telegraphed crew death; `game.js` calls it after every commit. Deaths
must always read as a player mistake, never luck. Keep ALL RNG upstream (placement),
zero RNG on resolution.

## Key design facts (so balance stays honest)
- The TIDE deepens: depth 1 = shallow (non-swimmers drown), depth 2 = DEEP (EVEN the
  diver drowns). The sea eventually claims the whole board → a hard clock, real stakes.
- Step-enemies FLEE the rising tide, so the tide is a WEAPON YOU AIM (shove them in),
  not a free board-wipe. `brute`/`lurker`/`hulk` don't flee (each a different puzzle).
- Diver `swim` only survives shallow water. There is NO immortal crew (a run is losable).

## Tests / verify (no bundler, no framework)
- `node --check js/*.js` · `node test/rules.test.js` (shove/chain/drown + invariant brute-force,
  incl. storm-tides) · `node test/dom-smoke.test.js` (boots under a DOM stub, drives turns).
- Browser playtest with Playwright (the playtester agent). Debug global: `window.__hj`
  ({state, G, R, DATA}; `.seed(n)`, `.jump(encIdx)`, `.storm(id)`, `.win()`, `.kill()`,
  `.forecast()`, `.resetSave()`).

## Deploy convention — every change MUST
- Bump the SW `CACHE` string in `sw.js` (`hojvande-v1`→`v2`), add any new file to `ASSETS`,
  **and** bump the `?v=` query on changed `<link>`/`<script>` in `index.html` (it uses `?v=`
  busting). Keep `.nojekyll`. Then commit + push (Mathias handles the GitHub remote / Pages / Hub).

## TODO / next
- Storm-tides (`fast`/`deep`/`narrow`) are wired + telegraph-tested; only `tideEvery/tideStart/
  floodWidth/fromCenter` rule-changes are implemented. More RULE-changing tiers welcome.
- Mette's weather-log gains a line per run-end (9 lines authored) — extend `METTE_LOG`.
- Combinatorial crew-tool tweaks (Balatro-Joker style, change HOW the shove works) are the
  documented replay-depth lever — not yet built.
