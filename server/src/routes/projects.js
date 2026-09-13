const express = require('express');
const prisma = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { RECENT_EVENTS_LIMIT, CSV_EXPORT_ROW_CAP } = require('../constants');

const router = express.Router();
router.use(requireAuth);

async function loadOwnedProject(req, res) {
  const project = await prisma.project.findUnique({ where: { id: req.params.id } });
  if (!project || project.userId !== req.user.id) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  return project;
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function csvCell(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

router.get('/', async (req, res) => {
  const projects = await prisma.project.findMany({
    where: { userId: req.user.id },
    select: {
      id: true,
      name: true,
      apiKey: true,
      createdAt: true,
      _count: { select: { events: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json(projects.map((p) => ({ ...p, eventCount: p._count.events, _count: undefined })));
});

router.get('/:id/stats', async (req, res) => {
  const project = await loadOwnedProject(req, res);
  if (!project) return;

  const totalEvents = await prisma.event.count({ where: { projectId: project.id } });

  const distinctUserRows = await prisma.event.findMany({
    where: { projectId: project.id },
    distinct: ['distinctId'],
    select: { distinctId: true },
  });
  const uniqueUsers = distinctUserRows.length;

  // "Events in the last 24h" — but fall back to the most recent 24h window
  // that actually has data if the literal last-24h window is empty, so the
  // stat never looks broken on a weekend or when the demo sits idle.
  const now = new Date();
  const literalCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  let last24hCount = await prisma.event.count({
    where: { projectId: project.id, occurredAt: { gte: literalCutoff } },
  });
  let last24hLabel = 'last 24 hours';
  if (last24hCount === 0 && totalEvents > 0) {
    const latest = await prisma.event.findFirst({
      where: { projectId: project.id },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    if (latest) {
      const altCutoff = new Date(latest.occurredAt.getTime() - 24 * 60 * 60 * 1000);
      last24hCount = await prisma.event.count({
        where: {
          projectId: project.id,
          occurredAt: { gte: altCutoff, lte: latest.occurredAt },
        },
      });
      last24hLabel = 'most recent 24h of activity';
    }
  }

  // Daily event volume, last 30 days.
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const recentEvents = await prisma.event.findMany({
    where: { projectId: project.id, occurredAt: { gte: thirtyDaysAgo } },
    select: { occurredAt: true },
  });

  const seriesMap = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo);
    d.setDate(d.getDate() + i);
    seriesMap[dayKey(d)] = { date: dayKey(d), count: 0 };
  }
  recentEvents.forEach((e) => {
    const key = dayKey(e.occurredAt);
    if (seriesMap[key]) seriesMap[key].count += 1;
  });

  // Top event names by frequency.
  const grouped = await prisma.event.groupBy({
    by: ['name'],
    where: { projectId: project.id },
    _count: { name: true },
    orderBy: { _count: { name: 'desc' } },
    take: 8,
  });
  const topEvents = grouped.map((g) => ({ name: g.name, count: g._count.name }));

  // Recent events table.
  const recent = await prisma.event.findMany({
    where: { projectId: project.id },
    orderBy: { occurredAt: 'desc' },
    take: RECENT_EVENTS_LIMIT,
    select: { id: true, name: true, distinctId: true, properties: true, occurredAt: true },
  });

  res.json({
    project: { id: project.id, name: project.name, apiKey: project.apiKey },
    totalEvents,
    uniqueUsers,
    last24hCount,
    last24hLabel,
    dailySeries: Object.values(seriesMap),
    topEvents,
    recentEvents: recent,
  });
});

router.get('/:id/events/export.csv', async (req, res) => {
  const project = await loadOwnedProject(req, res);
  if (!project) return;

  const events = await prisma.event.findMany({
    where: { projectId: project.id },
    orderBy: { occurredAt: 'desc' },
    take: CSV_EXPORT_ROW_CAP,
    select: { id: true, name: true, distinctId: true, properties: true, occurredAt: true },
  });

  const header = ['id', 'name', 'distinctId', 'properties', 'occurredAt'];
  const lines = [header.join(',')];
  for (const e of events) {
    lines.push(
      [
        csvCell(e.id),
        csvCell(e.name),
        csvCell(e.distinctId),
        csvCell(e.properties),
        csvCell(e.occurredAt.toISOString()),
      ].join(',')
    );
  }
  const csv = lines.join('\n');

  const filename = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-events.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

module.exports = router;
