const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'demo1234';
const DEMO_EMAIL = 'dev@driftwell.io';
const DEMO_NAME = 'Jordan Blake';

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

function genApiKey() {
  return `pb_live_${crypto.randomBytes(20).toString('hex')}`;
}

function pickWeighted(entries) {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e.name;
  }
  return entries[entries.length - 1].name;
}

// Realistic-but-distinct event catalogs per project so the two seeded
// projects visibly differ in both volume and event mix, proving the
// dashboard's aggregation is real per-project filtering, not hardcoded.
const MARKETING_EVENTS = [
  { name: 'page_view', weight: 55 },
  { name: 'signup_started', weight: 15 },
  { name: 'signup_completed', weight: 8 },
  { name: 'checkout_started', weight: 12 },
  { name: 'checkout_completed', weight: 10 },
];

const APP_EVENTS = [
  { name: 'session_start', weight: 30 },
  { name: 'feature_used', weight: 35 },
  { name: 'page_view', weight: 12 },
  { name: 'checkout_started', weight: 10 },
  { name: 'checkout_completed', weight: 8 },
  { name: 'signup_completed', weight: 5 },
];

function propertiesFor(eventName) {
  switch (eventName) {
    case 'page_view':
      return { path: pick(['/', '/pricing', '/features', '/blog', '/about', '/changelog']) };
    case 'session_start':
      return { platform: pick(['ios', 'android']) };
    case 'feature_used':
      return { feature: pick(['habit_tracker', 'sleep_log', 'reminders', 'export', 'streaks', 'mood_check_in']) };
    case 'signup_started':
    case 'signup_completed':
      return { plan: pick(['free', 'pro']) };
    case 'checkout_started':
    case 'checkout_completed':
      return { plan: pick(['pro', 'team']), amountUsd: pick([9, 19, 29, 49]) };
    default:
      return {};
  }
}

// Generates `days` worth of events for one project, with day-of-week volume
// variation and a skewed distinctId pool (a handful of "power users" account
// for a disproportionate share of events, like real product usage).
async function seedProjectEvents({ projectId, eventCatalog, idPrefix, poolSize, baseVolume, weekendMultiplier, days }) {
  const pool = Array.from({ length: poolSize }, (_, i) => `${idPrefix}_${i + 1}`);
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dow = date.getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dow === 0 || dow === 6;
    const isToday = i === 0;

    // "Today" is only partially elapsed, so both its volume and the hours we
    // scatter events across need to be scaled down to what's actually elapsed
    // — otherwise we'd generate events dated into the future (a real bug: it
    // makes "time ago" displays show "in 5 hours" instead of "5 hours ago").
    const elapsedFraction = isToday
      ? Math.max((now.getHours() * 60 + now.getMinutes()) / (24 * 60), 0.03)
      : 1;

    const jitter = 0.75 + Math.random() * 0.5; // +/-25% day-to-day noise
    const dayCount = Math.max(
      3,
      Math.round(baseVolume * (isWeekend ? weekendMultiplier : 1) * jitter * elapsedFraction)
    );

    for (let n = 0; n < dayCount; n++) {
      const eventName = pickWeighted(eventCatalog);
      // Power-law-ish skew: squares a uniform draw so lower pool indices
      // ("power users") get picked disproportionately more often.
      const idx = Math.floor(Math.pow(Math.random(), 2) * pool.length);
      const distinctId = pool[idx];

      const occurredAt = new Date(date);
      if (isToday) {
        const maxMinuteOfDay = Math.max(now.getHours() * 60 + now.getMinutes() - 1, 0);
        const minuteOfDay = randomInt(0, maxMinuteOfDay);
        occurredAt.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, randomInt(0, 59), 0);
      } else {
        occurredAt.setHours(randomInt(0, 23), randomInt(0, 59), randomInt(0, 59), 0);
      }

      rows.push({
        projectId,
        name: eventName,
        distinctId,
        properties: JSON.stringify(propertiesFor(eventName)),
        occurredAt,
      });
    }
  }

  // Batch insert for speed — this can be a few thousand rows per project.
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await prisma.event.createMany({ data: rows.slice(i, i + BATCH_SIZE) });
  }
  return rows.length;
}

async function main() {
  console.log('Seeding PulseBoard demo data for "Driftwell"...');

  await prisma.event.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await prisma.user.create({
    data: { email: DEMO_EMAIL, passwordHash, fullName: DEMO_NAME },
  });

  const marketingSite = await prisma.project.create({
    data: { userId: user.id, name: 'Marketing site', apiKey: genApiKey() },
  });
  const mobileApp = await prisma.project.create({
    data: { userId: user.id, name: 'Mobile app', apiKey: genApiKey() },
  });

  const marketingCount = await seedProjectEvents({
    projectId: marketingSite.id,
    eventCatalog: MARKETING_EVENTS,
    idPrefix: 'visitor',
    poolSize: 220,
    baseVolume: 95,
    weekendMultiplier: 0.4, // B2B-ish marketing traffic drops off on weekends
    days: 42,
  });

  const appCount = await seedProjectEvents({
    projectId: mobileApp.id,
    eventCatalog: APP_EVENTS,
    idPrefix: 'user',
    poolSize: 110,
    baseVolume: 55,
    weekendMultiplier: 1.35, // consumer wellness app usage rises on weekends
    days: 42,
  });

  console.log('Seed complete.');
  console.log(`  Marketing site: ${marketingCount} events, API key ${marketingSite.apiKey}`);
  console.log(`  Mobile app:     ${appCount} events, API key ${mobileApp.apiKey}`);
  console.log('Demo login:');
  console.log(`  ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

// Exported so the running server can call this on a schedule and reset the
// public demo, undoing whatever visitors sent in via /api/track, while
// keeping every date relative to "now" so the charts never look stale.
module.exports = { seedDatabase: main, DEMO_PASSWORD, DEMO_EMAIL };

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
