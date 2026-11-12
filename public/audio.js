// Neon Arena sound: everything is synthesized with Web Audio (no sound files).
// Guns are layered (crack + body + thump + echo tail), with mechanical extras (shotgun pump,
// sniper bolt). Other people's sounds are panned left/right and muffled with distance, so you
// can tell where shots and footsteps come from.

export function createAudio(getVolume) {
  let ctx, master, comp, dry, reverbIn, white;

  function init() {
    if (ctx) return ctx;
    ctx = new AudioContext();
    comp = ctx.createDynamicsCompressor(); // keeps loud moments from clipping
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = 0.8 * getVolume();
    comp.connect(master).connect(ctx.destination);
    dry = ctx.createGain();
    dry.connect(comp);
    // Reverb: a convolver with a synthetic decaying-noise impulse = a big hard-walled space.
    const len = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    reverbIn = ctx.createGain();
    reverbIn.gain.value = 0.32;
    reverbIn.connect(conv).connect(comp);
    white = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const w = white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    ambience();
    return ctx;
  }

  // A sound "bus": pan + distance muffle, then dry out and a little into the reverb.
  function bus({ vol = 1, pan = 0, far = 0, wet = 0.25 } = {}) {
    const g = ctx.createGain();
    g.gain.value = vol;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 18000 * Math.pow(0.08, far); // far away = muffled
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(lp).connect(p);
    p.connect(dry);
    const send = ctx.createGain();
    send.gain.value = wet + far * 0.6;
    p.connect(send).connect(reverbIn);
    return g;
  }

  // Noise burst through a filter, with a fast attack and exponential decay.
  function noise(out, t, { type = 'bandpass', freq = 1000, q = 1, gain = 0.5, attack = 0.002, decay = 0.1, rate = 1, sweepTo = null }) {
    const s = ctx.createBufferSource();
    s.buffer = white;
    s.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + attack + decay + 0.05);
  }
  // Pitched thump (sine sweep), e.g. the low "boom" of a gunshot.
  function thump(out, t, { from = 150, to = 45, gain = 0.6, decay = 0.15, type = 'sine' }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.05);
  }
  // Soft saturation curve, gives gunshots grit.
  let curve;
  function gritCurve() {
    if (!curve) {
      const n = 1024;
      curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; curve[i] = Math.tanh(x * 3); }
    }
    return curve;
  }

  // Per-weapon recipes: crack (high snap), body (mid punch), thump (low end), tail (echo).
  const GUNS = {
    rifle:   { crack: [3200, 0.035, 0.5], body: [950, 0.11, 0.7], thump: [140, 45, 0.55, 0.12], tail: [700, 0.28, 0.12] },
    pistol:  { crack: [3800, 0.03, 0.45], body: [1400, 0.07, 0.55], thump: [190, 70, 0.4, 0.08], tail: [900, 0.2, 0.08] },
    cannon:  { crack: [2600, 0.045, 0.7], body: [620, 0.2, 0.9], thump: [110, 32, 0.9, 0.28], tail: [500, 0.55, 0.2] },
    shotgun: { crack: [2200, 0.05, 0.6], body: [520, 0.24, 1.0], thump: [95, 30, 1.0, 0.3], tail: [450, 0.6, 0.22] },
    sniper:  { crack: [4200, 0.05, 0.9], body: [800, 0.18, 0.8], thump: [90, 28, 1.0, 0.4], tail: [600, 0.9, 0.25] },
  };

  function gun(id, opts = {}) {
    if (!ctx) return;
    const r = GUNS[id] || GUNS.rifle;
    const t = ctx.currentTime;
    const vol = opts.vol ?? 1;
    if (vol < 0.02) return;
    const out = bus({ vol, pan: opts.pan || 0, far: opts.far || 0, wet: 0.22 });
    const jitter = 0.94 + Math.random() * 0.12;
    noise(out, t, { type: 'highpass', freq: r.crack[0] * jitter, q: 0.7, gain: r.crack[2], decay: r.crack[1] });
    const body = ctx.createWaveShaper(); // the body layer gets a little distortion for grit
    body.curve = gritCurve();
    body.connect(out);
    noise(body, t, { type: 'bandpass', freq: r.body[0] * jitter, q: 0.9, gain: r.body[2], decay: r.body[1], sweepTo: r.body[0] * 0.5 });
    thump(out, t, { from: r.thump[0] * jitter, to: r.thump[1], gain: r.thump[2], decay: r.thump[3] });
    noise(out, t + 0.01, { type: 'lowpass', freq: r.tail[0], q: 0.5, gain: r.tail[2], attack: 0.02, decay: r.tail[1] });
    if (!opts.far || opts.far < 0.6) mechanics(id, out, t);
  }

  // Shotgun pump, sniper bolt, a shell hitting the floor.
  function mechanics(id, out, t) {
    const click = (at, freq, gain = 0.25, decay = 0.03) => noise(out, t + at, { type: 'bandpass', freq, q: 4, gain, decay });
    if (id === 'shotgun') { click(0.32, 1800, 0.3, 0.05); click(0.36, 900, 0.25, 0.06); click(0.5, 2200, 0.3, 0.04); click(0.54, 1100, 0.25, 0.05); }
    else if (id === 'sniper') { click(0.5, 2600, 0.25); click(0.62, 1600, 0.2, 0.05); click(0.82, 1900, 0.22); click(0.9, 2800, 0.25); }
    else if (id === 'rifle' || id === 'pistol' || id === 'cannon') {
      if (Math.random() < 0.6) click(0.25 + Math.random() * 0.15, 5200 + Math.random() * 1500, 0.06, 0.04); // brass tink
    }
  }

  // Footsteps: soft thud + scuff. kind: 'walk' | 'sprint' | 'land'
  function step(opts = {}) {
    if (!ctx) return;
    const vol = opts.vol ?? 1;
    if (vol < 0.02) return;
    const t = ctx.currentTime;
    const out = bus({ vol, pan: opts.pan || 0, far: opts.far || 0, wet: 0.08 });
    const k = opts.kind || 'walk';
    const loud = k === 'sprint' ? 1.3 : k === 'land' ? 1.6 : 1;
    const p = 0.85 + Math.random() * 0.3;
    thump(out, t, { from: (k === 'land' ? 120 : 170) * p, to: 60, gain: 0.35 * loud, decay: k === 'land' ? 0.12 : 0.06 });
    noise(out, t, { type: 'bandpass', freq: 420 * p, q: 1.2, gain: 0.28 * loud, decay: 0.07 });
    noise(out, t + 0.012, { type: 'highpass', freq: 2500 * p, q: 0.7, gain: 0.06 * loud, decay: 0.05 }); // scuff
  }

  // Reloads: magazine out, magazine in, charging handle / slide.
  function reload(id, ms) {
    if (!ctx) return;
    const t = ctx.currentTime, s = ms / 1000;
    const out = bus({ vol: 0.9, wet: 0.05 });
    const click = (at, freq, gain = 0.3, decay = 0.04, q = 3) => noise(out, t + at, { type: 'bandpass', freq, q, gain, decay });
    if (id === 'shotgun') {
      for (let i = 0; i < 4; i++) { click(0.2 + i * (s - 0.5) / 4, 1300, 0.25, 0.05); click(0.24 + i * (s - 0.5) / 4, 700, 0.2, 0.06); }
      click(s - 0.2, 1800, 0.3, 0.05); click(s - 0.12, 900, 0.3, 0.06);
    } else if (id === 'sniper') {
      click(0.15, 2400); click(0.3, 1500, 0.25, 0.06); click(s * 0.55, 900, 0.35, 0.06); click(s * 0.8, 2600); click(s * 0.9, 1700, 0.3, 0.05);
    } else {
      click(0.1, 1900); click(0.14, 1100, 0.2, 0.06);            // mag out
      noise(out, t + 0.18, { type: 'bandpass', freq: 600, q: 0.8, gain: 0.08, decay: 0.15 }); // cloth
      click(s * 0.6, 850, 0.4, 0.06); click(s * 0.62, 1600, 0.25); // mag in
      click(s * 0.85, 2300, 0.3); click(s * 0.9, 1300, 0.25, 0.05); // charge
    }
  }

  function equip() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = bus({ vol: 0.6, wet: 0.03 });
    noise(out, t, { type: 'bandpass', freq: 1100, q: 0.8, gain: 0.12, attack: 0.02, decay: 0.12 }); // cloth
    noise(out, t + 0.12, { type: 'bandpass', freq: 2400, q: 4, gain: 0.2, decay: 0.03 });           // click
  }

  // Simple tones for UI and alerts.
  function blip(freq, dur = 0.06, vol = 0.2, type = 'square') {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dry);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Generic noisy bang (explosions, knife hits). len = how long it rings out.
  function shot(vol = 1, pitch = 1, len = 0.14) {
    if (!ctx || vol < 0.02) return;
    const t = ctx.currentTime;
    const out = bus({ vol, wet: 0.3 });
    noise(out, t, { type: 'lowpass', freq: 5000 * pitch, q: 0.5, gain: 0.5, decay: len, sweepTo: 300 });
    thump(out, t, { from: 160 * pitch, to: 40, gain: 0.6, decay: len * 0.8 });
  }

  function whoosh(heavy) {
    if (!ctx) return;
    const t = ctx.currentTime, len = heavy ? 0.3 : 0.18;
    const out = bus({ vol: 1, wet: 0.05 });
    noise(out, t, { type: 'bandpass', freq: 700, q: 1.5, gain: 0.3, attack: len * 0.4, decay: len * 0.6, sweepTo: heavy ? 2200 : 3200 });
  }

  // Background: steady rain + a low breathing city hum.
  function ambience() {
    const long = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = long.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < d.length; i++) { last = last * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = last; }
    }
    const src = ctx.createBufferSource(); src.buffer = long; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4500;
    const rg = ctx.createGain(); rg.gain.value = 0.06;
    src.connect(hp).connect(lp).connect(rg).connect(master);
    src.start();
    const hum = ctx.createGain(); hum.gain.value = 0.03;
    const hlp = ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 220;
    for (const f of [55, 55.35, 82.4]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(hlp); o.start();
    }
    hlp.connect(hum).connect(master);
  }

  return {
    init,
    setVolume(v) { if (master) master.gain.value = 0.8 * v; },
    gun, step, reload, equip, blip, shot, whoosh,
    // Compatibility with older calls: weapon(w, vol) plays that gun's sound.
    weapon(w, vol = 1, pan = 0, far = 0) { gun(w.id, { vol, pan, far }); },
  };
}
