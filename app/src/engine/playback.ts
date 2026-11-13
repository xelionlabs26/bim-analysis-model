/** Play / pause / seek / speed / loop over a fixed-length sequence. */
export class Playback {
  t = 0;
  playing = true;
  speed = 1;
  loop = true;
  private listeners = new Set<() => void>();

  constructor(public duration: number) {}

  setDuration(d: number) {
    this.duration = d;
    this.t = Number.isFinite(this.t) ? Math.min(this.t, d) : 0;
  }

  /** Advance by wall-clock dt (seconds). */
  tick(dt: number) {
    if (!this.playing) return;
    if (!Number.isFinite(this.t)) this.t = 0;
    let t = this.t + (Number.isFinite(dt) ? dt : 0) * this.speed;
    if (t >= this.duration) t = this.loop ? 0 : this.duration;
    this.t = t;
  }

  /** Jump to time t, clamped to the sequence. A non-finite time (say from a bad ?t= link) is ignored. */
  seek(t: number) {
    if (!Number.isFinite(t)) return;
    this.t = Math.min(Math.max(t, 0), this.duration);
    this.emit();
  }

  toggle(force?: boolean) {
    this.playing = force ?? !this.playing;
    this.emit();
  }

  cycleSpeed() {
    this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1;
    this.emit();
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}
