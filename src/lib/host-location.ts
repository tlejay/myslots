import { BUFFERS, CITIES, DEFAULT_LOCATION, LOCATION_EVENT_PREFIX, type CityId } from './config'
import {
  addDaysToKey,
  dateKeysBetween,
  localInstant,
  openSegments,
  type BusyBlock,
} from './booking-time'

// Where the host is, stretch by stretch through each day, read from location
// events on their own calendar ("@ Uptown"). Every minute no such event covers
// falls back to DEFAULT_LOCATION. Pure logic — the calendar read lives in
// google-calendar.ts — so scripts/check-booking.mjs runs it without Google.
//
// Times are minutes since local midnight, 0–1440; a stretch covers [start, end).

export const DAY_MINUTES = 24 * 60

/** An event whose title says where the host is. */
export interface LocationEvent {
  title: string
  start: Date
  end: Date
}

/**
 * Where the host is for one stretch of a day: a city from CITIES, or `null` for
 * anywhere in-person meetings cannot be booked — a city not in the list, or
 * nowhere known while DEFAULT_LOCATION is null.
 */
export interface HostStretch {
  start: number
  end: number
  city: CityId | null
}

export interface HostDay {
  date: string
  /** The whole day, 00:00 to 24:00, earliest first, with no gaps. */
  stretches: HostStretch[]
}

export interface Span {
  start: number
  end: number
}

const normalise = (name: string) => name.trim().toLowerCase().replace(/[\s-]+/g, ' ')

/**
 * The city a location event's title names, `null` when it names somewhere not
 * in CITIES, or `undefined` when the title is not a location event at all.
 */
export function cityFromTitle(title: string | null | undefined): CityId | null | undefined {
  const prefix = LOCATION_EVENT_PREFIX.trim()
  const text = (title ?? '').trim()
  if (!prefix || !text.startsWith(prefix)) return undefined
  const name = normalise(text.slice(prefix.length))
  if (!name) return undefined
  const city = CITIES.find(c => [c.id, c.label, ...c.aliases].some(n => normalise(n) === name))
  return city ? city.id : null
}

export function isLocationTitle(title: string | null | undefined): boolean {
  return cityFromTitle(title) !== undefined
}

/** The stretches of a day once [start, end) is set to `city`, over whatever was there. */
function lay(stretches: HostStretch[], start: number, end: number, city: CityId | null): HostStretch[] {
  const out: HostStretch[] = []
  for (const s of stretches) {
    if (s.end <= start || s.start >= end) {
      out.push(s)
      continue
    }
    if (s.start < start) out.push({ ...s, end: start })
    if (s.end > end) out.push({ ...s, start: end })
  }
  out.push({ start, end, city })
  return out.sort((a, b) => a.start - b.start)
}

/** Neighbouring stretches in the same place, joined into one. */
function joined(stretches: HostStretch[]): HostStretch[] {
  const out: HostStretch[] = []
  for (const s of stretches) {
    const last = out[out.length - 1]
    if (last && last.city === s.city && last.end === s.start) last.end = s.end
    else out.push({ ...s })
  }
  return out
}

/**
 * Every day from `from` to `to`, laid out end to end from the location events
 * among `events` (anything else is ignored). Where two of them overlap, the one
 * that starts later wins for the time they share — so "@ Downtown" 10:00–12:00
 * inside an all-day "@ Uptown" reads as a trip there and back. Of two that
 * start together, the shorter wins. `fallback` is where the host is the rest of
 * the time.
 */
export function hostDays(
  from: string,
  to: string,
  events: LocationEvent[],
  fallback: CityId | null = DEFAULT_LOCATION,
): HostDay[] {
  const located = events
    .map(e => ({ ...e, city: cityFromTitle(e.title) }))
    .filter((e): e is LocationEvent & { city: CityId | null } => e.city !== undefined && e.end > e.start)
    .sort((a, b) =>
      a.start.getTime() - b.start.getTime() || (b.end.getTime() - b.start.getTime()) - (a.end.getTime() - a.start.getTime()),
    )

  return dateKeysBetween(from, to).map(date => {
    const dayStart = localInstant(date, 0).getTime()
    const dayEnd = localInstant(addDaysToKey(date, 1), 0).getTime()
    let stretches: HostStretch[] = [{ start: 0, end: DAY_MINUTES, city: fallback }]
    for (const e of located) {
      const start = Math.max(e.start.getTime(), dayStart)
      const end = Math.min(e.end.getTime(), dayEnd)
      if (end <= start) continue
      // Whole minutes, so every edge can be written back as a wall-clock time.
      stretches = lay(stretches, Math.floor((start - dayStart) / 60_000), Math.ceil((end - dayStart) / 60_000), e.city)
    }
    return { date, stretches: joined(stretches) }
  })
}

/** When the host is in `city`, as unbroken stretches. */
export function presenceIn(stretches: HostStretch[], city: CityId): Span[] {
  return joined(stretches.filter(s => s.city === city)).map(({ start, end }) => ({ start, end }))
}

/** True when one stretch holds all of [from, to). */
export function covers(spans: Span[], from: number, to: number): boolean {
  return spans.some(s => s.start <= from && s.end >= to)
}

/**
 * Whether an in-person meeting at [start, end) on this day can happen in
 * `city`: the host must be there throughout, the journey either side included.
 */
export function onsiteFits(stretches: HostStretch[], city: CityId, start: number, end: number): boolean {
  const { before, after } = BUFFERS.onsite
  return covers(presenceIn(stretches, city), Math.max(0, start - before), Math.min(DAY_MINUTES, end + after))
}

/**
 * Where the host spends most of the day's working hours — the place to name
 * when a day is shut for in-person meetings in the city the visitor picked.
 * `null` = somewhere that cannot be booked.
 */
export function mainCity(dateKey: string, stretches: HostStretch[]): CityId | null {
  const minutes = new Map<CityId | null, number>()
  for (const { open, close } of openSegments(dateKey)) {
    for (const s of stretches) {
      const overlap = Math.min(s.end, close) - Math.max(s.start, open)
      if (overlap > 0) minutes.set(s.city, (minutes.get(s.city) ?? 0) + overlap)
    }
  }
  let best: CityId | null = null
  let most = 0
  for (const [city, m] of minutes) {
    if (m > most) [best, most] = [city, m]
  }
  return best
}

/**
 * The parts of `dateKey` the host is not in the city, as busy blocks for the
 * slot checks. They carry no buffer of their own, so the meeting's own journey
 * either side is what keeps it clear of them — the same rule as `onsiteFits`.
 */
export function absenceBlocks(dateKey: string, presence: Span[]): BusyBlock[] {
  const blocks: BusyBlock[] = []
  let cursor = 0
  const away = (start: number, end: number) => {
    if (end > start) blocks.push({ start: localInstant(dateKey, start), end: localInstant(dateKey, end), kind: 'away' })
  }
  for (const p of [...presence].sort((a, b) => a.start - b.start)) {
    away(cursor, p.start)
    cursor = Math.max(cursor, p.end)
  }
  away(cursor, DAY_MINUTES)
  return blocks
}
