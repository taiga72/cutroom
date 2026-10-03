// Exchange rates for invoice totals: GET /api/rates?base=USD → {base, rates:{PHP:…}, date}. Cached for 6 hours.
const { send } = require('./_lib');

module.exports = async (req, res) => {
  const base = (new URL(req.url, 'http://x').searchParams.get('base') || 'USD').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'USD';
  const tries = [
    async () => { const j = await (await fetch(`https://open.er-api.com/v6/latest/${base}`)).json(); if (j.result !== 'success') throw 0; return { rates: j.rates, date: (j.time_last_update_utc || '').slice(5, 16) }; },
    async () => { const j = await (await fetch(`https://api.frankfurter.app/latest?from=${base}`)).json(); if (!j.rates) throw 0; return { rates: { ...j.rates, [base]: 1 }, date: j.date }; }
  ];
  for (const t of tries) {
    try { const r = await t(); res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400'); return res.end(JSON.stringify({ base, ...r })); } catch (e) { /* next source */ }
  }
  send(res, 502, { error: 'rates_unavailable' });
};
