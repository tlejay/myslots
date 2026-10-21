# CLAUDE.md — MySlots

A single-person booking page: Next.js App Router, Tailwind v4, Google Calendar API.

## Layout

- `src/lib/config.ts` — host name, working hours, durations, time zone. Change
  behaviour here first; almost nothing else should need editing.
- `src/lib/google-calendar.ts` — OAuth client. `isCalendarConfigured` is false
  when credentials are absent, which puts the app in demo mode.
- `src/lib/demo-availability.ts` — deterministic synthetic busy blocks and
  location events (an Uptown day, an Uptown afternoon, and an Uptown day with a
  10:00–12:00 stop back in Downtown each week).
- `src/lib/host-location.ts` — "@ City" events → where the host is, minute by
  minute; `onsiteFits` / `absenceBlocks` decide what in person may book.
- `src/lib/calendar-events.ts` — which events are busy (and of what kind), which
  are location events. Pure, like the next two, so `pnpm check:booking` runs them.
- `src/lib/booking-request.ts` — the POST /api/book body, every field type-checked.
- `src/lib/booking-travel.ts` — fixed travel event ids and the 409-means-done retry.
- `src/app/api/availability/route.ts` — candidate slots ∩ busy time (∩ presence in person).
- `src/app/api/book/route.ts` — re-validates server-side, then inserts the event
  (and, in person, the two 🚗 travel events).
- `src/lib/booking-email-template.ts` — the notification markup. Import-free on
  purpose: `pnpm mockup` loads it directly to shoot the README pictures, so
  settings arrive as an `EmailContext` argument rather than from `config.ts`.
- `src/lib/booking-email.ts` — Gmail transport. Sends are best-effort; a booking
  never fails because the mail did.
- `src/app/book/BookingFlow.tsx` — the whole client flow: how to meet (online /
  in person + city) → day → time → details.
- `src/app/book/FindSlots.tsx` — the Find slots panel: free time as copyable text.
- `src/lib/booking-time.ts` — working hours, slot grid, horizon, buffers, free
  windows and the server-side slot check. Every endpoint reads its rules from here.
- Meeting buffers (`BUFFERS` in config: online 30/30, in person 45/45) are applied
  once, inside `busyBetween(from, to, mode)`, which returns busy blocks already
  grown — by the larger of the block's own buffer and the new meeting's, never
  the sum. Never pad again at a call site, and never read the calendar around it
  — the endpoints would stop agreeing on which slots are open.
- Where the host is comes only from location events (title starts with
  `LOCATION_EVENT_PREFIX`, default `@ `); anything uncovered is `DEFAULT_LOCATION`
  (may be null). Location events and `🚗 Travel` events are never busy.
- `src/lib/availability-text.ts` — the Find slots message format.
- `src/app/api/availability/windows/route.ts` — free stretches per day for a range.
- `docs/hero.png`, `docs/demo.gif`, `docs/mobile.png` — README art, shot from demo
  mode. Re-shoot when the UI changes visibly.

## Rules

- Code and comments in English.
- Never commit a real `.env*` file. Only `.env.example` is tracked.
- The public endpoints must keep validating server-side — the browser offering
  only legal slots is not a guarantee.
- Availability responses must never expose event titles or attendees. Events are
  read server-side (free/busy cannot tell kinds apart), but only busy times, the
  host's presence in the chosen city and a listed city id ever go out — never a
  location event's own text.
- In-person code and examples stay generic (Downtown / Uptown). The repo is public.
- The host notification is the only reason `gmail.send` is requested. Keep it
  optional: without the scope the app logs the fix and carries on booking.
- `pnpm mockup` shells out to Chrome rather than adding a browser-automation
  dependency, and Chrome screenshots a window rather than an element — so each
  shot carries its own height constant. Re-measure when the template grows.

## UX invariants (regressions to avoid)

- The query string mirrors the picker (`?mode=onsite&city=&date=&duration=&time=`,
  the first two only in person) and is written
  with `replaceState` — never `pushState`, which would trap Back behind every
  tile a visitor tried. It is read once, in a `useState` initialiser during
  hydration; nothing date- or link-derived renders until `useHydrated()` is true,
  so the server render and the first client render stay identical.

- The day strip starts at **today**, never earlier, and always offers a way back.
- Loading states hold their height — skeletons, not collapsing placeholders — so
  the page never jumps while availability reloads.
- The confirm bar is sticky once a slot is picked.
- Start time leads visually; the end time is smaller and quieter beneath it.

## Checks before pushing

```bash
pnpm build      # must pass
pnpm check:booking  # booking rules, Node 20+, no server
pnpm dev        # demo mode works with no credentials
pnpm mockup     # after touching the email template
git ls-files | grep -i env   # must show only .env.example
```
