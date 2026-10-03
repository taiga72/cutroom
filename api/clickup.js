// ClickUp actions for the signed-in user: POST /api/clickup?action=status|connect|remove|sync|resync|disconnect
// connect takes {token} (a ClickUp personal API token, pk_…), checked against ClickUp and kept server side only.
// ClickUp tokens are per workspace: connecting another token adds its workspace; remove {team} drops one.
const { send, authUser, sb, env } = require('./_lib');
const { whoAmI, getLink, saveLink, syncUser, NeedsToken } = require('./_clickup');

const readBody = req => new Promise(ok => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e4) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { ok({}); } }); });
// tokens never leave the server: teams are sent without them
const view = l => l ? { connected: true, name: l.cu_name, email: l.cu_email, lastSync: l.last_sync, error: l.last_error, errorMsg: l.last_error ? ((l.state || {}).lastErr || '') : '',
  teams: (l.teams || []).map(t => ({ id: t.id, name: t.name, color: t.color, sum: ((l.state || {}).sum || {})[t.id] || null })) } : { connected: false };

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
      // ClickUp tokens are per workspace: a new token adds its workspaces to the ones already connected
      const had = await getLink(user.id);
      const fresh = me.teams.map(t => ({ ...t, token, uid: me.user.id }));
      const teams = [...((had && had.teams) || []).filter(t => !fresh.some(f => f.id === String(t.id))).map(t => ({ ...t, token: t.token || had.token, uid: t.uid || had.cu_user_id })), ...fresh];
      const row = { user_id: user.id, token: had ? had.token : token, cu_user_id: had ? had.cu_user_id : me.user.id, cu_name: me.user.name, cu_email: me.user.email, tz: (had && had.tz) || me.user.tz || null, teams, last_error: null };
      if (had) await saveLink(user.id, row); else await sb('clickup_links', { method: 'POST', body: JSON.stringify({ ...row, state: {} }) });
      return send(res, 200, { ...view(await getLink(user.id)), added: fresh.map(t => t.name) });
    }
    if (action === 'remove') {
      const body = req.body && typeof req.body === 'object' ? req.body : await readBody(req);
      const had = await getLink(user.id);
      if (!had) return send(res, 200, { connected: false });
      const teams = (had.teams || []).filter(t => String(t.id) !== String(body.team));
      if (!teams.length) { await sb(`clickup_links?user_id=eq.${user.id}`, { method: 'DELETE' }); return send(res, 200, { connected: false }); }
      await saveLink(user.id, { teams, token: (teams[0].token || had.token) });
      return send(res, 200, view(await getLink(user.id)));
    }
    if (action === 'resync') {   // re-read every linked task (comments, status) once, e.g. after a token problem
      const l = await getLink(user.id);
      if (l) await saveLink(user.id, { state: { ...(l.state || {}), redo: Date.now() } });
      const r = await syncUser(user.id); return send(res, 200, { ...r, ...view(await getLink(user.id)) });
    }
    if (action === 'sync') { const r = await syncUser(user.id); return send(res, 200, { ...r, ...view(await getLink(user.id)) }); }
    if (action === 'disconnect') { await sb(`clickup_links?user_id=eq.${user.id}`, { method: 'DELETE' }); return send(res, 200, { connected: false }); }
    send(res, 400, { error: 'unknown_action' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'failed' });
  }
};
