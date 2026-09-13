import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { formatDistanceToNow } from 'date-fns';
import axios from 'axios';
import api from '../api/client';
import StatCard from '../components/StatCard';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4300/api';

function formatDay(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function previewProperties(raw) {
  try {
    const obj = JSON.parse(raw);
    const str = JSON.stringify(obj);
    return str.length > 60 ? `${str.slice(0, 60)}…` : str;
  } catch {
    return raw;
  }
}

function curlCommand(apiKey) {
  return `curl -X POST ${API_BASE}/track \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"event":"feature_used","distinctId":"visitor_test","properties":{"feature":"demo"}}'`;
}

export default function Dashboard() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);
  const [stats, setStats] = useState(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingStats, setLoadingStats] = useState(false);
  const [error, setError] = useState('');

  const [testPanelOpen, setTestPanelOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy');
  const [exporting, setExporting] = useState(false);

  const pollRef = useRef(null);

  useEffect(() => {
    api
      .get('/projects')
      .then((res) => {
        setProjects(res.data);
        if (res.data.length > 0) setProjectId(res.data[0].id);
      })
      .catch(() => setError('Could not load projects.'))
      .finally(() => setLoadingProjects(false));
  }, []);

  const loadStats = useCallback(
    (id) => {
      if (!id) return;
      setLoadingStats(true);
      return api
        .get(`/projects/${id}/stats`)
        .then((res) => setStats(res.data))
        .catch(() => setError('Could not load dashboard data for this project.'))
        .finally(() => setLoadingStats(false));
    },
    []
  );

  useEffect(() => {
    if (projectId) loadStats(projectId);
  }, [projectId, loadStats]);

  // While the "send a test event" panel is open, poll for fresh stats every
  // few seconds so a visitor who fires a test event (or curls it manually)
  // sees it land without having to hit refresh themselves.
  useEffect(() => {
    if (testPanelOpen && projectId) {
      pollRef.current = setInterval(() => loadStats(projectId), 4000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [testPanelOpen, projectId, loadStats]);

  async function handleSendTestEvent() {
    if (!stats?.project?.apiKey) return;
    setSending(true);
    setSendResult('');
    try {
      await axios.post(
        `${API_BASE}/track`,
        {
          event: 'feature_used',
          distinctId: `visitor_test_${Math.floor(Math.random() * 1000)}`,
          properties: { feature: 'demo', source: 'send_test_event_panel' },
        },
        { headers: { Authorization: `Bearer ${stats.project.apiKey}` } }
      );
      setSendResult('Event sent — refreshing dashboard…');
      await loadStats(projectId);
    } catch (err) {
      setSendResult(err.response?.data?.error || 'Could not send test event.');
    } finally {
      setSending(false);
    }
  }

  function handleCopyCurl() {
    if (!stats?.project?.apiKey) return;
    navigator.clipboard.writeText(curlCommand(stats.project.apiKey)).then(() => {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy'), 1500);
    });
  }

  async function handleExportCsv() {
    if (!projectId) return;
    setExporting(true);
    try {
      const res = await api.get(`/projects/${projectId}/events/export.csv`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      const projectName = projects.find((p) => p.id === projectId)?.name || 'project';
      link.setAttribute('download', `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-events.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('Could not export CSV.');
    } finally {
      setExporting(false);
    }
  }

  if (loadingProjects) return <p className="text-slate-500">Loading projects…</p>;
  if (error && !stats) return <p className="text-rose-600">{error}</p>;
  if (projects.length === 0) return <p className="text-slate-500">No projects yet.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Product analytics</h1>
          <p className="text-sm text-slate-500">Driftwell · usage across your tracked projects</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600" htmlFor="project-switcher">
            Project
          </label>
          <select
            id="project-switcher"
            value={projectId || ''}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.eventCount} events)
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadingStats || !stats ? (
        <p className="text-slate-500">Loading dashboard…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total events" value={stats.totalEvents.toLocaleString()} sublabel="Project lifetime" accent="brand" />
            <StatCard label="Unique users" value={stats.uniqueUsers.toLocaleString()} sublabel="Distinct visitors tracked" accent="green" />
            <StatCard
              label="Events (24h)"
              value={stats.last24hCount.toLocaleString()}
              sublabel={stats.last24hLabel}
              accent={stats.last24hLabel === 'last 24 hours' ? 'green' : 'amber'}
            />
            <StatCard label="Top event" value={stats.topEvents[0]?.name || '—'} sublabel={stats.topEvents[0] ? `${stats.topEvents[0].count.toLocaleString()} events` : 'No data yet'} accent="brand" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
              <h2 className="mb-4 text-sm font-semibold text-slate-700">Daily event volume (last 30 days)</h2>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={stats.dailySeries}>
                  <defs>
                    <linearGradient id="volume" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tickFormatter={formatDay} fontSize={12} stroke="#94a3b8" />
                  <YAxis fontSize={12} stroke="#94a3b8" allowDecimals={false} />
                  <Tooltip labelFormatter={formatDay} />
                  <Area type="monotone" dataKey="count" stroke="#4f46e5" fill="url(#volume)" name="Events" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-slate-700">Top events</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.topEvents} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" fontSize={12} stroke="#94a3b8" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={100} fontSize={11} stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="count" fill="#4f46e5" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-700">Send a test event</h2>
              <button
                onClick={() => setTestPanelOpen((v) => !v)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {testPanelOpen ? 'Hide' : 'Show'}
              </button>
            </div>
            {testPanelOpen && (
              <div className="space-y-3">
                <p className="text-sm text-slate-500">
                  This project's live API key. Anyone with it can send real events to this
                  dashboard — treat it like a password in a real deployment.
                </p>
                <div className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                  {stats.project.apiKey}
                </div>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-lg bg-slate-900 px-4 py-3 text-xs text-slate-100">
{curlCommand(stats.project.apiKey)}
                  </pre>
                  <button
                    onClick={handleCopyCurl}
                    className="absolute right-2 top-2 rounded-md bg-slate-700 px-2 py-1 text-xs text-white hover:bg-slate-600"
                  >
                    {copyLabel}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleSendTestEvent}
                    disabled={sending}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    {sending ? 'Sending…' : 'Send a test event now'}
                  </button>
                  <button
                    onClick={() => loadStats(projectId)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    Refresh dashboard
                  </button>
                  {sendResult && <span className="text-sm text-slate-500">{sendResult}</span>}
                </div>
                <p className="text-xs text-slate-400">
                  Auto-refreshing every few seconds while this panel is open — send an event, then
                  watch the stat cards and recent events table above update.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-700">
                Recent events{' '}
                <span className="font-normal text-slate-400">(latest {stats.recentEvents.length})</span>
              </h2>
              <button
                onClick={handleExportCsv}
                disabled={exporting}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                {exporting ? 'Exporting…' : 'Export events (CSV)'}
              </button>
            </div>
            <div className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Event</th>
                    <th className="px-4 py-3">Distinct ID</th>
                    <th className="px-4 py-3">Properties</th>
                    <th className="px-4 py-3">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.recentEvents.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{e.name}</td>
                      <td className="px-4 py-3 text-slate-600">{e.distinctId}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">
                        {previewProperties(e.properties)}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {formatDistanceToNow(new Date(e.occurredAt), { addSuffix: true })}
                      </td>
                    </tr>
                  ))}
                  {stats.recentEvents.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                        No events yet for this project.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
