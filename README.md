# PulseBoard — lightweight product analytics

A mini product-analytics dashboard (a "just enough" PostHog/Mixpanel) built for **Driftwell** (fictional client, built as a portfolio case study), an early-stage wellness startup that needed to see how people actually use their marketing site and mobile app without paying for a full analytics platform they'd barely scratch the surface of.

**Live demo:** _add your deployed URL here_
**Demo login** (one-click quick-fill on the login screen):

| Email | Password |
|---|---|
| `dev@driftwell.io` | `demo1234` |

The account owns two seeded projects — **Marketing site** and **Mobile app** — each with its own API key and independently-generated event history, so switching between them visibly changes every chart and stat on the dashboard.

## The problem

Driftwell's two-person team had page-view logs scattered across their host's basic traffic panel and nothing at all for in-app behavior — no way to answer "how many people actually complete checkout," "what's our busiest day," or "is anyone using the feature we just shipped." Full analytics platforms were priced for teams with the volume to justify them; Driftwell just needed real numbers from their own event stream.

## What was built

- **A real ingestion pipeline**: `POST /api/track`, authenticated per-project via an API key (`Authorization: Bearer <apiKey>`), that writes an actual `Event` row per call — not a mock. Curl it yourself from the dashboard's "Send a test event" panel and watch the stat cards and recent-events table update on the next poll.
- **Per-project dashboards computed from real rows**: total events, unique users (distinct `distinctId` count), a 30-day daily-volume chart, and a top-events breakdown — every number is a live Prisma aggregate query against the `Event` table for the selected project, not pre-baked chart data. Switching projects re-runs every query scoped to the new `projectId`.
- **CSV export**: a real "Export events (CSV)" button that returns an actual CSV of the selected project's events (capped at the most recent 5,000 rows to keep memory use bounded).
- **Input validation and rate limiting on the public ingestion endpoint** (see below) — the one piece of this project that got the most deliberate security attention, because it's the one endpoint here with no login wall at all.

## Tech stack

- **Backend:** Node.js, Express, Prisma ORM, SQLite (swappable to Postgres via `DATABASE_URL` with no code changes)
- **Frontend:** React 18, Vite, Tailwind CSS, Recharts, React Router
- **Auth:** JWT + bcrypt for the dashboard login; separate per-project API keys for event ingestion (deliberately not the same credential — a leaked tracking key should never grant dashboard access, and vice versa)

## Running it locally

```bash
# Backend
cd server
npm install
npx prisma migrate dev --name init
node prisma/seed.js
npm run dev        # http://localhost:4300

# Frontend (separate terminal)
cd client
npm install
npm run dev         # http://localhost:5176
```

## On the public ingestion endpoint — a deliberate security decision

`/api/track` has to be publicly callable with no login — that's the entire point of an events API — which makes it the one part of this codebase that's genuinely exposed to abuse from a portfolio visitor (or anyone else) with a project's API key. It's treated accordingly, not as an afterthought:

- **Input validation, not optional:** event names are capped at 100 characters, `distinctId` at 200, and `properties` must serialize to 4KB or less as a genuine JSON object (arrays, strings, and anything oversized are rejected with a 400). This isn't just tidiness — an unauthenticated write endpoint with no size caps is a database-bloat vector waiting to be found.
- **Rate limiting, two layers:** 60 requests/minute per project API key (the limit that actually matters, since it bounds each key regardless of how many IPs it's called from), plus a looser 120 requests/minute/IP ceiling as defense in depth. Both are enforced with `express-rate-limit` and return 429 once tripped.
- **Rendering safety:** event `properties` are shown in the recent-events table as plain text via React's default escaping — never `dangerouslySetInnerHTML`. Anything a visitor sends through `/api/track` is treated as untrusted display data in the admin UI, not as markup.

## Notes on the public demo

Since this is a live, publicly clickable demo, two things keep it from degrading over time:

1. `DEMO_RESEED_CRON` (set in the deployed server's env, e.g. `0 */3 * * *`) re-runs the seed script on a schedule, regenerating both projects' event history with dates relative to "now" and wiping anything sent in via `/api/track` (test events included) — so the trend charts never look stale or spammy.
2. The "events in the last 24h" stat falls back to the most recent 24-hour window that actually has data if the literal last-24h window is empty, so the number never looks broken if the demo sits idle overnight.

## What I'd build next for a real client

- Funnel analysis (e.g. `signup_started` → `signup_completed` conversion) instead of just raw event counts
- Session stitching — group a `distinctId`'s events into sessions with a configurable timeout
- Alerting on anomalies (e.g. event volume drops sharply day-over-day)
- SDKs (a tiny JS snippet, a server-side helper) instead of asking every integrator to hand-roll the `/api/track` POST body
