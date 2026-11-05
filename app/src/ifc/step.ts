/**
 * ISO 10303-21 ("STEP physical file") reader for IFC.
 *
 * `index()` scans the DATA section once and records where each instance's
 * argument list starts and ends. Arguments are only parsed when an entity is
 * visited, so a large file costs one linear scan plus whatever the importer
 * actually touches.
 */

export class Ref {
  constructor(readonly id: number) {}
}
export class Enum {
  constructor(readonly v: string) {}
}
export class Typed {
  constructor(
    readonly type: string,
    readonly value: StepValue,
  ) {}
}
/** `$` is null; `*` (derived attribute) is undefined. */
export type StepValue = number | string | null | undefined | Ref | Enum | Typed | StepValue[];

export interface Entity {
  id: number;
  type: string;
  args: StepValue[];
}

export interface StepHeader {
  schema: string; // IFC2X3, IFC4, IFC4X3...
  description: string;
  originatingSystem: string;
  timeStamp: string;
  name: string;
}

const CH_HASH = 35;
const CH_QUOTE = 39;
const CH_LPAREN = 40;
const CH_RPAREN = 41;
const CH_EQ = 61;
const CH_SLASH = 47;
const CH_STAR = 42;
const CH_DOLLAR = 36;
const CH_DOT = 46;
const CH_COMMA = 44;

const isDigit = (c: number) => c >= 48 && c <= 57;
const isNameChar = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || isDigit(c) || c === 95;
const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9;

export class StepFile {
  readonly header: StepHeader;
  private ids: number[] = [];
  private typeIdx: number[] = [];
  private argStart: number[] = [];
  private argEnd: number[] = [];
  private slot = new Map<number, number>();
  private typeNames: string[] = [];
  private typeLookup = new Map<string, number>();
  private byTypeIds = new Map<number, number[]>();
  private cache = new Map<number, Entity>();
  readonly complexIds: number[] = [];

  private constructor(private readonly text: string) {
    this.header = parseHeader(text);
  }

  /** Index a whole file. `onProgress` gets the share of the text scanned (0–1). */
  static parse(text: string, onProgress?: (share: number) => void): StepFile {
    const f = new StepFile(text);
    f.scan(onProgress);
    return f;
  }

  get count() {
    return this.ids.length;
  }

  private internType(name: string): number {
    let i = this.typeLookup.get(name);
    if (i === undefined) {
      i = this.typeNames.length;
      this.typeNames.push(name);
      this.typeLookup.set(name, i);
      this.byTypeIds.set(i, []);
    }
    return i;
  }

  private scan(onProgress?: (share: number) => void) {
    const s = this.text;
    const n = s.length;
    let i = s.indexOf('DATA;');
    if (i < 0) throw new Error('Not an IFC file: no DATA section');
    i += 5;
    let nextReport = i + 4_000_000;
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === CH_HASH) {
        // #id
        let j = i + 1;
        let id = 0;
        while (j < n && isDigit(s.charCodeAt(j))) id = id * 10 + (s.charCodeAt(j++) - 48);
        while (j < n && isSpace(s.charCodeAt(j))) j++;
        if (s.charCodeAt(j) !== CH_EQ) {
          i = j;
          continue;
        }
        j++;
        while (j < n && isSpace(s.charCodeAt(j))) j++;
        if (s.charCodeAt(j) === CH_LPAREN) {
          // complex instance: #id=(IFCA(...)IFCB(...)); — kept aside, rarely needed
          const end = this.skipBalanced(j);
          this.complexIds.push(id);
          this.record(id, '(COMPLEX)', j + 1, end - 1);
          i = this.toSemicolon(end);
          continue;
        }
        const t0 = j;
        while (j < n && isNameChar(s.charCodeAt(j))) j++;
        const type = s.slice(t0, j).toUpperCase();
        while (j < n && isSpace(s.charCodeAt(j))) j++;
        if (s.charCodeAt(j) !== CH_LPAREN) {
          i = j;
          continue;
        }
        const end = this.skipBalanced(j);
        this.record(id, type, j + 1, end - 1);
        i = this.toSemicolon(end);
        if (onProgress && i > nextReport) {
          onProgress(i / n);
          nextReport = i + 4_000_000;
        }
        continue;
      }
      if (c === CH_SLASH && s.charCodeAt(i + 1) === CH_STAR) {
        const e = s.indexOf('*/', i + 2);
        i = e < 0 ? n : e + 2;
        continue;
      }
      if (c === 69 /* E */ && s.startsWith('ENDSEC;', i)) break;
      i++;
    }
    onProgress?.(1);
  }

  private record(id: number, type: string, a: number, b: number) {
    const t = this.internType(type);
    this.slot.set(id, this.ids.length);
    this.ids.push(id);
    this.typeIdx.push(t);
    this.argStart.push(a);
    this.argEnd.push(b);
    this.byTypeIds.get(t)!.push(id);
  }

  /** From an opening '(' return the index just after its matching ')'. */
  private skipBalanced(open: number): number {
    const s = this.text;
    const n = s.length;
    let depth = 0;
    let i = open;
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === CH_QUOTE) {
        i++;
        while (i < n) {
          if (s.charCodeAt(i) === CH_QUOTE) {
            if (s.charCodeAt(i + 1) === CH_QUOTE) i += 2;
            else break;
          } else i++;
        }
      } else if (c === CH_LPAREN) depth++;
      else if (c === CH_RPAREN) {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return n;
  }

  private toSemicolon(i: number): number {
    const e = this.text.indexOf(';', i);
    return e < 0 ? this.text.length : e + 1;
  }

  has(id: number) {
    return this.slot.has(id);
  }

  typeOf(id: number): string | undefined {
    const k = this.slot.get(id);
    return k === undefined ? undefined : this.typeNames[this.typeIdx[k]];
  }

  /** All instance ids of an exact (upper-case) type name. */
  idsOfType(type: string): number[] {
    const t = this.typeLookup.get(type);
    return t === undefined ? [] : this.byTypeIds.get(t)!;
  }

  /** Type names present in the file, with counts. */
  typeCounts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const [t, list] of this.byTypeIds) m.set(this.typeNames[t], list.length);
    return m;
  }

  get(id: number): Entity | undefined {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const k = this.slot.get(id);
    if (k === undefined) return undefined;
    const p = new ArgParser(this.text, this.argStart[k], this.argEnd[k]);
    const e: Entity = { id, type: this.typeNames[this.typeIdx[k]], args: p.list() };
    this.cache.set(id, e);
    return e;
  }

  /** Resolve a value that should be a reference. */
  deref(v: StepValue): Entity | undefined {
    return v instanceof Ref ? this.get(v.id) : undefined;
  }

  /** Drop parsed entities to free memory (the index stays). */
  clearCache() {
    this.cache.clear();
  }
}

/** Recursive-descent parser over one argument list (without its outer parentheses). */
class ArgParser {
  private i: number;
  constructor(
    private readonly s: string,
    start: number,
    private readonly end: number,
  ) {
    this.i = start;
  }

  list(): StepValue[] {
    const out: StepValue[] = [];
    this.ws();
    if (this.i >= this.end) return out;
    for (;;) {
      out.push(this.value());
      this.ws();
      const c = this.s.charCodeAt(this.i);
      if (c === CH_COMMA) {
        this.i++;
        continue;
      }
      break;
    }
    return out;
  }

  private ws() {
    while (this.i < this.end && isSpace(this.s.charCodeAt(this.i))) this.i++;
  }

  private value(): StepValue {
    this.ws();
    const s = this.s;
    const c = s.charCodeAt(this.i);
    if (c === CH_HASH) {
      let j = this.i + 1;
      let id = 0;
      while (isDigit(s.charCodeAt(j))) id = id * 10 + (s.charCodeAt(j++) - 48);
      this.i = j;
      return new Ref(id);
    }
    if (c === CH_QUOTE) return this.string();
    if (c === CH_DOLLAR) {
      this.i++;
      return null;
    }
    if (c === CH_STAR) {
      this.i++;
      return undefined;
    }
    if (c === CH_DOT) {
      const e = s.indexOf('.', this.i + 1);
      const v = s.slice(this.i + 1, e);
      this.i = e + 1;
      return new Enum(v.toUpperCase());
    }
    if (c === CH_LPAREN) {
      this.i++;
      const inner: StepValue[] = [];
      this.ws();
      if (s.charCodeAt(this.i) === CH_RPAREN) {
        this.i++;
        return inner;
      }
      for (;;) {
        inner.push(this.value());
        this.ws();
        const d = s.charCodeAt(this.i);
        if (d === CH_COMMA) {
          this.i++;
          continue;
        }
        if (d === CH_RPAREN) this.i++;
        break;
      }
      return inner;
    }
    if (c === 34 /* " binary */) {
      const e = s.indexOf('"', this.i + 1);
      const v = s.slice(this.i + 1, e);
      this.i = e + 1;
      return v;
    }
    if (isNameChar(c) && !isDigit(c) && c !== 95) {
      // typed value: IFCLABEL('x'), IFCPARAMETERVALUE(0.5)
      const t0 = this.i;
      while (isNameChar(s.charCodeAt(this.i))) this.i++;
      const type = s.slice(t0, this.i).toUpperCase();
      this.ws();
      if (s.charCodeAt(this.i) === CH_LPAREN) {
        this.i++;
        const v = this.value();
        this.ws();
        if (s.charCodeAt(this.i) === CH_RPAREN) this.i++;
        return new Typed(type, v);
      }
      return new Enum(type);
    }
    // number
    const t0 = this.i;
    while (this.i < this.end) {
      const d = s.charCodeAt(this.i);
      if (isDigit(d) || d === 43 || d === 45 || d === CH_DOT || d === 69 || d === 101) this.i++;
      else break;
    }
    if (this.i === t0) {
      this.i++; // unknown token: skip it
      return null;
    }
    return parseFloat(s.slice(t0, this.i));
  }

  private string(): string {
    const s = this.s;
    let j = this.i + 1;
    let raw = '';
    let start = j;
    for (;;) {
      const c = s.charCodeAt(j);
      if (c === CH_QUOTE) {
        if (s.charCodeAt(j + 1) === CH_QUOTE) {
          raw += s.slice(start, j + 1);
          j += 2;
          start = j;
          continue;
        }
        raw += s.slice(start, j);
        break;
      }
      if (j >= this.end + 1) {
        raw += s.slice(start, j);
        break;
      }
      j++;
    }
    this.i = j + 1;
    return raw.indexOf('\\') >= 0 ? decodeStepString(raw) : raw;
  }
}

/** Decode the ISO 10303-21 string escapes: \\, \S\, \X\HH, \X2\…\X0\, \X4\…\X0\, \P?\. */
export function decodeStepString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const next = raw[i + 1];
    if (next === '\\') {
      out += '\\';
      i++;
    } else if (next === 'S' && raw[i + 2] === '\\') {
      out += String.fromCharCode(raw.charCodeAt(i + 3) + 128);
      i += 3;
    } else if (next === 'P' && raw[i + 3] === '\\') {
      i += 3; // code page switch: ignored
    } else if (next === 'X' && raw[i + 2] === '\\') {
      out += String.fromCharCode(parseInt(raw.slice(i + 3, i + 5), 16));
      i += 4;
    } else if (next === 'X' && (raw[i + 2] === '2' || raw[i + 2] === '4') && raw[i + 3] === '\\') {
      const width = raw[i + 2] === '2' ? 4 : 8;
      const end = raw.indexOf('\\X0\\', i + 4);
      const hex = raw.slice(i + 4, end < 0 ? raw.length : end);
      for (let k = 0; k + width <= hex.length; k += width) out += String.fromCodePoint(parseInt(hex.slice(k, k + width), 16));
      i = end < 0 ? raw.length : end + 3;
    } else out += c;
  }
  return out;
}

function parseHeader(text: string): StepHeader {
  const head = text.slice(0, Math.min(text.length, 20000));
  const pick = (re: RegExp) => decodeStepString(re.exec(head)?.[1] ?? '');
  const schema = (/FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(head)?.[1] ?? 'IFC2X3').toUpperCase();
  return {
    schema,
    description: pick(/FILE_DESCRIPTION\s*\(\s*\(\s*'((?:[^']|'')*)'/i),
    name: pick(/FILE_NAME\s*\(\s*'((?:[^']|'')*)'/i),
    timeStamp: pick(/FILE_NAME\s*\(\s*'(?:[^']|'')*'\s*,\s*'((?:[^']|'')*)'/i),
    originatingSystem: pick(/FILE_NAME\s*\([^;]*?,\s*'((?:[^']|'')*)'\s*,\s*'(?:[^']|'')*'\s*,\s*'(?:[^']|'')*'\s*\)\s*;/i),
  };
}

// ── small helpers used by the importer ─────────────────────────────────────

export const num = (v: StepValue, fallback = 0): number => {
  if (typeof v === 'number') return v;
  if (v instanceof Typed) return num(v.value, fallback);
  return fallback;
};
export const str = (v: StepValue): string => {
  if (typeof v === 'string') return v;
  if (v instanceof Typed) return str(v.value);
  return '';
};
export const enumOf = (v: StepValue): string => (v instanceof Enum ? v.v : '');
export const bool = (v: StepValue): boolean | null => {
  if (v instanceof Typed) return bool(v.value);
  if (v instanceof Enum) return v.v === 'T' ? true : v.v === 'F' ? false : null;
  return null;
};
export const refs = (v: StepValue): number[] => (Array.isArray(v) ? v.filter((x): x is Ref => x instanceof Ref).map((x) => x.id) : v instanceof Ref ? [v.id] : []);
