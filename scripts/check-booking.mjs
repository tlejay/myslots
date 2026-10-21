/**
 * Checks the booking rules — online and in person — against the real modules:
 * no server, no calendar. Exits non-zero on the first broken rule.
 *
 *   pnpm check:booking
 *
 * Runs on Node 20: the modules under test are compiled with the project's own
 * TypeScript into a scratch folder first, so nothing needs type stripping.
 * Written against the shipped defaults in src/lib/config.ts — the first checks
 * say which ones, so a changed default fails loudly rather than strangely.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Types stripped, and the extension-less imports between modules spelled out
// as `.mjs` so Node can follow them.
const MODULES = [
  'config',
  'booking-time',
  'host-location',
  'calendar-events',
  'booking-request',
  'booking-travel',
  'demo-availability',
]
const out = mkdtempSync(join(tmpdir(), 'check-booking-'))
process.on('exit', () => rmSync(out, { recursive: true, force: true }))
for (const name of MODULES) {
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  writeFileSync(join(out, `${name}.mjs`), outputText.replace(/from '\.\/([\w-]+)'/g, "from './$1.mjs'"))
}
const load = name => import(pathToFileURL(join(out, `${name}.mjs`)).href)

const config = await load('config')
const time = await load('booking-time')
const where = await load('host-location')
const events = await load('calendar-events')
const request = await load('booking-request')
const travel = await load('booking-travel')
const demo = await load('demo-availability')

const at = (date, hm) => new Date(`${date}T${hm}:00+07:00`)
const block = (date, from, to) => ({ start: at(date, from), end: at(date, to) })
const mins = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m }
const BEFORE_ALL = new Date('2029-12-01T00:00:00+07:00') // long before every test day

/** HH:MM of every bookable slot for a day, given raw calendar blocks. */
function open(date, duration, rawBusy, mode) {
  return time
    .daySlots(date, duration, time.withBuffers(rawBusy, mode), BEFORE_ALL)
    .filter(s => s.available)
    .map(s => s.display)
}

const MON = '2030-01-07'
const FRI = '2030-01-11'
const SAT = '2030-01-05'
let passed = 0
async function check(name, fn) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

console.log('Defaults these checks are written against')
await check('working hours 9–20 weekdays, 10–20 weekends, no daily break, 30-minute grid', () => {
  assert.deepEqual(config.WEEKDAY_HOURS, { start: 9, end: 20 })
  assert.deepEqual(config.WEEKEND_HOURS, { start: 10, end: 20 })
  assert.equal(config.DAILY_BREAK, null)
  assert.equal(config.SLOT_STEP_MINUTES, 30)
})
await check('buffers: 45/45 in person, 30/30 online and for every other event', () => {
  assert.deepEqual(config.BUFFERS.onsite, { before: 45, after: 45 })
  assert.deepEqual(config.BUFFERS.online, { before: 30, after: 30 })
  assert.deepEqual(config.BUFFERS.other, { before: 30, after: 30 })
})
await check('cities downtown + uptown, default downtown, location events start "@ "', () => {
  assert.deepEqual(config.CITIES.map(c => c.id), ['downtown', 'uptown'])
  assert.equal(config.DEFAULT_LOCATION, 'downtown')
  assert.equal(config.LOCATION_EVENT_PREFIX, '@ ')
})

console.log('In-person buffer (45 before / 45 after)')
await check('10:00–11:00 in person needs 09:15–11:45 free — a block ending 09:15 is fine', () => {
  assert.ok(open(MON, 60, [block(MON, '08:00', '09:15')], 'onsite').includes('10:00'))
})
await check('…a block ending 09:16 is not', () => {
  assert.ok(!open(MON, 60, [block(MON, '08:00', '09:16')], 'onsite').includes('10:00'))
})
await check('…a block starting 11:45 is fine', () => {
  assert.ok(open(MON, 60, [block(MON, '11:45', '11:59')], 'onsite').includes('10:00'))
})
await check('…a block starting 11:44 is not', () => {
  assert.ok(!open(MON, 60, [block(MON, '11:44', '11:59')], 'onsite').includes('10:00'))
})
await check('online keeps its 30 — the same 09:16 block leaves 10:00 open online', () => {
  assert.ok(open(MON, 60, [block(MON, '08:00', '09:16')], 'online').includes('10:00'))
  assert.ok(!open(MON, 60, [block(MON, '08:00', '09:31')], 'online').includes('10:00'))
})
await check('online is unchanged when mode is left out', () => {
  const raw = [block(MON, '14:00', '15:00')]
  assert.deepEqual(open(MON, 60, raw, undefined), open(MON, 60, raw, 'online'))
})
await check('travel events: 10:00–11:00 → 09:15–10:00 and 11:00–11:45', () => {
  const [there, back] = time.travelLegs(at(MON, '10:00'), at(MON, '11:00'))
  assert.equal(there.start.getTime(), at(MON, '09:15').getTime())
  assert.equal(there.end.getTime(), at(MON, '10:00').getTime())
  assert.equal(back.start.getTime(), at(MON, '11:00').getTime())
  assert.equal(back.end.getTime(), at(MON, '11:45').getTime())
})

console.log('Buffers do not stack — the gap is the larger of the two')
// `onsite` = an in-person meeting booked here, no kind = any other event
// (online bookings included). Travel and location events are not busy at all.
const meeting = (from, to, kind) => ({ ...block(MON, from, to), kind })
/** The first time a meeting of `mode` may start after `raw` ends — the buffered block's end. */
const nextStart = (raw, mode) => time.hhmm(time.localParts(time.withBuffers([raw], mode)[0].end).minutes)
/** The latest time a meeting of `mode` may end before `raw` starts. */
const lastEnd = (raw, mode) => time.hhmm(time.localParts(time.withBuffers([raw], mode)[0].start).minutes)
await check('in person 14:00–15:00 → next online may start 15:45', () => {
  assert.equal(nextStart(meeting('14:00', '15:00', 'onsite'), 'online'), '15:45')
})
await check('in person 14:00–15:00 → next in person may start 15:45 (not 16:30)', () => {
  assert.equal(nextStart(meeting('14:00', '15:00', 'onsite'), 'onsite'), '15:45')
})
await check('online 14:00–15:00 → next online 15:30, next in person 15:45', () => {
  assert.equal(nextStart(meeting('14:00', '15:00'), 'online'), '15:30')
  assert.equal(nextStart(meeting('14:00', '15:00'), 'onsite'), '15:45')
})
await check('the other way round: online must end by 13:15 before an in-person 14:00, by 13:30 before an online one', () => {
  assert.equal(lastEnd(meeting('14:00', '15:00', 'onsite'), 'online'), '13:15')
  assert.equal(lastEnd(meeting('14:00', '15:00'), 'online'), '13:30')
  assert.equal(lastEnd(meeting('14:00', '15:00'), 'onsite'), '13:15')
})
await check('on the 30-minute grid: after an in-person 14:00–15:00 the page offers 16:00 next, either kind', () => {
  const booked = [meeting('14:00', '15:00', 'onsite')]
  assert.equal(open(MON, 60, booked, 'onsite').find(t => t > '14:00'), '16:00')
  assert.equal(open(MON, 30, booked, 'online').find(t => t > '14:00'), '16:00')
})
await check('on the grid: after an online 14:00–15:00 an online call is offered at 15:30', () => {
  assert.equal(open(MON, 30, [meeting('14:00', '15:00')], 'online').find(t => t > '14:00'), '15:30')
})
await check('lookup range is wide enough for the largest buffer', () => {
  const r = time.bufferedLookupRange(at(MON, '10:00'), at(MON, '11:00'))
  assert.equal(r.start.getTime(), at(MON, '09:15').getTime())
  assert.equal(r.end.getTime(), at(MON, '11:45').getTime())
})

console.log('Working hours')
await check('in person keeps weekday hours: first 09:00, last 60-minute slot 19:00', () => {
  const slots = open(MON, 60, [], 'onsite')
  assert.equal(slots[0], '09:00')
  assert.equal(slots.at(-1), '19:00')
})
await check('in person keeps weekend hours: first 10:00', () => {
  assert.equal(open(SAT, 60, [], 'onsite')[0], '10:00')
})

console.log('Location events — what counts as one')
await check('"@ Uptown", any case or spacing, its alias, or "@Uptown" → uptown', () => {
  for (const title of ['@ Uptown', '@ uptown ', '  @   UPTOWN', '@ North Side', '@ north-side', '@Uptown']) {
    assert.equal(where.cityFromTitle(title), 'uptown', title)
  }
  assert.equal(where.cityFromTitle('@ City Centre'), 'downtown')
})
await check('"@ Lisbon" is a location event for somewhere nobody can book → null', () => {
  assert.equal(where.cityFromTitle('@ Lisbon'), null)
  assert.ok(where.isLocationTitle('@ Lisbon'))
})
await check('anything else is not a location event', () => {
  for (const title of ['Uptown', 'Lunch @ Uptown', '@', '@   ', '', null, undefined]) {
    assert.equal(where.cityFromTitle(title), undefined, String(title))
  }
})

console.log('Where the host is')
const loc = (title, date, from, to, toDate = date) => ({ title, start: at(date, from), end: at(toDate, to) })
const allDay = (title, date, days = 1) => ({ title, start: at(date, '00:00'), end: at(time.addDaysToKey(date, days), '00:00') })
const spans = day => day.stretches.map(s => `${time.hhmm(s.start)}-${time.hhmm(s.end)} ${s.city}`)
/** HH:MM of every in-person slot in `city`, the way /api/availability works it out. */
function openOnsite(date, duration, locationEvents, city, rawBusy = [], fallback) {
  const [day] = where.hostDays(date, date, locationEvents, fallback)
  const presence = where.presenceIn(day.stretches, city)
  if (presence.length === 0) return []
  const busy = [...time.withBuffers(rawBusy, 'onsite'), ...time.withBuffers(where.absenceBlocks(date, presence), 'onsite')]
  return time.daySlots(date, duration, busy, BEFORE_ALL).filter(s => s.available).map(s => s.display)
}
await check('a day with no location event is DEFAULT_LOCATION all day', () => {
  assert.deepEqual(spans(where.hostDays(MON, MON, [])[0]), ['00:00-24:00 downtown'])
})
await check('an all-day "@ Uptown" over three days covers each; the days around fall back', () => {
  const out = where.hostDays('2030-01-07', '2030-01-11', [allDay('@ Uptown', '2030-01-08', 3)])
  assert.deepEqual(out.map(d => [d.date, spans(d)]), [
    ['2030-01-07', ['00:00-24:00 downtown']],
    ['2030-01-08', ['00:00-24:00 uptown']],
    ['2030-01-09', ['00:00-24:00 uptown']],
    ['2030-01-10', ['00:00-24:00 uptown']],
    ['2030-01-11', ['00:00-24:00 downtown']],
  ])
})
await check('"@ Uptown" Fri 10:00–22:00: downtown either side', () => {
  assert.deepEqual(spans(where.hostDays(FRI, FRI, [loc('@ Uptown', FRI, '10:00', '22:00')])[0]), [
    '00:00-10:00 downtown', '10:00-22:00 uptown', '22:00-24:00 downtown',
  ])
})
await check('…in person uptown: 10:45 is the earliest the rule allows; the 30-minute grid offers 11:00', () => {
  const [day] = where.hostDays(FRI, FRI, [loc('@ Uptown', FRI, '10:00', '22:00')])
  assert.ok(where.onsiteFits(day.stretches, 'uptown', mins('10:45'), mins('11:45')))
  assert.ok(!where.onsiteFits(day.stretches, 'uptown', mins('10:30'), mins('11:30')))
  assert.equal(openOnsite(FRI, 60, [loc('@ Uptown', FRI, '10:00', '22:00')], 'uptown')[0], '11:00')
})
await check('…and downtown has nothing that Friday: a morning meeting would have to end by 09:15', () => {
  assert.deepEqual(openOnsite(FRI, 30, [loc('@ Uptown', FRI, '10:00', '22:00')], 'downtown'), [])
})
await check('the journey home stays inside the stay: uptown until 20:00 → last 60-minute slot 18:00', () => {
  assert.equal(openOnsite(FRI, 60, [loc('@ Uptown', FRI, '10:00', '22:00')], 'uptown').at(-1), '19:00')
  assert.equal(openOnsite(FRI, 60, [loc('@ Uptown', FRI, '10:00', '20:00')], 'uptown').at(-1), '18:00')
})
await check('a later event inside an all-day one wins for its stretch — a trip there and back', () => {
  const day = where.hostDays(FRI, FRI, [loc('@ Downtown', FRI, '10:00', '12:00'), allDay('@ Uptown', FRI)])[0]
  assert.deepEqual(spans(day), ['00:00-10:00 uptown', '10:00-12:00 downtown', '12:00-24:00 uptown'])
})
await check('neighbouring stretches of one city join up', () => {
  const day = where.hostDays(FRI, FRI, [loc('@ Uptown', FRI, '10:00', '14:00'), loc('@ North side', FRI, '14:00', '22:00')])[0]
  assert.deepEqual(where.presenceIn(day.stretches, 'uptown'), [{ start: 600, end: 1320 }])
  assert.ok(where.onsiteFits(day.stretches, 'uptown', mins('13:30'), mins('14:30')))
})
await check('"@ Lisbon" all day closes in person everywhere', () => {
  const ev = [allDay('@ Lisbon', FRI)]
  assert.deepEqual(openOnsite(FRI, 60, ev, 'downtown'), [])
  assert.deepEqual(openOnsite(FRI, 60, ev, 'uptown'), [])
  assert.equal(where.mainCity(FRI, where.hostDays(FRI, FRI, ev)[0].stretches), null)
})
await check('a day shut for uptown names where the host is instead', () => {
  assert.equal(where.mainCity(MON, where.hostDays(MON, MON, [])[0].stretches), 'downtown')
})
await check('"@ Lisbon" 09:00–12:00: downtown opens again at 12:45 — the 30-minute grid offers 13:00', () => {
  const slots = openOnsite(MON, 60, [loc('@ Lisbon', MON, '09:00', '12:00')], 'downtown')
  assert.equal(slots[0], '13:00')
})
await check('DEFAULT_LOCATION null: only what a location event covers is open', () => {
  assert.deepEqual(openOnsite(MON, 60, [], 'downtown', [], null), [])
  assert.equal(openOnsite(MON, 60, [loc('@ Downtown', MON, '13:00', '24:00')], 'downtown', [], null)[0], '14:00')
})

console.log('Calendar events — what takes up time')
const ev = (extra = {}) => ({
  status: 'confirmed',
  summary: 'Team sync',
  start: { dateTime: '2030-01-07T10:00:00+07:00' },
  end: { dateTime: '2030-01-07T11:00:00+07:00' },
  ...extra,
})
await check('an ordinary event is busy, of kind other', () => {
  const [b] = events.busyBlocks([ev()])
  assert.equal(b.kind, 'other')
  assert.equal(b.start.getTime(), at(MON, '10:00').getTime())
})
await check('an in-person booking made here is busy, of kind onsite', () => {
  const [b] = events.busyBlocks([ev({ extendedProperties: { private: { [events.BOOKING_TAG]: 'onsite' } } })])
  assert.equal(b.kind, 'onsite')
})
await check('a location event is never busy — marked free or busy', () => {
  assert.deepEqual(events.busyBlocks([ev({ summary: '@ Uptown' }), ev({ summary: '@ Uptown', transparency: 'opaque' })]), [])
  assert.deepEqual(events.busyBlocks([ev({ summary: '@ Lisbon', transparency: 'transparent' })]), [])
})
await check('travel events, free, cancelled and declined ones are not busy', () => {
  assert.deepEqual(events.busyBlocks([
    ev({ extendedProperties: { private: { [events.BOOKING_TAG]: 'travel' } } }),
    ev({ transparency: 'transparent' }),
    ev({ status: 'cancelled' }),
    ev({ attendees: [{ self: true, responseStatus: 'declined' }] }),
    ev({ eventType: 'workingLocation' }),
  ]), [])
})
await check('location events are read whatever they are marked; cancelled ones are not', () => {
  const found = events.locationEvents([
    ev({ summary: '@ Uptown', transparency: 'transparent', start: { date: '2030-01-07' }, end: { date: '2030-01-08' } }),
    ev({ summary: '@ Downtown', status: 'cancelled' }),
    ev(),
  ])
  assert.equal(found.length, 1)
  assert.equal(found[0].title, '@ Uptown')
  assert.equal(found[0].start.getTime(), at(MON, '00:00').getTime())
  assert.equal(found[0].end.getTime(), at('2030-01-08', '00:00').getTime())
})

console.log('Demo mode')
const dateKeyOf = d => time.localParts(d).dateKey
await check('any seven days in a row hold an uptown day, an uptown afternoon and a day out of town', () => {
  for (let i = 0; i < 7; i++) {
    const from = time.addDaysToKey(MON, i)
    const to = time.addDaysToKey(from, 6)
    const located = demo.demoLocationsBetween(at(from, '00:00'), at(time.addDaysToKey(to, 1), '00:00'), dateKeyOf, '+07:00')
    const days = where.hostDays(from, to, located)
    const whole = days.filter(d => spans(d).join() === '00:00-24:00 uptown').length
    const half = days.filter(d => spans(d).join() === '00:00-13:00 downtown,13:00-24:00 uptown').length
    const away = days.filter(d => spans(d).join() === '00:00-24:00 null').length
    assert.deepEqual([whole, half, away], [1, 1, 1], `${from}…${to}`)
  }
})
await check('the afternoon day offers uptown from 14:00, after the journey from 13:00', () => {
  const week = time.dateKeysBetween(MON, time.addDaysToKey(MON, 6))
  const date = week.find(d => demo.demoLocations(d).some(e => e.start.endsWith('T13:00:00')))
  const located = demo.demoLocationsBetween(at(date, '00:00'), at(time.addDaysToKey(date, 1), '00:00'), dateKeyOf, '+07:00')
  assert.equal(openOnsite(date, 60, located, 'uptown')[0], '14:00')
})

console.log('Request parsing')
await check('mode left out = online; online ignores city', () => {
  assert.deepEqual(config.parseMeetingKind(null, null), { mode: 'online' })
  assert.deepEqual(config.parseMeetingKind('online', 'nowhere'), { mode: 'online' })
})
await check('in person needs a city from the list', () => {
  assert.deepEqual(config.parseMeetingKind('onsite', 'uptown'), { mode: 'onsite', city: 'uptown' })
  assert.ok('error' in config.parseMeetingKind('onsite', null))
  assert.ok('error' in config.parseMeetingKind('onsite', 'lisbon'))
  assert.ok('error' in config.parseMeetingKind('teleport', 'uptown'))
})
await check('date keys must be real days', () => {
  assert.ok(time.isDateKey('2030-01-31'))
  assert.ok(!time.isDateKey('2030-02-30'))
  assert.ok(!time.isDateKey('2030-1-5'))
  assert.ok(!time.isDateKey(null))
  assert.equal(time.dateKeysBetween('2030-01-30', '2030-02-02').length, 4)
})

console.log('Booking request body (POST /api/book) — wrong types are a 400, never a crash')
const good = {
  startTime: '2030-01-07T10:00:00+07:00',
  duration: 60,
  name: 'Sam',
  email: 'sam@example.com',
}
const parse = body => request.parseBookingRequest(body, BEFORE_ALL)
const refused = body => {
  const result = parse(body)
  assert.ok('error' in result, `expected an error for ${JSON.stringify(body)}`)
  return result.error
}
await check('a plain online request goes through, trimmed', () => {
  const r = parse({ ...good, name: '  Sam ', email: ' sam@example.com ', topic: ' hi ', guests: [' a@b.co ', ''] })
  assert.equal(r.name, 'Sam')
  assert.equal(r.email, 'sam@example.com')
  assert.equal(r.topic, 'hi')
  assert.deepEqual(r.guests, ['a@b.co'])
  assert.equal(r.onsite, null)
  assert.equal(r.start.toISOString(), '2030-01-07T03:00:00.000Z')
})
await check('in person carries city and place', () => {
  const r = parse({ ...good, mode: 'onsite', city: 'uptown', place: ' Corner café ' })
  assert.deepEqual(r.onsite, { city: 'uptown', place: 'Corner café' })
})
await check('optional fields may be null', () => {
  assert.ok(!('error' in parse({ ...good, topic: null, guests: null, mode: null, city: null, place: null })))
})
await check('the body itself: null, a number, a string, a list → refused', () => {
  for (const body of [null, 42, 'hello', [], [good], true]) refused(body)
})
await check('every field of the wrong type → refused', () => {
  const wrong = [null, 42, true, [], {}, ['x']]
  for (const field of ['startTime', 'name', 'email']) {
    for (const value of wrong) refused({ ...good, [field]: value })
  }
  for (const value of [null, '60', '', [], {}, 61]) refused({ ...good, duration: value })
  for (const field of ['topic', 'mode', 'city', 'place']) {
    for (const value of [42, true, [], {}, ['x']]) refused({ ...good, [field]: value })
  }
  for (const value of [42, 'a@b.co', {}, [42], [null], [['a@b.co']]]) refused({ ...good, guests: value })
})
await check('in person without a place, with only spaces, or one too long → refused', () => {
  refused({ ...good, mode: 'onsite', city: 'uptown' })
  refused({ ...good, mode: 'onsite', city: 'uptown', place: '   ' })
  refused({ ...good, mode: 'onsite', city: 'uptown', place: 'x'.repeat(config.MAX_PLACE_LENGTH + 1) })
})
await check('an unreadable start time → refused', () => {
  assert.equal(refused({ ...good, startTime: 'tomorrow-ish' }), 'Invalid start time')
})
await check('too many guests, or one bad address → refused', () => {
  refused({ ...good, guests: Array.from({ length: 11 }, (_, i) => `g${i}@b.co`) })
  assert.match(refused({ ...good, guests: ['a@b.co', 'nope'] }), /nope/)
})

console.log('Travel events — a retry never adds a second copy')
/**
 * A stand-in for Google Calendar's events.insert: an id already on the calendar
 * is a 409, and the first `lose` saves still fail on the way back — the event
 * is written, the answer never arrives.
 */
function fakeCalendar({ lose = 0, refuse = 0 } = {}) {
  const saved = new Map()
  let calls = 0
  return {
    saved,
    get calls() {
      return calls
    },
    insert: async event => {
      calls++
      if (refuse > 0) {
        refuse--
        throw Object.assign(new Error('Backend Error'), { status: 503 })
      }
      if (saved.has(event.id)) throw Object.assign(new Error('The requested identifier already exists.'), { status: 409 })
      saved.set(event.id, event)
      if (lose > 0) {
        lose--
        throw new Error('socket hang up')
      }
    },
  }
}
/** What /api/book does for both legs: the legs still missing. */
async function blockBoth(cal, meetingId = 'abc123meeting') {
  const errors = []
  const legs = ['there', 'back']
  const made = await Promise.all(
    legs.map(direction =>
      travel.insertTravelLeg(
        () => cal.insert({ id: travel.travelEventId(meetingId, direction), direction }),
        (err, attempt) => errors.push({ direction, attempt, err }),
      ),
    ),
  )
  return { missing: legs.filter((_, i) => !made[i]), errors }
}
const BASE32HEX_ID = /^[a-v0-9]{5,1024}$/
await check('event ids are valid Google ids, fixed per meeting and leg', () => {
  const id = travel.travelEventId('abc123meeting', 'there')
  assert.match(id, BASE32HEX_ID)
  assert.match(travel.travelEventId('', 'back'), BASE32HEX_ID)
  assert.equal(travel.travelEventId('abc123meeting', 'there'), id)
  assert.notEqual(travel.travelEventId('abc123meeting', 'back'), id)
  assert.notEqual(travel.travelEventId('other-meeting', 'there'), id)
})
await check('saved, but the answer is lost → the retry gets 409 → one event per leg, nothing missing', async () => {
  const cal = fakeCalendar({ lose: 1 })
  const { missing, errors } = await blockBoth(cal)
  assert.deepEqual(missing, [])
  assert.equal(cal.saved.size, 2)
  assert.equal(cal.calls, 3)
  assert.equal(errors.length, 1)
})
await check('both legs saved without an answer → still one event each, nothing missing', async () => {
  const cal = fakeCalendar({ lose: 2 })
  const { missing } = await blockBoth(cal)
  assert.deepEqual(missing, [])
  assert.equal(cal.saved.size, 2)
})
await check('refused once, then saved → one event, nothing missing', async () => {
  const cal = fakeCalendar({ refuse: 1 })
  const { missing } = await blockBoth(cal)
  assert.deepEqual(missing, [])
  assert.equal(cal.saved.size, 2)
})
await check('refused both tries → that leg is reported missing', async () => {
  const cal = fakeCalendar({ refuse: 4 })
  const { missing, errors } = await blockBoth(cal)
  assert.deepEqual(missing, ['there', 'back'])
  assert.equal(cal.saved.size, 0)
  assert.equal(errors.length, 4)
})
await check('only a 409 counts as "already there" — other failures do not', () => {
  assert.ok(travel.isAlreadyCreated({ status: 409 }))
  assert.ok(travel.isAlreadyCreated({ response: { status: 409 } }))
  for (const err of [{ status: 503 }, { status: 400 }, new Error('409'), null, '409', 409]) {
    assert.ok(!travel.isAlreadyCreated(err), JSON.stringify(err))
  }
})

console.log(`\n${passed} checks passed`)
