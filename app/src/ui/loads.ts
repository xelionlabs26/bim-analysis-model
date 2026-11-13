/**
 * Loads that replace one another, and the BCF export that must not outlive
 * the model it started on. Pure, so the rules are tested without a page.
 *
 * Every load (an opened or dropped file, the Duplex sample, Arbor House)
 * takes a generation. Work from an older generation is dropped when it
 * resumes: its progress, its result, its error and hiding the loading card,
 * so the model on show is always the last one asked for.
 */

/** Thrown from an older load's progress callback to stop its meshing. */
export class Superseded extends Error {
  constructor() {
    super('A newer load took over');
    this.name = 'Superseded';
  }
}

export class LoadGate {
  private gen = 0;

  /** Start a load (or supersede the ones running): its generation. */
  begin(): number {
    return ++this.gen;
  }

  /** Whether `gen` is still the newest load. */
  isCurrent(gen: number): boolean {
    return gen === this.gen;
  }

  /** For a progress callback: throws Superseded when a newer load took over. */
  check(gen: number): void {
    if (!this.isCurrent(gen)) throw new Superseded();
  }

  /**
   * Whether a failure of load `gen` should be reported: not when it was
   * superseded (its error belongs to a model nobody is waiting for).
   */
  reports(gen: number, err: unknown): boolean {
    return !(err instanceof Superseded) && this.isCurrent(gen);
  }

  /** The newest generation handed out (0 before any load). */
  get current(): number {
    return this.gen;
  }
}

/**
 * The page opened on a sample (?sample=duplex) falls back to the demo tower
 * only when the sample was not shown, nothing has been mounted meanwhile and
 * no newer load is still running.
 */
export function sampleFallback(o: { shown: boolean; mounted: boolean; gate: LoadGate; gen: number }): boolean {
  return !o.shown && !o.mounted && o.gate.isCurrent(o.gen);
}

/**
 * The BCF export's guard: one export at a time, and an export stops when the
 * model or the report it started with is replaced.
 */
export class ExportGuard<P, R> {
  private busy = false;

  get running(): boolean {
    return this.busy;
  }

  /** Start an export of `p` and `r`; null while another one runs. The handle's stale() turns true once either is replaced. */
  start(p: P, r: R, now: () => { p: P; r: R }): { stale: () => boolean; done: () => void } | null {
    if (this.busy) return null;
    this.busy = true;
    let open = true;
    return {
      stale: () => {
        const cur = now();
        return cur.p !== p || cur.r !== r;
      },
      done: () => {
        if (open) {
          open = false;
          this.busy = false;
        }
      },
    };
  }
}
