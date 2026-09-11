import { NextRequest, NextResponse } from 'next/server'
import { busyBetween } from '@/lib/google-calendar'
import { MAX_DAYS_AHEAD } from '@/lib/config'
import {
  DATE_KEY_RE,
  addDaysToKey,
  bookingHorizon,
  freeWindows,
  localInstant,
  type FreeWindow,
} from '@/lib/booking-time'

// GET /api/availability/windows?from=2026-09-21&to=2026-09-25
//
// The free stretches of every day in the range, unfiltered by meeting length —
// the Find slots panel trims them to a length in the browser, so switching
// between 30 / 60 / 90 / custom never waits on the network.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  if (!DATE_KEY_RE.test(from) || !DATE_KEY_RE.test(to)) {
    return NextResponse.json({ error: 'Invalid range — expected from/to as YYYY-MM-DD' }, { status: 400 })
  }
  if (to < from) {
    return NextResponse.json({ error: 'The range ends before it starts' }, { status: 400 })
  }

  // Days before today have nothing to offer and days past the horizon cannot be
  // booked, so the range is clamped rather than refused.
  const { first, last } = bookingHorizon()
  const start = from < first ? first : from
  const end = to > last ? last : to
  if (end < start) {
    return NextResponse.json({ error: `Pick days between today and ${MAX_DAYS_AHEAD} days ahead` }, { status: 400 })
  }

  try {
    const busy = await busyBetween(localInstant(start, 0), localInstant(addDaysToKey(end, 1), 0))
    const now = new Date()

    const days: { date: string; windows: FreeWindow[] }[] = []
    for (let d = start; d <= end; d = addDaysToKey(d, 1)) {
      days.push({ date: d, windows: freeWindows(d, busy, now) })
    }
    return NextResponse.json({ days })
  } catch (err) {
    console.error('Calendar windows error:', err)
    return NextResponse.json({ error: 'Calendar unavailable' }, { status: 503 })
  }
}
