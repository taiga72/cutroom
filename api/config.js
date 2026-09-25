// Public settings the page needs to reach Supabase. The anon key is meant to be public;
// row level security decides what each signed-in person can read and write.
const { env, send, calendarReady } = require('./_lib');

module.exports = (req, res) => {
  const url = env('SUPABASE_URL'), key = env('SUPABASE_ANON_KEY');
  // Only names are reported, never values, so the page can say what's left to set up.
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter(k => !env(k));
  if (!url || !key) return send(res, 503, { error: 'not_configured', missing });
  if (!/^https:\/\/[^/]+$/.test(url.replace(/\/+$/, ''))) return send(res, 503, { error: 'bad_url', missing });
  send(res, 200, { supabaseUrl: url.replace(/\/+$/, ''), supabaseAnonKey: key, calendar: calendarReady(), missing });
};
