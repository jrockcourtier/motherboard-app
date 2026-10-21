// Fiches DuProprio en PDF, gardées privées dans Supabase Storage (bucket « fiches »).
// GET  /api/pdf?id=<uuid du contact>      -> le PDF
// POST /api/pdf?id=<uuid du contact>      -> enregistre le PDF (corps = le fichier, max ~4 Mo)
const L = require('./_lib');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE = (process.env.SUPABASE_URL || 'https://luynpgieqbszsqucldal.supabase.co').replace(/\/$/, '') + '/storage/v1/object/fiches/';

function headers(extra) {
  const key = L.supabaseKey();
  const h = Object.assign({ apikey: key }, extra || {});
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  return h;
}
async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');
  const chunks = []; for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  try {
    const email = await L.requireOwner(req, res);
    if (!email) return;
    const id = String((req.query && req.query.id) || new URL(req.url, 'http://x').searchParams.get('id') || '');
    if (!UUID.test(id)) return L.json(res, 400, { error: 'bad_id' });

    if (req.method === 'GET') {
      const r = await fetch(BASE + id + '.pdf', { headers: headers() });
      if (!r.ok) return L.json(res, r.status === 400 || r.status === 404 ? 404 : 502, { error: 'not_found' });
      const buf = Buffer.from(await r.arrayBuffer());
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.end(buf);
    }
    if (req.method === 'POST') {
      const buf = await rawBody(req);
      if (!buf.length || buf.slice(0, 4).toString() !== '%PDF') return L.json(res, 400, { error: 'not_a_pdf' });
      const r = await fetch(BASE + id + '.pdf', { method: 'POST', headers: headers({ 'Content-Type': 'application/pdf', 'x-upsert': 'true' }), body: buf });
      if (!r.ok) return L.json(res, 502, { error: 'storage_error', status: r.status, detail: (await r.text()).slice(0, 200) });
      return L.json(res, 200, { ok: true, bytes: buf.length });
    }
    res.setHeader('Allow', 'GET, POST');
    L.json(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    L.json(res, 502, { error: 'storage_unreachable', detail: e.message });
  }
};
