// ClickUp actions for the signed-in user: POST /api/clickup?action=status|connect|sync|disconnect
// connect takes {token} (a ClickUp personal API token, pk_…), checked against ClickUp and kept server side only.
const { send, authUser, sb, env } = require('./_lib');
const { whoAmI, getLink, saveLink, syncUser, NeedsToken } = require('./_clickup');

const readBody = req => new Promise(ok => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e4) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { ok({}); } }); });
const view = l => l ? { connected: true, name: l.cu_name, email: l.cu_email, teams: l.teams || [], lastSync: l.last_sync, error: l.last_error } : { connected: false };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (!env('SUPABASE_SERVICE_ROLE_KEY')) return send(res, 503, { error: 'not_configured' });
  const user = await authUser(req);
  if (!user) return send(res, 401, { error: 'signed_out' });
  const action = new URL(req.url, 'http://x').searchParams.get('action');
  try {
    if (action === 'status') return send(res, 200, view(await getLink(user.id)));
    if (action === 'connect') {
      const body = req.body && typeof req.body === 'object' ? req.body : await readBody(req);
      const token = String(body.token || '').trim();
      if (!/^pk_[A-Za-z0-9_]{10,}$/.test(token)) return send(res, 400, { error: 'bad_token' });
      let me;
      try { me = await whoAmI(token); } catch (e) { return send(res, 400, { error: e instanceof NeedsToken ? 'bad_token' : 'clickup_down' }); }
      const row = { user_id: user.id, token, cu_user_id: me.user.id, cu_name: me.user.name, cu_email: me.user.email, tz: me.user.tz || null, teams: me.teams, last_error: null };
      const had = await getLink(user.id);
      if (had) await saveLink(user.id, row); else await sb('clickup_links', { method: 'POST', body: JSON.stringify({ ...row, state: {} }) });
      return send(res, 200, view(await getLink(user.id)));
    }
    if (action === 'sync') { const r = await syncUser(user.id); return send(res, 200, { ...r, ...view(await getLink(user.id)) }); }
    if (action === 'disconnect') { await sb(`clickup_links?user_id=eq.${user.id}`, { method: 'DELETE' }); return send(res, 200, { connected: false }); }
    send(res, 400, { error: 'unknown_action' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'failed' });
  }
};
