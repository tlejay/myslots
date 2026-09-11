import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { busyBetween, calendar, CALENDAR_ID, isCalendarConfigured } from '@/lib/google-calendar'
import { ADD_GOOGLE_MEET, DURATIONS, HOST_NAME, TIME_ZONE } from '@/lib/config'
import { slotProblem } from '@/lib/booking-time'
import { notifyBookingCreated, notifyBookingFailed, type BookingSummary } from '@/lib/booking-email'

interface BookingRequest {
  startTime: string
  duration: number
  name: string
  email: string
  topic?: string
  guests?: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Every guest is a person Google will email, so the list is capped. */
const MAX_GUESTS = 10

/** Trimmed, lowercased, de-duplicated, and never the booker or the host again. */
function normaliseGuests(guests: string[] | undefined, bookerEmail: string): string[] {
  if (!guests) return []
  const taken = new Set([bookerEmail.trim().toLowerCase(), CALENDAR_ID.toLowerCase()])
  const out: string[] = []
  for (const raw of guests) {
    const email = String(raw).trim().toLowerCase()
    if (!email || taken.has(email)) continue
    taken.add(email)
    out.push(email)
  }
  return out
}

/**
 * The browser only ever offers legal slots, but the endpoint is public — so it
 * re-checks the request against working hours and the calendar before writing.
 */
function validate(body: BookingRequest): string | null {
  const { startTime, duration, name, email, guests } = body

  if (!startTime || !name?.trim() || !email?.trim()) return 'Missing required fields'
  if (!EMAIL_RE.test(email.trim())) return 'Invalid email address'
  if (!(DURATIONS as readonly number[]).includes(duration)) return 'Unsupported meeting length'

  if (guests !== undefined) {
    if (!Array.isArray(guests)) return 'Guests must be a list of email addresses'
    if (guests.length > MAX_GUESTS) return `At most ${MAX_GUESTS} guests`
    const bad = guests.map(g => String(g).trim()).filter(g => g && !EMAIL_RE.test(g))
    if (bad.length > 0) return `Invalid guest email: ${bad[0]}`
  }

  return slotProblem(new Date(startTime), duration)
}

export async function POST(request: NextRequest) {
  let body: BookingRequest
  try {
    body = (await request.json()) as BookingRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const problem = validate(body)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const { startTime, duration, name, email, topic } = body
  const guestEmails = normaliseGuests(body.guests, email)
  const start = new Date(startTime)
  const end = new Date(start.getTime() + duration * 60_000)

  const summary: BookingSummary = {
    name: name.trim(),
    email: email.trim(),
    topic: topic?.trim() ?? '',
    guests: guestEmails,
    start,
    end,
    duration,
  }

  try {
    // The page may have been open for an hour. Whoever booked this time in the
    // meantime keeps it; this visitor is told, and picks again. Back-to-back
    // meetings are fine, so a block that merely touches an edge does not count.
    const clashes = (await busyBetween(start, end)).filter(b => b.start < end && b.end > start)
    if (clashes.length > 0) {
      return NextResponse.json({ error: 'That slot was just taken' }, { status: 409 })
    }

    // Demo mode: the clash check above runs against the demo schedule, then it
    // pretends it worked — but never sends an invite, or a notification, to a
    // real person.
    if (!isCalendarConfigured) {
      return NextResponse.json({ success: true, demo: true, meetLink: null })
    }

    const created = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: 'all',
      conferenceDataVersion: ADD_GOOGLE_MEET ? 1 : 0,
      requestBody: {
        summary: `${HOST_NAME} × ${name.trim()}`,
        description: [topic?.trim() ? `Topic: ${topic.trim()}` : null, 'Booked via MySlots']
          .filter(Boolean)
          .join('\n\n'),
        start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
        end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
        attendees: [
          { email: CALENDAR_ID, responseStatus: 'accepted' },
          { email: email.trim(), displayName: name.trim() },
          ...guestEmails.map(guest => ({ email: guest })),
        ],
        ...(ADD_GOOGLE_MEET && {
          conferenceData: {
            createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
          },
        }),
      },
    })

    // Google attaches the room to the invite itself; the link is only read back
    // so the confirmation screen and the host's email can show it too. A room
    // Google declined to create leaves the booking standing, just without one.
    const meetLink = created.data.hangoutLink ?? null
    if (ADD_GOOGLE_MEET && !meetLink) {
      console.error('Google Meet room was not created:', created.data.conferenceData?.createRequest?.status)
    }

    // Google tells the guests. Nobody tells the host, so we do.
    await notifyBookingCreated({ ...summary, meetLink }, created.data.htmlLink)

    return NextResponse.json({ success: true, meetLink })
  } catch (err) {
    console.error('Booking failed:', err)
    // A booking that vanishes silently is worse than one that fails loudly.
    await notifyBookingFailed(summary, err)
    return NextResponse.json({ error: 'Booking failed' }, { status: 500 })
  }
}
