/** Must match `proposeBlocks` in server/src/schedule/setup.ts exactly (same rounding). */
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Equal blocks between day start and end, each rounded down to the minute; the last ends at `dayEnd`. */
export function proposeBlocks(dayStart: string, dayEnd: string, count: number): { name: string; start: string; end: string }[] {
  const a = toMin(dayStart);
  const b = toMin(dayEnd);
  return Array.from({ length: count }, (_, i) => ({
    name: `Session ${i + 1}`,
    start: toHhmm(a + Math.floor(((b - a) * i) / count)),
    end: i === count - 1 ? dayEnd : toHhmm(a + Math.floor(((b - a) * (i + 1)) / count)),
  }));
}
