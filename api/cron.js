// Daily safety net: re-sync every connected calendar (Vercel Cron, see vercel.json).
const { env, send, origin, sb, calendarReady } = require('./_lib');
const { syncUser } = require('./_gcal');
const clickup = require('./_clickup');

module.exports = async (req, res) => {
  const want = env('CRON_SECRET');
  if (!want || req.headers.authorization !== `Bearer ${want}`) return send(res, 401, { error: 'unauthorized' });
  // ClickUp: bring in anything assigned while the app was closed
  let cuOk = 0, cuFailed = 0;
  if (env('SUPABASE_SERVICE_ROLE_KEY')) {
    const cl = await sb('clickup_links?select=user_id').catch(() => []);
    for (const l of cl) { const r = await clickup.syncUser(l.user_id); r.error ? cuFailed++ : cuOk++; }
  }
  if (!calendarReady()) return send(res, 200, { skipped: 'not_configured', clickup: { ok: cuOk, failed: cuFailed } });
  const app = env('APP_URL') || origin(req);
  const links = await sb('gcal_links?select=user_id');
  let ok = 0, failed = 0;
  for (const l of links) { const r = await syncUser(l.user_id, app); r.error ? failed++ : ok++; }
  send(res, 200, { ok, failed, clickup: { ok: cuOk, failed: cuFailed } });
};
