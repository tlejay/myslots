import { NextRequest, NextResponse } from 'next/server'
import { busyBetween, isCalendarConfigured } from '@/lib/google-calendar'
import { DURATIONS, SLOT_STEP_MINUTES } from '@/lib/config'
import { DATE_KEY_RE, addDaysToKey, hhmm, localInstant, openingMinutes } from '@/lib/booking-time'

/** Every candidate slot for the day, before the calendar is consulted. */
function generateSlots(date: string, durationMin: number) {
  const { open, close } = openingMinutes(date)
  const slots: { start: string; display: string }[] = []
  // A meeting may not run past closing time.
  for (let m = open; m + durationMin <= close; m += SLOT_STEP_MINUTES) {
    slots.push({ start: localInstant(date, m).toISOString(), display: hhmm(m) })
  }
  return slots
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const duration = Number(searchParams.get('duration') ?? '60')

  if (!date || !DATE_KEY_RE.test(date)) {
    return NextResponse.json({ error: 'Invalid date — expected YYYY-MM-DD' }, { status: 400 })
  }
  if (!(DURATIONS as readonly number[]).includes(duration)) {
    return NextResponse.json({ error: 'Unsupported meeting length' }, { status: 400 })
  }

  try {
    const busy = await busyBetween(localInstant(date, 0), localInstant(addDaysToKey(date, 1), 0))
    const now = new Date()

    const slots = generateSlots(date, duration).map(({ start, display }) => {
      const slotStart = new Date(start)
      const slotEnd = new Date(slotStart.getTime() + duration * 60_000)

      if (slotStart <= now) return { start, display, available: false, reason: 'past' }

      const overlaps = busy.some(b => slotStart < b.end && slotEnd > b.start)
      return { start, display, available: !overlaps, reason: overlaps ? 'busy' : 'available' }
    })

    return NextResponse.json({ slots, demo: !isCalendarConfigured })
  } catch (err) {
    console.error('Availability lookup failed:', err)
    return NextResponse.json({ error: 'Calendar unavailable' }, { status: 503 })
  }
}
