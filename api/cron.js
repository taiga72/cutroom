// Daily safety net: re-sync every connected calendar (Vercel Cron, see vercel.json).
const { env, send, origin, sb, calendarReady } = require('./_lib');
const { syncUser } = require('./_gcal');

module.exports = async (req, res) => {
  const want = env('CRON_SECRET');
  if (!want || req.headers.authorization !== `Bearer ${want}`) return send(res, 401, { error: 'unauthorized' });
  if (!calendarReady()) return send(res, 200, { skipped: 'not_configured' });
  const app = env('APP_URL') || origin(req);
  const links = await sb('gcal_links?select=user_id');
  let ok = 0, failed = 0;
  for (const l of links) { const r = await syncUser(l.user_id, app); r.error ? failed++ : ok++; }
  send(res, 200, { ok, failed });
};
