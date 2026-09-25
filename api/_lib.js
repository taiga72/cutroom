// Shared helpers for the Vercel functions. Files starting with "_" are not routes.
const crypto = require('crypto');

const env = k => (process.env[k] || '').trim();
const SB_URL = () => env('SUPABASE_URL').replace(/\/+$/, '');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function origin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// Checks the Supabase access token sent by the page and returns the signed-in user.
async function authUser(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  const r = await fetch(`${SB_URL()}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${m[1]}`, apikey: env('SUPABASE_ANON_KEY') }
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

// PostgREST with the service role key (bypasses row level security; server only).
async function sb(path, opts = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${SB_URL()}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      Prefer: 'return=representation', ...(opts.headers || {})
    }
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const getLink = async uid => (await sb(`gcal_links?user_id=eq.${uid}&select=*`))[0] || null;
const saveLink = (uid, p) => sb(`gcal_links?user_id=eq.${uid}`, { method: 'PATCH', body: JSON.stringify(p) });

// Signed, short-lived state for the Google consent round trip.
const secret = () => env('STATE_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY');
function sign(obj) {
  const p = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${p}.${crypto.createHmac('sha256', secret()).update(p).digest('base64url')}`;
}
function unsign(s) {
  const [p, h] = String(s || '').split('.');
  if (!p || !h) return null;
  const want = crypto.createHmac('sha256', secret()).update(p).digest('base64url');
  if (want.length !== h.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(h))) return null;
  const o = JSON.parse(Buffer.from(p, 'base64url').toString());
  return o.exp > Date.now() ? o : null;
}

const calendarReady = () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') && env('SUPABASE_SERVICE_ROLE_KEY'));

module.exports = { env, SB_URL, send, origin, authUser, sb, getLink, saveLink, sign, unsign, calendarReady };
