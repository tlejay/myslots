import { NextRequest, NextResponse } from 'next/server'
import { busyBetween, hostDaysBetween } from '@/lib/google-calendar'
import { MAX_DAYS_AHEAD, parseMeetingKind } from '@/lib/config'
import {
  addDaysToKey,
  bookingHorizon,
  dateKeysBetween,
  freeWindows,
  isDateKey,
  localInstant,
  withBuffers,
  type FreeWindow,
  type Interval,
} from '@/lib/booking-time'
import { absenceBlocks, presenceIn } from '@/lib/host-location'

// GET /api/availability/windows?from=2026-09-21&to=2026-09-25
// GET /api/availability/windows?from=2026-09-21&to=2026-09-25&mode=onsite&city=uptown
//
// The free stretches of every day in the range, unfiltered by meeting length —
// the Find slots panel trims them to a length in the browser, so switching
// between 30 / 60 / 90 / custom never waits on the network. In person, only the
// stretches the host is in that city (journey included) are open.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  if (!isDateKey(from) || !isDateKey(to)) {
    return NextResponse.json({ error: 'Invalid range — expected from/to as YYYY-MM-DD' }, { status: 400 })
  }
  if (to < from) {
    return NextResponse.json({ error: 'The range ends before it starts' }, { status: 400 })
  }
  const kind = parseMeetingKind(searchParams.get('mode'), searchParams.get('city'))
  if ('error' in kind) return NextResponse.json({ error: kind.error }, { status: 400 })

  // Days before today have nothing to offer and days past the horizon cannot be
  // booked, so the range is clamped rather than refused.
  const { first, last } = bookingHorizon()
  const start = from < first ? first : from
  const end = to > last ? last : to
  if (end < start) {
    return NextResponse.json({ error: `Pick days between today and ${MAX_DAYS_AHEAD} days ahead` }, { status: 400 })
  }

  try {
    // In person, the hours the host is somewhere else are busy too, with the
    // meeting's own journey kept clear of them; a day they are not there at all
    // is shut (`null`). The whole map is `null` online.
    let away: Map<string, Interval[] | null> | null = null
    if (kind.mode === 'onsite') {
      const hostDays = await hostDaysBetween(start, end)
      away = new Map(hostDays.map(d => {
        const presence = presenceIn(d.stretches, kind.city)
        return [d.date, presence.length > 0 ? withBuffers(absenceBlocks(d.date, presence), 'onsite') : null]
      }))
    }

    const busy = await busyBetween(localInstant(start, 0), localInstant(addDaysToKey(end, 1), 0), kind.mode)
    const now = new Date()

    const days: { date: string; windows: FreeWindow[] }[] = dateKeysBetween(start, end).map(d => {
      if (!away) return { date: d, windows: freeWindows(d, busy, now) }
      const elsewhere = away.get(d)
      return { date: d, windows: elsewhere ? freeWindows(d, [...busy, ...elsewhere], now) : [] }
    })
    return NextResponse.json({ days })
  } catch (err) {
    console.error('Calendar windows error:', err)
    return NextResponse.json({ error: 'Calendar unavailable' }, { status: 503 })
  }
}
