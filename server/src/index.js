require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const trackRoutes = require('./routes/track');
const { seedDatabase } = require('../prisma/seed');

const app = express();

// Rate limiting on /api/track relies on req.ip, so trust the first proxy hop
// when deployed behind one (Render/Railway/etc). Harmless locally.
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5176' }));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/track', trackRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Public demo: reset seed data on a schedule so it self-heals from whatever
// visitors send in via "send a test event" or the raw curl endpoint, keeping
// all dates relative to "now" so the trend charts never look stale.
if (process.env.DEMO_RESEED_CRON) {
  cron.schedule(process.env.DEMO_RESEED_CRON, () => {
    console.log('Running scheduled demo reseed...');
    seedDatabase().catch((err) => console.error('Demo reseed failed:', err));
  });
  console.log(`Demo auto-reseed scheduled: "${process.env.DEMO_RESEED_CRON}"`);
}

const PORT = process.env.PORT || 4300;
app.listen(PORT, () => console.log(`PulseBoard API listening on port ${PORT}`));
