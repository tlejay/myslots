import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import {
  BOOKING_TAG,
  busyBetween,
  calendar,
  CALENDAR_ID,
  hostDaysBetween,
  isCalendarConfigured,
} from '@/lib/google-calendar'
import { ADD_GOOGLE_MEET, HOST_NAME, TIME_ZONE, TRAVEL_EVENT_TITLE, cityById } from '@/lib/config'
import { localParts, travelLegs } from '@/lib/booking-time'
import { onsiteFits } from '@/lib/host-location'
import { parseBookingRequest } from '@/lib/booking-request'
import { insertTravelLeg, travelEventId, type TravelDirection } from '@/lib/booking-travel'
import { notifyBookingCreated, notifyBookingFailed, type BookingSummary } from '@/lib/booking-email'
import type { TravelLeg } from '@/lib/booking-email-template'

/** Lowercased, de-duplicated, and never the booker or the host again. */
function normaliseGuests(guests: string[], bookerEmail: string): string[] {
  const taken = new Set([bookerEmail.toLowerCase(), CALENDAR_ID.toLowerCase()])
  const out: string[] = []
  for (const raw of guests) {
    const email = raw.toLowerCase()
    if (taken.has(email)) continue
    taken.add(email)
    out.push(email)
  }
  return out
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // The browser only ever offers legal slots, but the endpoint is public — so
  // every field is re-checked, and a wrong type is a 400 rather than a crash.
  const parsed = parseBookingRequest(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { start, duration, name, email, topic } = parsed
  const guestEmails = normaliseGuests(parsed.guests, email)
  const end = new Date(start.getTime() + duration * 60_000)
  const onsite = parsed.onsite && { city: cityById(parsed.onsite.city), place: parsed.onsite.place }
  const mode = onsite ? 'onsite' : 'online'
  const addMeet = ADD_GOOGLE_MEET && !onsite

  const summary: BookingSummary = {
    name,
    email,
    topic,
    guests: guestEmails,
    start,
    end,
    duration,
    mode,
    place: onsite ? { city: onsite.city.label, location: onsite.place } : null,
  }

  try {
    // In person is only offered while the host is in that city, the journey
    // either side included. The page checked when it loaded; the plan may have
    // changed since.
    if (onsite) {
      const { dateKey, minutes } = localParts(start)
      const [{ stretches }] = await hostDaysBetween(dateKey, dateKey)
      if (!onsiteFits(stretches, onsite.city.id, minutes, minutes + duration)) {
        return NextResponse.json(
          { error: `${HOST_NAME} is not in ${onsite.city.label} at that time`, reason: 'away' },
          { status: 409 },
        )
      }
    }

    // The page may have been open for an hour. Whoever booked this time in the
    // meantime keeps it; this visitor is told, and picks again. Busy blocks
    // arrive already grown by the buffers, so a block that merely touches an
    // edge still leaves the buffer intact and does not count.
    const clashes = (await busyBetween(start, end, mode)).filter(b => b.start < end && b.end > start)
    if (clashes.length > 0) {
      return NextResponse.json({ error: 'That slot was just taken', reason: 'taken' }, { status: 409 })
    }

    // Demo mode: the checks above run against the demo schedule, then it
    // pretends it worked — but never sends an invite, or a notification, to a
    // real person.
    if (!isCalendarConfigured) {
      return NextResponse.json({ success: true, demo: true, meetLink: null })
    }

    const created = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: 'all',
      conferenceDataVersion: addMeet ? 1 : 0,
      requestBody: {
        summary: `${HOST_NAME} × ${name}`,
        description: [
          topic ? `Topic: ${topic}` : null,
          onsite ? `In person · ${onsite.city.label}\nPlace: ${onsite.place}` : null,
          'Booked via MySlots',
        ]
          .filter(Boolean)
          .join('\n\n'),
        start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
        end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
        attendees: [
          { email: CALENDAR_ID, responseStatus: 'accepted' },
          { email, displayName: name },
          ...guestEmails.map(guest => ({ email: guest })),
        ],
        ...(addMeet && {
          conferenceData: {
            createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } },
          },
        }),
        // Tagged so the buffers can tell an in-person meeting from any other event.
        ...(onsite && {
          location: onsite.place,
          extendedProperties: { private: { [BOOKING_TAG]: 'onsite', city: onsite.city.id } },
        }),
      },
    })

    // Google attaches the room to the invite itself; the link is only read back
    // so the confirmation screen and the host's email can show it too. A room
    // Google declined to create leaves the booking standing, just without one.
    const meetLink = created.data.hangoutLink ?? null
    if (addMeet && !meetLink) {
      console.error('Google Meet room was not created:', created.data.conferenceData?.createRequest?.status)
    }

    // In person, the journey either side goes on the calendar as events of its
    // own, so the host — and anyone checking their free/busy — sees it. The
    // booking checks skip them (the meeting's own buffers stand for the
    // journey). The meeting stands either way; a leg that still fails after a
    // second try is flagged in the heads-up, with its times, to block by hand.
    // Google always returns the id; the fallback only keeps the legs unique.
    if (onsite) {
      summary.travelMissing = await blockTravel(start, end, created.data.id ?? randomUUID(), name, onsite.place)
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

/**
 * Two events for the journey there and back (see `travelLegs`), busy so other
 * people's schedulers see it. Private to the host's calendar — no attendees, no
 * emails. Each leg has a fixed id, so a second try never adds a copy of a first
 * one Google saved without answering (see `insertTravelLeg`). The legs still
 * missing are returned.
 */
async function blockTravel(start: Date, end: Date, meetingId: string, name: string, place: string): Promise<TravelLeg[]> {
  const [there, back] = travelLegs(start, end)
  const legs = [
    { ...there, direction: 'there' as TravelDirection, label: 'There', what: `Travel to meet ${name}` },
    { ...back, direction: 'back' as TravelDirection, label: 'Back', what: `Travel back from meeting ${name}` },
  ]
  const insert = (leg: (typeof legs)[number]) =>
    calendar.events.insert({
      calendarId: CALENDAR_ID,
      sendUpdates: 'none',
      requestBody: {
        id: travelEventId(meetingId, leg.direction),
        summary: TRAVEL_EVENT_TITLE,
        description: `${leg.what} at ${place}\n\nAdded by MySlots — delete it if no travel is needed`,
        start: { dateTime: leg.start.toISOString(), timeZone: TIME_ZONE },
        end: { dateTime: leg.end.toISOString(), timeZone: TIME_ZONE },
        transparency: 'opaque',
        extendedProperties: { private: { [BOOKING_TAG]: 'travel', meetingId } },
      },
    })

  const made = await Promise.all(
    legs.map(leg =>
      insertTravelLeg(
        () => insert(leg),
        (err, attempt) => console.error(`Travel event (${leg.what}) was not created, attempt ${attempt}:`, err),
      ),
    ),
  )
  return legs.filter((_, i) => !made[i]).map(({ label, start, end }) => ({ label, start, end }))
}
