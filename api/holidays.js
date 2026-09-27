// Public holidays for one country and year, for the Calendar: GET /api/holidays?c=AE&y=2026
// → { country, year, source, items: [[ 'YYYY-MM-DD', 'Name' ], ...] }
// Reads Google's public holiday calendar (covers every country, including Islamic holidays such as UAE's);
// falls back to Nager.Date. Browsers can't read either feed directly (no CORS on Google's), hence this route.
const { send } = require('./_lib');

const unfold = s => s.replace(/\r?\n[ \t]/g, '');
const unesc = s => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

function parseIcs(text, year) {
  const out = [];
  for (const block of unfold(text).split('BEGIN:VEVENT').slice(1)) {
    const get = k => { const m = new RegExp('^' + k + '[;:][^\\r\\n]*', 'm').exec(block); return m ? m[0].replace(/^[^:]*:/, '') : ''; };
    const d = /(\d{4})(\d{2})(\d{2})/.exec(get('DTSTART'));
    if (!d || +d[1] !== year) continue;
    const name = unesc(get('SUMMARY')), desc = unesc(get('DESCRIPTION'));
    if (!name || /observance/i.test(desc)) continue;           // keep days off, skip "observances" (Valentine's Day…)
    out.push([`${d[1]}-${d[2]}-${d[3]}`, name]);
  }
  return out;
}

async function fromGoogle(cc, year) {
  const id = encodeURIComponent(`en.${cc.toLowerCase()}#holiday@group.v.calendar.google.com`);
  const r = await fetch(`https://calendar.google.com/calendar/ical/${id}/public/basic.ics`);
  if (!r.ok) throw new Error('google ' + r.status);
  const text = await r.text();
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('google: not a calendar');
  return parseIcs(text, year);
}

async function fromNager(cc, year) {
  const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${cc}`);
  if (!r.ok) throw new Error('nager ' + r.status);
  const list = await r.json();
  return (Array.isArray(list) ? list : []).filter(h => h.global !== false).map(h => [h.date, h.localName && h.name && h.localName !== h.name ? h.name : (h.name || h.localName)]);
}

module.exports = async (req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const cc = String(q.get('c') || '').toUpperCase(), year = parseInt(q.get('y'), 10);
  if (!/^[A-Z]{2}$/.test(cc) || !(year >= 2000 && year <= 2100)) return send(res, 400, { error: 'bad_request' });
  let items = null, source = '';
  try { items = await fromGoogle(cc, year); source = 'google'; } catch (e) { /* try the next one */ }
  if (!items || !items.length) { try { items = await fromNager(cc, year); source = 'nager'; } catch (e) { /* none */ } }
  if (!items) return send(res, 502, { error: 'unavailable' });
  // one entry per day and name, in date order
  const seen = new Set();
  items = items.filter(([d, n]) => { const k = d + n; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a[0].localeCompare(b[0]));
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.end(JSON.stringify({ country: cc, year, source, items }));
};

module.exports.parseIcs = parseIcs;
