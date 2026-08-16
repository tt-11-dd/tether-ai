/** Split newline-delimited RPC stdout without breaking UTF-8 code points across chunks. */
export function drainUtf8Lines(buffer: Buffer, chunk: Buffer): { rest: Buffer; lines: string[] } {
  const combined = Buffer.concat([buffer, chunk]);
  const lines: string[] = [];
  let start = 0;
  let index = combined.indexOf(0x0a, start);
  while (index >= 0) {
    const line = combined.subarray(start, index).toString("utf8").replace(/\r$/, "");
    if (line) lines.push(line);
    start = index + 1;
    index = combined.indexOf(0x0a, start);
  }
  return { rest: combined.subarray(start), lines };
}
