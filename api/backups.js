// Automatic restore points for the signed-in user, kept in a private Storage bucket ("backups", created on first use):
//   POST /api/backups?action=auto    → makes one if the newest is 7+ days old (the page calls this after sign-in)
//   POST /api/backups?action=create  → makes one now
//   POST /api/backups?action=list    → [{ name, date, size }] newest first
//   POST /api/backups?action=get&name=YYYY-MM-DD.json → the backup file (same format as the page's downloaded backup)
// Files live at backups/<user id>/<YYYY-MM-DD>.json; the newest KEEP are kept. Only the service role can read the bucket.
const { env, SB_URL, send, authUser, sb } = require('./_lib');

const BUCKET = 'backups', KEEP = 8, EVERY_DAYS = 7;
const svc = () => ({ apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` });
const storage = (path, opts = {}) => fetch(`${SB_URL()}/storage/v1/${path}`, { ...opts, headers: { ...svc(), ...(opts.headers || {}) } });

async function ensureBucket() {
  const r = await storage('bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
  if (r.ok) return;
  const t = await r.text();
  if (!/exist|duplicate/i.test(t)) throw new Error(`bucket ${r.status}: ${t}`);
}

async function list(uid) {
  const r = await storage(`object/list/${BUCKET}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: `${uid}/`, limit: 100, offset: 0, sortBy: { column: 'name', order: 'desc' } }) });
  if (!r.ok) { const t = await r.text(); if (r.status === 404 || /not.?found/i.test(t)) return []; throw new Error(`list ${r.status}: ${t}`); }
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).filter(o => /^\d{4}-\d{2}-\d{2}\.json$/.test(o.name))
    .map(o => ({ name: o.name, date: o.name.slice(0, 10), size: o.metadata?.size || 0 }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

async function create(uid) {
  await ensureBucket();
  const data = { jobs: {}, clients: {}, tasks: {}, settings: {} };
  for (let from = 0; ; from += 1000) {
    const rows = await sb(`docs?user_id=eq.${uid}&select=col,id,data&order=col,id&limit=1000&offset=${from}`);
    for (const r of rows || []) if (data[r.col]) data[r.col][r.id] = r.data;
    if (!rows || rows.length < 1000) break;
  }
  const date = new Date().toISOString().slice(0, 10);
  const file = { app: 'splice-co', version: 1, exported: new Date().toISOString(), auto: true, data };
  const r = await storage(`object/${BUCKET}/${uid}/${date}.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: JSON.stringify(file) });
  if (!r.ok) throw new Error(`upload ${r.status}: ${await r.text()}`);
  const all = await list(uid), old = all.slice(KEEP).map(o => `${uid}/${o.name}`);
  if (old.length) await storage(`object/${BUCKET}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: old }) });
  return { created: date, points: all.slice(0, KEEP) };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (!env('SUPABASE_SERVICE_ROLE_KEY')) return send(res, 503, { error: 'not_configured' });
  const user = await authUser(req);
  if (!user) return send(res, 401, { error: 'signed_out' });
  const q = new URL(req.url, 'http://x').searchParams, action = q.get('action');
  try {
    if (action === 'list') return send(res, 200, { points: await list(user.id) });
    if (action === 'create') return send(res, 200, await create(user.id));
    if (action === 'auto') {
      const all = await list(user.id), newest = all[0]?.date;
      const age = newest ? (Date.now() - Date.parse(newest + 'T00:00:00Z')) / 86400000 : Infinity;
      if (age < EVERY_DAYS) return send(res, 200, { created: null, points: all });
      return send(res, 200, await create(user.id));
    }
    if (action === 'get') {
      const name = String(q.get('name') || '');
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) return send(res, 400, { error: 'bad_name' });
      const r = await storage(`object/${BUCKET}/${user.id}/${name}`);
      if (!r.ok) return send(res, 404, { error: 'not_found' });
      return send(res, 200, await r.json());
    }
    return send(res, 400, { error: 'unknown_action' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'failed' });
  }
};
