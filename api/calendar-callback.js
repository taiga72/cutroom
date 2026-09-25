// Google sends the person back here after they allow calendar access.
const { send, origin, sb, getLink, unsign } = require('./_lib');
const { tokenRequest, syncUser } = require('./_gcal');

const back = (res, app, result) => { res.statusCode = 302; res.setHeader('Location', `${app}/?calendar=${result}`); res.end(); };

module.exports = async (req, res) => {
  const app = origin(req);
  const q = new URL(req.url, 'http://x').searchParams;
  const st = unsign(q.get('state'));
  if (!st) return back(res, app, 'expired');
  if (q.get('error') || !q.get('code')) return back(res, app, 'cancelled');
  try {
    const tok = await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: `${app}/api/calendar-callback` });
    if (!tok.refresh_token) return back(res, app, 'failed');
    let email = null;
    try { email = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString()).email || null; } catch (e) {}
    const old = await getLink(st.uid);
    const row = { user_id: st.uid, refresh_token: tok.refresh_token, email, last_error: null,
      calendar_id: old && old.email === email ? old.calendar_id : null };
    await sb('gcal_links?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
    await syncUser(st.uid, app);
    back(res, app, 'connected');
  } catch (e) {
    console.error(e);
    back(res, app, 'failed');
  }
};
