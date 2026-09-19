const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[n] = value >>> 0;
  }
  return table;
})();

function write16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function write32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

async function crc32(blob) {
  const chunkSize = 1024 * 1024;
  let crc = 0xffffffff;

  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
    for (let index = 0; index < bytes.length; index += 1) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function asBlob(data, type = "application/octet-stream") {
  if (data instanceof Blob) return data;
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return new Blob([data], { type });
  const textType = type === "application/octet-stream" ? "text/plain;charset=utf-8" : type;
  return new Blob([String(data)], { type: textType });
}

// Images are already compressed, so ZIP STORE is both fast and memory-efficient.
export async function createZip(entries, onProgress = () => {}) {
  if (entries.length > 65535) {
    throw new Error("The package contains too many files for the standard ZIP format.");
  }

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let centralSize = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const nameBytes = encoder.encode(entry.name.replace(/^\/+/, ""));
    const blob = asBlob(entry.data, entry.type);
    if (blob.size > 0xffffffff) {
      throw new Error(`The file ${entry.name} exceeds the 4 GB ZIP limit.`);
    }

    const checksum = await crc32(blob);
    const { time, day } = dosDateTime(entry.modifiedAt ? new Date(entry.modifiedAt) : new Date());
    const localHeader = new ArrayBuffer(30);
    const local = new DataView(localHeader);
    write32(local, 0, 0x04034b50);
    write16(local, 4, 20);
    write16(local, 6, 0x0800);
    write16(local, 8, 0);
    write16(local, 10, time);
    write16(local, 12, day);
    write32(local, 14, checksum);
    write32(local, 18, blob.size);
    write32(local, 22, blob.size);
    write16(local, 26, nameBytes.length);
    write16(local, 28, 0);
    localParts.push(localHeader, nameBytes, blob);

    const centralHeader = new ArrayBuffer(46);
    const central = new DataView(centralHeader);
    write32(central, 0, 0x02014b50);
    write16(central, 4, 20);
    write16(central, 6, 20);
    write16(central, 8, 0x0800);
    write16(central, 10, 0);
    write16(central, 12, time);
    write16(central, 14, day);
    write32(central, 16, checksum);
    write32(central, 20, blob.size);
    write32(central, 24, blob.size);
    write16(central, 28, nameBytes.length);
    write16(central, 30, 0);
    write16(central, 32, 0);
    write16(central, 34, 0);
    write16(central, 36, 0);
    write32(central, 38, 0);
    write32(central, 42, localOffset);
    centralParts.push(centralHeader, nameBytes);

    localOffset += localHeader.byteLength + nameBytes.byteLength + blob.size;
    centralSize += centralHeader.byteLength + nameBytes.byteLength;
    if (localOffset > 0xffffffff || centralSize > 0xffffffff) {
      throw new Error("The package exceeds the 4 GB limit of the standard ZIP format. Use Save to folder.");
    }
    onProgress((index + 1) / entries.length, entry.name);
  }

  const endHeader = new ArrayBuffer(22);
  const end = new DataView(endHeader);
  write32(end, 0, 0x06054b50);
  write16(end, 4, 0);
  write16(end, 6, 0);
  write16(end, 8, entries.length);
  write16(end, 10, entries.length);
  write32(end, 12, centralSize);
  write32(end, 16, localOffset);
  write16(end, 20, 0);

  return new Blob([...localParts, ...centralParts, endHeader], { type: "application/zip" });
}
