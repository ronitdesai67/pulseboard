// Local development entrypoint: binds a port and runs the demo reseed as an
// in-process cron job. Production (Vercel) never loads this file — it imports
// src/app.js from api/index.js as a serverless function and drives the reseed
// through Vercel Cron instead.
require('dotenv').config();
const cron = require('node-cron');

const app = require('./app');
const { seedDatabase } = require('../prisma/seed');

if (process.env.DEMO_RESEED_CRON) {
  cron.schedule(process.env.DEMO_RESEED_CRON, () => {
    console.log('Running scheduled demo reseed...');
    seedDatabase().catch((err) => console.error('Demo reseed failed:', err));
  });
  console.log(`Demo auto-reseed scheduled: "${process.env.DEMO_RESEED_CRON}"`);
}

const PORT = process.env.PORT || 4300;
app.listen(PORT, () => console.log(`PulseBoard API listening on port $\{PORT\}`));
