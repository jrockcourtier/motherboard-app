// Motherboard — Inscriptions : contrats de courtage (vente), prix et baisses de prix, expiration, commission,
// et passage en transaction quand une promesse d'achat est acceptée.
// Règles de Julien : rappels 30 j, 7 j et le jour de l'expiration · rappel la veille de la mise en marché ·
// commission affichée en % et en montant brut · après une offre acceptée, l'inscription reste visible « Sous condition ».
(function () {
  if (!window.TX || !window.TX._h) return;
  const H = window.TX._h, TX = window.TX;
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s || ''));
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (x) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (x) {} } };
  const { fmtD, money, addD, diffD, today, uuid, countdown } = H;
  const toastMsg = (t, ms) => { if (typeof toast === 'function') toast(t, ms); };
  const pctTxt = (p) => String(p).replace('.', ',') + ' %';
  const STATUS = {
    active:   { label: 'Active', cls: 'on' },
    a_venir:  { label: 'Signée — mise en marché à venir', cls: 'soon' },
    sous_condition: { label: 'Sous condition', cls: 'cond' },
    vendue:   { label: 'Vendue', cls: 'sold' },
    expiree:  { label: 'Expirée', cls: 'off' },
    retiree:  { label: 'Retirée', cls: 'off' }
  };

  // ---------- données ----------
  let L = ls.get('mb_lst', {}), pending = new Set(ls.get('mb_lst_pending', []));
  const persist = () => { ls.set('mb_lst', L); ls.set('mb_lst_pending', [...pending]); };
  const list = () => Object.values(L).filter(x => !x.deleted);
  function save(x) { x.updatedAt = new Date().toISOString(); L[x.id] = x; pending.add(x.id); persist(); flush(); render(); }
  let flushing = false;
  async function flush() {
    if (flushing || !pending.size) return; flushing = true;
    try {
      const ids = [...pending]; const items = ids.map(id => ({ id, data: L[id], updatedAt: L[id].updatedAt })).filter(i => i.data);
      const r = await fetch('/api/listings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      if (r.ok) { ids.forEach(id => pending.delete(id)); persist(); }
    } catch (x) {}
    flushing = false;
  }
  async function pull() {
    try {
      const r = await fetch('/api/listings', { cache: 'no-store', credentials: 'same-origin' }); if (!r.ok) return;
      const { items } = await r.json();
      (items || []).forEach(it => { const mine = L[it.id], theirs = Object.assign({}, it.data, { id: it.id }); if (!mine || (!pending.has(it.id) && (theirs.updatedAt || '') >= (mine.updatedAt || ''))) L[it.id] = theirs; });
      persist(); render(); flush();
    } catch (x) {}
  }
  const curPrice = (x) => { const h = x.priceHist || []; return h.length ? h[h.length - 1].price : x.price; };
  const isLive = (x) => (x.status || 'active') === 'active' || x.status === 'a_venir';
  const statusOf = (x) => { const s = x.status || 'active'; if (s === 'active' && x.marketingDate && x.marketingDate > today()) return 'a_venir'; if ((s === 'active' || s === 'a_venir') && x.expiresAt && x.expiresAt < today()) return 'expiree'; return s; };

  // ---------- lecture du contrat de courtage exclusif – vente (OACIQ CCVE) ----------
  function parseCC(lines) {
    const T = lines.map(l => l.t);
    const find = (rx, from = 0) => { for (let i = from; i < T.length; i++) if (rx.test(T[i])) return i; return -1; };
    const clean = (s) => String(s || '').replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const num = (s) => { const m = String(s || '').replace(/\s*\|\s*/g, ' ').match(/(\d{1,3}(?:[  ]\d{3})+|\d+)(?:,\d\d)?/); return m ? +m[1].replace(/[^\d]/g, '') : 0; };
    const r = { warnings: [], sellers: [] };
    if (!/CONTRAT DE COURTAGE/i.test(T.slice(0, 6).join(' '))) r.warnings.push("Ce PDF ne ressemble pas à un contrat de courtage de l'OACIQ : vérifie bien chaque champ.");
    // vendeurs : 2 colonnes (gauche = vendeur 1, droite = vendeur 2) — seulement nom, téléphone, courriel (aucune pièce d'identité n'est lue)
    const iv = find(/^IDENTIFICATION DU VENDEUR/);
    if (iv >= 0) {
      const col = (it, left) => clean(it.filter(i => left ? i.x < 300 : i.x >= 300).map(i => i.s).join(' '));
      const nameL = lines[iv + 1], phL = lines.slice(iv + 1, iv + 6).find(l => /\d{3}[-. ]\d{3}[-. ]\d{4}/.test(l.t)), emL = lines.slice(iv + 1, iv + 7).find(l => /@/.test(l.t));
      [true, false].forEach(left => {
        const name = nameL ? col(nameL.it, left) : '';
        if (!name || /^NOM,/.test(name) || /\d/.test(name)) return;
        const ph = phL ? (col(phL.it, left).match(/\d{3}[-. ]\d{3}[-. ]\d{4}/) || [''])[0] : '';
        const em = emL ? (col(emL.it, left).match(/[^\s@]+@[^\s@]+\.[^\s@]+/) || [''])[0] : '';
        r.sellers.push({ name, phone: ph, email: em });
      });
    }
    const ad = find(/^NUMÉRO \| RUE \| VILLE/); if (ad > 0) r.address = clean(T[ad - 1]).replace(/,\s*Qc,?/i, ',').replace(/\s+,/g, ',');
    // prix demandé (4.1)
    const p41 = find(/^4\.1 \| Le prix de vente demandé/); if (p41 >= 0) { for (let k = p41; k < p41 + 3; k++) { const n = num((T[k].match(/\(\s*\|?(.*?)\$/) || [])[1]); if (n > 1000) { r.price = n; break; } } }
    // fin du contrat (2.1) : « prend fin à 23 h 59, le … »
    const fin = find(/prend fin à 23 h 59/); if (fin >= 0) for (let k = fin - 2; k <= fin; k++) { const d = H.frDate(T[k]); if (d) { r.expiresAt = d; break; } }
    // rétribution (7.1) : % ou somme forfaitaire
    const c71 = find(/^7\.1 \|/);
    if (c71 >= 0) {
      for (let k = c71 + 1; k < c71 + 4; k++) { const m = T[k].match(/(\d{1,2}(?:[,.]\d{1,3})?)\s*$/); if (m && /pour cent/.test(T[k + 1] || '')) { r.commissionPct = +m[1].replace(',', '.'); break; } }
      if (!r.commissionPct) { const fk = find(/somme forfaitaire de/, c71); if (fk >= 0 && fk < c71 + 8) { const n = num((T[fk + 1] || '').match(/\((.*?)\$/) ? T[fk + 1].match(/\((.*?)\$/)[1] : ''); if (n) r.commissionFlat = n; } }
    }
    // partage avec le courtier collaborateur (7.3)
    const c73 = find(/^7\.3 \|/);
    if (c73 >= 0) for (let k = c73 + 1; k < c73 + 10; k++) { if (/pour cent/.test(T[k]) && /\d/.test(T[k - 1])) { const m = T[k - 1].match(/(\d{1,2}(?:[,.]\d{1,3})?)\s*$/); if (m) { r.collabPct = +m[1].replace(',', '.'); break; } } }
    // date de mise en marché reportée (11.2) : « au plus tard le 10 juin 2026 »
    const all = clean(T.join(' | '));
    const mk = all.match(/reporter la mise en marché[\s\S]{0,320}?au plus tard le (\d{1,2} \S+ \d{4})/i) || all.match(/mise en marché[\s\S]{0,200}?au plus tard le (\d{1,2} \S+ \d{4})/i); if (mk) r.marketingDate = H.frDate(mk[1]);
    // date de signature : « Finalisé le 2026-06-03 » (signature électronique), sinon date de vérification d'identité (1.1)
    const fz = all.match(/Finalisé le (\d{4}-\d{2}-\d{2})/); if (fz) r.signedAt = fz[1];
    else { const v11 = find(/^1\.1 \| La vérification de l.identité/); if (v11 > 0) r.signedAt = H.frDate(T[v11 - 1]); }
    // délai de signature de l'acte (5.1)
    const a51 = find(/^5\.1 \|/); if (a51 > 0) { const m = (T[a51 - 1] + ' ' + T[a51]).match(/(\d{1,3})\s*\|?\s*jours/); if (m) r.deedDelay = +m[1]; }
    const n11 = find(/^11\. \| AUTRES DÉCLARATIONS/), n12 = find(/^12\. \| ANNEXES/);
    if (n11 >= 0 && n12 > n11) r.otherText = clean(T.slice(n11 + 1, n12).filter(t => !/^(\(v\d|L.OACIQ|Généré par|I \| NFO|INFO OACIQ|11\.[12]$)|©/i.test(t)).join(' ')).slice(0, 1500);
    if (!r.expiresAt) r.warnings.push("Date de fin du contrat non trouvée : entre-la à la main.");
    if (!r.commissionPct && !r.commissionFlat) r.warnings.push('Rétribution non trouvée : entre le pourcentage à la main.');
    if (!r.signedAt) r.warnings.push('Date de signature non lisible : vérifie-la.');
    return r;
  }

  // ---------- rappels ----------
  function milestones(x) {
    const out = []; if (!x.expiresAt) return out;
    const live = isLive(x) || statusOf(x) === 'a_venir';
    if (live) {
      [[30, '⏳', 'Contrat de courtage expire dans 30 jours'], [7, '⚠️', 'Contrat de courtage expire dans 7 jours'], [0, '🚨', "Contrat de courtage expire AUJOURD'HUI (23 h 59)"]].forEach(([n, ic, l]) => {
        const d = addD(x.expiresAt, -n); out.push({ key: 'exp' + n, icon: ic, label: l, date: d, hour: '23:59', urgent: n <= 7 });
      });
      if (x.marketingDate && addD(x.marketingDate, -1) >= today()) out.push({ key: 'mkt', icon: '📸', label: `Mise en marché demain (${fmtD(x.marketingDate)}) — Centris, photos, pancarte`, date: addD(x.marketingDate, -1), hour: '10:00', task: true });
    }
    out.forEach(m => { m.closed = !!(x.done || {})[m.key]; });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  function evBody(x, m) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const st = new Date(m.date + 'T00:00:00'); const sl = m.slot != null ? m.slot : (m.task ? 600 : 570); st.setHours(Math.floor(sl / 60), sl % 60, 0, 0);
    const en = new Date(st.getTime() + 30 * 60000);
    return {
      summary: `${m.icon} ${m.label} — ${x.address || 'inscription'}`,
      description: [`Inscription — ${x.address || ''}`, x.sellers && x.sellers.length ? 'Vendeur(s) : ' + x.sellers.map(s => s.name).join(', ') : '', `Prix actuel : ${money(curPrice(x))}`, `Fin du contrat : ${fmtD(x.expiresAt, true)} à 23 h 59`, 'Créé par Motherboard'].filter(Boolean).join('\n'),
      colorId: m.task ? '6' : m.urgent ? '11' : '5',
      start: { dateTime: st.toISOString(), timeZone: tz }, end: { dateTime: en.toISOString(), timeZone: tz },
      extendedProperties: { private: { mbType: m.task ? 'tache' : 'urgent', mbTx: x.id, mbKey: m.key } },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] }
    };
  }
  async function syncCalendar(x) {
    const old = x.events || {}, next = {}; let ok = 0, bad = 0;
    const ms = milestones(x).filter(m => !m.closed && m.date >= today());
    const busy = {};
    for (const m of ms) { if (!busy[m.date]) busy[m.date] = await H.busyOn(m.date); m.slot = H.freeSlot(busy[m.date], m.task ? 600 : 570); busy[m.date].push([m.slot, m.slot + 30]); }
    for (const m of ms) {
      try {
        const body = evBody(x, m), prev = old[m.key]; let res = null;
        if (prev) res = await H.gReq('PUT', `calendars/${encodeURIComponent(prev.cal)}/events/${encodeURIComponent(prev.id)}`, body);
        if (!res || !res.id) res = await H.gReq('POST', `calendars/${encodeURIComponent(H.calId())}/events`, body);
        if (res && res.id) { next[m.key] = { cal: prev && res.id === prev.id ? prev.cal : H.calId(), id: res.id, slot: m.slot }; ok++; } else bad++;
      } catch (z) { bad++; }
    }
    for (const k of Object.keys(old)) if (!next[k]) { try { await H.gReq('DELETE', `calendars/${encodeURIComponent(old[k].cal)}/events/${encodeURIComponent(old[k].id)}`); } catch (z) {} }
    x.events = next; save(x);
    if (typeof ensureLoaded === 'function') try { ensureLoaded(true); } catch (z) {}
    return { ok, bad };
  }

  // ---------- affichage ----------
  function modal() {
    let m = document.getElementById('lst-modal');
    if (!m) { m = document.createElement('div'); m.id = 'lst-modal'; m.className = 'modal'; m.innerHTML = '<div class="sheet tx-sheet"></div>'; document.body.appendChild(m); m.addEventListener('click', ev => { if (ev.target === m) close(); }); }
    return m;
  }
  function close() { const m = document.getElementById('lst-modal'); if (m) m.classList.remove('open'); }
  function commLine(x, price) {
    const p = price || curPrice(x);
    if (x.commissionPct && p) {
      const tot = p * x.commissionPct / 100;
      if (!x.collabPct) return `💰 ${pctTxt(x.commissionPct)} × ${money(p)} = <b>${money(tot)}</b> <span class="crm-muted">(+ taxes)</span>`;
      const mine = Math.max(0, x.commissionPct - x.collabPct);
      return `<div class="lst-split"><div><span>Total</span><b>${pctTxt(x.commissionPct)} · ${money(tot)}</b></div><div><span>Courtier collaborateur</span><b>${pctTxt(x.collabPct)} · ${money(p * x.collabPct / 100)}</b></div><div class="mine"><span>💰 Ma part</span><b>${pctTxt(+mine.toFixed(3))} · ${money(p * mine / 100)}</b></div></div><div class="crm-muted" style="font-size:12px">Sur ${money(p)}, + taxes. Si l'acheteur n'a pas de courtier, ta part est le total.</div>`;
    }
    if (x.commissionFlat) return `💰 Forfait <b>${money(x.commissionFlat)}</b> <span class="crm-muted">(+ taxes)</span>`;
    return '';
  }
  function badge(x) { const s = statusOf(x); return `<span class="lst-st ${STATUS[s].cls}">${STATUS[s].label}</span>`; }
  function render() {
    const root = document.getElementById('inscriptions'); if (!root) return;
    const order = { active: 0, a_venir: 1, sous_condition: 2, expiree: 3, vendue: 4, retiree: 5 };
    const all = list().sort((a, b) => (order[statusOf(a)] - order[statusOf(b)]) || (a.expiresAt || '').localeCompare(b.expiresAt || ''));
    const up = [];
    all.forEach(x => milestones(x).forEach(m => { if (!m.closed && m.date >= addD(today(), -1) && diffD(today(), m.date) <= 45) up.push(Object.assign({ x }, m)); }));
    up.sort((a, b) => a.date.localeCompare(b.date));
    root.innerHTML = `
      <input type="file" id="lst-file" accept="application/pdf,.pdf" style="display:none" onchange="LST.importFile(this.files[0]);this.value=''">
      <input type="file" id="lst-pa" accept="application/pdf,.pdf" style="display:none" onchange="LST.paFile(this.files[0]);this.value=''">
      <div class="tx-top"><b class="pr-title">Inscriptions</b><span style="flex:1"></span>
        <button class="crm-add" onclick="document.getElementById('lst-file').click()">📥 Importer un contrat de courtage (PDF)</button>
        <button class="crm-add tx-new" onclick="LST.edit()">+ Inscription</button></div>
      ${up.length ? `<div class="section-title">⏰ À venir</div><div class="tx-list">${up.slice(0, 10).map(m => msRow(m.x, m, true)).join('')}</div>` : ''}
      <div class="section-title">Inscriptions (${all.length})</div>
      ${all.length ? all.map(card).join('') : `<div class="crm-empty"><b>Aucune inscription pour l'instant.</b><br>Importe ton contrat de courtage (PDF) : l'app lit le prix, la date d'expiration et ta rétribution.<br><button class="cta-btn" onclick="document.getElementById('lst-file').click()">📥 Importer un contrat de courtage</button></div>`}
      <div style="height:90px"></div>`;
  }
  function msRow(x, m, withAddr) {
    const cd = countdown(m.date);
    return `<div class="tx-ms ${m.task ? 'task' : ''} ${cd.cls}${m.closed ? ' closed' : ''}" onclick="LST.open('${x.id}')">
      <div class="tx-ms-d"><b>${fmtD(m.date)}</b><span>${m.task ? 'tâche' : 'rappel'}${m.placed != null || (x.events && x.events[m.key]) ? ' · ' + H.hh(Math.floor(((x.events[m.key] || {}).slot || 570) / 60) + ':' + String(((x.events[m.key] || {}).slot || 570) % 60).padStart(2, '0')) : ''}</span></div>
      <div class="tx-ms-b"><div>${m.icon} ${e(m.label)}</div>${withAddr ? `<div class="crm-muted">${e(x.address || '')}</div>` : ''}</div>
      <div class="tx-ms-c">${m.closed ? '✓' : `<span class="tx-cd">${cd.t}</span><button onclick="event.stopPropagation();LST.done('${x.id}','${m.key}')" title="Fait">✓</button>`}</div></div>`;
  }
  function card(x) {
    const p = curPrice(x), dropped = (x.priceHist || []).length && p < x.price;
    const days = x.expiresAt ? diffD(today(), x.expiresAt) : null;
    return `<div class="tx-card" onclick="LST.open('${x.id}')">
      <div class="tx-l1">${badge(x)}<b>${e(x.address || 'Inscription sans adresse')}</b><span class="tx-price">${dropped ? '🔻 ' : ''}${money(p)}</span></div>
      <div class="crm-muted">${(x.sellers || []).length ? '👤 ' + e(x.sellers.map(s => s.name).join(' et ')) + ' · ' : ''}${x.expiresAt ? `fin du contrat ${fmtD(x.expiresAt)}${isLive(x) && days != null ? ` (${days < 0 ? 'expiré' : days === 0 ? "aujourd'hui" : 'dans ' + days + ' j'})` : ''}` : ''}</div>
      <div class="lst-comm">${x.commissionPct && x.collabPct ? `💰 Ma part <b>${pctTxt(+(x.commissionPct - x.collabPct).toFixed(3))} · ${money(curPrice(x) * (x.commissionPct - x.collabPct) / 100)}</b> <span class="crm-muted">(total ${pctTxt(x.commissionPct)} · ${money(curPrice(x) * x.commissionPct / 100)}, collaborateur ${pctTxt(x.collabPct)})</span>` : commLine(x)}</div>
      ${x.txId && window.TX && TX._all()[x.txId] ? `<div class="tx-next">🤝 Offre acceptée le ${fmtD(TX._all()[x.txId].acceptedAt)} — ${money(TX._all()[x.txId].price)}</div>` : ''}
    </div>`;
  }
  function open(id) {
    const x = L[id]; if (!x) return;
    const box = modal().querySelector('.sheet');
    const p = curPrice(x), tx = x.txId && window.TX ? TX._all()[x.txId] : null, s = statusOf(x);
    box.innerHTML = `
      <div class="sheet-head"><button type="button" class="sheet-x" onclick="LST.close()">✕</button><b>${e(x.address || 'Inscription')}</b><span class="sheet-acts"><button class="sheet-trash" onclick="LST.del('${x.id}')" title="Supprimer">🗑</button><button class="sheet-save" onclick="LST.edit('${x.id}')">Modifier</button></span></div>
      <div class="tx-sum">${badge(x)}<br>${(x.sellers || []).map(v => `👤 <b>${e(v.name)}</b>${v.phone ? ` · <a href="tel:${v.phone.replace(/[^\d]/g, '')}">${e(v.phone)}</a>` : ''}${v.email ? ` · ${e(v.email)}` : ''}`).join('<br>')}</div>
      <div class="pd-facts lst-facts">
        <div>Prix actuel<b>${money(p)}</b></div>
        <div>Prix initial<b>${money(x.price)}</b></div>
        <div>Contrat signé<b>${x.signedAt ? fmtD(x.signedAt) : '—'}</b></div>
        <div>Fin du contrat<b>${x.expiresAt ? fmtD(x.expiresAt) + ' · 23 h 59' : '—'}</b></div>
        ${x.marketingDate ? `<div>Mise en marché<b>${fmtD(x.marketingDate)}</b></div>` : ''}
        ${x.deedDelay ? `<div>Acte de vente<b>${x.deedDelay} jours</b></div>` : ''}
      </div>
      <div class="lst-comm big">${commLine(x)}</div>
      ${tx ? `<div class="tx-info">🤝 Offre acceptée le <b>${fmtD(tx.acceptedAt, true)}</b> à <b>${money(tx.price)}</b>${tx.commissionPct ? ` · ta part ${String(tx.commissionPct).replace('.', ',')} % = ${money(tx.price * tx.commissionPct / 100)} (+ taxes)` : ''}<br><button class="tx-link" onclick="LST.close();showTab({target:document.querySelector('.tab-btn[onclick*=transactions]')},'transactions');TX.open('${tx.id}')">Voir la transaction et ses dates limites →</button></div>` : ''}
      <div class="tx-actions">
        ${isLive(x) || s === 'expiree' ? `<button onclick="LST.drop('${x.id}')">🔻 Baisse de prix</button><button class="lst-offer" onclick="LST.offer('${x.id}')">🤝 Offre d'achat acceptée</button><button onclick="LST.extend('${x.id}')">🔄 Prolonger le contrat</button>` : ''}
        ${x.hasPdf ? `<button onclick="TX.pdf('${x.id}')">📄 Voir le contrat</button>` : ''}
        ${window.CRM ? sellerIds(x).map(cid => { const c = CRM._all()[cid]; return c && !c.deleted ? `<button onclick="LST.close();CRM.open('${cid}')">👤 ${e(c.name)}</button>` : ''; }).join('') : ''}
        <button onclick="LST.resync('${x.id}')">📅 Rappels dans l'agenda</button>
      </div>
      <div id="lst-inline"></div>
      ${(x.priceHist || []).length ? `<div class="f-label">Historique de prix</div><div class="tx-note">${[{ at: x.signedAt || x.createdAt, price: x.price, note: 'Prix initial' }].concat(x.priceHist).map(h => `${fmtD(String(h.at).slice(0, 10))} — <b>${money(h.price)}</b>${h.note ? ' · ' + e(h.note) : ''}`).join('<br>')}</div>` : ''}
      <div class="f-label">Statut</div>
      <div class="chips">${['active', 'sous_condition', 'vendue', 'expiree', 'retiree'].map(k => `<button class="${(x.status || 'active') === k ? 'on' : ''}" onclick="LST.setStatus('${x.id}','${k}')">${STATUS[k].label}</button>`).join('')}</div>
      <div class="f-label">Rappels</div>
      <div class="tx-list">${milestones(x).map(m => msRow(x, m, false)).join('') || '<div class="crm-muted">Aucun rappel (inscription non active).</div>'}</div>
      ${x.otherText ? `<div class="f-label">Autres déclarations et conditions (11)</div><div class="tx-note">${e(x.otherText)}</div>` : ''}
      ${x.notes ? `<div class="f-label">Notes</div><div class="tx-note">${e(x.notes)}</div>` : ''}
      <div style="height:16px"></div>`;
    modal().classList.add('open'); box.scrollTop = 0;
  }

  // ---------- formulaire ----------
  let draft = null;
  function edit(id, fromImport) {
    draft = id ? JSON.parse(JSON.stringify(L[id])) : (fromImport || { id: uuid(), status: 'active', sellers: [{ name: '', phone: '', email: '' }], signedAt: today(), createdAt: new Date().toISOString(), _newContact: true });
    renderForm(); modal().classList.add('open'); modal().querySelector('.sheet').scrollTop = 0;
  }
  function contactOpts() {
    if (!window.CRM || !CRM._all) return '';
    return Object.values(CRM._all()).filter(c => !c.deleted && (c.type === 'vendeur' || c.type === 'proprio' || c.isContact)).map(c => `<option value="${c.id}" ${draft.contactId === c.id ? 'selected' : ''}>${e(c.name)}</option>`).join('');
  }
  function renderForm() {
    const d = draft, box = modal().querySelector('.sheet');
    const inp = (k, label, val, extra = '', type = 'text') => `<label class="f-block">${label}<input type="${type}" value="${e(val == null ? '' : val)}" ${extra}></label>`;
    box.innerHTML = `
      <div class="sheet-head"><button type="button" class="sheet-x" onclick="LST.close()">✕</button><b>${d._imp ? 'Vérifie le contrat importé' : L[d.id] ? "Modifier l'inscription" : 'Nouvelle inscription'}</b><button class="sheet-save" onclick="LST.saveForm()">Enregistrer</button></div>
      ${(d._warn || []).map(w => `<div class="tx-warn">⚠️ ${e(w)}</div>`).join('')}
      ${d._imp ? '<div class="tx-info">Vérifie les dates et le prix avec ton contrat avant d\'enregistrer.</div>' : ''}
      ${inp('address', "Adresse de l'immeuble", d.address, `oninput="LST.f('address',this.value)"`)}
      <div class="f-label">Vendeur(s)</div>
      ${(d.sellers || []).map((v, i) => `<div class="tx-cedit"><input placeholder="Nom" value="${e(v.name)}" oninput="LST.sf(${i},'name',this.value)" style="flex:1 1 160px"><input placeholder="Téléphone" inputmode="tel" value="${e(v.phone)}" oninput="LST.sf(${i},'phone',this.value)" style="flex:1 1 120px"><input placeholder="Courriel" inputmode="email" value="${e(v.email)}" oninput="LST.sf(${i},'email',this.value)" style="flex:1 1 160px"><button class="tx-cdel" onclick="LST.sdel(${i})">✕</button></div>`).join('')}
      <div class="chips" style="margin-top:6px"><button onclick="LST.sadd()">+ Vendeur</button></div>
      <label class="f-block">Lier à une fiche contact<select onchange="LST.f('contactId',this.value);LST.f('_newContact',!this.value)"><option value="">— ${d.contactId ? '' : 'aucune'}</option>${contactOpts()}</select></label>
      ${!d.contactId ? `<label class="f-check"><input type="checkbox" ${d._newContact !== false ? 'checked' : ''} onchange="LST.f('_newContact',this.checked)"> Créer la fiche du vendeur dans mes contacts</label>` : ''}
      <div class="f-row"><label style="flex:1">Prix demandé<input inputmode="numeric" value="${d.price ? Math.round(d.price).toLocaleString('fr-CA') : ''}" oninput="LST.f('price',+this.value.replace(/[^\\d]/g,''))"></label>
        <label style="flex:1">Rétribution (%)<input inputmode="decimal" value="${d.commissionPct != null ? String(d.commissionPct).replace('.', ',') : ''}" placeholder="ex. 3,5" oninput="LST.f('commissionPct',this.value?+this.value.replace(',','.'):null)"></label></div>
      <div class="f-row"><label style="flex:1">Contrat signé le<input type="date" value="${d.signedAt || ''}" onchange="LST.f('signedAt',this.value)"></label>
        <label style="flex:1">Fin du contrat (23 h 59)<input type="date" value="${d.expiresAt || ''}" onchange="LST.f('expiresAt',this.value)"></label></div>
      <div class="f-row"><label style="flex:1">Mise en marché au plus tard<input type="date" value="${d.marketingDate || ''}" onchange="LST.f('marketingDate',this.value)"></label>
        <label style="flex:1">Partage collaborateur (%)<input inputmode="decimal" value="${d.collabPct != null ? String(d.collabPct).replace('.', ',') : ''}" placeholder="ex. 2" oninput="LST.f('collabPct',this.value?+this.value.replace(',','.'):null)"></label></div>
      <div class="lst-comm big" id="lst-prev">${commLine(d, d.price)}</div>
      ${d.otherText != null ? `<label class="f-block">Autres déclarations et conditions (11)<textarea rows="3" oninput="LST.f('otherText',this.value)">${e(d.otherText || '')}</textarea></label>` : ''}
      <label class="f-block">Notes<textarea rows="2" oninput="LST.f('notes',this.value)">${e(d.notes || '')}</textarea></label>
      <label class="f-check" style="margin-top:12px"><input type="checkbox" id="lst-cal" checked> Rappels dans mon agenda : 30 j, 7 j et le jour de l'expiration${d.marketingDate ? ' + la veille de la mise en marché' : ''}</label>
      <div style="height:20px"></div>`;
  }
  function f(k, v) { draft[k] = v; const el = document.getElementById('lst-prev'); if (el && (k === 'price' || k === 'commissionPct')) el.innerHTML = commLine(draft, draft.price); if (k === 'contactId' || k === 'marketingDate') renderForm(); }
  function sf(i, k, v) { draft.sellers[i][k] = v; }
  function sadd() { draft.sellers = draft.sellers || []; draft.sellers.push({ name: '', phone: '', email: '' }); renderForm(); }
  function sdel(i) { draft.sellers.splice(i, 1); renderForm(); }
  async function saveForm() {
    const d = draft; if (!d.address) { toastMsg("Entre l'adresse de l'immeuble."); return; }
    if (!d.expiresAt) { toastMsg('Entre la date de fin du contrat.'); return; }
    d.sellers = (d.sellers || []).filter(v => v.name || v.phone);
    const wantCal = document.getElementById('lst-cal') && document.getElementById('lst-cal').checked;
    const file = d._file, mkContact = d._newContact !== false && !d.contactId; ['_file', '_warn', '_imp', '_newContact'].forEach(k => delete d[k]);
    // une fiche contact par vendeur (Catherine et Marco = deux personnes)
    linkSellers(d, mkContact);
    save(d);
    if (file) H.uploadPdf(d.id, file).then(ok => { if (ok) { d.hasPdf = true; save(d); } });
    close();
    if (wantCal) { toastMsg('📅 Création des rappels…'); const r = await syncCalendar(d); toastMsg(r.bad ? `⚠️ ${r.ok} rappel(s) créé(s), ${r.bad} en erreur — connecte Google` : `✅ Inscription enregistrée · ${r.ok} rappel(s) dans ton agenda`, 7000); }
    else toastMsg('✅ Inscription enregistrée');
    render();
  }

  // ---------- fiches des vendeurs ----------
  const normN = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const dig = (v) => String(v || '').replace(/\D/g, '').slice(-10);
  function sellerContact(d, v, create) {
    const all = Object.values(CRM._all()).filter(c => !c.deleted);
    let c = all.find(k => (v.phone && dig(k.phone) && dig(k.phone) === dig(v.phone)) || (normN(v.name).length > 4 && normN(k.name) === normN(v.name)));
    if (c || !create) return c || null;
    const now = new Date().toISOString();
    c = { id: H.uuid(), type: 'vendeur', stage: d.marketingDate && d.marketingDate > today() ? 'CCV signé' : 'En vigueur', name: v.name, phone: v.phone || '', email: v.email || '', address: d.address, price: money(curPrice(d)), commission: d.commissionPct != null ? String(d.commissionPct) : '', source: 'Contrat de courtage', firstContact: (d.signedAt || now).slice(0, 10), lastContact: now.slice(0, 10), notes: [{ id: H.uuid(), at: now, text: `🏷️ Contrat de courtage signé — ${d.address}${d.expiresAt ? ', fin le ' + fmtD(d.expiresAt, true) : ''}` }], calls: [], createdAt: now };
    CRM.upsert(c); return c;
  }
  function linkSellers(d, create) {
    if (!window.CRM || !CRM._all) return;
    const ids = [];
    (d.sellers || []).filter(v => v.name || v.phone).forEach(v => { const c = sellerContact(d, v, create); if (c && !ids.includes(c.id)) ids.push(c.id); });
    if (!ids.length && d.contactId) ids.push(d.contactId);
    d.contactIds = ids; d.contactId = ids[0] || d.contactId || '';
    ids.forEach(id => { const c = CRM._all()[id]; if (c && c.type === 'vendeur' && ['Lead', 'Évaluation'].includes(c.stage)) { c.stage = 'CCV signé'; CRM.upsert(c); } });
  }
  const sellerIds = (x) => (x.contactIds && x.contactIds.length ? x.contactIds : x.contactId ? [x.contactId] : []);
  // correction (v17.1) : une ancienne fiche « Catherine Mongeau et Marco Savard » devient deux fiches
  function splitOld() {
    if (!window.CRM || !CRM._all) return;
    list().forEach(x => {
      if (x.splitV171 || (x.sellers || []).length < 2 || !x.contactId) return;
      const c = CRM._all()[x.contactId];
      if (c && !c.deleted && / et /.test(c.name || '') && (x.sellers || []).every(v => (c.name || '').includes(v.name))) {
        const v = x.sellers[0]; c.name = v.name; c.phone = v.phone || c.phone; c.phone2 = ''; c.email = v.email || c.email; CRM.upsert(c);
      }
      linkSellers(x, true); x.splitV171 = true; save(x);
    });
  }

  // ---------- actions ----------
  async function importFile(file) {
    if (!file) return;
    toastMsg('📄 Lecture du contrat de courtage…');
    try {
      const r = parseCC(await H.readLines(file));
      edit(null, { id: uuid(), status: 'active', address: r.address || '', sellers: r.sellers.length ? r.sellers : [{ name: '', phone: '', email: '' }], price: r.price || 0, commissionPct: r.commissionPct != null ? r.commissionPct : null, commissionFlat: r.commissionFlat || null, collabPct: r.collabPct != null ? r.collabPct : null,
        signedAt: r.signedAt || '', expiresAt: r.expiresAt || '', marketingDate: r.marketingDate || '', deedDelay: r.deedDelay || null, otherText: r.otherText || '', createdAt: new Date().toISOString(), _warn: r.warnings, _imp: true, _file: file, _newContact: true, fileName: file.name });
    } catch (x) { toastMsg("⚠️ Impossible de lire ce PDF (" + (x.message || 'erreur') + "). Crée l'inscription à la main avec « + Inscription ».", 8000); }
  }
  function inline(html) { const el = document.getElementById('lst-inline'); if (el) { el.innerHTML = html; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = el.querySelector('input'); if (i) setTimeout(() => i.focus(), 200); } }
  function drop(id) {
    const x = L[id];
    inline(`<div class="guest-panel"><b>🔻 Nouveau prix</b><div class="guest-row"><input id="lst-np" inputmode="numeric" placeholder="ex. ${Math.round(curPrice(x) * 0.97 / 1000) * 1000}"><input id="lst-nd" type="date" value="${today()}"><button onclick="LST.saveDrop('${id}')">Enregistrer</button></div><div class="f-hint">La commission et les rappels sont recalculés sur le nouveau prix.</div></div>`);
  }
  function saveDrop(id) {
    const x = L[id], n = +String(document.getElementById('lst-np').value).replace(/[^\d]/g, ''), d = document.getElementById('lst-nd').value || today();
    if (!n) { toastMsg('Entre le nouveau prix.'); return; }
    const old = curPrice(x); x.priceHist = (x.priceHist || []).concat([{ at: d, price: n, note: old ? `${n < old ? 'baisse' : 'hausse'} de ${money(Math.abs(old - n))}` : '' }]);
    save(x);
    if (window.CRM) sellerIds(x).forEach(cid => { const c = CRM._all()[cid]; if (c) { c.notes = c.notes || []; c.notes.push({ id: H.uuid(), at: new Date().toISOString(), text: `🔻 Prix ajusté : ${money(old)} → ${money(n)} (${x.address})` }); c.price = money(n); CRM.upsert(c); } });
    open(id); toastMsg(`🔻 Nouveau prix : ${money(n)}${x.commissionPct ? ' · commission ' + money(n * x.commissionPct / 100) : ''}`);
  }
  function extend(id) {
    const x = L[id];
    inline(`<div class="guest-panel"><b>🔄 Nouvelle date de fin du contrat</b><div class="guest-row"><input id="lst-ne" type="date" value="${x.expiresAt ? addD(x.expiresAt, 90) : ''}"><button onclick="LST.saveExtend('${id}')">Enregistrer</button></div><div class="f-hint">Les rappels 30 j / 7 j / jour même sont replacés.</div></div>`);
  }
  async function saveExtend(id) {
    const x = L[id], d = document.getElementById('lst-ne').value; if (!d) return;
    const old = x.expiresAt; x.expiresAt = d; x.done = {}; if (x.status === 'expiree') x.status = 'active';
    x.extensions = (x.extensions || []).concat([{ at: new Date().toISOString(), from: old, to: d }]);
    save(x); open(id); await syncCalendar(x); open(id); toastMsg(`🔄 Contrat prolongé jusqu'au ${fmtD(d, true)}`);
  }
  function offer(id) {
    const x = L[id];
    inline(`<div class="guest-panel"><b>🤝 Offre d'achat acceptée — c'est quoi la promesse d'achat ?</b><div class="f-hint" style="margin:6px 0">Importe le PDF de la promesse d'achat acceptée : l'app crée la transaction avec toutes ses dates limites, liée à cette inscription.</div>
      <div class="chips"><button onclick="window.__lstOffer='${id}';document.getElementById('lst-pa').click()">📥 Importer la promesse d'achat (PDF)</button><button onclick="LST.offerManual('${id}')">✍️ Entrer à la main</button></div></div>`);
  }
  function txPrefill(x) {
    const mine = x.commissionPct ? (x.collabPct ? +(x.commissionPct - x.collabPct).toFixed(3) : x.commissionPct) : null;
    return { kind: 'vente', listingId: x.id, address: x.address, contactId: x.contactId || '', clients: (x.sellers || []).map(s => s.name).filter(Boolean).join(' et '), commissionPct: mine, commTotalPct: x.commissionPct || null, collabPct: x.collabPct || null };
  }
  function paFile(file) {
    const id = window.__lstOffer; window.__lstOffer = null; const x = L[id]; if (!x || !file) return;
    close(); TX.importFile(file, txPrefill(x));
  }
  function offerManual(id) {
    const x = L[id]; close();
    TX.edit(null, Object.assign({ id: H.uuid(), acceptedAt: today(), hour: '19:00', conditions: [], price: curPrice(x), createdAt: new Date().toISOString() }, txPrefill(x)));
  }
  // appelé par Transactions quand le dossier lié est enregistré
  function linkTx(lid, t) {
    const x = L[lid]; if (!x) return;
    x.txId = t.id; if (isLive(x) || statusOf(x) === 'expiree') x.status = 'sous_condition';
    if (window.CRM) sellerIds(x).slice(1).forEach(cid => { const c = CRM._all()[cid]; if (c && !['Vendu / Notaire', 'Client passé'].includes(c.stage)) { c.stage = 'Offre acceptée'; CRM.upsert(c); } });
    save(x); syncCalendar(x).catch(() => {});
  }
  async function setStatus(id, st) { const x = L[id]; x.status = st; save(x); open(id); await syncCalendar(x); open(id); }
  async function done(id, key) { const x = L[id]; x.done = x.done || {}; x.done[key] = new Date().toISOString(); save(x); if (document.getElementById('lst-modal').classList.contains('open')) open(id); await syncCalendar(x); }
  async function resync(id) { const x = L[id]; toastMsg("📅 Mise à jour de l'agenda…"); const r = await syncCalendar(x); open(id); toastMsg(r.bad ? `⚠️ ${r.bad} rappel(s) en erreur — connecte Google` : `✅ ${r.ok} rappel(s) à jour`); }
  function del(id) { inline(`<div class="crm-del">Supprimer cette inscription et ses rappels ? <button class="danger" onclick="LST.doDel('${id}')">Oui, supprimer</button><button onclick="LST.open('${id}')">Annuler</button></div>`); }
  async function doDel(id) {
    const x = L[id]; const evs = x.events || {}; x.deleted = true; x.events = {}; save(x); close();
    for (const k of Object.keys(evs)) { try { await H.gReq('DELETE', `calendars/${encodeURIComponent(evs[k].cal)}/events/${encodeURIComponent(evs[k].id)}`); } catch (z) {} }
    toastMsg('🗑 Inscription supprimée');
  }

  window.LST = { _list: list, _cur: curPrice, _status: statusOf, render, open, close, edit, f, sf, sadd, sdel, saveForm, importFile, drop, saveDrop, extend, saveExtend, offer, paFile, offerManual, linkTx, setStatus, done, resync, del, doDel, _parse: parseCC, _milestones: milestones, _all: () => L };
  render(); pull().then(() => setTimeout(splitOld, 1500));
  window.addEventListener('online', flush);
})();
