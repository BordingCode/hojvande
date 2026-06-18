/* HØJVANDE — procedural Web Audio. Calm thinking-game palette (no harsh hits).
   Adapted from ASTRA's audio.js: soft sine/triangle tones + filtered-noise water textures.
   The signature beat is the shove→drown "gulp/sploosh". NO screenshake-style audio. */
(function (root) {
  'use strict';
  var ctx = null, master = null, enabled = true;
  var PENTA = [0, 2, 4, 7, 9], BASE = 196; // G3 — a touch lower, sea-calm

  function ensure() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    } catch (e) { /* no audio */ }
    return ctx;
  }
  function unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setEnabled(v) { enabled = v; }
  function isEnabled() { return enabled; }
  function noteFreq(deg, oct) { oct = oct || 0; var s = PENTA[((deg % 5) + 5) % 5] + 12 * (oct + Math.floor(deg / 5)); return BASE * Math.pow(2, s / 12); }

  function tone(freq, o) {
    o = o || {}; if (!enabled || !ensure()) return;
    var t = ctx.currentTime, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine'; osc.frequency.value = freq; osc.detune.value = o.detune || 0;
    var dur = o.dur || 0.5, gain = o.gain == null ? 0.16 : o.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.05);
  }
  // filtered noise swell — water. Optional downward pitch sweep for the "gulp".
  function water(o) {
    o = o || {}; if (!enabled || !ensure()) return;
    var t = ctx.currentTime, dur = o.dur || 0.6, len = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass';
    var c0 = o.cutoff || 700, c1 = o.cutoffEnd == null ? c0 * 1.6 : o.cutoffEnd;
    f.frequency.setValueAtTime(c0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, c1), t + dur);
    var g = ctx.createGain(); var gain = o.gain == null ? 0.12 : o.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur);
  }

  var sfx = {
    select() { tone(noteFreq(2, 1), { dur: 0.18, gain: 0.08, type: 'triangle' }); },
    move()   { water({ dur: 0.28, gain: 0.06, cutoff: 600, cutoffEnd: 900 }); },
    shove()  { water({ dur: 0.35, gain: 0.10, cutoff: 500, cutoffEnd: 1100 });
               tone(noteFreq(2, 0), { dur: 0.2, gain: 0.07, type: 'sine' }); },
    // the signature: a soft "gulp/sploosh" — downward pitch + a low water swell
    drown()  { water({ dur: 0.7, gain: 0.16, cutoff: 1200, cutoffEnd: 180 });
               tone(noteFreq(0, -1), { dur: 0.5, gain: 0.10, type: 'sine', detune: -8 }); },
    flood()  { water({ dur: 0.5, gain: 0.07, cutoff: 400, cutoffEnd: 650 }); },
    tide()   { tone(noteFreq(4, 0), { dur: 0.4, gain: 0.05, type: 'sine' });
               water({ dur: 0.6, gain: 0.05, cutoff: 350, cutoffEnd: 500 }); },
    crewLost(){ tone(noteFreq(0, -1), { dur: 0.9, gain: 0.13, type: 'sine' });
               tone(noteFreq(2, -1), { dur: 0.9, gain: 0.06, type: 'sine', detune: -6 }); },
    win()    { var seq = [0, 4, 7, 9]; seq.forEach(function (deg, k) {
                 setTimeout(function () { tone(noteFreq(deg, 1), { dur: 0.8, gain: 0.13, type: 'triangle' }); }, k * 120); });
               water({ dur: 1.4, gain: 0.06, cutoff: 1400, cutoffEnd: 1800 }); },
    lose()   { tone(noteFreq(0, -1), { dur: 1.1, gain: 0.12, type: 'sine' });
               water({ dur: 1.2, gain: 0.10, cutoff: 500, cutoffEnd: 120 }); },
  };

  root.HJ_AUDIO = { unlock: unlock, setEnabled: setEnabled, isEnabled: isEnabled, sfx: sfx };
})(window);
