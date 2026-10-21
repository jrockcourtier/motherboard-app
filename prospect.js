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
  async function lib() {
    if (pdfjs) return pdfjs;
    pdfjs = await import('/vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.mjs';
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
    const doc = await p.getDocument({ data: new Uint8Array(await file.arrayBuffer()), verbosity: 0, isEvalSupported: false }).promise;
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
    info.file = file.name;
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
      try { res.push(await readPdf(files[i])); } catch (x) { res.push({ file: files[i].name, error: true }); }
      box.querySelector('.pr-prog i').style.width = Math.round((i + 1) / files.length * 100) + '%';
      box.querySelector('#pr-prog-txt').textContent = `${i + 1} / ${files.length} · ${files[i].name}`;
    }
    review(res);
  }
  let pendingImport = [];
  function review(res) {
    pendingImport = res;
    const ok = res.filter(r => !r.error && r.no);
    const known = {}; all().forEach(c => { if (c.listingNo) known[c.listingNo] = c; });
    const listName = mode(ok.map(r => r.list).filter(Boolean)) || defaultListName();
    const nNew = ok.filter(r => !known[r.no]).length, nDup = ok.length - nNew, nBad = res.length - ok.length;
    const noPhone = ok.filter(r => !r.phone).length;
    const box = modal().querySelector('.sheet');
    box.innerHTML = `
      <div class="sheet-head"><button type="button" class="sheet-x" onclick="Prospect.closeModal()">✕</button><b>Importer ${ok.length} fiche${ok.length > 1 ? 's' : ''}</b><button class="sheet-save" onclick="Prospect.confirmImport()">Ajouter</button></div>
      <label class="f-block">Nom de la liste<input id="pr-listname" value="${e(listName)}" autocomplete="off"></label>
      <div class="pr-sum">🆕 <b>${nNew}</b> nouvelle${nNew > 1 ? 's' : ''}${nDup ? ` · ♻️ <b>${nDup}</b> déjà dans tes listes (prix mis à jour)` : ''}${noPhone ? ` · 📵 ${noPhone} sans téléphone sur la fiche` : ''}${nBad ? ` · ⚠️ ${nBad} illisible${nBad > 1 ? 's' : ''}` : ''}</div>
      <div class="pr-rev">${res.map(r => r.error || !r.no ? `<div class="pr-rev-row bad">⚠️ ${e(r.file)} — fiche non reconnue</div>` :
        `<div class="pr-rev-row">${r.thumb ? `<img src="${r.thumb}" alt="">` : '<span class="pr-nothumb">🏠</span>'}<div><b>${r.order ? '#' + r.order + ' · ' : ''}${e(r.price || '')}</b> ${e(r.ptype || '')}<br>${e(r.street || '')} <span class="crm-muted">${e(r.hood || '')}</span><br><span class="crm-muted">${r.phone ? '📞 ' + e(r.phone) : '📵 pas de téléphone'} · DuProprio #${e(r.no)}${known[r.no] ? ' · ♻️ déjà là' : ''}</span></div></div>`).join('')}</div>
      <div class="crm-muted" style="margin-top:8px">Les numéros ne sont pas encore vérifiés à la LNNTE : l'app te le rappellera avant chaque appel.</div>`;
  }
  function mode(arr) { const c = {}; let best = null; arr.forEach(x => { c[x] = (c[x] || 0) + 1; if (!best || c[x] > c[best]) best = x; }); return best; }
  function defaultListName() { const d = new Date(); return 'Liste ' + d.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric' }); }
  function confirmImport() {
    const name = (document.getElementById('pr-listname').value || '').trim() || defaultListName();
    const known = {}; all().forEach(c => { if (c.listingNo) known[c.listingNo] = c; });
    // aussi les proprios déjà au CRM sans liste, par numéro
    if (window.CRM) Object.values(CRM._all()).forEach(c => { if (!c.deleted && c.listingNo && !known[c.listingNo]) known[c.listingNo] = c; });
    const now = new Date().toISOString(), up = [];
    let added = 0, updated = 0, order = Math.max(0, ...all().filter(c => c.plist === name).map(c => c.porder || 0));
    pendingImport.filter(r => !r.error && r.no).forEach(r => {
      const old = known[r.no];
      if (old) {
        if (r.price && old.price && r.price !== old.price) {
          old.notes = old.notes || []; old.notes.push({ id: CRM.newId(), at: now, text: `💲 Prix modifié sur DuProprio : ${old.price} → ${r.price}` });
          old.price = r.price;
        }
        if (r.phone && !old.phone) old.phone = r.phone;
        if (!old.plist) { old.plist = name; old.porder = r.order || ++order; old.importedAt = now; }
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
      if (r.thumb) { thumbs[id] = r.thumb; up.push({ id, data: { t: r.thumb } }); }
    });
    ls.set('mb_thumbs', thumbs);
    uploadThumbs(up);
    curList = name; ls.set('mb_plist', curList); col = 'appeler';
    closeModal(); render();
    toastMsg(`✅ ${added} fiche${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} à « ${name} »${updated ? ` · ${updated} mise${updated > 1 ? 's' : ''} à jour` : ''}`);
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
      <div class="pr-grid" id="pr-drop">${rows.map(card).join('') || `<div class="crm-empty">${col === 'suivi' ? 'Aucun suivi pour l\'instant. Quand tu parles à quelqu\'un, il arrive ici automatiquement.' : col === 'signe' ? 'Aucun contrat signé… pour l\'instant 💪' : col === 'archive' ? 'Rien d\'archivé.' : 'Toute la liste a été appelée 🎉'}</div>`}</div>`}
      <div style="height:90px"></div>`;
    bindDrop(root);
  }
  function card(c) {
    const lc = lastCall(c);
    const nCalls = (c.calls || []).length;
    const fu = c.nextFollowUp ? `<span class="${isDue(c) ? 'crm-due-txt' : ''}">🔔 ${c.nextFollowUp === today() ? "aujourd'hui" : fmtD(c.nextFollowUp)}</span>` : '';
    return `<div class="pr-card${c.dnc ? ' dnc' : ''}" onclick="CRM.open('${c.id}')">
      ${thumbHtml(c, 'pr-thumb')}
      <div class="pr-body">
        <div class="pr-l1"><span class="pr-no">#${e(c.porder || '')}</span><b>${e(c.price || '')}</b><span class="pr-type">${e(c.ptype || '')}</span></div>
        <div class="pr-addr">${e(c.name)}${c.owner ? ` · <b>${e(c.owner)}</b>` : ''}</div>
        <div class="pr-meta">${c.hood ? e(c.hood) + ' · ' : ''}${c.dnc ? '⛔ Ne pas appeler' : c.phone ? '📞 ' + e(c.phone) : '📵 pas de tél.'}${!c.dncChecked && c.phone && !c.dnc ? ' · <span class="pr-lnnte">LNNTE ?</span>' : ''}</div>
        <div class="pr-meta">${lc ? `${OUTL[lc.outcome] || ''}${nCalls > 1 ? ` (${nCalls} appels)` : ''} · ` : ''}${fu}</div>
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
  function changed() { clearTimeout(rt); rt = setTimeout(() => { const r = document.getElementById('prospection'); if (r && r.classList.contains('active')) render(); }, 150); }

  window.Prospect = {
    render, changed, thumb, thumbHtml, importFiles, confirmImport, closeModal, pick, dial, _parse: parseText,
    list(v) { curList = v; ls.set('mb_plist', v); render(); },
    col(k) { col = k; q = ''; render(); },
    search(v) { q = v; render(); const s = document.querySelector('#prospection .crm-search'); if (s) { s.focus(); s.setSelectionRange(v.length, v.length); } }
  };
})();
