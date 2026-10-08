require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const trackRoutes = require('./routes/track');
const { mountDemoCron } = require('./demoCron');

const app = express();

// Rate limiting on /api/track relies on req.ip, so trust the first proxy hop.
// On Vercel that hop is the edge network, which sets x-forwarded-for.
app.set('trust proxy', 1);

// In production the client and API share one Vercel domain, so browser calls
// are same-origin and never preflight. The public ingestion endpoint
// (/api/track) is called server-to-server from anywhere, which CORS does not
// govern. CORS here is really just for local dev, where Vite is on its own port.
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5176' }));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/track', trackRoutes);

mountDemoCron(app);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
