/**
 * A minimal ZIP writer (stored entries, no compression). BCF and the issue
 * register only need a valid container: the XML is small and PNG snapshots
 * are already compressed.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

/** DOS date and time fields for a JS date (local time, as ZIP tools expect). */
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosTime(when);
  const files = entries.map((e) => {
    const name = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    return { name, data, crc: crc32(data) };
  });
  const localSize = files.reduce((a, f) => a + 30 + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((a, f) => a + 46 + f.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const dv = new DataView(out.buffer);
  let o = 0;
  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(o);
    dv.setUint32(o, 0x04034b50, true);
    dv.setUint16(o + 4, 20, true); // version needed
    dv.setUint16(o + 6, 0x0800, true); // UTF-8 names
    dv.setUint16(o + 8, 0, true); // stored
    dv.setUint16(o + 10, time, true);
    dv.setUint16(o + 12, date, true);
    dv.setUint32(o + 14, f.crc, true);
    dv.setUint32(o + 18, f.data.length, true);
    dv.setUint32(o + 22, f.data.length, true);
    dv.setUint16(o + 26, f.name.length, true);
    dv.setUint16(o + 28, 0, true);
    out.set(f.name, o + 30);
    out.set(f.data, o + 30 + f.name.length);
    o += 30 + f.name.length + f.data.length;
  }
  const central = o;
  files.forEach((f, k) => {
    dv.setUint32(o, 0x02014b50, true);
    dv.setUint16(o + 4, 20, true); // made by
    dv.setUint16(o + 6, 20, true); // needed
    dv.setUint16(o + 8, 0x0800, true);
    dv.setUint16(o + 10, 0, true);
    dv.setUint16(o + 12, time, true);
    dv.setUint16(o + 14, date, true);
    dv.setUint32(o + 16, f.crc, true);
    dv.setUint32(o + 20, f.data.length, true);
    dv.setUint32(o + 24, f.data.length, true);
    dv.setUint16(o + 28, f.name.length, true);
    dv.setUint16(o + 30, 0, true); // extra
    dv.setUint16(o + 32, 0, true); // comment
    dv.setUint16(o + 34, 0, true); // disk
    dv.setUint16(o + 36, 0, true); // internal attributes
    dv.setUint32(o + 38, 0, true); // external attributes
    dv.setUint32(o + 42, offsets[k], true);
    out.set(f.name, o + 46);
    o += 46 + f.name.length;
  });
  dv.setUint32(o, 0x06054b50, true);
  dv.setUint16(o + 8, files.length, true);
  dv.setUint16(o + 10, files.length, true);
  dv.setUint32(o + 12, o - central, true);
  dv.setUint32(o + 16, central, true);
  return out;
}

/** Read back a stored ZIP (for tests): name → bytes, verifying every CRC. */
export function unzip(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let end = buf.length - 22;
  while (end >= 0 && dv.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip');
  const n = dv.getUint16(end + 10, true);
  let o = dv.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(o, true) !== 0x02014b50) throw new Error('bad central directory');
    const crc = dv.getUint32(o + 16, true);
    const size = dv.getUint32(o + 20, true);
    const nameLen = dv.getUint16(o + 28, true);
    const extra = dv.getUint16(o + 30, true);
    const comment = dv.getUint16(o + 32, true);
    const local = dv.getUint32(o + 42, true);
    const name = dec.decode(buf.subarray(o + 46, o + 46 + nameLen));
    const lName = dv.getUint16(local + 26, true), lExtra = dv.getUint16(local + 28, true);
    const data = buf.subarray(local + 30 + lName + lExtra, local + 30 + lName + lExtra + size);
    if (crc32(data) !== crc) throw new Error(`crc mismatch in ${name}`);
    out.set(name, data);
    o += 46 + nameLen + extra + comment;
  }
  return out;
}
