// Google Calendar actions for the signed-in user: POST /api/calendar?action=status|connect|sync|disconnect
const { env, send, origin, authUser, sb, getLink, sign, calendarReady } = require('./_lib');
const { SCOPES, tokenRequest, client, syncUser } = require('./_gcal');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
  if (!calendarReady()) return send(res, 503, { error: 'not_configured' });
  const user = await authUser(req);
  if (!user) return send(res, 401, { error: 'signed_out' });
  const action = new URL(req.url, 'http://x').searchParams.get('action');
  const app = origin(req);
  try {
    if (action === 'status') {
      const l = await getLink(user.id);
      return send(res, 200, l ? { connected: true, email: l.email, lastSync: l.last_sync, error: l.last_error } : { connected: false });
    }
    if (action === 'connect') {
      const q = new URLSearchParams({
        client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: `${app}/api/calendar-callback`, response_type: 'code',
        scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
        state: sign({ uid: user.id, exp: Date.now() + 10 * 60 * 1000 })
      });
      if (user.email) q.set('login_hint', user.email);
      return send(res, 200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
    }
    if (action === 'sync') return send(res, 200, await syncUser(user.id, app));
    if (action === 'disconnect') {
      const l = await getLink(user.id);
      if (l) {
        try {
          const { access_token } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: l.refresh_token });
          if (l.calendar_id) await client(access_token)('DELETE', `/calendars/${encodeURIComponent(l.calendar_id)}`).catch(() => {});
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(l.refresh_token)}`, { method: 'POST' }).catch(() => {});
        } catch (e) { /* access already removed on Google's side */ }
        await sb(`gcal_links?user_id=eq.${user.id}`, { method: 'DELETE' });
      }
      return send(res, 200, { connected: false });
    }
    send(res, 400, { error: 'unknown_action' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'failed' });
  }
};
