// Google Calendar: one all-day event per open task, on its due date, in a "Cutroom" calendar.
const { env, sb, getLink, saveLink } = require('./_lib');

const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.app.created';
const API = 'https://www.googleapis.com/calendar/v3';
const STATUS = { not_started: 'Not started', in_progress: 'In progress', internal_review: 'Internal review', revisions: 'Revisions', done: 'Done' };
const PRIO = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };

class NeedsReconnect extends Error {}

async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), ...params })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === 'invalid_grant') throw new NeedsReconnect('Google access was removed');
    throw new Error(`Google token ${r.status}: ${j.error || ''}`);
  }
  return j;
}

function client(accessToken) {
  return async function g(method, path, body) {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) { const e = new Error(`Google ${method} ${path} ${r.status}`); e.status = r.status; throw e; }
    return j;
  };
}

const createCalendar = g => g('POST', '/calendars', { summary: 'Cutroom', description: 'Task due dates from Cutroom. Changes here are overwritten by Cutroom.' });

const nextDay = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };

function eventFor(t, jobs, clients, appUrl) {
  const job = jobs[t.jobId], cl = t.clientId && clients[t.clientId];
  const who = cl ? `${job.name} · ${cl.name}` : job.name;
  const links = t.links || {};
  const lines = [
    `Status: ${STATUS[t.status] || t.status}`,
    `Priority: ${PRIO[t.priority] || 'Normal'}`,
    [t.format, t.length].filter(Boolean).join(' · '),
    t.revision ? `Revision ${t.revision}` : '',
    links.task ? `Task: ${links.task}` : '',
    links.upload ? `Review: ${links.upload}` : '',
    links.file ? `Files: ${links.file}` : '',
    appUrl ? `\nOpen Cutroom: ${appUrl}` : ''
  ].filter(Boolean);
  return {
    summary: `${who} · ${t.name || 'Untitled task'}`,
    description: lines.join('\n'),
    start: { date: t.due },
    end: { date: nextDay(t.due) },
    transparency: 'transparent',
    extendedProperties: { private: { cutroomId: t.id } }
  };
}

async function loadDocs(uid) {
  const out = { jobs: {}, clients: {}, tasks: {} };
  for (let from = 0; ; from += 1000) {
    const rows = await sb(`docs?user_id=eq.${uid}&col=in.(jobs,clients,tasks)&select=col,id,data&order=col,id`, {
      headers: { Range: `${from}-${from + 999}` }
    });
    rows.forEach(r => { out[r.col][r.id] = { ...r.data, id: r.id }; });
    if (rows.length < 1000) return out;
  }
}

async function listEvents(g, cal) {
  const all = [];
  let page = '';
  do {
    const j = await g('GET', `/calendars/${encodeURIComponent(cal)}/events?maxResults=2500&showDeleted=false${page ? '&pageToken=' + page : ''}`);
    all.push(...(j.items || []));
    page = j.nextPageToken || '';
  } while (page);
  return all;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// Makes the Cutroom calendar match the user's tasks. Safe to run any number of times.
async function syncUser(uid, appUrl) {
  const link = await getLink(uid);
  if (!link) return { connected: false };
  try {
    const { access_token } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: link.refresh_token });
    const g = client(access_token);
    let cal = link.calendar_id;
    let existing;
    try { existing = cal ? await listEvents(g, cal) : null; } catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
    if (!existing) { cal = (await createCalendar(g)).id; existing = []; await saveLink(uid, { calendar_id: cal }); }

    const { jobs, clients, tasks } = await loadDocs(uid);
    const want = {};
    for (const t of Object.values(tasks)) {
      if (t.archived || t.status === 'done' || !/^\d{4}-\d{2}-\d{2}$/.test(t.due || '') || !jobs[t.jobId]) continue;
      want[t.id] = eventFor(t, jobs, clients, appUrl);
    }
    const seen = new Set(), ops = [];
    for (const ev of existing) {
      const id = ev.extendedProperties?.private?.cutroomId;
      const w = id && want[id];
      if (!w || seen.has(id)) { ops.push(() => g('DELETE', `/calendars/${encodeURIComponent(cal)}/events/${ev.id}`)); continue; }
      seen.add(id);
      if (ev.summary !== w.summary || (ev.description || '') !== w.description || ev.start?.date !== w.start.date || ev.end?.date !== w.end.date)
        ops.push(() => g('PUT', `/calendars/${encodeURIComponent(cal)}/events/${ev.id}`, w));
    }
    for (const id in want) if (!seen.has(id)) ops.push(() => g('POST', `/calendars/${encodeURIComponent(cal)}/events`, want[id]));
    await pool(ops, 5, op => op().catch(e => { if (e.status !== 404 && e.status !== 410) throw e; }));
    const at = new Date().toISOString();
    await saveLink(uid, { last_sync: at, last_error: null });
    return { connected: true, events: Object.keys(want).length, changed: ops.length, lastSync: at };
  } catch (e) {
    const msg = e instanceof NeedsReconnect ? 'reconnect' : 'failed';
    await saveLink(uid, { last_error: msg }).catch(() => {});
    if (!(e instanceof NeedsReconnect)) console.error(e);
    return { connected: true, error: msg };
  }
}

module.exports = { SCOPES, tokenRequest, client, createCalendar, syncUser, NeedsReconnect };
