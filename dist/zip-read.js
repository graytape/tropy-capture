// Read the uncompressed ZIP archives produced by Tropy Capture.
export async function readCaptureZip(file) {
  const data = await file.arrayBuffer();
  const view = new DataView(data);
  const bytes = new Uint8Array(data);
  const decode = new TextDecoder();
  const entries = new Map();
  const start = Math.max(0, data.byteLength - 65557);
  let end = -1;
  for (let offset = data.byteLength - 22; offset >= start; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === data.byteLength) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("Invalid ZIP archive.");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  if (cursor + view.getUint32(end + 12, true) > end) throw new Error("Invalid ZIP directory.");
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Invalid ZIP entry.");
    const method = view.getUint16(cursor + 10, true);
    if (method !== 0) throw new Error("This ZIP uses unsupported compression. Extract it and select the folder.");
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const name = decode.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localOffset = view.getUint32(cursor + 42, true);
    if (localOffset + 30 > end || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("Invalid ZIP file.");
    const contentStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (contentStart + size > end || entries.has(name)) throw new Error("Invalid ZIP contents.");
    entries.set(name, file.slice(contentStart, contentStart + size));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
