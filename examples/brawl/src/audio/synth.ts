// Procedural sound: every sound effect and music loop in BRAWL is synthesised by this file (no samples to license,
// no generation credit spent). Pure functions over Float32Arrays, so the same code renders the sfx WAVs offline
// (tools/make-sfx.ts) and the music loops at runtime (MusicPlayer's `load` hook). Seeded noise keeps renders
// reproducible.

export type Wave = "sine" | "square" | "saw" | "tri" | "noise";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function osc(w: Wave, phase: number, noise: () => number): number {
  const p = phase - Math.floor(phase);
  switch (w) {
    case "sine":
      return Math.sin(p * Math.PI * 2);
    case "square":
      return p < 0.5 ? 0.8 : -0.8;
    case "saw":
      return 2 * p - 1;
    case "tri":
      return 1 - 4 * Math.abs(p - 0.5);
    default:
      return noise() * 2 - 1;
  }
}

export interface Voice {
  wave: Wave;
  /** Start / end frequency (Hz), exponential sweep. */
  f0: number;
  f1?: number;
  /** Seconds. */
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
  /** Exponential decay rate (1/s), 0 = sustained; omitted = linear fade to the end. */
  decay?: number;
  /** One-pole low-pass cutoff (Hz) for noise and buzz. */
  lp?: number;
  /** Vibrato depth (fraction) and rate (Hz). */
  vib?: [number, number];
}

/** Mixes voices into a buffer `len` seconds long at `rate`. */
export function render(voices: Voice[], len: number, rate = 22050, seed = 1): Float32Array {
  const out = new Float32Array(Math.ceil(len * rate));
  const noise = rng(seed);
  for (const v of voices) {
    const start = Math.floor((v.at ?? 0) * rate);
    const n = Math.floor(v.dur * rate);
    let phase = 0;
    let lp = 0;
    const k = v.lp ? 1 - Math.exp((-2 * Math.PI * v.lp) / rate) : 1;
    for (let i = 0; i < n && start + i < out.length; i++) {
      const t = i / rate;
      const f = v.f1 ? v.f0 * Math.pow(v.f1 / v.f0, t / v.dur) : v.f0;
      const fm = v.vib ? f * (1 + v.vib[0] * Math.sin(t * Math.PI * 2 * v.vib[1])) : f;
      phase += fm / rate;
      let s = osc(v.wave, phase, noise);
      lp += (s - lp) * k;
      s = v.lp ? lp : s;
      const a = v.attack ? Math.min(1, t / v.attack) : 1;
      const env = v.decay === undefined ? 1 - t / v.dur : Math.exp(-v.decay * t);
      const tail = Math.min(1, (v.dur - t) / 0.01);
      out[start + i] += s * v.gain * a * env * tail;
    }
  }
  return out;
}

/** Scales a buffer to `peak` and soft-clips it. */
export function normalise(buf: Float32Array, peak = 0.9): Float32Array {
  let m = 1e-6;
  for (const s of buf) m = Math.max(m, Math.abs(s));
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh((buf[i] / m) * peak * 1.2) / Math.tanh(1.2);
  return buf;
}

/** The sound effects: id -> variants (each a list of voices and a length). */
export function sfxRecipes(): Record<string, { len: number; voices: Voice[] }[]> {
  const v = (k: number, fn: (j: number) => { len: number; voices: Voice[] }) =>
    Array.from({ length: k }, (_, j) => fn(j));
  return {
    attack: v(3, (j) => ({
      len: 0.32,
      voices: [
        { wave: "noise", f0: 1, dur: 0.22, gain: 0.8, decay: 18, lp: 2600 + j * 500 },
        { wave: "square", f0: 220 + j * 30, f1: 70, dur: 0.18, gain: 0.5, decay: 14 },
      ],
    })),
    hit: v(3, (j) => ({
      len: 0.34,
      voices: [
        { wave: "sine", f0: 150 - j * 15, f1: 45, dur: 0.3, gain: 1, decay: 10 },
        { wave: "noise", f0: 1, dur: 0.08, gain: 0.7, decay: 40, lp: 5000 },
        { wave: "square", f0: 900 + j * 120, f1: 300, dur: 0.05, gain: 0.25, decay: 50 },
      ],
    })),
    dash: v(2, (j) => ({
      len: 0.4,
      voices: [
        { wave: "noise", f0: 1, dur: 0.36, gain: 0.7, attack: 0.04, decay: 7, lp: 1200 + j * 600 },
        { wave: "saw", f0: 160 + j * 20, f1: 420, dur: 0.22, gain: 0.18, decay: 10, lp: 2000 },
      ],
    })),
    slamCharge: v(1, () => ({
      len: 0.45,
      voices: [
        { wave: "saw", f0: 120, f1: 600, dur: 0.42, gain: 0.35, attack: 0.05, decay: 0, lp: 1800, vib: [0.03, 14] },
      ],
    })),
    slam: v(2, (j) => ({
      len: 0.9,
      voices: [
        { wave: "sine", f0: 90 - j * 8, f1: 30, dur: 0.85, gain: 1, decay: 4 },
        { wave: "noise", f0: 1, dur: 0.7, gain: 0.8, decay: 5, lp: 700 },
        { wave: "noise", f0: 1, dur: 0.12, gain: 0.5, decay: 25, lp: 6000 },
      ],
    })),
    bump: v(2, (j) => ({
      len: 0.25,
      voices: [
        { wave: "square", f0: 520 + j * 140, dur: 0.2, gain: 0.25, decay: 22, lp: 3000 },
        { wave: "tri", f0: 1310 + j * 210, dur: 0.18, gain: 0.25, decay: 18 },
        { wave: "noise", f0: 1, dur: 0.04, gain: 0.5, decay: 60, lp: 4000 },
      ],
    })),
    fall: v(2, (j) => ({
      len: 0.9,
      voices: [
        { wave: "tri", f0: 900 - j * 80, f1: 160, dur: 0.85, gain: 0.45, decay: 0, vib: [0.02, 9] },
        { wave: "noise", f0: 1, dur: 0.5, gain: 0.25, attack: 0.3, decay: 3, lp: 600 },
      ],
    })),
    ko: v(1, () => ({
      len: 1.4,
      voices: [
        { wave: "noise", f0: 1, dur: 1.35, gain: 0.6, attack: 0.25, decay: 2.2, lp: 1400 },
        { wave: "noise", f0: 1, dur: 1.2, gain: 0.3, attack: 0.15, decay: 3, lp: 3200 },
      ],
    })),
    countdown: v(1, () => ({ len: 0.3, voices: [{ wave: "square", f0: 660, dur: 0.22, gain: 0.35, decay: 9 }] })),
    fight: v(1, () => ({
      len: 0.7,
      voices: [
        { wave: "square", f0: 880, dur: 0.6, gain: 0.3, decay: 4 },
        { wave: "square", f0: 1320, dur: 0.6, gain: 0.2, decay: 4 },
        { wave: "noise", f0: 1, dur: 0.3, gain: 0.3, decay: 10, lp: 3000 },
      ],
    })),
    roundOver: v(1, () => ({ len: 1.0, voices: arpeggio([523, 659, 784, 1047], 0.09, 0.5, "square", 0.22) })),
    matchOver: v(1, () => ({
      len: 2.2,
      voices: [
        ...arpeggio([392, 523, 659, 784, 1047, 1319], 0.1, 1.3, "square", 0.2),
        { wave: "tri", f0: 131, dur: 2, gain: 0.4, at: 0.1, decay: 1.4 },
      ],
    })),
    join: v(1, () => ({ len: 0.5, voices: arpeggio([784, 1175], 0.07, 0.35, "tri", 0.35) })),
    "bed.wind": v(1, () => ({
      len: 6,
      voices: [
        { wave: "noise", f0: 1, dur: 6, gain: 0.6, decay: 0, lp: 380, attack: 0.001 },
        { wave: "noise", f0: 1, dur: 6, gain: 0.25, decay: 0, lp: 900, attack: 0.001 },
      ],
    })),
    "bed.crowd": v(1, () => ({
      len: 5,
      voices: Array.from({ length: 14 }, (_, i) => ({
        wave: "saw" as Wave,
        f0: 110 + ((i * 37) % 90),
        dur: 5,
        gain: 0.05,
        decay: 0,
        lp: 500,
        vib: [0.05, 0.4 + (i % 5) * 0.21] as [number, number],
        attack: 0.001,
      })),
    })),
  };
}

function arpeggio(freqs: number[], step: number, dur: number, wave: Wave, gain: number): Voice[] {
  return freqs.map((f, i) => ({ wave, f0: f, at: i * step, dur, gain, decay: 5 }));
}

/** Loops crossfaded at the seam so a looped bed never clicks. */
export function seamless(buf: Float32Array, rate: number, fade = 0.25): Float32Array {
  const n = Math.floor(fade * rate);
  const out = buf.slice(0, buf.length - n);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    out[i] = out[i] * k + buf[buf.length - n + i] * (1 - k);
  }
  return out;
}

// ── Music ──

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export interface Song {
  bpm: number;
  bars: number;
  /** Chord roots (MIDI) per bar. */
  roots: number[];
  /** Arp intervals over each root. */
  arp: number[];
  lead?: number[];
  drums: boolean;
  wave: Wave;
  bass: Wave;
  swing?: number;
}

export const SONGS: Record<string, Song> = {
  menu: {
    bpm: 96,
    bars: 8,
    roots: [57, 53, 60, 55, 57, 53, 55, 52],
    arp: [0, 7, 12, 16, 12, 7],
    drums: false,
    wave: "tri",
    bass: "sine",
  },
  select: {
    bpm: 118,
    bars: 8,
    roots: [52, 52, 55, 57, 52, 52, 59, 57],
    arp: [0, 7, 12, 7],
    drums: true,
    wave: "square",
    bass: "tri",
  },
  battle: {
    bpm: 148,
    bars: 8,
    roots: [45, 45, 48, 50, 45, 45, 43, 44],
    arp: [0, 12, 7, 12, 3, 12, 7, 15],
    lead: [69, -1, 72, 74, -1, 72, 69, -1, 67, 69, -1, 64, 67, -1, 69, -1],
    drums: true,
    wave: "square",
    bass: "saw",
  },
  results: {
    bpm: 104,
    bars: 4,
    roots: [60, 65, 67, 60],
    arp: [0, 4, 7, 12, 7, 4],
    drums: false,
    wave: "tri",
    bass: "tri",
  },
};

/** Renders one loop of a song (exactly `bars` long, so it loops seamlessly). */
export function renderSong(s: Song, rate = 22050): Float32Array {
  const beat = 60 / s.bpm;
  const bar = beat * 4;
  const len = bar * s.bars;
  const voices: Voice[] = [];
  for (let b = 0; b < s.bars; b++) {
    const root = s.roots[b % s.roots.length];
    const t0 = b * bar;
    voices.push({ wave: s.bass, f0: NOTE(root - 12), at: t0, dur: beat * 1.9, gain: 0.32, decay: 1.2, lp: 900 });
    voices.push({
      wave: s.bass,
      f0: NOTE(root - 12),
      at: t0 + beat * 2,
      dur: beat * 1.9,
      gain: 0.28,
      decay: 1.4,
      lp: 900,
    });
    const steps = s.arp.length;
    const per = bar / (steps * 2);
    for (let k = 0; k < steps * 2; k++)
      voices.push({
        wave: s.wave,
        f0: NOTE(root + s.arp[k % steps]),
        at: t0 + k * per,
        dur: per * 0.9,
        gain: 0.07,
        decay: 9,
        lp: 3500,
      });
    if (s.lead)
      for (let k = 0; k < 16; k++) {
        const n = s.lead[(k + b * 3) % s.lead.length];
        if (n > 0 && b % 2 === 1)
          voices.push({
            wave: "tri",
            f0: NOTE(n),
            at: t0 + (k * bar) / 16,
            dur: bar / 16,
            gain: 0.12,
            decay: 3,
            vib: [0.01, 6],
          });
      }
    if (s.drums)
      for (let q = 0; q < 8; q++) {
        const at = t0 + q * (beat / 2);
        if (q % 4 === 0) voices.push({ wave: "sine", f0: 120, f1: 40, at, dur: 0.22, gain: 0.55, decay: 14 });
        if (q % 4 === 2) voices.push({ wave: "noise", f0: 1, at, dur: 0.16, gain: 0.3, decay: 20, lp: 2600 });
        voices.push({ wave: "noise", f0: 1, at, dur: 0.04, gain: 0.08, decay: 70, lp: 9000 });
      }
  }
  return normalise(render(voices, len, rate, s.bpm), 0.7);
}

/** 16-bit PCM mono WAV bytes. */
export function wav(buf: Float32Array, rate: number): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + buf.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  out.setUint32(4, 36 + buf.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, "data");
  out.setUint32(40, buf.length * 2, true);
  for (let i = 0; i < buf.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, buf[i])) * 32767, true);
  return new Uint8Array(out.buffer);
}
