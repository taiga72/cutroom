// Public settings the page needs to reach Supabase. The anon key is meant to be public;
// row level security decides what each signed-in person can read and write.
const { env, send, calendarReady } = require('./_lib');

module.exports = (req, res) => {
  const url = env('SUPABASE_URL'), key = env('SUPABASE_ANON_KEY');
  if (!url || !key) return send(res, 503, { error: 'Supabase is not set up yet: add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.' });
  send(res, 200, { supabaseUrl: url.replace(/\/+$/, ''), supabaseAnonKey: key, calendar: calendarReady() });
};
