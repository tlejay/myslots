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
