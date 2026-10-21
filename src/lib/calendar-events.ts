import type { calendar_v3 } from 'googleapis'
import { localInstant, type BusyBlock } from './booking-time'
import { isLocationTitle, type LocationEvent } from './host-location'

// What the app reads out of the host's calendar events: which take up time, and
// which say where the host is. Pure logic — google-calendar.ts does the
// fetching — so scripts/check-booking.mjs runs it without Google.

type CalendarEvent = calendar_v3.Schema$Event

/**
 * Events this app writes are tagged in their private extended properties, so
 * they can be told apart without parsing titles: `onsite` on an in-person
 * meeting, `travel` on the journey put on the calendar either side of it.
 */
export const BOOKING_TAG = 'myslotsBooking'

/** An event's start and end as instants; an all-day one runs midnight to midnight in the host's zone. */
export function eventSpan(e: CalendarEvent): { start: Date; end: Date } | null {
  if (e.start?.dateTime && e.end?.dateTime) return { start: new Date(e.start.dateTime), end: new Date(e.end.dateTime) }
  if (e.start?.date && e.end?.date) return { start: localInstant(e.start.date, 0), end: localInstant(e.end.date, 0) }
  return null
}

/**
 * Whether an event takes up the host's time, the way Google's free/busy answer
 * would say so: not when it is cancelled, marked "free", a working-location or
 * birthday marker, or an invitation the host turned down. Two more are left out
 * whatever they are marked: location events ("@ Uptown"), which say where the
 * host is rather than what they are doing, and the journey this app puts either
 * side of an in-person meeting — that meeting's own buffers stand for it.
 */
export function takesTime(e: CalendarEvent): boolean {
  if (e.status === 'cancelled') return false
  if (e.transparency === 'transparent') return false
  if (e.eventType === 'workingLocation' || e.eventType === 'birthday') return false
  if (e.attendees?.some(a => a.self && a.responseStatus === 'declined')) return false
  if (e.extendedProperties?.private?.[BOOKING_TAG] === 'travel') return false
  if (isLocationTitle(e.summary)) return false
  return true
}

/** The events that take up time, as busy blocks of the right kind. */
export function busyBlocks(events: CalendarEvent[]): BusyBlock[] {
  const blocks: BusyBlock[] = []
  for (const e of events) {
    if (!takesTime(e)) continue
    const span = eventSpan(e)
    if (!span || span.end <= span.start) continue
    const kind = e.extendedProperties?.private?.[BOOKING_TAG] === 'onsite' ? 'onsite' : 'other'
    blocks.push({ ...span, kind })
  }
  return blocks
}

/** The events that say where the host is — free or busy, timed or all-day. */
export function locationEvents(events: CalendarEvent[]): LocationEvent[] {
  const out: LocationEvent[] = []
  for (const e of events) {
    if (e.status === 'cancelled' || !isLocationTitle(e.summary)) continue
    const span = eventSpan(e)
    if (span && span.end > span.start) out.push({ title: e.summary!, ...span })
  }
  return out
}
