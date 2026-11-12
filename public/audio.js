// Neon Arena sound: everything is synthesized with Web Audio (no sound files).
// Guns are layered (crack + body + thump + echo tail), with mechanical extras (shotgun pump,
// sniper bolt). Other people's sounds are panned left/right and muffled with distance, so you
// can tell where shots and footsteps come from.

export function createAudio(getVolume) {
  let ctx, master, comp, dry, reverbIn, white;

  function init() {
    if (ctx) return ctx;
    ctx = new AudioContext({ latencyHint: 'interactive' });
    // Browsers suspend audio when the tab loses focus or the device changes; wake it back up.
    ctx.onstatechange = () => { if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {}); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) ensure(); });
    addEventListener('pointerdown', ensure); addEventListener('keydown', ensure);
    comp = ctx.createDynamicsCompressor(); // limiter: keeps loud moments from clipping or distorting
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 10;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
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
      let lp = 0;
      for (let i = 0; i < len; i++) { // smoothed noise: a soft room tail, not a hiss
        lp += ((Math.random() * 2 - 1) - lp) * 0.25;
        d[i] = lp * Math.pow(1 - i / len, 3.5) * (i < 400 ? i / 400 : 1);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    reverbIn = ctx.createGain();
    reverbIn.gain.value = 0.2;
    reverbIn.connect(conv).connect(comp);
    white = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const w = white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    // no constant background sound (rain and hum removed)
    return ctx;
  }

  function ensure() { if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {}); }
  // Too many sounds at once (a bot firefight) overloads the audio thread and makes crackles.
  let recent = [];
  function allow(maxPer100 = 14) {
    const now = performance.now();
    recent = recent.filter((t) => now - t < 100);
    if (recent.length >= maxPer100) return false;
    recent.push(now);
    return true;
  }
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

  // A sound "bus": pan + distance muffle, then dry out and a little into the reverb.
  function bus({ vol = 1, pan = 0, far = 0, wet = 0.25, ttl = 2500 } = {}) {
    vol = num(vol, 1); pan = num(pan); far = Math.max(0, Math.min(1, num(far)));
    ensure();
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
    send.gain.value = Math.min(0.5, wet + far * 0.35);
    p.connect(send).connect(reverbIn);
    setTimeout(() => { try { g.disconnect(); lp.disconnect(); p.disconnect(); send.disconnect(); } catch {} }, ttl); // free nodes
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
    cannon:  { crack: [2600, 0.045, 0.7], body: [620, 0.2, 0.9], thump: [110, 32, 0.9, 0.28], tail: [500, 0.55, 0.2], sub: [70, 26, 0.8, 0.45], wet: 0.22 },
    shotgun: { crack: [2200, 0.05, 0.6], body: [520, 0.24, 1.0], thump: [95, 30, 1.0, 0.3], tail: [450, 0.6, 0.22], sub: [75, 26, 0.9, 0.5], wet: 0.22 },
    smg:     { crack: [3600, 0.025, 0.4], body: [1200, 0.06, 0.5], thump: [170, 60, 0.35, 0.07], tail: [800, 0.18, 0.08] },
    burst:   { crack: [3000, 0.03, 0.45], body: [900, 0.09, 0.6], thump: [130, 45, 0.45, 0.1], tail: [650, 0.25, 0.1] },
    sniper:  { crack: [4200, 0.06, 1.0], body: [800, 0.22, 0.9], thump: [90, 28, 1.0, 0.45], tail: [600, 1.3, 0.3], sub: [60, 20, 1.2, 0.8], wet: 0.34 },
  };

  function gun(id, opts = {}) {
    if (!ctx) return;
    const r = GUNS[id] || GUNS.rifle;
    const t = ctx.currentTime;
    const vol = opts.vol ?? 1;
    if (vol < 0.02 || !allow((opts.far || 0) > 0.3 ? 8 : 16)) return;
    const out = bus({ vol: vol * 0.85, pan: opts.pan || 0, far: opts.far || 0, wet: r.wet ?? 0.16, ttl: 3500 });
    const jitter = 0.94 + Math.random() * 0.12;
    noise(out, t, { type: 'highpass', freq: r.crack[0] * jitter, q: 0.7, gain: r.crack[2], decay: r.crack[1] });
    const body = ctx.createWaveShaper(); // the body layer gets a little distortion for grit
    body.curve = gritCurve();
    body.connect(out);
    noise(body, t, { type: 'bandpass', freq: r.body[0] * jitter, q: 0.9, gain: r.body[2], decay: r.body[1], sweepTo: r.body[0] * 0.5 });
    thump(out, t, { from: r.thump[0] * jitter, to: r.thump[1], gain: r.thump[2], decay: r.thump[3] });
    if (r.sub) thump(out, t, { from: r.sub[0], to: r.sub[1], gain: r.sub[2], decay: r.sub[3] }); // chest-thump
    noise(out, t + 0.01, { type: 'lowpass', freq: r.tail[0], q: 0.5, gain: r.tail[2], attack: 0.02, decay: r.tail[1] });
    if (!opts.far || opts.far < 0.6) mechanics(id, out, t);
  }

  // Shotgun pump, sniper bolt, a shell hitting the floor.
  function mechanics(id, out, t) {
    const click = (at, freq, gain = 0.25, decay = 0.03) => noise(out, t + at, { type: 'bandpass', freq, q: 4, gain, decay });
    if (id === 'shotgun') { click(0.32, 1800, 0.3, 0.05); click(0.36, 900, 0.25, 0.06); click(0.5, 2200, 0.3, 0.04); click(0.54, 1100, 0.25, 0.05); }
    else if (id === 'sniper') { click(0.5, 2600, 0.25); click(0.62, 1600, 0.2, 0.05); click(0.82, 1900, 0.22); click(0.9, 2800, 0.25); }
    else if (id === 'rifle' || id === 'pistol' || id === 'cannon' || id === 'smg' || id === 'burst') {
      if (Math.random() < 0.6) click(0.25 + Math.random() * 0.15, 5200 + Math.random() * 1500, 0.06, 0.04); // brass tink
    }
  }

  // Footsteps: soft thud + scuff. kind: 'walk' | 'sprint' | 'land'
  function step(opts = {}) {
    if (!ctx) return;
    const vol = opts.vol ?? 1;
    if (vol < 0.02 || !allow(10)) return;
    const t = ctx.currentTime;
    const out = bus({ vol, pan: opts.pan || 0, far: opts.far || 0, wet: 0.06, ttl: 800 });
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
    ensure();
    const t = ctx.currentTime;
    if (type === 'square' || type === 'sawtooth') type = 'triangle'; // harsh waves sounded eerie
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = Math.max(20, num(freq, 440));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol * 0.8, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 3200;
    o.connect(g).connect(lpf).connect(dry);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => { try { lpf.disconnect(); g.disconnect(); } catch {} };
  }

  // Generic noisy bang (explosions, knife hits). len = how long it rings out.
  function shot(vol = 1, pitch = 1, len = 0.14) {
    if (!ctx || vol < 0.02) return;
    const t = ctx.currentTime;
    const out = bus({ vol, wet: 0.2, ttl: 3500 });
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

  // One bad call must never break the game or the sound system.
  function safe(fns) {
    const out = {};
    for (const k in fns) out[k] = (...a) => { try { return fns[k](...a); } catch (e) { console.warn('audio', k, e); } };
    return out;
  }

  return {
    init,
    setVolume(v) { if (master) master.gain.value = 0.8 * v; },
    ...safe({ gun, step, reload, equip, blip, shot, whoosh }),
    // Compatibility with older calls: weapon(w, vol) plays that gun's sound.
    weapon(w, vol = 1, pan = 0, far = 0) { safe({ gun }).gun(w.id, { vol, pan, far }); },
  };
}
