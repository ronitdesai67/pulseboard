const express = require('express');
const rateLimit = require('express-rate-limit');
const prisma = require('../prisma');
const {
  EVENT_NAME_MAX_LENGTH,
  DISTINCT_ID_MAX_LENGTH,
  PROPERTIES_MAX_BYTES,
} = require('../constants');

const router = express.Router();

function extractApiKey(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  if (req.body && typeof req.body.apiKey === 'string') return req.body.apiKey.trim();
  return null;
}

// Defense in depth: a per-IP ceiling in addition to the per-key limit below.
// A shared demo IP (behind a corporate NAT, or the portfolio host itself)
// could otherwise trip the per-key limit for everyone testing at once, so the
// IP ceiling is intentionally looser than the per-key one.
const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP. Slow down and try again shortly.' },
});

// Primary limit: 60 events/minute per project API key. This is the one that
// actually matters for a public, no-CAPTCHA ingestion endpoint — it bounds
// how fast any single key (real client or a curious portfolio visitor) can
// write rows, regardless of how many IPs it's called from.
const keyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const apiKey = extractApiKey(req);
    return apiKey ? `key:${apiKey}` : `ip:${req.ip}`;
  },
  message: { error: 'Too many events for this API key. Slow down and try again shortly.' },
});

// POST /api/track — public event ingestion. Authenticated via a project's
// API key, either as `Authorization: Bearer <apiKey>` (preferred) or an
// `apiKey` field in the JSON body (kept as a fallback for simple curl/cURL-less
// clients that can't easily set headers).
router.post('/', ipLimiter, keyLimiter, async (req, res) => {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key. Send Authorization: Bearer <apiKey>.' });
  }

  const project = await prisma.project.findUnique({ where: { apiKey } });
  if (!project) return res.status(401).json({ error: 'Invalid API key' });

  const { event, distinctId, properties } = req.body || {};

  if (typeof event !== 'string' || !event.trim()) {
    return res.status(400).json({ error: '"event" is required and must be a non-empty string' });
  }
  if (event.length > EVENT_NAME_MAX_LENGTH) {
    return res.status(400).json({ error: `"event" must be ${EVENT_NAME_MAX_LENGTH} characters or fewer` });
  }

  if (typeof distinctId !== 'string' || !distinctId.trim()) {
    return res.status(400).json({ error: '"distinctId" is required and must be a non-empty string' });
  }
  if (distinctId.length > DISTINCT_ID_MAX_LENGTH) {
    return res.status(400).json({ error: `"distinctId" must be ${DISTINCT_ID_MAX_LENGTH} characters or fewer` });
  }

  let propertiesJson = '{}';
  if (properties !== undefined) {
    if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
      return res.status(400).json({ error: '"properties" must be a JSON object' });
    }
    try {
      propertiesJson = JSON.stringify(properties);
    } catch {
      return res.status(400).json({ error: '"properties" could not be serialized to JSON' });
    }
    if (Buffer.byteLength(propertiesJson, 'utf8') > PROPERTIES_MAX_BYTES) {
      return res
        .status(400)
        .json({ error: `"properties" must serialize to ${PROPERTIES_MAX_BYTES} bytes or fewer` });
    }
  }

  const created = await prisma.event.create({
    data: {
      projectId: project.id,
      name: event.trim(),
      distinctId: distinctId.trim(),
      properties: propertiesJson,
      occurredAt: new Date(),
    },
  });

  res.status(201).json({ status: 'ok', eventId: created.id });
});

module.exports = router;
