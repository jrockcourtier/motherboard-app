// ============================================================
// Motherboard — Prospection (remplace la liste OneNote)
// Listes par secteur / mois · colonnes À appeler → Suivi → Signé
// Import : on glisse les PDF DuProprio (Imprimer → Enregistrer en PDF), l'app lit chaque fiche.
// Les fiches sont des contacts « Proprio » du CRM : appels, rappels et historique au même endroit.
// ============================================================
(function () {
  const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (x) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (x) {} } };
  const COLS = [['appeler', 'À appeler'], ['suivi', 'Suivi'], ['signe', 'Signé'], ['archive', 'Archivés']];
  let col = 'appeler', curList = ls.get('mb_plist', null), thumbs = ls.get('mb_thumbs', {}), thumbsLoaded = false, q = '';

  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const all = () => (window.CRM && CRM._all ? Object.values(CRM._all()) : []).filter(c => !c.deleted && c.type === 'proprio' && c.plist);
  function colOf(c) {
    const s = c.stage || 'À appeler';
    if (s === 'À appeler') return 'appeler';
    if (s === 'Signé' || s === 'Converti en vendeur') return 'signe';
    if (s === 'Pas intéressé' || s === 'Injoignable') return 'archive';
    return 'suivi';
  }
  const isDue = (c) => c.nextFollowUp && c.nextFollowUp <= today();
  function lists() {
    const m = {};
    all().forEach(c => { const k = c.plist; m[k] = m[k] || { name: k, n: 0, at: '' }; m[k].n++; if ((c.importedAt || '') > m[k].at) m[k].at = c.importedAt || ''; });
    return Object.values(m).sort((a, b) => b.at.localeCompare(a.at));
  }
  const lastCall = (c) => (c.calls || []).slice(-1)[0];
  const OUTL = { pas_reponse: '📵 Pas de réponse', message: '📨 Message laissé', parle: '💬 Parlé', rdv: '📅 RDV fixé', pas_interesse: '🙅 Pas intéressé' };
  const fmtD = (s) => { const d = new Date(s + 'T12:00:00'); return d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }); };

  // ---------- photos (miniatures) : gardées sur l'appareil + Supabase (table prospects) ----------
  async function loadThumbs() {
    if (thumbsLoaded) return; thumbsLoaded = true;
    try {
      const r = await fetch('/api/thumbs', { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = await r.json();
      let n = 0; (j.items || []).forEach(it => { if (it.data && it.data.t && !thumbs[it.id]) { thumbs[it.id] = it.data.t; n++; } });
      if (n) { ls.set('mb_thumbs', thumbs); render(); }
    } catch (x) {}
  }
  async function uploadThumbs(items) {
    for (let i = 0; i < items.length; i += 20) {
      try { await fetch('/api/thumbs', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: items.slice(i, i + 20) }) }); } catch (x) {}
    }
  }
  const thumb = (id) => thumbs[id] || null;
  function thumbHtml(c, cls) {
    const t = thumb(c.id);
    return t ? `<img class="${cls || 'pr-thumb'}" src="${t}" alt="" loading="lazy">` : (cls === 'pr-thumb' ? `<div class="pr-thumb pr-nothumb">🏠</div>` : '');
  }

  // ---------- lecture d'un PDF DuProprio ----------
  let pdfjs = null;
  // pdf.js 3.11 (version « legacy », compatible avec les navigateurs plus anciens), chargé au besoin
  function lib() {
    if (pdfjs) return pdfjs;
    pdfjs = new Promise((ok, ko) => {
      if (window.pdfjsLib) return ok(window.pdfjsLib);
      const s = document.createElement('script'); s.src = '/vendor/pdf3.min.js';
      s.onload = () => { if (!window.pdfjsLib) return ko(new Error('pdf.js absent')); window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf3.worker.min.js'; ok(window.pdfjsLib); };
      s.onerror = () => { pdfjs = null; ko(new Error('pdf.js non chargé (connexion ?)')); };
      document.head.appendChild(s);
    });
    return pdfjs;
  }
  function parseText(items) {
    // colonne de droite (bloc vert) : prix, #numéro, adresse, ville, téléphone
    const right = items.filter(i => i.str.trim() && i.transform[4] > 330 && i.transform[5] > 540).sort((a, b) => b.transform[5] - a.transform[5]).map(i => i.str.trim());
    const all = items.map(i => i.str).join('\n');
    const out = {};
    const pm = (right.join(' ') + ' ' + all).match(/(\d{1,3}(?:[\s  ]\d{3})+)\s*\$/);
    if (pm) out.price = pm[1].replace(/[\s  ]/g, ' ') + ' $';
    const nm = (right.join(' ') + ' ' + all).match(/#\s?(\d{5,9})\b/) || all.match(/duproprio\.com\/(\d{5,9})/);
    if (nm) out.no = nm[1];
    const k = right.findIndex(s => /^#\s?\d{5,9}$/.test(s));
    if (k >= 0) {
      const rest = right.slice(k + 1);
      const ci = rest.findIndex(s => /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(s) || /Québec|Quebec/.test(s));
      if (ci > 0) { out.street = rest.slice(0, ci).join(' '); out.city = rest[ci]; }
      else if (rest.length) { out.street = rest[0]; out.city = rest[1] || ''; }
      const ph = rest.find(s => /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}$/.test(s));
      if (ph) out.phone = ph;
    }
    if (!out.phone) { const ph = right.join(' ').match(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/); if (ph) out.phone = ph[0]; }
    const tm = all.match(/Type de propriété\s*\n[\s\n]*([^\n]+)/); if (tm) out.ptype = tm[1].trim();
    const ch = all.match(/Nombre de chambres\s*\n[\s\n]*(\d+)/); if (ch) out.rooms = ch[1];
    out.hood = out.city ? out.city.split(',')[0].trim() : '';
    return out;
  }
  // repère la 1re photo dans la colonne de droite (sous le bloc vert) et en fait une miniature
  function cropPhoto(canvas, scale) {
    const ctx = canvas.getContext('2d'); const W = canvas.width, H = canvas.height;
    const x0 = Math.round(335 * scale), x1 = Math.round(570 * scale), xm = Math.round(450 * scale);
    const px = ctx.getImageData(0, 0, W, H).data;
    const at = (x, y) => { const i = (y * W + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
    const isWhite = ([r, g, b]) => r > 240 && g > 240 && b > 240;
    const isGreen = ([r, g, b]) => g > 140 && g > r + 40 && g > b + 60;
    const xs = []; for (let k = 0; k < 12; k++) xs.push(Math.round(x0 + 12 * scale + k * (x1 - x0 - 24 * scale) / 11));
    const frac = (y, f) => xs.filter(x => f(at(x, y))).length / xs.length;
    const run = (y, test, n) => { for (let k = 0; k < n; k++) if (!test(y + k)) return false; return true; };
    const lim = Math.round(H * 0.85);
    let y = Math.round(10 * scale), top = -1, bottom = -1;
    while (y < lim && frac(y, isGreen) < 0.6) y++;                                   // début du bloc vert
    while (y < lim && !run(y, yy => frac(yy, isGreen) < 0.2, 3)) y++;               // fin du bloc vert
    while (y < lim && !run(y, yy => frac(yy, isWhite) < 0.4 && frac(yy, isGreen) < 0.2, 4)) y++; // début de la photo
    if (y >= lim) return null;
    top = y;
    for (y = top + Math.round(30 * scale); y < lim; y++) { if (run(y, yy => frac(yy, isWhite) > 0.85, 3)) { bottom = y; break; } }
    if (bottom < 0) bottom = Math.min(H, top + Math.round(180 * scale));
    const w = x1 - x0, h = bottom - top;
    if (h < 40 * scale) return null;
    const out = document.createElement('canvas'); const tw = 240; out.width = tw; out.height = Math.round(tw * h / w);
    out.getContext('2d').drawImage(canvas, x0, top, w, h, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.62);
  }
  async function readPdf(file) {
    const p = await lib();
    let buf;
    try { buf = await file.arrayBuffer(); }
    catch (x) { const er = new Error('icloud'); er.why = 'Fichier pas encore téléchargé d\'iCloud sur ce Mac'; throw er; }
    if (!buf || !buf.byteLength) { const er = new Error('vide'); er.why = 'Fichier vide (peut-être encore dans iCloud)'; throw er; }
    const doc = await p.getDocument({ data: new Uint8Array(buf), verbosity: 0, isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const info = parseText((await page.getTextContent()).items);
    try {
      const scale = 1.4, vp = page.getViewport({ scale });
      const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      info.thumb = cropPhoto(cv, scale);
    } catch (x) {}
    try { doc.destroy(); } catch (x) {}
    // nom du fichier : « Sud-Ouest 27 Sept 2026- 41.pdf » → liste « Sud-Ouest 27 Sept 2026 », fiche #41
    const fm = file.name.replace(/\.pdf$/i, '').match(/^(.*?)[\s_-]*(\d{1,3})$/);
    if (fm && fm[1].trim().length > 2) { info.list = fm[1].replace(/[\s_-]+$/, '').trim(); info.order = +fm[2]; }
    info.file = file.name; info._f = file;
    return info;
  }

  // ---------- import ----------
  async function importFiles(files) {
    files = [...files].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!files.length) { toastMsg('Aucun PDF trouvé.'); return; }
    files.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    const m = modal();
    const box = m.querySelector('.sheet');
    box.innerHTML = `<div class="sheet-head"><b>Lecture des fiches…</b></div><div class="pr-prog"><i style="width:0"></i></div><div id="pr-prog-txt" class="crm-muted">0 / ${files.length}</div>`;
    m.classList.add('open');
    const res = [];
    for (let i = 0; i < files.length; i++) {
      try { res.push(await readPdf(files[i])); } catch (x) { console.warn('PDF', files[i].name, x); res.push({ file: files[i].name, error: true, why: x.why || x.message || String(x) }); }
      box.querySelector('.pr-prog i').style.width = Math.round((i + 1) / files.length * 100) + '%';
      box.querySelector('#pr-prog-txt').textContent = `${i + 1} / ${files.length} · ${files[i].name}`;
    }
    review(res);
  }
  // ---------- reconnaître une fiche déjà connue : n° DuProprio, sinon adresse ----------
  function addrKey(street, city) {
    const st = String(street || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(app|apt|appartement|unite|suite|local)\b.*$/, '').replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(rue|avenue|av|ave|boulevard|boul|blvd|chemin|ch|place|pl|croissant|cr|terrasse|montee|rang|route|de|du|des|la|le|l|d|st|ste|saint|sainte)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/\d/.test(st) || st.length < 4) return '';
    const pc = (String(city || '').toUpperCase().match(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/) || [''])[0].replace(/\s/g, '');
    return st + (pc ? '|' + pc.slice(0, 3) : '');
  }
  function knownMaps() {
    const byNo = {}, byAddr = {};
    const add = c => { if (c.deleted || c.type !== 'proprio' && !c.listingNo) return;
      if (c.listingNo && !byNo[c.listingNo]) byNo[c.listingNo] = c;
      const parts = String(c.address || '').split(', '); const k = addrKey(c.name || parts[0], c.address);
      if (k && !byAddr[k]) byAddr[k] = c; };
    all().forEach(add); if (window.CRM) Object.values(CRM._all()).forEach(add);
    return { find: r => byNo[r.no] || byAddr[addrKey(r.street, r.city)] || null };
  }
  function priceNum(p) { const n = parseInt(String(p || '').replace(/[^\d]/g, ''), 10); return isNaN(n) ? 0 : n; }
  let pendingImport = [];
  function review(res) {
    pendingImport = res;
    const ok = res.filter(r => !r.error && r.no);
    const K = knownMaps(); const known = {}; ok.forEach(r => { const o = K.find(r); if (o) known[r.no] = o; });
    const listName = mode(ok.map(r => r.list).filter(Boolean)) || defaultListName();
    const nNew = ok.filter(r => !known[r.no]).length, nDup = ok.length - nNew, nBad = res.length - ok.length;
    const noPhone = ok.filter(r => !r.phone).length;
    const box = modal().querySelector('.sheet');
    box.innerHTML = `
      <div class="sheet-head"><button type="button" class="sheet-x" onclick="Prospect.closeModal()">✕</button><b>Importer ${ok.length} fiche${ok.length > 1 ? 's' : ''}</b><button class="sheet-save" onclick="Prospect.confirmImport()">Ajouter</button></div>
      <label class="f-block">Nom de la liste<input id="pr-listname" value="${e(listName)}" autocomplete="off"></label>
      <div class="pr-sum">🆕 <b>${nNew}</b> nouvelle${nNew > 1 ? 's' : ''}${nDup ? ` · ♻️ <b>${nDup}</b> déjà dans tes listes (prix mis à jour)` : ''}${noPhone ? ` · 📵 ${noPhone} sans téléphone sur la fiche` : ''}${nBad ? ` · ⚠️ ${nBad} illisible${nBad > 1 ? 's' : ''}` : ''}</div>
      <div class="pr-rev">${res.map(r => r.error || !r.no ? `<div class="pr-rev-row bad">⚠️ ${e(r.file)} — ${r.error ? 'illisible : ' + e(r.why || 'erreur') : 'pas une fiche DuProprio reconnue'}</div>` :
        `<div class="pr-rev-row">${r.thumb ? `<img src="${r.thumb}" alt="">` : '<span class="pr-nothumb">🏠</span>'}<div><b>${r.order ? '#' + r.order + ' · ' : ''}${e(r.price || '')}</b> ${e(r.ptype || '')}<br>${e(r.street || '')} <span class="crm-muted">${e(r.hood || '')}</span><br><span class="crm-muted">${r.phone ? '📞 ' + e(r.phone) : '📵 pas de téléphone'} · DuProprio #${e(r.no)}${known[r.no] ? ' · ♻️ déjà là' + (known[r.no].listingNo && known[r.no].listingNo !== r.no ? ' (même adresse, annonce remise en ligne)' : '') + (known[r.no].price && r.price && priceNum(r.price) < priceNum(known[r.no].price) ? ' · 🔻 baisse de prix' : '') : ''}</span></div></div>`).join('')}</div>
      ${res.some(r => r.error && /iCloud|vide/.test(r.why || '')) ? `<div class="pr-warn">☁️ Ces PDF sont dans iCloud mais pas encore téléchargés sur ce Mac. Dans le Finder : clic droit sur le dossier <b>Sud-Ouest</b> → <b>Télécharger maintenant</b>, attends que les nuages disparaissent, puis réessaie.</div>` : ''}
      <div class="crm-muted" style="margin-top:8px">Les numéros ne sont pas encore vérifiés à la LNNTE : l'app te le rappellera avant chaque appel.</div>`;
  }
  function mode(arr) { const c = {}; let best = null; arr.forEach(x => { c[x] = (c[x] || 0) + 1; if (!best || c[x] > c[best]) best = x; }); return best; }
  function defaultListName() { const d = new Date(); return 'Liste ' + d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' }); }
  function confirmImport() {
    const name = (document.getElementById('pr-listname').value || '').trim() || defaultListName();
    const K = knownMaps();
    const now = new Date().toISOString(), up = [], toUpload = [];
    let added = 0, updated = 0, order = Math.max(0, ...all().filter(c => c.plist === name).map(c => c.porder || 0));
    pendingImport.filter(r => !r.error && r.no).forEach(r => {
      const old = K.find(r);
      if (old) {
        let newPdf = false;
        old.notes = old.notes || [];
        if (old.listingNo && r.no !== old.listingNo) {
          old.notes.push({ id: CRM.newId(), at: now, text: `🔁 Annonce remise en ligne sur DuProprio : #${old.listingNo} → #${r.no}` });
          old.listingNo = r.no; old.dpUrl = 'https://duproprio.com/' + r.no; newPdf = true;
        }
        if (r.price && old.price && r.price !== old.price) {
          const a = priceNum(old.price), b = priceNum(r.price);
          old.notes.push({ id: CRM.newId(), at: now, text: `${b < a ? '🔻 Baisse de prix' : '💲 Prix modifié'} sur DuProprio : ${old.price} → ${r.price}${a && b ? ` (${b < a ? '−' : '+'}${Math.abs(a - b).toLocaleString('fr-CA')} $)` : ''}` });
          old.priceHist = (old.priceHist || []).concat([{ at: now, from: old.price, to: r.price }]);
          if (b < a) old.priceDropAt = now; else delete old.priceDropAt;
          old.prevPrice = old.price; old.price = r.price; newPdf = true;
        }
        if (r.phone && !old.phone) old.phone = r.phone;
        if (!old.plist) { old.plist = name; old.porder = r.order || ++order; old.importedAt = now; }
        if (r._f && (!old.hasPdf || newPdf)) toUpload.push([old, r._f]);
        CRM.upsert(old); updated++;
        if (r.thumb && !thumbs[old.id]) { thumbs[old.id] = r.thumb; up.push({ id: old.id, data: { t: r.thumb } }); }
        return;
      }
      const id = CRM.newId();
      const c = {
        id, type: 'proprio', stage: 'À appeler', name: r.street || ('DuProprio #' + r.no),
        address: [r.street, r.city].filter(Boolean).join(', '), phone: r.phone || '', price: r.price || '',
        ptype: r.ptype || '', rooms: r.rooms || '', hood: r.hood || '', listingNo: r.no, dpUrl: 'https://duproprio.com/' + r.no,
        plist: name, porder: r.order || ++order, importedAt: now, source: 'DuProprio', firstContact: '', notes: [], calls: [], createdAt: now
      };
      CRM.upsert(c); added++;
      if (r._f) toUpload.push([c, r._f]);
      if (r.thumb) { thumbs[id] = r.thumb; up.push({ id, data: { t: r.thumb } }); }
    });
    ls.set('mb_thumbs', thumbs);
    uploadThumbs(up);
    uploadPdfs(toUpload);
    curList = name; ls.set('mb_plist', curList); col = 'appeler';
    closeModal(); render();
    toastMsg(`✅ ${added} fiche${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} à « ${name} »${updated ? ` · ${updated} mise${updated > 1 ? 's' : ''} à jour` : ''}`);
  }


  // ---------- copies des PDF : Supabase Storage (privé) + cache du navigateur ----------
  const pdfMem = {};                       // id -> Blob (session en cours)
  let upQueue = [], upBusy = false, upDone = 0, upTotal = 0;
  function uploadPdfs(list) {
    list.forEach(([c, f]) => { pdfMem[c.id] = f; upQueue.push([c.id, f]); });
    caches.open('mb-fiches').then(cc => list.forEach(([c]) => cc.delete('/api/pdf?id=' + c.id))).catch(() => {});
    upTotal += list.length; pumpUploads();
  }
  async function pumpUploads() {
    if (upBusy) return; upBusy = true;
    while (upQueue.length) {
      const [id, f] = upQueue.shift();
      try {
        const r = await fetch('/api/pdf?id=' + id, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/pdf' }, body: f });
        if (r.ok) { const c = CRM._all()[id]; if (c && !c.hasPdf) { c.hasPdf = true; CRM.upsert(c); } try { (await caches.open('mb-fiches')).put('/api/pdf?id=' + id, new Response(f, { headers: { 'Content-Type': 'application/pdf' } })); } catch (x) {} }
      } catch (x) {}
      upDone++; showUp();
    }
    upBusy = false; showUp();
  }
  function showUp() {
    let el = document.getElementById('pr-upload');
    if (!el) { el = document.createElement('div'); el.id = 'pr-upload'; el.className = 'pr-upload'; document.body.appendChild(el); }
    if (upDone >= upTotal) { el.textContent = `☁️ ${upTotal} fiche${upTotal > 1 ? 's' : ''} PDF sauvegardée${upTotal > 1 ? 's' : ''}`; setTimeout(() => el.remove(), 3000); upDone = upTotal = 0; return; }
    el.textContent = `☁️ Sauvegarde des PDF… ${upDone} / ${upTotal}`;
  }
  async function getPdf(id) {
    if (pdfMem[id]) return pdfMem[id];
    const url = '/api/pdf?id=' + id;
    try { const cc = await caches.open('mb-fiches'); const hit = await cc.match(url); if (hit) return pdfMem[id] = await hit.blob(); } catch (x) {}
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) return null;
    const b = await r.blob();
    try { (await caches.open('mb-fiches')).put(url, new Response(b, { headers: { 'Content-Type': 'application/pdf' } })); } catch (x) {}
    return pdfMem[id] = b;
  }

  // ---------- le dossier : PDF à gauche · propriété au centre · notes à droite ----------
  let cur = null, order = [], pane = window.innerWidth < 900 ? 'prop' : 'notes', saveT = null;
  const OUTS = [['pas_reponse', '📵', 'Pas de réponse'], ['message', '📨', 'Message'], ['parle', '💬', 'Parlé'], ['rdv', '📅', 'RDV'], ['pas_interesse', '🙅', 'Pas intéressé']];
  const QUICK = [['Nom du proprio', 'Nom du proprio : '], ['Prix minimum', 'Prix minimum : '], ['Commission', 'Commission : '], ['Délai', 'Délai : '], ['Motivation', 'Motivation : '], ['Courtier ?', 'A déjà un courtier : ']];
  function openFiche(id) {
    const c = CRM._all()[id]; if (!c) return;
    cur = id; CRM.focus(id);
    const items = all().filter(k => k.plist === c.plist);
    const inCol = items.filter(k => colOf(k) === colOf(c));
    const list = (q ? items.filter(k => [k.name, k.address, k.owner, k.phone, k.listingNo].join(' ').toLowerCase().includes(q.toLowerCase())) : inCol);
    order = list.sort((a, b) => (a.porder || 0) - (b.porder || 0)).map(k => k.id);
    let m = document.getElementById('pr-dossier');
    if (!m) { m = document.createElement('div'); m.id = 'pr-dossier'; m.className = 'pr-dossier'; document.body.appendChild(m); }
    m.classList.add('open'); document.body.classList.add('pr-dossier-open');
    renderFiche(true);
  }
  document.addEventListener('keydown', ev => { if (!cur || /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return; if (ev.key === 'Escape') closeFiche(); if (ev.key === 'ArrowRight') step(1); if (ev.key === 'ArrowLeft') step(-1); });
  function closeFiche() { const m = document.getElementById('pr-dossier'); if (m) m.classList.remove('open'); document.body.classList.remove('pr-dossier-open'); flushNote(); cur = null; render(); }
  function step(d) { flushNote(); const i = order.indexOf(cur); const n = order[i + d]; if (n) openFiche(n); }
  function renderFiche(full) {
    const c = CRM._all()[cur]; const m = document.getElementById('pr-dossier'); if (!c || !m) return;
    const i = order.indexOf(cur);
    if (full) {
      m.innerHTML = `
        <div class="pd-top">
          <button class="pd-x" onclick="Prospect.close()" aria-label="Fermer">✕</button>
          <div class="pd-title"><b>${e(c.plist || 'Prospection')}</b><span>fiche #${e(c.porder || '')} · ${i + 1} / ${order.length}</span></div>
          <div class="pd-nav"><button ${i <= 0 ? 'disabled' : ''} onclick="Prospect.step(-1)">‹ Précédente</button><button ${i >= order.length - 1 ? 'disabled' : ''} onclick="Prospect.step(1)">Suivante ›</button></div>
        </div>
        <div class="pd-tabs">${[['pdf', '📄 Fiche'], ['prop', '🏠 Propriété'], ['notes', '📝 Notes']].map(([k, l]) => `<button class="${pane === k ? 'on' : ''}" onclick="Prospect.pane('${k}')">${l}</button>`).join('')}</div>
        <div class="pd-grid pane-${pane}">
          <section class="pd-col pd-pdf"><div class="pd-pdfbar"><h4>📄 Fiche DuProprio complète</h4><button id="pd-big" onclick="Prospect.big()">Ouvrir en grand ↗</button></div><div class="pd-pages" id="pd-pages"><div class="crm-muted pd-wait">Chargement de la fiche…</div></div></section>
          <section class="pd-col pd-prop" id="pd-prop"></section>
          <section class="pd-col pd-notes">
            <h4>📝 Notes de l'appel <span class="pd-saved" id="pd-saved">enregistré automatiquement</span></h4>
            <textarea id="pd-note" placeholder="Écris tes notes pendant l'appel, comme dans OneNote…&#10;&#10;Ex. : Mathieu — minimum 750 k — 3 % — veut attendre 2 semaines" oninput="Prospect.typed()">${e(c.pnotes || '')}</textarea>
            <div class="pd-quick">${QUICK.map(([l, t]) => `<button onclick="Prospect.quick('${t}')">+ ${l}</button>`).join('')}</div>
            <h4>Résultat de l'appel</h4>
            <div class="crm-outcomes">${OUTS.map(([k, ic, l]) => `<button onclick="Prospect.out('${k}')">${ic}<span>${l}</span></button>`).join('')}</div>
            <div id="pd-after" class="crm-after"></div>
            <h4>Historique</h4>
            <div class="crm-timeline" id="pd-hist"></div>
          </section>
        </div>`;
      loadPdfView(c);
    }
    renderProp(c);
    const h = document.getElementById('pd-hist'); if (h) h.innerHTML = CRM._timeline(c.id);
  }
  function money(n) { return Math.round(n).toLocaleString('fr-CA') + ' $'; }
  function offerCalc(c) {
    const v = priceNum(c.price); if (!v) return '';
    const sel = c.offer && c.offer.price === c.price ? c.offer.pct : null;
    return `<div class="pd-offer"><div class="pd-offer-h">Prix à proposer <span>(prix demandé − commission) · coche ce que tu as proposé</span></div>${[3.5, 3.25, 3].map(t => { const com = v * t / 100;
      return `<label class="pd-offer-r${sel === t ? ' on' : ''}"><input type="checkbox" ${sel === t ? 'checked' : ''} onchange="Prospect.offer(${t}, this.checked)"><span class="pd-offer-t">${String(t).replace('.', ',')} %</span><b>${money(v - com)}</b><span class="pd-offer-c">comm. ${money(com)}</span></label>`; }).join('')}
      ${c.offer && c.offer.price !== c.price ? `<div class="pd-offer-old">Déjà proposé : ${String(c.offer.pct).replace('.', ',')} % → ${money(c.offer.amount)} (sur ${e(c.offer.price)})</div>` : ''}</div>`;
  }
  function toContact(again) {
    flushNote();
    const c = CRM._all()[cur]; if (!c) return;
    if (!String(c.owner || '').trim()) {
      const inp = document.querySelector('.pd-facts input'); if (inp) { inp.focus(); inp.classList.add('pd-need'); setTimeout(() => inp.classList.remove('pd-need'), 2500); }
      toastMsg('✍️ Écris d\'abord le prénom du proprio dans « Propriétaire », puis réappuie.'); return;
    }
    if (!c.isContact) {
      c.isContact = true; c.contactAt = new Date().toISOString();
      c.notes = c.notes || []; c.notes.push({ id: CRM.newId(), at: c.contactAt, text: `📇 Ajouté à mes contacts : POT-${c.owner} - ${c.name}` });
      if (!c.firstContact) c.firstContact = c.contactAt.slice(0, 10);
      CRM.upsert(c);
    }
    CRM.vcard(c.id);
    renderFiche(false); render();
  }
  function offer(t, on) {
    const c = CRM._all()[cur]; if (!c) return; const v = priceNum(c.price); const now = new Date().toISOString();
    c.notes = c.notes || [];
    if (on) {
      const amount = Math.round(v * (1 - t / 100));
      c.offer = { pct: t, amount, price: c.price, at: now };
      c.notes.push({ id: CRM.newId(), at: now, text: `🤝 Proposé ${money(amount)} (${String(t).replace('.', ',')} % · comm. ${money(v * t / 100)}) — prix demandé ${c.price}` });
    } else if (c.offer && c.offer.pct === t) { delete c.offer; }
    CRM.upsert(c); renderFiche(false);
  }
  function renderProp(c) {
    const el = document.getElementById('pd-prop'); if (!el) return;
    const lc = lastCall(c), n = (c.calls || []).length;
    const fu = c.nextFollowUp ? (c.nextFollowUp <= today() ? `<div class="pd-fu due">🔔 À rappeler ${c.nextFollowUp === today() ? "aujourd'hui" : 'depuis le ' + fmtD(c.nextFollowUp)}</div>` : `<div class="pd-fu">🔔 Prochain rappel : ${fmtD(c.nextFollowUp)}</div>`) : '';
    el.innerHTML = `
      ${thumb(c.id) ? `<img class="pd-photo" src="${thumb(c.id)}" alt="">` : '<div class="pd-photo pr-nothumb">🏠</div>'}
      <div class="pd-price">${e(c.price || '')} <span>${e(c.ptype || '')}${c.rooms ? ' · ' + e(c.rooms) + ' ch.' : ''}</span></div>
      ${c.priceDropAt && c.prevPrice ? `<div class="pd-drop">🔻 Baisse de prix le ${new Date(c.priceDropAt).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })} · avant ${e(c.prevPrice)}</div>` : ''}
      ${offerCalc(c)}
      <div class="pd-addr">${e(c.name)}</div>
      <div class="crm-muted">${e((c.address || '').replace(c.name + ', ', ''))}${c.listingNo ? ' · DuProprio #' + e(c.listingNo) : ''}</div>
      ${c.dnc ? '<div class="crm-dnc-banner">⛔ Ne pas appeler</div>' : c.phone ? `<a class="dial-call" href="tel:${String(c.phone).replace(/[^\d+]/g, '')}" onclick="CRM.touch && CRM.touch()">📞 Appeler ${e(c.phone)}</a>` : '<div class="pd-nophone">📵 Pas de téléphone sur la fiche — contacte-le via DuProprio</div>'}
      ${c.isContact ? `<div class="pd-contact ok">✓ Dans tes contacts <span>POT-${e(c.owner || 'Proprio')} - ${e(c.name)}</span><button onclick="Prospect.toContact(true)">📲 Renvoyer au téléphone</button></div>`
        : `<button class="pd-contact-btn" onclick="Prospect.toContact()">📇 Ajouter à mes contacts <span>POT-${e(c.owner || '…')} - ${e(c.name)}</span></button>`}
      <div class="pd-facts">
        <div>Propriétaire<b><input value="${e(c.owner || '')}" placeholder="nom ?" onchange="Prospect.set('owner', this.value)"></b></div>
        <div>Étape<b>${e(c.stage || 'À appeler')}</b></div>
        <div>Prochain rappel<b>${c.nextFollowUp ? fmtD(c.nextFollowUp) : '—'}</b></div>
        <div>Appels<b>${n ? n + ' essai' + (n > 1 ? 's' : '') : 'jamais appelé'}</b></div>
      </div>
      ${lc ? `<div class="crm-muted" style="margin-top:6px">Dernier : ${OUTL[lc.outcome] || ''} · ${new Date(lc.at).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })}</div>` : ''}
      ${!c.dncChecked && !c.dnc && c.phone ? `<div class="dial-warn">LNNTE non vérifiée · <a href="https://lnnte-dncl.gc.ca/" target="_blank" rel="noopener">vérifier</a> · <button onclick="Prospect.set('dncChecked', true)">✓ Vérifiée</button></div>` : ''}
      ${fu}
      <div class="pd-stages">${['À appeler', 'Appelé – rappeler', 'Intéressé', 'Rendez-vous', 'Signé', 'Pas intéressé'].map(s => `<button class="${(c.stage || 'À appeler') === s ? 'on' : ''}" onclick="Prospect.set('stage', ${JSON.stringify(s).replace(/"/g, '&quot;')})">${s === 'Signé' ? '✍️ Signé' : e(s)}</button>`).join('')}</div>
      <div class="pd-links">${c.dpUrl ? `<a href="${e(c.dpUrl)}" target="_blank" rel="noopener">🏠 Annonce DuProprio</a>` : ''}<button onclick="CRM.open('${c.id}')">Fiche contact complète</button>
        <label class="pd-dnc"><input type="checkbox" ${c.dnc ? 'checked' : ''} onchange="Prospect.set('dnc', this.checked)"> ⛔ Ne pas appeler</label></div>`;
  }
  async function loadPdfView(c) {
    const box = document.getElementById('pd-pages'); if (!box) return;
    let blob = null;
    try { blob = await getPdf(c.id); } catch (x) {}
    if (cur !== c.id) return;
    if (!blob) { box.innerHTML = `<div class="pd-wait">📄 Le PDF complet n'est pas encore sauvegardé pour cette fiche.<br><span class="crm-muted">Réimporte tes PDF du dossier (les fiches existantes ne seront pas dupliquées) : ils seront gardés pour l'ordi et le téléphone.</span>${c.dpUrl ? `<br><a href="${e(c.dpUrl)}" target="_blank" rel="noopener">Voir l'annonce sur DuProprio ↗</a>` : ''}</div>`; return; }
    try {
      const p = await lib();
      const doc = await p.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), verbosity: 0, isEvalSupported: false }).promise;
      box.innerHTML = '';
      const w = Math.max(280, box.clientWidth - 16), dpr = Math.min(2, window.devicePixelRatio || 1);
      for (let n = 1; n <= doc.numPages; n++) {
        if (cur !== c.id) return;
        const page = await doc.getPage(n);
        const vp0 = page.getViewport({ scale: 1 }), scale = w / vp0.width, vp = page.getViewport({ scale: scale * dpr });
        const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; cv.style.width = w + 'px'; cv.className = 'pd-page';
        box.appendChild(cv);
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      }
    } catch (x) { box.innerHTML = `<div class="pd-wait">Impossible d'afficher le PDF (${e(x.message || x)}).</div>`; }
  }
  async function big() { const b = cur && await getPdf(cur); if (b) window.open(URL.createObjectURL(b), '_blank'); }
  // notes : enregistrement automatique (comme OneNote)
  function typed() { const s = document.getElementById('pd-saved'); if (s) { s.textContent = '…'; s.classList.add('busy'); } clearTimeout(saveT); saveT = setTimeout(flushNote, 700); }
  function flushNote() {
    clearTimeout(saveT);
    const ta = document.getElementById('pd-note'); if (!ta || !cur) return;
    const c = CRM._all()[cur]; if (!c || (c.pnotes || '') === ta.value) { const s = document.getElementById('pd-saved'); if (s) { s.textContent = 'enregistré automatiquement'; s.classList.remove('busy'); } return; }
    c.pnotes = ta.value;
    const om = ta.value.match(/^\s*Nom du proprio\s*:\s*(.+)$/mi); if (om && om[1].trim() && om[1].trim() !== c.owner) c.owner = om[1].trim();
    CRM.upsert(c);
    const s = document.getElementById('pd-saved'); if (s) { s.textContent = '✓ enregistré'; s.classList.remove('busy'); }
  }
  function quick(t) {
    const ta = document.getElementById('pd-note'); if (!ta) return;
    const v = ta.value, pre = v && !v.endsWith('\n') ? '\n' : '';
    ta.value = v + pre + t; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); typed();
  }
  function set(k, v) { const c = CRM._all()[cur]; if (!c) return; c[k] = v; if (k === 'dnc' && v) c.nextFollowUp = ''; CRM.upsert(c); if (k === 'owner') renderProp(c); }
  function out(k) {
    flushNote();
    const c = CRM._all()[cur]; if (!c) return;
    const first = (c.pnotes || '').split('\n').map(x => x.trim()).filter(Boolean).slice(-1)[0] || '';
    const ta = document.createElement('textarea'); ta.id = 'pd-tmp'; ta.value = k === 'parle' || k === 'rdv' || k === 'pas_interesse' ? first.slice(0, 160) : ''; ta.style.display = 'none'; document.body.appendChild(ta);
    CRM.logCall(k, { id: c.id, noteId: 'pd-tmp', silent: true }); ta.remove();
    const after = document.getElementById('pd-after');
    if (k === 'parle') {
      after.innerHTML = `<div class="crm-after-q">Quand le rappeler ?</div><div class="chips">${[[3, '3 jours (il réfléchit)'], [7, '1 sem'], [14, '2 sem (pas maintenant)'], [30, '1 mois'], [90, '3 mois']].map(([d, l]) => `<button onclick="Prospect.follow(${d})">${l}</button>`).join('')}<label class="crm-datepick">📅<input type="date" onchange="Prospect.followDate(this.value)"></label></div><label class="crm-cal"><input type="checkbox" id="pd-cal" checked> Ajouter « 📱 Rappeler » à mon agenda</label>`;
      return;
    }
    if (k === 'rdv') { CRM.focus(c.id); CRM.meeting(); return; }
    toastMsg(`${OUTL[k]} — ${c.nextFollowUp ? 'rappel le ' + fmtD(c.nextFollowUp) : 'archivé'} <button onclick="CRM.undoCall('${c.id}')">Annuler</button>`);
  }
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  function followDate(v) { if (!v) return; const d = Math.round((new Date(v + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5); follow(d); }
  function follow(days) {
    const c = CRM._all()[cur]; if (!c) return;
    c.nextFollowUp = addDays(days); CRM.upsert(c);
    const cal = document.getElementById('pd-cal');
    if (cal && cal.checked && window.VoiceCRM && VoiceCRM.reminder) { const d = new Date(); d.setDate(d.getDate() + days); VoiceCRM.reminder(c, { date: d, start: null }).catch(() => {}); }
    document.getElementById('pd-after').innerHTML = '';
    toastMsg(`💬 Parlé — rappel le ${fmtD(c.nextFollowUp)}`);
  }

  // ---------- affichage ----------
  function modal() {
    let m = document.getElementById('pr-modal');
    if (!m) { m = document.createElement('div'); m.id = 'pr-modal'; m.className = 'modal'; m.innerHTML = '<div class="sheet pr-sheet"></div>'; document.body.appendChild(m); }
    return m;
  }
  function closeModal() { const m = document.getElementById('pr-modal'); if (m) m.classList.remove('open'); }
  function toastMsg(t) { if (typeof toast === 'function') toast(t); }
  function pick() { const i = document.getElementById('pr-file'); if (i) { i.value = ''; i.click(); } }

  function render() {
    const root = document.getElementById('prospection'); if (!root) return;
    loadThumbs();
    const L = lists();
    if (!curList || !L.some(l => l.name === curList)) curList = L.length ? L[0].name : null;
    const items = all().filter(c => c.plist === curList);
    const by = { appeler: [], suivi: [], signe: [], archive: [] };
    items.forEach(c => by[colOf(c)].push(c));
    const due = by.suivi.filter(isDue).length;
    let rows = by[col];
    if (q) { const s = q.toLowerCase(); rows = items.filter(c => [c.name, c.address, c.owner, c.phone, c.listingNo, c.price, c.ptype].join(' ').toLowerCase().includes(s)); }
    if (col === 'appeler' && !q) rows.sort((a, b) => (a.porder || 0) - (b.porder || 0));
    else rows.sort((a, b) => (a.nextFollowUp || '9').localeCompare(b.nextFollowUp || '9') || (a.porder || 0) - (b.porder || 0));
    const callable = q ? [] : dialIds();
    const st = (window.CRM && CRM._stats) ? CRM._stats() : null;

    root.innerHTML = `
      <input type="file" id="pr-file" accept="application/pdf,.pdf" multiple style="display:none" onchange="Prospect.importFiles(this.files)">
      <div class="pr-top">
        ${L.length ? `<select class="pr-select" onchange="Prospect.list(this.value)">${L.map(l => `<option ${l.name === curList ? 'selected' : ''} value="${e(l.name)}">${e(l.name)} (${l.n})</option>`).join('')}</select>` : '<b class="pr-title">Prospection</b>'}
        <button class="crm-add" onclick="Prospect.pick()">📥 Importer des PDF</button>
      </div>
      ${!L.length ? `<div class="pr-drop" id="pr-drop">
          <div class="pr-drop-ic">📄</div>
          <b>Glisse ici tes PDF DuProprio</b> (ou touche « Importer des PDF »)<br>
          <span class="crm-muted">Sur l'ordi : ouvre ton dossier <i>Fiche prospection › Sud-Ouest</i>, sélectionne tout (⌘A) et glisse les fichiers ici. L'app lit le prix, l'adresse, le téléphone et la photo de chaque fiche, et crée ta liste dans l'ordre de tes numéros.</span>
        </div>` : `
      ${st ? `<div class="pr-stats"><span><b>${st.d.calls}</b> appels aujourd'hui</span><span><b>${st.d.conv}</b> conversations</span><span><b>${st.d.rdv}</b> RDV</span></div>` : ''}
      <div class="crm-filters pr-cols">${COLS.map(([k, l]) => `<button class="${col === k && !q ? 'on' : ''}" onclick="Prospect.col('${k}')">${l} ${by[k].length}${k === 'suivi' && due ? ` <span class="pr-due">${due} à rappeler</span>` : ''}</button>`).join('')}</div>
      <div class="pr-searchrow"><input class="crm-search" type="search" placeholder="🔍 Adresse, numéro, nom…" value="${e(q)}" oninput="Prospect.search(this.value)"></div>
      ${callable.length ? `<button class="crm-dial" onclick="Prospect.dial()">▶ Appeler ${col === 'suivi' ? 'les rappels dus' : 'la liste'} (${callable.length})</button>` : ''}
      <div class="pr-grid" id="pr-drop">${(() => { nextId = col === 'appeler' && !q ? ((rows.find(c => !(c.calls || []).length && c.phone && !c.dnc) || {}).id || null) : null; return rows.map(card).join(''); })() || `<div class="crm-empty">${col === 'suivi' ? 'Aucun suivi pour l\'instant. Quand tu parles à quelqu\'un, il arrive ici automatiquement.' : col === 'signe' ? 'Aucun contrat signé… pour l\'instant 💪' : col === 'archive' ? 'Rien d\'archivé.' : 'Toute la liste a été appelée 🎉'}</div>`}</div>`}
      <div style="height:90px"></div>`;
    bindDrop(root);
  }
  let nextId = null;
  function card(c) {
    const lc = lastCall(c);
    const nCalls = (c.calls || []).length;
    const done = col === 'appeler' && nCalls > 0 && !isDue(c);   // déjà essayé, pas encore le moment de rappeler
    const isNext = c.id === nextId;
    const fu = c.nextFollowUp ? `<span class="${isDue(c) ? 'crm-due-txt' : ''}">🔔 ${c.nextFollowUp === today() ? "aujourd'hui" : fmtD(c.nextFollowUp)}</span>` : '';
    return `<div class="pr-card${c.dnc ? ' dnc' : ''}${done ? ' done' : ''}${isNext ? ' next' : ''}" onclick="Prospect.open('${c.id}')">
      ${thumbHtml(c, 'pr-thumb')}
      <div class="pr-body">
        <div class="pr-l1">${isNext ? '<span class="pr-next">▶ Prochain</span>' : ''}<span class="pr-no">#${e(c.porder || '')}</span><b>${e(c.price || '')}</b>${c.priceDropAt ? '<span class="pr-drop" title="Baisse de prix">🔻</span>' : ''}${c.isContact ? '<span class="pr-drop" title="Dans tes contacts">📇</span>' : ''}<span class="pr-type">${e(c.ptype || '')}</span></div>
        <div class="pr-addr">${e(c.name)}${c.owner ? ` · <b>${e(c.owner)}</b>` : ''}</div>
        <div class="pr-meta">${c.hood ? e(c.hood) + ' · ' : ''}${c.dnc ? '⛔ Ne pas appeler' : c.phone ? '📞 ' + e(c.phone) : '📵 pas de tél.'}${!c.dncChecked && c.phone && !c.dnc ? ' · <span class="pr-lnnte">LNNTE ?</span>' : ''}</div>
        <div class="pr-meta">${done ? `<span class="pr-done">✓ appelé ${new Date(lc.at).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })}</span> · ` : ''}${lc ? `${OUTL[lc.outcome] || ''} · ${nCalls} essai${nCalls > 1 ? 's' : ''} · ` : ''}${fu ? fu.replace('🔔 ', '🔔 rappel ') : ''}</div>
      </div>
      ${c.phone && !c.dnc ? `<a class="crm-call" href="tel:${String(c.phone).replace(/[^\d+]/g, '')}" onclick="event.stopPropagation()" aria-label="Appeler">📞</a>` : ''}
    </div>`;
  }
  function bindDrop(root) {
    const z = root; if (z._drop) return; z._drop = true;
    z.addEventListener('dragover', ev => { if ([...(ev.dataTransfer.items || [])].some(i => i.kind === 'file')) { ev.preventDefault(); z.classList.add('pr-dragging'); } });
    z.addEventListener('dragleave', ev => { if (ev.target === z) z.classList.remove('pr-dragging'); });
    z.addEventListener('drop', ev => { ev.preventDefault(); z.classList.remove('pr-dragging'); if (ev.dataTransfer.files && ev.dataTransfer.files.length) importFiles(ev.dataTransfer.files); });
  }
  // qui appeler maintenant : « À appeler » = jamais appelés ou rappel dû ; « Suivi » = rappels dus
  function dialIds() {
    if (col !== 'appeler' && col !== 'suivi') return [];
    return all().filter(c => c.plist === curList && colOf(c) === col && c.phone && !c.dnc && (col === 'suivi' ? isDue(c) : (!c.nextFollowUp || isDue(c))))
      .sort((a, b) => col === 'appeler' ? (a.porder || 0) - (b.porder || 0) : (a.nextFollowUp || '').localeCompare(b.nextFollowUp || ''));
  }
  function dial() { if (window.CRM) CRM.dial(dialIds().map(c => c.id)); }
  let rt = null;
  function changed() { clearTimeout(rt); rt = setTimeout(() => { if (cur) { renderFiche(false); return; } const r = document.getElementById('prospection'); if (r && r.classList.contains('active')) render(); }, 150); }

  window.Prospect = {
    offer, toContact,
    render, changed, thumb, thumbHtml, importFiles, confirmImport, closeModal, pick, dial, _parse: parseText,
    open: openFiche, close: closeFiche, step, typed, quick, set, out, follow, followDate, big,
    pane(k) { pane = k; const g = document.querySelector('#pr-dossier .pd-grid'); if (g) g.className = 'pd-grid pane-' + k; document.querySelectorAll('#pr-dossier .pd-tabs button').forEach(b => b.classList.toggle('on', b.getAttribute('onclick').includes("'" + k + "'"))); },
    list(v) { curList = v; ls.set('mb_plist', v); render(); },
    col(k) { col = k; q = ''; render(); },
    search(v) { q = v; render(); const s = document.querySelector('#prospection .crm-search'); if (s) { s.focus(); s.setSelectionRange(v.length, v.length); } }
  };
})();
