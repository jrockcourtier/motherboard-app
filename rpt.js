// Motherboard — Rapport des revenus de l'année + prévision des 3 prochains mois (PDF), pour l'impôt / une saisie.
// Dépenses (budget) gardées dans Supabase (/api/expenses). Rien sur la prospection. Aucune mention de TPS / TVQ.
(function () {
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (x) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (x) {} } };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => ymd(new Date());
  const money = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
  const money0 = (n) => Math.round(n || 0).toLocaleString('fr-CA') + ' $';
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const fmtD = (s, long) => s ? new Date(s + 'T12:00:00').toLocaleDateString('fr-CA', long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' }) : '';
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
  const toastMsg = (t, ms) => { if (typeof toast === 'function') toast(t, ms); };
  const SET_ID = '00000000-0000-4000-8000-000000000001';

  // ---------- données ----------
  let E = ls.get('mb_exp', {}), pending = new Set(ls.get('mb_exp_pending', []));
  const persist = () => { ls.set('mb_exp', E); ls.set('mb_exp_pending', [...pending]); };
  function save(x) { x.updatedAt = new Date().toISOString(); E[x.id] = x; pending.add(x.id); persist(); flush(); }
  let flushing = false;
  async function flush() {
    if (flushing || !pending.size) return; flushing = true;
    try {
      const ids = [...pending]; const items = ids.map(id => ({ id, data: E[id], updatedAt: E[id].updatedAt })).filter(i => i.data);
      const r = await fetch('/api/expenses', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      if (r.ok) { ids.forEach(id => pending.delete(id)); persist(); }
    } catch (x) {}
    flushing = false;
  }
  async function pull() {
    try {
      const r = await fetch('/api/expenses', { cache: 'no-store', credentials: 'same-origin' }); if (!r.ok) return;
      const { items } = await r.json();
      (items || []).forEach(it => { const mine = E[it.id], theirs = Object.assign({}, it.data, { id: it.id }); if (!mine || (!pending.has(it.id) && (theirs.updatedAt || '') >= (mine.updatedAt || ''))) E[it.id] = theirs; });
      persist(); flush();
    } catch (x) {}
  }
  const settings = () => E[SET_ID] || { id: SET_ID, type: 'settings', retenues: [{ label: 'Saisie Revenu Québec', pct: 30, on: true }, { label: 'Saisie Agence du revenu du Canada', pct: 40, on: true }], showPersonal: true };
  const expenses = (scope) => Object.values(E).filter(x => !x.deleted && x.type !== 'settings' && (!scope || x.scope === scope));
  const incl = (scope) => expenses(scope).filter(x => x.include !== false);
  const DEF_PAID = [{ label: 'Saisie Revenu Québec sur mes commissions', pct: 30, on: true }, { label: "Paiements faits à l'Agence du revenu du Canada", amount: 0, on: true }];
  const DEF_DEBTS = [{ label: 'Carte de crédit', balance: 5000, limit: 5000, rate: 14.9, monthly: 0, on: true }, { label: 'Marge de crédit', balance: 5000, limit: 5000, rate: 11.95, monthly: 0, on: true }];
  // paiement entré à la main, sinon intérêts estimés : solde × taux annuel ÷ 12
  const debtM = (d) => +d.monthly ? +d.monthly : (+d.balance || 0) * (+d.rate || 0) / 1200;
  const debtEst = (d) => !+d.monthly && +d.rate > 0;
  const paidOf = (S) => S.paid || JSON.parse(JSON.stringify(DEF_PAID));
  const debtsOf = (S) => S.debts || JSON.parse(JSON.stringify(DEF_DEBTS));
  const sumM = (arr) => arr.reduce((a, x) => a + (+x.monthly || 0), 0);

  // ---------- revenus (transactions) ----------
  const txComm = (t) => (t.commAmount != null && t.commAmount !== '' ? +t.commAmount : t.price && t.commissionPct ? t.price * t.commissionPct / 100 : 0);
  function txState(t) {
    if (t.deleted || t.status === 'annulee' || (t.conditions || []).some(c => c.status === 'nulle')) return 'annulee';
    if (t.status === 'conclue' || (t.deedAt && t.deedAt < today())) return 'conclue';
    return 'cours';
  }
  const KIND = { vente: 'Vendeur', achat: 'Acheteur', double: 'Vendeur et acheteur', location: 'Location', revenu: 'Autre revenu' };
  function figures() {
    const now = new Date(), y = now.getFullYear(), t0 = today();
    const txs = window.TX ? Object.values(TX._all()).filter(t => !t.deleted) : [];
    const done = txs.filter(t => txState(t) === 'conclue' && (t.deedAt || '').slice(0, 4) === String(y)).sort((a, b) => (a.deedAt || '').localeCompare(b.deedAt || ''));
    const byMonth = Array.from({ length: 12 }, () => ({ n: 0, amt: 0 }));
    done.forEach(t => { const m = +(t.deedAt.slice(5, 7)) - 1; byMonth[m].amt += txComm(t); if (t.kind !== 'revenu') byMonth[m].n++; });
    const rev = done.reduce((a, t) => a + txComm(t), 0);
    const start = new Date(y, 0, 1), elapsedDays = Math.round((new Date(t0 + 'T12:00:00') - start) / 864e5) + 1;
    const elapsedM = elapsedDays / (new Date(y, 11, 31) - start > 0 ? (Math.round((new Date(y, 11, 31) - start) / 864e5) + 1) : 365) * 12;
    const S = settings();
    const bizM = sumM(incl('compagnie')), persM = S.showPersonal ? sumM(incl('personnel')) : 0;
    const bizYTD = bizM * elapsedM, net = rev - bizYTD;
    // 3 prochains mois (mois complets à venir)
    const months = [1, 2, 3].map(k => { const d = new Date(y, now.getMonth() + k, 1); return { y: d.getFullYear(), m: d.getMonth(), key: ymd(d).slice(0, 7) }; });
    const winStart = months[0].key + '-01', winEnd = ymd(new Date(months[2].y, months[2].m + 1, 0));
    // les jours restants du mois en cours comptent aussi
    const possibleAll = txs.filter(t => txState(t) === 'cours' && t.deedAt && t.deedAt >= t0 && t.deedAt <= winEnd);
    const posAmt = possibleAll.reduce((a, t) => a + txComm(t), 0);
    const ret = (S.retenues || []).filter(r => r.on && +r.pct > 0);
    const retPct = Math.min(100, ret.reduce((a, r) => a + +r.pct, 0));
    const L = window.LST ? LST._list() : [];
    const lstActive = L.filter(x => ['active', 'a_venir'].includes(LST._status(x)));
    const paid = paidOf(S).filter(p => p.on).map(p => Object.assign({}, p, { amt: p.pct != null && p.pct !== '' ? rev * p.pct / 100 : +p.amount || 0 })).filter(p => p.amt > 0);
    const paidTot = paid.reduce((a, p) => a + p.amt, 0), left = net - paidTot;
    const debts = debtsOf(S).filter(d => d.on && (+d.balance || +d.monthly)), debtsM = debts.reduce((a, d) => a + debtM(d), 0), debtsEst = debts.some(debtEst);
    return { paid, paidTot, left, debts, debtsM, debtsEst, y, t0, done, byMonth, rev, elapsedM, bizM, persM, bizYTD, net, months, winStart, winEnd, possible: possibleAll, posAmt, ret, retPct, lstActive, S, curM: now.getMonth() };
  }

  // ---------- écran de préparation ----------
  function modal() {
    let m = document.getElementById('rpt-modal');
    if (!m) { m = document.createElement('div'); m.id = 'rpt-modal'; m.className = 'modal'; m.innerHTML = '<div class="sheet tx-sheet"></div>'; document.body.appendChild(m); m.addEventListener('click', ev => { if (ev.target === m) close(); }); }
    return m;
  }
  function close() { const m = document.getElementById('rpt-modal'); if (m) m.classList.remove('open'); }
  function rowE(x) {
    return `<div class="rpt-erow${x.include === false ? ' off' : ''}"><input type="checkbox" ${x.include !== false ? 'checked' : ''} onchange="RPT.ef('${x.id}','include',this.checked)" title="Inclure dans le rapport">
      <input class="rpt-lbl" value="${e(x.label)}" onchange="RPT.ef('${x.id}','label',this.value)">
      <input class="rpt-amt" inputmode="decimal" value="${(+x.monthly || 0).toFixed(2).replace('.', ',')}" onchange="RPT.ef('${x.id}','monthly',this.value)" title="Par mois"><span class="rpt-per">/ mois</span>
      <button class="tx-cdel" onclick="RPT.edel('${x.id}')" title="Retirer">✕</button></div>`;
  }
  function openPrep() {
    const F = figures(), S = F.S, box = modal().querySelector('.sheet');
    const grp = (scope) => expenses(scope).sort((a, b) => (a.cat || '').localeCompare(b.cat || '') || (b.monthly - a.monthly)).map(rowE).join('');
    box.innerHTML = `
      <div class="sheet-head"><button type="button" class="sheet-x" onclick="RPT.close()">✕</button><b>📄 Rapport annuel + prévision 3 mois</b><button class="sheet-save" onclick="RPT.preview()">Aperçu du PDF</button></div>
      <div class="tx-info">Revenus de ${F.y} : <b>${money0(F.rev)}</b> (commissions brutes, ${F.done.filter(t => t.kind !== 'revenu').length} transactions conclues) · prévision : ${MOIS[F.months[0].m]} à ${MOIS[F.months[2].m]}.<br>Rien sur la prospection. Vérifie tes dépenses, puis « Aperçu du PDF ».</div>
      <div class="f-label">Dépenses d'entreprise — ${money(sumM(incl('compagnie')))} / mois</div>
      <div class="rpt-elist">${grp('compagnie')}</div>
      <div class="chips"><button onclick="RPT.eadd('compagnie')">+ Dépense d'entreprise</button></div>
      <div class="f-label">Dépenses personnelles de base — ${money(sumM(incl('personnel')))} / mois</div>
      <label class="f-check"><input type="checkbox" ${S.showPersonal ? 'checked' : ''} onchange="RPT.sf('showPersonal',this.checked)"> Inclure le budget personnel dans le rapport (décoche une ligne pour la retirer)</label>
      <div class="rpt-elist">${grp('personnel')}</div>
      <div class="chips"><button onclick="RPT.eadd('personnel')">+ Dépense personnelle</button></div>
      <div class="f-label">Déjà retenu ou payé en ${F.y} — ${money(F.paidTot)}</div>
      ${paidOf(S).map((p, i) => { const isPct = p.pct != null && p.pct !== ''; return `<div class="rpt-erow${p.on ? '' : ' off'}"><input type="checkbox" ${p.on ? 'checked' : ''} onchange="RPT.pf(${i},'on',this.checked)"><input class="rpt-lbl" value="${e(p.label)}" onchange="RPT.pf(${i},'label',this.value)"><input class="rpt-amt" inputmode="decimal" value="${isPct ? String(p.pct).replace('.', ',') : (+p.amount || 0).toFixed(2).replace('.', ',')}" onchange="RPT.pf(${i},'${isPct ? 'pct' : 'amount'}',this.value)"><span class="rpt-per">${isPct ? `% = ${money0(F.rev * p.pct / 100)}` : '$'}</span><button class="tx-cdel" onclick="RPT.pdel(${i})">✕</button></div>`; }).join('')}
      <div class="chips"><button onclick="RPT.padd(0)">+ Paiement ($)</button><button onclick="RPT.padd(1)">+ Retenue (% des commissions)</button></div>
      <div class="f-label">Dettes</div>
      ${debtsOf(S).map((d, i) => `<div class="rpt-erow rpt-debt${d.on ? '' : ' off'}"><input type="checkbox" ${d.on ? 'checked' : ''} onchange="RPT.df(${i},'on',this.checked)"><input class="rpt-lbl" value="${e(d.label)}" onchange="RPT.df(${i},'label',this.value)"><label>solde<input class="rpt-amt" inputmode="decimal" value="${+d.balance || 0}" onchange="RPT.df(${i},'balance',this.value)"></label><label>limite<input class="rpt-amt" inputmode="decimal" value="${+d.limit || 0}" onchange="RPT.df(${i},'limit',this.value)"></label><label>taux %<input class="rpt-amt" inputmode="decimal" value="${String(+d.rate || 0).replace('.', ',')}" onchange="RPT.df(${i},'rate',this.value)"></label><label>paiement / mois<input class="rpt-amt" inputmode="decimal" value="${+d.monthly || ''}" placeholder="${debtEst(d) ? 'estimé ' + Math.round(debtM(d)) : '0'}" onchange="RPT.df(${i},'monthly',this.value)"></label><button class="tx-cdel" onclick="RPT.ddel(${i})">✕</button></div>`).join('')}
      <div class="chips"><button onclick="RPT.dadd()">+ Dette</button></div>
      <div class="f-hint">Laisse « paiement / mois » vide pour utiliser les intérêts estimés (solde × taux ÷ 12). Ce montant compte dans la prévision des 3 mois.</div>
      <div class="f-label">Retenues sur mes commissions à venir (dans la prévision)</div>
      ${(S.retenues || []).map((r, i) => `<div class="rpt-erow${r.on ? '' : ' off'}"><input type="checkbox" ${r.on ? 'checked' : ''} onchange="RPT.rf(${i},'on',this.checked)"><input class="rpt-lbl" value="${e(r.label)}" onchange="RPT.rf(${i},'label',this.value)"><input class="rpt-amt" inputmode="decimal" value="${r.pct}" onchange="RPT.rf(${i},'pct',this.value)"><span class="rpt-per">%</span><button class="tx-cdel" onclick="RPT.rdel(${i})">✕</button></div>`).join('')}
      <div class="chips"><button onclick="RPT.radd()">+ Retenue</button></div>
      <label class="f-block">Note à ajouter au rapport (optionnel, tes mots)<textarea rows="4" placeholder="Ex. : contexte du marché, mois sans revenu, démarches en cours…" onchange="RPT.sf('note',this.value)">${e(S.note || '')}</textarea></label>
      <div style="height:10px"></div>
      <button class="cta-btn" style="width:100%" onclick="RPT.preview()">📄 Aperçu du PDF</button>
      <div style="height:20px"></div>`;
    modal().classList.add('open');
  }
  const num = (v) => +String(v).replace(/[\s $]/g, '').replace(',', '.') || 0;
  function ef(id, k, v) { const x = E[id]; if (!x) return; if (k === 'monthly') { x.monthly = num(v); x.annual = Math.round(x.monthly * 1200) / 100; } else x[k] = v; save(x); openPrep(); }
  function edel(id) { const x = E[id]; if (!x) return; x.deleted = true; save(x); openPrep(); }
  function eadd(scope) { const x = { id: uuid(), scope, cat: scope === 'compagnie' ? 'Autres' : 'Autres', label: 'Nouvelle dépense', monthly: 0, annual: 0, include: true, createdAt: new Date().toISOString() }; save(x); openPrep(); setTimeout(() => { const i = [...document.querySelectorAll('#rpt-modal .rpt-lbl')].find(n => n.value === 'Nouvelle dépense'); if (i) { i.focus(); i.select(); } }, 50); }
  function sf(k, v) { const S = settings(); S[k] = v; save(S); if (k !== 'note') openPrep(); }
  function rf(i, k, v) { const S = settings(); S.retenues = S.retenues || []; S.retenues[i][k] = k === 'pct' ? num(v) : v; save(S); openPrep(); }
  function rdel(i) { const S = settings(); S.retenues.splice(i, 1); save(S); openPrep(); }
  function pf(i, k, v) { const S = settings(); S.paid = paidOf(S); S.paid[i][k] = k === 'pct' || k === 'amount' ? num(v) : v; save(S); openPrep(); }
  function pdel(i) { const S = settings(); S.paid = paidOf(S); S.paid.splice(i, 1); save(S); openPrep(); }
  function padd(pct) { const S = settings(); S.paid = paidOf(S).concat([pct ? { label: 'Retenue', pct: 0, on: true } : { label: 'Paiement', amount: 0, on: true }]); save(S); openPrep(); }
  function df(i, k, v) { const S = settings(); S.debts = debtsOf(S); S.debts[i][k] = ['balance', 'limit', 'monthly', 'rate'].includes(k) ? num(v) : v; save(S); openPrep(); }
  function ddel(i) { const S = settings(); S.debts = debtsOf(S); S.debts.splice(i, 1); save(S); openPrep(); }
  function dadd() { const S = settings(); S.debts = debtsOf(S).concat([{ label: 'Dette', balance: 0, limit: 0, monthly: 0, on: true }]); save(S); openPrep(); }
  function radd() { const S = settings(); S.retenues = (S.retenues || []).concat([{ label: 'Retenue', pct: 0, on: true }]); save(S); openPrep(); }

  // ---------- le rapport ----------
  function reportHtml() {
    const F = figures(), S = F.S;
    const biz = incl('compagnie').sort((a, b) => (a.cat || '').localeCompare(b.cat || '') || b.monthly - a.monthly);
    const pers = S.showPersonal ? incl('personnel').sort((a, b) => (a.cat || '').localeCompare(b.cat || '') || b.monthly - a.monthly) : [];
    const monthsDone = F.curM + 1, avgM = F.rev / F.elapsedM;
    const zeroMonths = F.byMonth.slice(0, monthsDone).filter(m => !m.amt).length;
    const need3 = (F.bizM + F.persM + F.debtsM) * 3; let sec = 0; const H = (t) => `<h2>${++sec}. ${t}</h2>`;
    const retAmt = F.posAmt * F.retPct / 100;
    const s1 = 0 - need3, s2 = F.posAmt - retAmt - need3;
    const per = `${MOIS[F.months[0].m]} ${F.months[0].y} à ${MOIS[F.months[2].m]} ${F.months[2].y}`;
    const tr = (cells, cls = '') => `<tr class="${cls}">${cells.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`;
    const tableE = (arr) => { let cat = null; return arr.map(x => { const h = x.cat !== cat ? (cat = x.cat, `<tr class="cat"><td colspan="3">${e(x.cat || '')}</td></tr>`) : ''; return h + tr([e(x.label), money(x.monthly), money(x.monthly * 12)]); }).join(''); };
    return `<div class="rp">
      <div class="rp-head"><div><div class="rp-name">Julien Rock</div><div class="rp-sub">Courtier immobilier résidentiel · RE/MAX L'Espace · Montréal</div></div>
        <div class="rp-date">Produit le ${fmtD(F.t0, true)}</div></div>
      <h1>Sommaire des revenus ${F.y} et prévision des trois prochains mois</h1>
      <div class="rp-meta">Période couverte : 1<sup>er</sup> janvier au ${fmtD(F.t0, true)} · Prévision : ${per}</div>

      <div class="rp-kpis">
        <div><span>Commissions brutes reçues ${F.y}</span><b>${money0(F.rev)}</b><i>avant frais d'agence et dépenses</i></div>
        <div><span>Dépenses d'entreprise (à ce jour)</span><b>${money0(F.bizYTD)}</b><i>${money0(F.bizM)} par mois</i></div>
        <div><span>Revenu net d'entreprise (à ce jour, avant impôt)</span><b>${money0(F.net)}</b><i>≈ ${money0(F.net / F.elapsedM)} par mois en moyenne</i></div>
        <div><span>Déjà retenu ou payé (saisies et paiements)</span><b>${money0(F.paidTot)}</b><i>${F.paid.map(p => e(p.label.replace(/ sur mes commissions/, ''))).join(' · ') || '—'}</i></div>
        <div class="hl"><span>Reste réellement reçu (à ce jour)</span><b>${money0(F.left)}</b><i>≈ ${money0(F.left / F.elapsedM)} par mois, avant impôt</i></div>
        <div class="hl"><span>Revenus confirmés — ${per}</span><b>0 $</b><i>aucune vente conclue à venir</i></div>
      </div>

      ${H(`Revenus de commissions par mois (${F.y})`)}
      <table class="rp-t"><thead><tr><th>Mois</th><th class="n">Transactions</th><th class="n">Commissions brutes</th></tr></thead><tbody>
        ${F.byMonth.slice(0, monthsDone).map((m, i) => tr([MOIS[i][0].toUpperCase() + MOIS[i].slice(1), m.n || '—', m.amt ? money(m.amt) : '0,00 $'], m.amt ? '' : 'zero')).join('')}
        ${tr(['<b>Total</b>', `<b>${F.done.filter(t => t.kind !== 'revenu').length}</b>`, `<b>${money(F.rev)}</b>`], 'tot')}
      </tbody></table>
      <p class="rp-note">Les revenus d'un courtier immobilier ne sont versés qu'à la signature de l'acte de vente chez le notaire : ils sont irréguliers. ${zeroMonths ? `${zeroMonths} mois sur ${monthsDone} n'ont généré aucun revenu cette année.` : ''}</p>

      ${H(`Transactions conclues en ${F.y}`)}
      <table class="rp-t"><thead><tr><th>Date</th><th>Propriété</th><th>Représentation</th><th class="n">Commission brute</th></tr></thead><tbody>
        ${F.done.map(t => `<tr><td>${fmtD(t.deedAt)}</td><td>${e(t.address || '')}</td><td>${KIND[t.kind] || ''}</td><td class="n">${money(txComm(t))}</td></tr>`).join('')}
        <tr class="tot"><td colspan="3"><b>Total</b></td><td class="n"><b>${money(F.rev)}</b></td></tr>
      </tbody></table>

      ${F.paid.length ? `${H(`Montants déjà retenus ou payés en ${F.y}`)}
      <table class="rp-t"><thead><tr><th>Retenue ou paiement</th><th class="n">Montant</th></tr></thead><tbody>
        ${F.paid.map(p => tr([e(p.label) + (p.pct != null && p.pct !== '' ? ` (${String(p.pct).replace('.', ',')} % de ${money(F.rev)})` : ''), money(p.amt)])).join('')}
        ${tr(['<b>Total</b>', `<b>${money(F.paidTot)}</b>`], 'tot')}
      </tbody></table>
      <p class="rp-note">Ces montants ont été retenus ou payés à même mes commissions : ils ne m'ont pas été disponibles. Après dépenses d'entreprise, il m'est réellement resté ${money(F.left)} depuis le 1<sup>er</sup> janvier, avant impôt.</p>` : ''}

      ${H(`Dépenses d'entreprise (budget ${F.y})`)}
      <table class="rp-t"><thead><tr><th>Dépense</th><th class="n">Par mois</th><th class="n">Par année</th></tr></thead><tbody>
        ${tableE(biz)}
        ${tr(['<b>Total des dépenses d\'entreprise</b>', `<b>${money(F.bizM)}</b>`, `<b>${money(F.bizM * 12)}</b>`], 'tot')}
      </tbody></table>
      <p class="rp-note">Ces dépenses se paient chaque mois, qu'il y ait des ventes ou non.</p>

      ${pers.length ? `${H('Dépenses personnelles de base (budget mensuel)')}
      <table class="rp-t"><thead><tr><th>Dépense</th><th class="n">Par mois</th><th class="n">Par année</th></tr></thead><tbody>
        ${tableE(pers)}
        ${tr(['<b>Total des dépenses personnelles</b>', `<b>${money(F.persM)}</b>`, `<b>${money(F.persM * 12)}</b>`], 'tot')}
      </tbody></table>` : ''}

      ${F.debts.length ? `${H('Dettes en cours')}
      <table class="rp-t"><thead><tr><th>Dette</th><th class="n">Solde</th><th class="n">Limite</th><th class="n">Taux annuel</th><th class="n">Frais mensuels${F.debtsEst ? ' (estimé)' : ''}</th></tr></thead><tbody>
        ${F.debts.map(d => `<tr><td>${e(d.label)}${+d.limit && +d.balance >= +d.limit ? ' <small>(au maximum)</small>' : ''}</td><td class="n">${money(+d.balance)}</td><td class="n">${+d.limit ? money(+d.limit) : '—'}</td><td class="n">${+d.rate ? String(+d.rate).replace('.', ',') + ' %' : '—'}</td><td class="n">${debtM(d) ? money(debtM(d)) + (debtEst(d) ? ' <small>estimé</small>' : '') : '—'}</td></tr>`).join('')}
        <tr class="tot"><td><b>Total</b></td><td class="n"><b>${money(F.debts.reduce((a, d) => a + (+d.balance || 0), 0))}</b></td><td></td><td></td><td class="n"><b>${F.debtsM ? money(F.debtsM) : '—'}</b></td></tr>
      </tbody></table>
      ${F.debts.some(d => +d.limit && +d.balance >= +d.limit) ? '<p class="rp-note">Mes crédits disponibles sont utilisés au maximum : je n\'ai plus de marge pour absorber les mois sans revenu.</p>' : ''}` : ''}

      ${H(`Prévision — ${per}`)}
      <table class="rp-t"><thead><tr><th></th><th class="n">Scénario 1<br><small>aucune vente conclue</small></th><th class="n">Scénario 2<br><small>la transaction sous condition se conclut</small></th></tr></thead><tbody>
        ${tr(['Revenus confirmés', '0,00 $', '0,00 $'])}
        ${tr([`Revenus possibles — transaction${F.possible.length > 1 ? 's' : ''} sous condition${F.possible.length ? ' (' + F.possible.map(t => 'notaire prévu le ' + fmtD(t.deedAt, true)).join(', ') + ')' : ''}`, '0,00 $', money(F.posAmt)])}
        ${F.ret.map(r => tr([`${e(r.label)} (${String(r.pct).replace('.', ',')} % des commissions)`, '0,00 $', '− ' + money(F.posAmt * r.pct / 100)])).join('')}
        ${tr([`Dépenses d'entreprise (3 × ${money(F.bizM)})`, '− ' + money(F.bizM * 3), '− ' + money(F.bizM * 3)])}
        ${F.persM ? tr([`Dépenses personnelles de base (3 × ${money(F.persM)})`, '− ' + money(F.persM * 3), '− ' + money(F.persM * 3)]) : ''}
        ${F.debtsM ? tr([`${F.debtsEst ? "Frais d'intérêt estimés sur dettes" : 'Paiements sur dettes'} (3 × ${money(F.debtsM)})`, '− ' + money(F.debtsM * 3), '− ' + money(F.debtsM * 3)]) : ''}
        ${tr(['<b>Solde sur 3 mois</b>', `<b class="${s1 < 0 ? 'neg' : ''}">${money(s1)}</b>`, `<b class="${s2 < 0 ? 'neg' : ''}">${money(s2)}</b>`], 'tot')}
      </tbody></table>
      <ul class="rp-list">
        <li>Aucune vente conclue n'est prévue d'ici ${MOIS[F.months[2].m]} ${F.months[2].y}.</li>
        ${F.possible.length ? `<li>${F.possible.length > 1 ? `${F.possible.length} transactions sont` : '1 transaction est'} actuellement sous condition. Elle${F.possible.length > 1 ? 's' : ''} peu${F.possible.length > 1 ? 'vent' : 't'} encore être annulée${F.possible.length > 1 ? 's' : ''} (inspection, financement, etc.) : ce revenu n'est pas garanti.</li>` : ''}
        <li>${F.lstActive.length} inscription${F.lstActive.length > 1 ? 's' : ''} en vigueur sans offre acceptée : une vente éventuelle ne serait payée qu'à la signature chez le notaire, après la levée des conditions.</li>
        ${F.ret.length ? `<li>Avec les retenues indiquées (${String(F.retPct).replace('.', ',')} % au total), il resterait ${money(F.posAmt - retAmt)} pour couvrir ${money(need3)} de dépenses sur 3 mois, si la transaction sous condition se conclut.</li>` : ''}
      </ul>

      ${S.note ? `<h2>Note</h2><p class="rp-free">${e(S.note).replace(/\n/g, '<br>')}</p>` : ''}

      <p class="rp-src">Sources : rapport des transactions de RE/MAX L'Espace (commissions brutes, avant frais d'agence) et budget ${F.y}.</p>
    </div>`;
  }
  function preview() {
    close();
    let ov = document.getElementById('rpt-print');
    if (!ov) { ov = document.createElement('div'); ov.id = 'rpt-print'; document.body.appendChild(ov); }
    ov.innerHTML = `<div class="rp-bar"><button onclick="RPT.closePrev()">✕ Fermer</button><span>Aperçu — « Imprimer » puis « Enregistrer en PDF »</span><button class="go" onclick="window.print()">🖨 Imprimer / PDF</button><button onclick="RPT.closePrev();RPT.open()">Modifier</button></div>` + reportHtml();
    document.body.classList.add('rpt-on'); ov.scrollTop = 0;
    const t = document.title; document.title = `Sommaire revenus ${new Date().getFullYear()} - Julien Rock`; window.addEventListener('afterprint', () => { document.title = t; }, { once: true });
  }
  function closePrev() { document.body.classList.remove('rpt-on'); const ov = document.getElementById('rpt-print'); if (ov) ov.innerHTML = ''; }

  window.RPT = { open: openPrep, close, preview, closePrev, ef, edel, eadd, sf, rf, rdel, radd, pf, pdel, padd, df, ddel, dadd, _fig: figures, _html: reportHtml };
  pull();
})();
