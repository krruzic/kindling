// A minimal fake AudioContext for node tests: nodes record their connections, AudioParams record automation,
// buffer sources record start / stop times, and advance(t) moves the clock and fires onended for sources whose
// stop time (or natural end) has passed.

export class FakeParam {
  events: [string, ...number[]][] = [];
  constructor(public value = 0) {}
  setValueAtTime(v: number, t: number) {
    this.events.push(["set", v, t]);
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(["linear", v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(["exp", v, t]);
    return this;
  }
  setTargetAtTime(v: number, t: number, k: number) {
    this.events.push(["target", v, t, k]);
    return this;
  }
  cancelScheduledValues(t: number) {
    this.events.push(["cancel", t]);
    return this;
  }
}

export class FakeNode {
  out: FakeNode[] = [];
  disconnected = false;
  constructor(
    public kind: string,
    public ctx: FakeContext,
  ) {}
  connect<T extends FakeNode>(n: T): T {
    this.out.push(n);
    return n;
  }
  disconnect() {
    this.disconnected = true;
    this.out = [];
  }
  /** Does audio from this node reach `target` through connections? */
  reaches(target: FakeNode): boolean {
    return this === target || this.out.some((n) => n.reaches(target));
  }
  /** Kinds along the first path to the destination. */
  path(): string[] {
    return [this.kind, ...(this.out[0]?.path() ?? [])];
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
  constructor(ctx: FakeContext) {
    super("gain", ctx);
  }
}

export class FakePanner extends FakeNode {
  pan = new FakeParam(0);
  constructor(ctx: FakeContext) {
    super("pan", ctx);
  }
}

export class FakeFilter extends FakeNode {
  type = "lowpass";
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  constructor(ctx: FakeContext) {
    super("filter", ctx);
  }
}

export class FakeBuffer {
  constructor(
    public duration: number,
    public sampleRate = 48000,
  ) {}
  getChannelData() {
    return new Float32Array(Math.max(1, Math.round(this.duration * this.sampleRate)));
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  playbackRate = new FakeParam(1);
  frequency = new FakeParam(440);
  type = "square";
  startAt: number | null = null;
  offset = 0;
  stopAt: number | null = null;
  ended = false;
  onended: (() => void) | null = null;
  constructor(kind: string, ctx: FakeContext) {
    super(kind, ctx);
    ctx.sources.push(this);
  }
  start(t = 0, offset = 0) {
    this.startAt = t;
    this.offset = offset;
  }
  stop(t = 0) {
    if (this.startAt === null) throw new Error("stop before start");
    this.stopAt = this.stopAt === null ? t : Math.min(this.stopAt, t);
  }
  /** When it ends on its own clock (Infinity: an unstopped loop). */
  get endTime(): number {
    if (this.startAt === null) return Infinity;
    const natural =
      this.loop || !this.buffer ? Infinity : this.startAt + this.buffer.duration / this.playbackRate.value;
    return Math.min(natural, this.stopAt ?? Infinity);
  }
}

export class FakeContext {
  currentTime = 0;
  sampleRate = 48000;
  state = "running";
  sources: FakeSource[] = [];
  destination = new FakeNode("destination", this);
  createGain() {
    return new FakeGain(this);
  }
  createStereoPanner() {
    return new FakePanner(this);
  }
  createBiquadFilter() {
    return new FakeFilter(this);
  }
  createDynamicsCompressor() {
    return new FakeNode("compressor", this);
  }
  createMediaElementSource(el: FakeMedia) {
    el.node = new FakeNode("media", this);
    return el.node;
  }
  createBufferSource() {
    return new FakeSource("source", this);
  }
  createOscillator() {
    return new FakeSource("osc", this);
  }
  createBuffer(_ch: number, len: number, rate: number) {
    return new FakeBuffer(len / rate, rate);
  }
  async decodeAudioData() {
    return new FakeBuffer(1);
  }
  async resume() {
    this.state = "running";
  }
  /** Moves the clock to t and fires onended for sources that finished. */
  advance(t: number) {
    this.currentTime = t;
    for (const s of this.sources)
      if (!s.ended && s.endTime <= t) {
        s.ended = true;
        s.onended?.();
      }
  }
  /** Sources started but never ending: loops nobody will stop. */
  get endless(): FakeSource[] {
    return this.sources.filter((s) => s.startAt !== null && s.endTime === Infinity);
  }
}

export const asCtx = (f: FakeContext) => f as unknown as AudioContext;
export const asBuf = (b: FakeBuffer) => b as unknown as AudioBuffer;

/** A fake media element for streamed music. */
export class FakeMedia {
  loop = false;
  preload = "";
  currentTime = 0;
  playing = false;
  node: FakeNode | null = null;
  constructor(public url: string) {}
  play() {
    this.playing = true;
    return Promise.resolve();
  }
  pause() {
    this.playing = false;
  }
}
