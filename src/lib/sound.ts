// Synthesized mission soundscape. Zero audio assets: everything is generated
// with the Web Audio API. Nothing plays until the user enables sound (the
// toggle click is the required user gesture).
"use client";

const STORAGE_KEY = "mc_sound";

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private send: GainNode | null = null; // shared space-echo bus
  private padGain: GainNode | null = null;
  private padOscs: OscillatorNode[] = [];
  private padFilter: BiquadFilterNode | null = null;
  private lastBlip = 0;
  private lastWhoosh = 0;
  private _enabled = false;
  // warp jump state machine (acceleration -> cruise -> arrival)
  private warp: {
    noise: AudioBufferSourceNode;
    lp: BiquadFilterNode;
    gain: GainNode;
    sub: OscillatorNode;
    subGain: GainNode;
    lfo: OscillatorNode;
    lfoDepth: GainNode;
  } | null = null;
  private warpEndTimer: number | null = null;

  get enabled(): boolean {
    return this._enabled;
  }

  init(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.25;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -28;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);

    // space echo: delay with filtered feedback
    const send = ctx.createGain();
    send.gain.value = 0.9;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.31;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 1800;
    send.connect(delay);
    delay.connect(damp).connect(fb).connect(delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    delay.connect(wet).connect(master);

    this.ctx = ctx;
    this.master = master;
    this.send = send;
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch { /* private mode */ }
    if (on) {
      this.init();
      this.ctx?.resume();
      this.startPad();
      this.confirmBlip();
    } else {
      this.stopPad();
      this.killWarp();
      this.ctx?.suspend();
    }
  }

  restoreFromStorage(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  // ---- ambient pad: two detuned oscillators through a slowly breathing lowpass
  private startPad(): void {
    if (!this.ctx || !this.master || this.padOscs.length) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    gain.gain.linearRampToValueAtTime(0.02, ctx.currentTime + 4);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(lp.frequency);
    const o1 = ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = 110;
    const o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = 110.45;
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(gain).connect(this.master);
    o1.start();
    o2.start();
    lfo.start();
    this.padOscs = [o1, o2, lfo];
    this.padGain = gain;
    this.padFilter = lp;
  }

  private stopPad(): void {
    for (const o of this.padOscs) {
      try { o.stop(); } catch { /* already stopped */ }
    }
    this.padOscs = [];
    this.padGain = null;
    this.padFilter = null;
  }

  // Position along the route (0 = home edge, 1 = galactic core). The pad
  // rises about two semitones toward the core and the filter opens a touch:
  // same timbre, just the sky getting busier. Smooth ramps, never steps.
  setTravelPosition(t: number): void {
    if (!this.ctx || this.padOscs.length < 2) return;
    const k = Math.min(1, Math.max(0, t));
    const ratio = Math.pow(2, (k * 2) / 12);
    const now = this.ctx.currentTime;
    this.padOscs[0].frequency.setTargetAtTime(110 * ratio, now, 0.35);
    this.padOscs[1].frequency.setTargetAtTime(110.45 * ratio, now, 0.35);
    this.padFilter?.frequency.setTargetAtTime(320 + 140 * k, now, 0.5);
  }

  // velocity-driven ambient brightness (0..1)
  setAmbientIntensity(x: number): void {
    if (!this.ctx || !this.padGain) return;
    const target = 0.012 + Math.min(Math.max(x, 0), 1) * 0.02;
    this.padGain.gain.linearRampToValueAtTime(target, this.ctx.currentTime + 2);
  }

  // ---- one new star = one sonar ping. intensity 0..1 maps to pitch.
  ping(intensity = 0.5): void {
    if (!this._enabled || !this.ctx || !this.master || !this.send) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const base = 660 + intensity * 520 + (Math.random() - 0.5) * 40;
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 0.94, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.085, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.55);
    osc.connect(g);
    g.connect(this.master);
    g.connect(this.send);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  hoverBlip(): void {
    if (!this._enabled || !this.ctx || !this.master) return;
    const now = performance.now();
    if (now - this.lastBlip < 90) return;
    this.lastBlip = now;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 1250;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.022, t);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.05);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  private confirmBlip(): void {
    // small two-tone confirmation when sound is switched on
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    [880, 1320].forEach((f, i) => {
      const t = ctx.currentTime + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 0.14);
    });
  }

  // Soft "air pass" for panning: low-passed noise with a gentle DOWNWARD
  // sweep and a slow envelope. (An upward bandpass sweep with high Q reads
  // as squeaking shoes; this reads as inertia.)
  panWhoosh(): void {
    if (!this._enabled || !this.ctx || !this.master) return;
    const now = performance.now();
    if (now - this.lastWhoosh < 220) return;
    this.lastWhoosh = now;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(620, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.045);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.2);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);

    // FTL shimmer on top: two soft rising partials feeding the space echo,
    // so chained pans blur into a continuous superluminal glide.
    if (this.send) {
      [
        { f0: 880, f1: 1480, gain: 0.014 },
        { f0: 1320, f1: 2220, gain: 0.007 },
      ].forEach((p) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(p.f0, t);
        osc.frequency.exponentialRampToValueAtTime(p.f1, t + 0.22);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0, t);
        og.gain.linearRampToValueAtTime(p.gain, t + 0.05);
        og.gain.exponentialRampToValueAtTime(0.0004, t + 0.26);
        osc.connect(og);
        og.connect(this.master!);
        og.connect(this.send!);
        osc.start(t);
        osc.stop(t + 0.3);
      });
    }
  }

  // ---- warp jump: a sustained bed with three phases.
  // Called on every pan tick; intensity 0 = local system (fine), 1 = route
  // band (fast). First tick swells in (acceleration), repeated ticks hold
  // the cruise, and 380ms of silence triggers the arrival thump.
  warpPan(intensity: number): void {
    if (!this._enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // The route variant is the SAME character as the local one, just faster:
    // slightly brighter and louder, sub a touch higher, and (the real speed
    // cue) a flutter tremolo whose rate rises with the pace.
    const cruiseGain = 0.035 + intensity * 0.01;
    const cruiseSub = 0.022 + intensity * 0.008;
    const cruiseCut = 500 + intensity * 220;
    const flutterHz = 1.2 + intensity * 5.3;

    if (!this.warp) {
      // acceleration: build the bed and swell it over ~0.7s
      const len = Math.floor(ctx.sampleRate * 1.2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 0.8;
      lp.frequency.setValueAtTime(160, t);
      lp.frequency.exponentialRampToValueAtTime(cruiseCut, t + 0.75);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(cruiseGain, t + 0.7);
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.setValueAtTime(46, t);
      sub.frequency.exponentialRampToValueAtTime(64 + intensity * 10, t + 0.7);
      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0, t);
      subGain.gain.linearRampToValueAtTime(cruiseSub, t + 0.7);
      // flutter: amplitude tremolo on the bed, rate = perceived speed
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(flutterHz, t);
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.setValueAtTime(0, t);
      lfoDepth.gain.linearRampToValueAtTime(cruiseGain * 0.35, t + 0.7);
      lfo.connect(lfoDepth).connect(gain.gain);
      noise.connect(lp).connect(gain);
      gain.connect(this.master);
      if (this.send) gain.connect(this.send);
      sub.connect(subGain).connect(this.master);
      noise.start(t);
      sub.start(t);
      lfo.start(t);
      this.warp = { noise, lp, gain, sub, subGain, lfo, lfoDepth };
    } else {
      // cruise: glide the bed toward this zone's intensity
      this.warp.gain.gain.setTargetAtTime(cruiseGain, t, 0.12);
      this.warp.subGain.gain.setTargetAtTime(cruiseSub, t, 0.12);
      this.warp.lp.frequency.setTargetAtTime(cruiseCut, t, 0.12);
      this.warp.lfo.frequency.setTargetAtTime(flutterHz, t, 0.15);
      this.warp.lfoDepth.gain.setTargetAtTime(cruiseGain * 0.35, t, 0.15);
      this.warp.sub.frequency.setTargetAtTime(64 + intensity * 10, t, 0.15);
    }

    if (this.warpEndTimer !== null) clearTimeout(this.warpEndTimer);
    this.warpEndTimer = window.setTimeout(() => this.warpArrival(), 260);
  }

  // arrival: cut the bed fast and land with a low thump
  private warpArrival(): void {
    if (!this.ctx || !this.master || !this.warp) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const w = this.warp;
    w.gain.gain.cancelScheduledValues(t);
    w.subGain.gain.cancelScheduledValues(t);
    w.lfoDepth.gain.cancelScheduledValues(t);
    w.gain.gain.setTargetAtTime(0.0001, t, 0.045);
    w.subGain.gain.setTargetAtTime(0.0001, t, 0.045);
    w.lfoDepth.gain.setTargetAtTime(0, t, 0.03);
    try {
      w.noise.stop(t + 0.3);
      w.sub.stop(t + 0.3);
      w.lfo.stop(t + 0.3);
    } catch { /* already stopped */ }
    this.warp = null;

    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(95, t);
    thump.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.07, t);
    tg.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
    thump.connect(tg).connect(this.master);
    if (this.send) tg.connect(this.send);
    thump.start(t);
    thump.stop(t + 0.32);
  }

  private killWarp(): void {
    if (this.warpEndTimer !== null) {
      clearTimeout(this.warpEndTimer);
      this.warpEndTimer = null;
    }
    if (this.warp) {
      try {
        this.warp.noise.stop();
        this.warp.sub.stop();
        this.warp.lfo.stop();
      } catch { /* already stopped */ }
      this.warp = null;
    }
  }

  // Tiny directional gliss for zooming: pitch up when zooming in, down when
  // zooming out.
  zoomTick(zoomIn: boolean): void {
    if (!this._enabled || !this.ctx || !this.master) return;
    const now = performance.now();
    if (now - this.lastWhoosh < 90) return;
    this.lastWhoosh = now;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(zoomIn ? 500 : 680, t);
    osc.frequency.exponentialRampToValueAtTime(zoomIn ? 680 : 500, t + 0.055);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.028, t);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.1);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  // serene three-note arpeggio for milestone crossings
  fanfare(): void {
    if (!this._enabled || !this.ctx || !this.master || !this.send) return;
    const ctx = this.ctx;
    [329.6, 493.9, 659.3].forEach((f, i) => {
      const t = ctx.currentTime + i * 0.16;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.4);
      osc.connect(g);
      g.connect(this.master!);
      g.connect(this.send!);
      osc.start(t);
      osc.stop(t + 1.5);
    });
  }
}

export const sound = new AudioEngine();
