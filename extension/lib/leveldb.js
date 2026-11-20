/* HeaderDial: read a Chrome/Edge LevelDB folder (an extension's "Local Extension Settings"
 * or the browser's "Local Storage/leveldb") in the browser, without uploading anything, and
 * find ModHeader profiles in it. Used by the "Recover ModHeader profiles" page and the
 * extension's import dialog. Our own implementation of the documented LevelDB file formats
 * (log, table, snappy); it only reads, and only what is needed to get key/value pairs. */
(function (root) {
  'use strict';

  // ---- small byte helpers
  function varint(buf, pos) {
    let result = 0, shift = 0, b;
    do {
      if (pos >= buf.length) throw new Error('truncated varint');
      b = buf[pos++];
      result += (b & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (b & 0x80);
    return [result, pos];
  }
  const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 0x1000000;

  // ---- snappy (raw block format, as LevelDB stores compressed table blocks)
  function snappy(src) {
    let [len, pos] = varint(src, 0);
    const out = new Uint8Array(len);
    let o = 0;
    while (pos < src.length) {
      const tag = src[pos++];
      const kind = tag & 3;
      if (kind === 0) {
        let n = tag >> 2;
        if (n >= 60) {
          const bytes = n - 59;
          n = 0;
          for (let i = 0; i < bytes; i++) n += src[pos + i] * Math.pow(256, i);
          pos += bytes;
        }
        n += 1;
        out.set(src.subarray(pos, pos + n), o);
        pos += n; o += n;
        continue;
      }
      let n, off;
      if (kind === 1) { n = ((tag >> 2) & 7) + 4; off = ((tag >> 5) << 8) | src[pos++]; }
      else if (kind === 2) { n = (tag >> 2) + 1; off = src[pos] | (src[pos + 1] << 8); pos += 2; }
      else { n = (tag >> 2) + 1; off = u32(src, pos); pos += 4; }
      if (!off || off > o) throw new Error('bad snappy offset');
      for (let i = 0; i < n; i++, o++) out[o] = out[o - off]; // may overlap: copy byte by byte
    }
    if (o !== len) throw new Error('snappy length mismatch');
    return out;
  }

  // ---- write batches (the payload of every log record)
  function readBatch(rec, add) {
    if (rec.length < 12) return;
    const seq = u32(rec, 0) + u32(rec, 4) * 0x100000000;
    const count = u32(rec, 8);
    let pos = 12;
    for (let i = 0; i < count && pos < rec.length; i++) {
      const tag = rec[pos++];
      let klen, vlen;
      [klen, pos] = varint(rec, pos);
      const key = rec.subarray(pos, pos + klen); pos += klen;
      if (tag === 1) {
        [vlen, pos] = varint(rec, pos);
        add(key, seq + i, rec.subarray(pos, pos + vlen)); pos += vlen;
      } else if (tag === 0) add(key, seq + i, null);
      else return; // unknown tag: stop rather than misread
    }
  }

  // ---- log files: 32 KiB blocks of records (7-byte header: crc32, length, type)
  function readLog(buf, add) {
    const BLOCK = 32768;
    let pos = 0, parts = null;
    while (pos + 7 <= buf.length) {
      const left = BLOCK - (pos % BLOCK);
      if (left < 7) { pos += left; continue; }
      const len = buf[pos + 4] | (buf[pos + 5] << 8), type = buf[pos + 6];
      const data = buf.subarray(pos + 7, pos + 7 + len);
      pos += 7 + len;
      if (type === 0) { pos += BLOCK - (pos % BLOCK || BLOCK); continue; } // zero padding: rest of block
      if (type === 1) readBatch(data, add);
      else if (type === 2) parts = [data];
      else if (type === 3 && parts) parts.push(data);
      else if (type === 4 && parts) {
        parts.push(data);
        const whole = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let o = 0;
        for (const p of parts) { whole.set(p, o); o += p.length; }
        readBatch(whole, add);
        parts = null;
      }
    }
  }

  // ---- table files (.ldb / .sst): footer -> index block -> data blocks
  function blockAt(buf, offset, size) {
    const raw = buf.subarray(offset, offset + size);
    const type = buf[offset + size];
    if (type === 1) return snappy(raw);
    if (type === 0) return raw;
    throw new Error('unsupported block compression ' + type);
  }
  function blockEntries(block, each) {
    const restarts = u32(block, block.length - 4);
    const end = block.length - 4 - restarts * 4;
    let pos = 0, key = new Uint8Array(0);
    while (pos < end) {
      let shared, own, vlen;
      [shared, pos] = varint(block, pos);
      [own, pos] = varint(block, pos);
      [vlen, pos] = varint(block, pos);
      const k = new Uint8Array(shared + own);
      k.set(key.subarray(0, shared), 0);
      k.set(block.subarray(pos, pos + own), shared);
      pos += own;
      key = k;
      each(k, block.subarray(pos, pos + vlen));
      pos += vlen;
    }
  }
  function readTable(buf, add) {
    if (buf.length < 48) throw new Error('too short for a table');
    const f = buf.length - 48;
    if (u32(buf, f + 40) !== 0x8b80fb57 || u32(buf, f + 44) !== 0xdb477524) throw new Error('not a LevelDB table');
    let p = f, mo, ms, io, is;
    [mo, p] = varint(buf, p); [ms, p] = varint(buf, p);
    [io, p] = varint(buf, p); [is, p] = varint(buf, p);
    blockEntries(blockAt(buf, io, is), (_, handle) => {
      let [o, q] = varint(handle, 0);
      const [s] = varint(handle, q);
      blockEntries(blockAt(buf, o, s), (ikey, value) => {
        if (ikey.length < 8) return;
        const n = ikey.length - 8;
        const type = ikey[n];
        const seq = (u32(ikey, n) - type) / 256 + u32(ikey, n + 4) * 0x1000000;
        add(ikey.subarray(0, n), seq, type === 1 ? value : null);
      });
    });
  }

  /**
   * files: [{ name, bytes: Uint8Array }] from one or more LevelDB folders.
   * Returns { entries: [{ key: Uint8Array, value: Uint8Array, file }], errors: [string] }
   * with only the newest live value of each key.
   */
  function readLevelDB(files) {
    const latest = new Map();
    const errors = [];
    for (const file of files) {
      const name = String(file.name);
      const add = (key, seq, value) => {
        const k = (file.dir || '') + '\u0000' + latin1(key);
        const cur = latest.get(k);
        if (!cur || seq >= cur.seq) latest.set(k, { key: key.slice(), seq, value: value && value.slice(), file: name });
      };
      try {
        if (/\.log$/i.test(name)) readLog(file.bytes, add);
        else if (/\.(ldb|sst)$/i.test(name)) readTable(file.bytes, add);
      } catch (e) {
        errors.push(name + ': ' + e.message);
      }
    }
    const entries = [...latest.values()].filter((e) => e.value).map(({ key, value, file }) => ({ key, value, file }));
    return { entries, errors };
  }

  function latin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return s;
  }
  function utf16(bytes) {
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    return s;
  }
  const utf8 = (b) => new TextDecoder('utf-8', { fatal: false }).decode(b);

  /**
   * Text of a key/value pair. chrome.storage values are UTF-8 JSON. window.localStorage
   * ("Local Storage/leveldb") keys look like "_<origin>\0<1 byte encoding><name>" and values
   * start with an encoding byte too: 0 = UTF-16LE, 1 = Latin-1.
   */
  function decodeEntry(e) {
    const k = latin1(e.key);
    const m = /^_([^\u0000]*)\u0000([\u0000\u0001])/.exec(k);
    if (m) {
      const rest = e.key.subarray(m[0].length);
      const dec = (enc, b) => (enc === 0 ? utf16(b) : latin1(b));
      return { origin: m[1], key: dec(m[2].charCodeAt(0), rest), text: dec(e.value[0], e.value.subarray(1)) };
    }
    return { origin: '', key: utf8(e.key), text: utf8(e.value) };
  }

  function looksLikeModHeader(o) {
    return !!o && typeof o === 'object' && !Array.isArray(o) && ('respHeaders' in o || 'shortTitle' in o ||
      'urlReplacements' in o || 'appendMode' in o || ('title' in o && 'headers' in o));
  }
  // Walk a parsed value for ModHeader profiles: a list of them, or a lone one. Strings that
  // hold JSON (localStorage stores strings) are parsed too.
  function profilesIn(v, depth) {
    if (depth > 6 || v == null) return [];
    if (typeof v === 'string') {
      const t = v.trim();
      if (!/^[[{]/.test(t)) return [];
      try { return profilesIn(JSON.parse(t), depth + 1); } catch (e) { return []; }
    }
    if (Array.isArray(v)) {
      if (v.length && v.every(looksLikeModHeader)) return [v];
      return v.reduce((acc, x) => acc.concat(profilesIn(x, depth + 1)), []);
    }
    if (typeof v === 'object') {
      if (looksLikeModHeader(v)) return [[v]];
      return Object.keys(v).reduce((acc, k) => acc.concat(profilesIn(v[k], depth + 1)), []);
    }
    return [];
  }

  /**
   * Find ModHeader profile sets in LevelDB files. Returns
   * { found: [{ key, origin, file, profiles }], errors, scanned } where each set is a
   * ModHeader-format array that HeaderDial's importer accepts. Identical sets are merged.
   */
  function findModHeaderProfiles(files) {
    const { entries, errors } = readLevelDB(files);
    const found = [];
    const seen = new Set();
    for (const e of entries) {
      const d = decodeEntry(e);
      for (const set of profilesIn(d.text, 0)) {
        const json = JSON.stringify(set);
        if (seen.has(json)) continue;
        seen.add(json);
        found.push({ key: d.key, origin: d.origin, file: e.file, profiles: set });
      }
    }
    found.sort((a, b) => b.profiles.length - a.profiles.length);
    return { found, errors, scanned: entries.length };
  }

  root.HeaderDialLevelDB = { snappy, readLevelDB, decodeEntry, findModHeaderProfiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HeaderDialLevelDB;
})(typeof self !== 'undefined' ? self : globalThis);
