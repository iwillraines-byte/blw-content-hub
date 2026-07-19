// Minimal ZIP writer — STORE method only (no compression), zero dependencies.
// Photos are already JPEG/PNG compressed, so deflating them again buys ~0%
// and would need a real library; STORE keeps this ~80 lines and universally
// readable (Finder, Explorer, unzip).
//
// buildZip([{ name, blob }]) → Promise<Blob>   (application/zip)
//
// Format refresher: [local header + data] per file, then a central directory
// mirroring every entry, then the end-of-central-directory record. All
// little-endian; CRC-32 over the uncompressed bytes.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// DOS date/time stamp (ZIP's native format). Uses "now" — the stamp is
// cosmetic metadata on the extracted files.
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export async function buildZip(files) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime();
  const parts = [];        // BlobParts in file order
  const central = [];      // central-directory entries
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = new Uint8Array(await f.blob.arrayBuffer());
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);  // local file header signature
    local.setUint16(4, 20, true);          // version needed
    local.setUint16(6, 0x0800, true);      // flags: UTF-8 names
    local.setUint16(8, 0, true);           // method: STORE
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size (== raw for STORE)
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);          // extra length

    parts.push(local.buffer, nameBytes, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += 30 + nameBytes.length + data.length;
  }

  const centralParts = [];
  let centralSize = 0;
  for (const e of central) {
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);     // central directory signature
    cd.setUint16(4, 20, true);             // version made by
    cd.setUint16(6, 20, true);             // version needed
    cd.setUint16(8, 0x0800, true);         // flags: UTF-8 names
    cd.setUint16(10, 0, true);             // method: STORE
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, e.crc, true);
    cd.setUint32(20, e.size, true);
    cd.setUint32(24, e.size, true);
    cd.setUint16(28, e.nameBytes.length, true);
    // extra/comment/disk/attrs all zero
    cd.setUint32(42, e.offset, true);      // local header offset
    centralParts.push(cd.buffer, e.nameBytes);
    centralSize += 46 + e.nameBytes.length;
  }

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);     // end-of-central-directory signature
  eocd.setUint16(8, central.length, true); // entries on this disk
  eocd.setUint16(10, central.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);        // central directory offset
  return new Blob([...parts, ...centralParts, eocd.buffer], { type: 'application/zip' });
}
