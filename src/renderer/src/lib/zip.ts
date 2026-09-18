/** Minimal ZIP writer using the store method (no native dependency). */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const u16 = (n: number): number[] => [n & 255, (n >>> 8) & 255];
const u32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

export function makeZip(entries: Array<{ name: string; content: string }>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: number[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name.replace(/\\/g, '/'));
    const data = enc.encode(entry.content);
    const crc = crc32(data);
    const localOffset = offset;
    const local = [0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...name, ...data];
    chunks.push(...local);
    offset += local.length;
    central.push(0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(localOffset), ...name);
  }
  const centralOffset = offset;
  chunks.push(...central);
  chunks.push(0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(central.length), ...u32(centralOffset), ...u16(0));
  return Uint8Array.from(chunks);
}
