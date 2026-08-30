import { NextRequest, NextResponse } from 'next/server'
import { calendar, CALENDAR_ID, isCalendarConfigured } from '@/lib/google-calendar'
import { demoBusy } from '@/lib/demo-availability'
import { UTC_OFFSET, SLOT_STEP_MINUTES, hoursFor } from '@/lib/config'

interface Busy {
  start: string
  end: string
}

function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
}

/** Every candidate slot for the day, before the calendar is consulted. */
function generateSlots(date: string, durationMin: number) {
  const { start: startHour, end: endHour } = hoursFor(dayOfWeek(date))
  const closing = new Date(`${date}T${String(endHour).padStart(2, '0')}:00:00${UTC_OFFSET}`)
  const slots: { start: string; display: string }[] = []

  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += SLOT_STEP_MINUTES) {
      const hh = String(h).padStart(2, '0')
      const mm = String(m).padStart(2, '0')
      const slotStart = new Date(`${date}T${hh}:${mm}:00${UTC_OFFSET}`)
      const slotEnd = new Date(slotStart.getTime() + durationMin * 60_000)
      if (slotEnd > closing) continue // a meeting may not run past closing time
      slots.push({ start: slotStart.toISOString(), display: `${hh}:${mm}` })
    }
  }
  return slots
}

async function busyFor(date: string): Promise<Busy[]> {
  if (!isCalendarConfigured) {
    return demoBusy(date).map(b => ({
      start: `${b.start}${UTC_OFFSET}`,
      end: `${b.end}${UTC_OFFSET}`,
    }))
  }

  const fb = await calendar.freebusy.query({
    requestBody: {
      timeMin: new Date(`${date}T00:00:00${UTC_OFFSET}`).toISOString(),
      timeMax: new Date(`${date}T23:59:59${UTC_OFFSET}`).toISOString(),
      items: [{ id: CALENDAR_ID }],
    },
  })

  return (fb.data.calendars?.[CALENDAR_ID]?.busy ?? [])
    .filter((b): b is { start: string; end: string } => Boolean(b.start && b.end))
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const duration = Number(searchParams.get('duration') ?? '60')

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date — expected YYYY-MM-DD' }, { status: 400 })
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return NextResponse.json({ error: 'Invalid duration' }, { status: 400 })
  }

  try {
    const busy = await busyFor(date)
    const now = new Date()

    const slots = generateSlots(date, duration).map(({ start, display }) => {
      const slotStart = new Date(start)
      const slotEnd = new Date(slotStart.getTime() + duration * 60_000)

      if (slotStart <= now) return { start, display, available: false, reason: 'past' }

      const overlaps = busy.some(({ start: bs, end: be }) => {
        const busyStart = new Date(bs)
        const busyEnd = new Date(be)
        return slotStart < busyEnd && slotEnd > busyStart
      })

      return { start, display, available: !overlaps, reason: overlaps ? 'busy' : 'available' }
    })

    return NextResponse.json({ slots, demo: !isCalendarConfigured })
  } catch (err) {
    console.error('Availability lookup failed:', err)
    return NextResponse.json({ error: 'Calendar unavailable' }, { status: 503 })
  }
}
