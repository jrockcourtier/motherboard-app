// CRM : contacts de Julien, gardés dans Supabase (table "contacts").
// GET  /api/contacts            -> liste complète
// POST /api/contacts {items:[]} -> création / mise à jour (upsert), suppression = data.deleted = true
const L = require('./_lib');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  const email = await L.requireOwner(req, res);
  if (!email) return;
  if (!L.supabaseKey()) return L.json(res, 503, { error: 'db_not_configured' });

  if (req.method === 'GET') {
    const r = await L.sb('contacts?select=id,data,updated_at&order=updated_at.desc&limit=5000');
    if (!r.ok) return L.json(res, 502, { error: 'db_error', status: r.status, detail: r.body });
    return L.json(res, 200, { items: (r.body || []).map(x => ({ id: x.id, data: x.data, updatedAt: x.updated_at })) });
  }

  if (req.method === 'POST') {
    const body = await L.readBody(req);
    const items = (body && Array.isArray(body.items) ? body.items : []).slice(0, 500);
    const rows = items.filter(i => i && UUID.test(i.id) && i.data && typeof i.data === 'object')
      .map(i => ({ id: i.id, data: i.data, updated_at: i.updatedAt || new Date().toISOString() }));
    if (!rows.length) return L.json(res, 400, { error: 'no_valid_items' });
    if (JSON.stringify(rows).length > 4e6) return L.json(res, 413, { error: 'too_large' });
    const r = await L.sb('contacts?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });
    if (!r.ok) return L.json(res, 502, { error: 'db_error', status: r.status, detail: r.body });
    return L.json(res, 200, { saved: rows.map(x => x.id) });
  }

  res.setHeader('Allow', 'GET, POST');
  L.json(res, 405, { error: 'method_not_allowed' });
};
