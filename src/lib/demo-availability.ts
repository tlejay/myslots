/**
 * Deterministic fake busy blocks, used only when Google credentials are absent.
 * Same date in, same result out — so the demo does not flicker between loads.
 */
export function demoBusy(date: string): { start: string; end: string }[] {
  const seed = [...date].reduce((n, c) => n + c.charCodeAt(0), 0)
  const blocks: { start: string; end: string }[] = []

  // Two or three meetings a day, spread across the working window.
  const count = 2 + (seed % 2)
  for (let i = 0; i < count; i++) {
    const startHour = 9 + ((seed * (i + 3)) % 9)
    const length = 1 + ((seed + i) % 2)
    blocks.push({
      start: `${date}T${String(startHour).padStart(2, '0')}:00:00`,
      end: `${date}T${String(Math.min(startHour + length, 20)).padStart(2, '0')}:00:00`,
    })
  }
  return blocks
}

/** The fake busy blocks of every day that [from, to) touches, as instants. */
export function demoBusyBetween(
  from: Date,
  to: Date,
  dateKeyOf: (d: Date) => string,
  offset: string,
): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = []
  const last = dateKeyOf(new Date(to.getTime() - 1))
  for (let d = dateKeyOf(from); d <= last; ) {
    for (const b of demoBusy(d)) out.push({ start: new Date(`${b.start}${offset}`), end: new Date(`${b.end}${offset}`) })
    const [y, m, day] = d.split('-').map(Number)
    d = new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10)
  }
  return out.filter(b => b.start < to && b.end > from)
}
