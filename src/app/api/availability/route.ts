import { NextRequest, NextResponse } from 'next/server'
import { busyBetween, hostDaysBetween, isCalendarConfigured } from '@/lib/google-calendar'
import { DURATIONS, parseMeetingKind, type CityId } from '@/lib/config'
import { addDaysToKey, daySlots, hhmm, isDateKey, localInstant, withBuffers, type Interval } from '@/lib/booking-time'
import { absenceBlocks, mainCity, presenceIn } from '@/lib/host-location'

// GET /api/availability?date=2026-10-22&duration=60
// GET /api/availability?date=2026-10-22&duration=60&mode=onsite&city=uptown
//
// In person, only the stretches of the day the host is in that city are open,
// the journey either side included. The response says when that is
// (`presence`), or — on a day they are not there at all — which listed city
// they are in instead (`hostCity`, null for anywhere else), so the page can say
// why the day is shut. Location event titles themselves never leave the server.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const duration = Number(searchParams.get('duration') ?? '60')

  if (!isDateKey(date)) {
    return NextResponse.json({ error: 'Invalid date — expected YYYY-MM-DD' }, { status: 400 })
  }
  if (!(DURATIONS as readonly number[]).includes(duration)) {
    return NextResponse.json({ error: 'Unsupported meeting length' }, { status: 400 })
  }
  const kind = parseMeetingKind(searchParams.get('mode'), searchParams.get('city'))
  if ('error' in kind) return NextResponse.json({ error: kind.error }, { status: 400 })

  try {
    let away: Interval[] = []
    let place: { hostCity: CityId | null; presence: { start: string; end: string }[] } | null = null
    if (kind.mode === 'onsite') {
      const [{ stretches }] = await hostDaysBetween(date, date)
      const presence = presenceIn(stretches, kind.city)
      place = {
        hostCity: presence.length > 0 ? kind.city : mainCity(date, stretches),
        presence: presence.map(p => ({ start: hhmm(p.start), end: hhmm(p.end) })),
      }
      // Elsewhere all day: nothing to offer, and no reason to read the busy times.
      if (presence.length === 0) return NextResponse.json({ slots: [], ...place, demo: !isCalendarConfigured })
      away = withBuffers(absenceBlocks(date, presence), 'onsite')
    }

    const busy = await busyBetween(localInstant(date, 0), localInstant(addDaysToKey(date, 1), 0), kind.mode)
    const slots = daySlots(date, duration, [...busy, ...away])
    return NextResponse.json({ slots, ...place, demo: !isCalendarConfigured })
  } catch (err) {
    console.error('Availability lookup failed:', err)
    return NextResponse.json({ error: 'Calendar unavailable' }, { status: 503 })
  }
}
