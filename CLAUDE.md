# CLAUDE.md — MySlots

A single-person booking page: Next.js App Router, Tailwind v4, Google Calendar API.

## Layout

- `src/lib/config.ts` — host name, working hours, durations, time zone. Change
  behaviour here first; almost nothing else should need editing.
- `src/lib/google-calendar.ts` — OAuth client. `isCalendarConfigured` is false
  when credentials are absent, which puts the app in demo mode.
- `src/lib/demo-availability.ts` — deterministic synthetic busy blocks.
- `src/app/api/availability/route.ts` — candidate slots ∩ free/busy.
- `src/app/api/book/route.ts` — re-validates server-side, then inserts the event.
- `src/app/book/BookingFlow.tsx` — the whole three-step client flow.

## Rules

- Code and comments in English.
- Never commit a real `.env*` file. Only `.env.example` is tracked.
- The public endpoints must keep validating server-side — the browser offering
  only legal slots is not a guarantee.
- Availability responses must never expose event titles or attendees; free/busy
  is deliberately the only calendar read.

## UX invariants (regressions to avoid)

- The day strip starts at **today**, never earlier, and always offers a way back.
- Loading states hold their height — skeletons, not collapsing placeholders — so
  the page never jumps while availability reloads.
- The confirm bar is sticky once a slot is picked.
- Start time leads visually; the end time is smaller and quieter beneath it.

## Checks before pushing

```bash
pnpm build      # must pass
pnpm dev        # demo mode works with no credentials
git ls-files | grep -i env   # must show only .env.example
```
