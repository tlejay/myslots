import { CITIES, LOCATION_EVENT_PREFIX } from './config'

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

/**
 * Fake location events, so in person can be tried without a calendar. Every
 * week has one day in the second city, one that starts in the default and moves
 * there after lunch, and one in the second city with a trip back to the first
 * from 10:00 to 12:00 — the rest fall back to DEFAULT_LOCATION. Keyed on the
 * day number, so any seven days in a row hold each kind once.
 */
export function demoLocations(date: string): { title: string; start: string; end: string }[] {
  const [y, m, d] = date.split('-').map(Number)
  const day = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  const home = `${LOCATION_EVENT_PREFIX}${CITIES[0].label}`
  const away = `${LOCATION_EVENT_PREFIX}${(CITIES[1] ?? CITIES[0]).label}`

  switch (day % 7) {
    case 1: return [{ title: away, start: `${date}T00:00:00`, end: `${next}T00:00:00` }]
    case 3: return [{ title: away, start: `${date}T13:00:00`, end: `${next}T00:00:00` }]
    case 5: return [
      { title: away, start: `${date}T00:00:00`, end: `${next}T00:00:00` },
      { title: home, start: `${date}T10:00:00`, end: `${date}T12:00:00` },
    ]
    default: return []
  }
}

/** The fake blocks of every day that [from, to) touches, as instants. */
function demoBetween<T extends { start: string; end: string }>(
  perDay: (date: string) => T[],
  from: Date,
  to: Date,
  dateKeyOf: (d: Date) => string,
  offset: string,
): (Omit<T, 'start' | 'end'> & { start: Date; end: Date })[] {
  const out: (Omit<T, 'start' | 'end'> & { start: Date; end: Date })[] = []
  const last = dateKeyOf(new Date(to.getTime() - 1))
  for (let d = dateKeyOf(from); d <= last; ) {
    for (const b of perDay(d)) out.push({ ...b, start: new Date(`${b.start}${offset}`), end: new Date(`${b.end}${offset}`) })
    const [y, m, day] = d.split('-').map(Number)
    d = new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10)
  }
  return out.filter(b => b.start < to && b.end > from)
}

/** The fake busy blocks of every day that [from, to) touches, as instants. */
export function demoBusyBetween(from: Date, to: Date, dateKeyOf: (d: Date) => string, offset: string) {
  return demoBetween(demoBusy, from, to, dateKeyOf, offset)
}

/** The fake location events of every day that [from, to) touches, as instants. */
export function demoLocationsBetween(from: Date, to: Date, dateKeyOf: (d: Date) => string, offset: string) {
  return demoBetween(demoLocations, from, to, dateKeyOf, offset)
}
