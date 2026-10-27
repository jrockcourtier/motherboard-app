// Motherboard — Accueil : tableau de bord (revenus, inscriptions, transactions, prospection, à faire)
(function () {
  const e = (s) => (typeof esc === 'function' ? esc(s) : String(s || ''));
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = () => ymd(new Date());
  const money = (n) => (Math.round(n || 0)).toLocaleString('fr-CA') + ' $';
  const kmoney = (n) => n >= 1000 ? (Math.round(n / 100) / 10).toLocaleString('fr-CA') + ' k$' : money(n);
  const pct = (a, b) => b ? Math.round(a * 100 / b) + ' %' : '—';
  const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const fmtD = (s) => s ? new Date(s + 'T12:00:00').toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  const go = (tab) => `showTab({target:document.querySelector('.tab-btn[onclick*=&quot;\\'${tab}\\'&quot;]')},'${tab}')`;

  function txState(t) {
    if (t.deleted || t.status === 'annulee' || (t.conditions || []).some(c => c.status === 'nulle')) return 'annulee';
    if (t.status === 'conclue' || (t.deedAt && t.deedAt < today())) return 'conclue';
    return 'cours';
  }
  const txComm = (t) => (t.commAmount != null && t.commAmount !== '' ? +t.commAmount : t.price && t.commissionPct ? t.price * t.commissionPct / 100 : 0);
  const txYear = (t) => (t.deedAt || t.acceptedAt || '').slice(0, 4);
  const txMonth = (t) => +((t.deedAt || t.acceptedAt || '').slice(5, 7)) - 1;

  function data() {
    const y = String(new Date().getFullYear()), t0 = today();
    const txs = window.TX ? Object.values(TX._all()).filter(t => !t.deleted) : [];
    const done = txs.filter(t => txState(t) === 'conclue' && txYear(t) === y), sales = done.filter(t => t.kind !== 'revenu');
    const cours = txs.filter(t => txState(t) === 'cours');
    const monthly = Array.from({ length: 12 }, () => ({ done: 0, plan: 0 }));
    done.forEach(t => { if (txMonth(t) >= 0) monthly[txMonth(t)].done += txComm(t); });
    cours.forEach(t => { if (txYear(t) === y && txMonth(t) >= 0) monthly[txMonth(t)].plan += txComm(t); });
    const L = window.LST ? LST._list() : [];
    const lstActive = L.filter(x => ['active', 'a_venir'].includes(LST._status(x)));
    const lstCond = L.filter(x => LST._status(x) === 'sous_condition');
    // prospection
    const C = window.CRM ? Object.values(CRM._all()).filter(c => !c.deleted) : [];
    const OUT = (window.CRM && CRM._out) || {};
    const wk = new Date(); wk.setDate(wk.getDate() - ((wk.getDay() + 6) % 7)); const wkS = ymd(wk);
    const moS = t0.slice(0, 8) + '01', yS = y + '-01-01';
    const P = { w: { calls: 0, conv: 0, rdv: 0 }, m: { calls: 0, conv: 0, rdv: 0 }, y: { calls: 0, conv: 0, rdv: 0 } };
    C.forEach(c => (c.calls || []).forEach(k => {
      const d = ymd(new Date(k.at)), o = OUT[k.outcome] || {};
      [['w', wkS], ['m', moS], ['y', yS]].forEach(([p, from]) => { if (d >= from) { P[p].calls++; if (o.conv) P[p].conv++; if (k.outcome === 'rdv') P[p].rdv++; } });
    }));
    const pros = C.filter(c => c.type === 'proprio' && c.plist);
    const pipe = {
      appeler: pros.filter(c => (c.stage || 'À appeler') === 'À appeler' || (!c.suivi && c.stage === 'Appelé – rappeler')).length,
      suivi: pros.filter(c => c.suivi || c.stage === 'Intéressé').length,
      rdv: pros.filter(c => c.stage === 'Rendez-vous').length,
      signe: pros.filter(c => c.stage === 'Signé').length
    };
    let sessW = 0; try { (JSON.parse(localStorage.getItem('mb_sess_log') || '[]') || []).forEach(s => { if (ymd(new Date(s.s)) >= wkS) sessW += (new Date(s.e) - new Date(s.s)) / 1000; }); } catch (x) {}
    // à faire
    const dueN = window.CRM && CRM.dueIds ? C.filter(c => !c.inbox && c.nextFollowUp && c.nextFollowUp <= t0).length : 0;
    const inboxN = C.filter(c => c.inbox).length;
    const next = [];
    txs.filter(t => txState(t) === 'cours').forEach(t => TX._milestones(t).forEach(m => { if (!m.closed && !m.info && m.date >= t0) next.push({ date: m.date, icon: m.icon, label: m.label, where: t.address, open: `${go('transactions')};TX.open('${t.id}')` }); }));
    L.forEach(x => LST._milestones(x).forEach(m => { if (!m.closed && m.date >= t0) next.push({ date: m.date, icon: m.icon, label: m.label, where: x.address, open: `${go('inscriptions')};LST.open('${x.id}')` }); }));
    next.sort((a, b) => a.date.localeCompare(b.date));
    return { y, done, sales, cours, monthly, lstActive, lstCond, P, pipe, sessW, dueN, inboxN, next: next.slice(0, 6),
      rev: done.reduce((a, t) => a + txComm(t), 0), revPlan: cours.reduce((a, t) => a + txComm(t), 0),
      missingPct: done.concat(cours).filter(t => !txComm(t)).length,
      volume: lstActive.reduce((a, x) => a + (LST._cur(x) || 0), 0) };
  }

  function chart(monthly) {
    const max = Math.max(1, ...monthly.map(m => m.done + m.plan));
    const cur = new Date().getMonth();
    return `<div class="db-chart" role="img" aria-label="Commissions par mois">
      ${monthly.map((m, i) => {
        const hd = m.done / max * 100, hp = m.plan / max * 100;
        const tip = `${MOIS[i]} · conclu ${money(m.done)}${m.plan ? ' · prévu ' + money(m.plan) : ''}`;
        return `<div class="db-col${i === cur ? ' cur' : ''}" title="${tip}"><div class="db-tip">${tip}</div>
          <div class="db-stack">${m.plan ? `<div class="db-bar plan" style="height:${hp}%"></div>` : ''}${m.done ? `<div class="db-bar done" style="height:${hd}%"></div>` : ''}</div>
          <span>${MOIS[i].replace('.', '')}</span></div>`;
      }).join('')}
    </div>
    <div class="db-legend"><span><i class="done"></i>Conclu</span><span><i class="plan"></i>Prévu (en cours)</span></div>`;
  }
  function tile(label, value, sub, onclick, cls = '') {
    return `<div class="db-tile ${cls}" ${onclick ? `onclick="${onclick}" role="button" tabindex="0"` : ''}><div class="db-l">${label}</div><div class="db-v">${value}</div>${sub ? `<div class="db-s">${sub}</div>` : ''}</div>`;
  }
  function render() {
    const root = document.getElementById('accueil'); if (!root) return;
    const D = data(), P = D.P;
    const hr = new Date().getHours(), hello = hr < 12 ? 'Bonjour' : hr < 18 ? 'Bon après-midi' : 'Bonsoir';
    const hm = (s) => { const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
    root.innerHTML = `
      <div class="db">
        <div class="db-head"><div><h2>${hello} Julien</h2><div class="db-date">${new Date().toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
          <div class="db-todo">${D.dueN ? `<button onclick="${go('jour')}">🔔 ${D.dueN} suivi${D.dueN > 1 ? 's' : ''} à faire</button>` : ''}${D.inboxN ? `<button onclick="${go('contacts')}">📥 ${D.inboxN} contact${D.inboxN > 1 ? 's' : ''} à classer</button>` : ''}</div></div>

        <div class="db-grid">
          <div class="db-card db-hero">
            <div class="db-l">Revenus ${D.y} · commissions conclues (brut)</div>
            <div class="db-big">${money(D.rev)}</div>
            <div class="db-s">${D.sales.length} transaction${D.sales.length > 1 ? 's' : ''} conclue${D.sales.length > 1 ? 's' : ''} · <b>${money(D.revPlan)}</b> à venir (${D.cours.length} en cours)</div>
            ${chart(D.monthly)}
            ${D.missingPct ? `<div class="db-warn">⚠️ ${D.missingPct} transaction${D.missingPct > 1 ? 's' : ''} sans % de commission — <a onclick="${go('transactions')}">ajoute-le</a> pour qu'elle compte dans tes revenus.</div>` : ''}
          </div>
          <div class="db-tiles">
            ${tile('Inscriptions actives', D.lstActive.length, D.volume ? kmoney(D.volume) + ' en vente' : 'aucune', go('inscriptions'))}
            ${tile('Sous condition', D.lstCond.length, 'inscriptions avec offre acceptée', go('inscriptions'))}
            ${tile('Transactions en cours', D.cours.length, D.revPlan ? kmoney(D.revPlan) + ' de commissions' : '', go('transactions'))}
            ${tile('Ventes conclues ' + D.y, D.sales.length, D.rev ? kmoney(D.rev) : '', go('transactions'))}
          </div>
        </div>

        <div class="db-card">
          <div class="db-row-h"><b>📞 Prospection</b><button class="db-link" onclick="${go('prospection')}">Ouvrir la prospection →</button></div>
          <div class="db-prosp">
            ${[['Cette semaine', P.w], ['Ce mois-ci', P.m], ['Cette année', P.y]].map(([l, x]) => `<div class="db-pcol"><div class="db-l">${l}</div>
              <div class="db-nums"><div><b>${x.calls}</b><span>appels</span></div><div><b>${x.conv}</b><span>conversations</span></div><div><b>${x.rdv}</b><span>RDV</span></div></div>
              <div class="db-rates"><span title="Conversations ÷ appels">Taux de contact <b>${pct(x.conv, x.calls)}</b></span><span title="RDV ÷ conversations">Taux de RDV <b>${pct(x.rdv, x.conv)}</b></span></div></div>`).join('')}
          </div>
          <div class="db-pipe">
            ${[['À appeler', D.pipe.appeler], ['En suivi', D.pipe.suivi], ['RDV', D.pipe.rdv], ['Signés', D.pipe.signe]].map(([l, n]) => `<div><b>${n}</b><span>${l}</span></div>`).join('<i>›</i>')}
            ${D.sessW ? `<div class="db-sess">⏱ ${hm(D.sessW)} de prospection cette semaine</div>` : ''}
          </div>
        </div>

        <div class="db-card">
          <div class="db-row-h"><b>⏰ Prochaines échéances</b></div>
          ${D.next.length ? `<div class="db-next">${D.next.map(n => { const d = Math.round((new Date(n.date + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 864e5);
            return `<div onclick="${n.open}" role="button"><span class="db-nd${d <= 1 ? ' hot' : ''}">${d === 0 ? "Aujourd'hui" : d === 1 ? 'Demain' : fmtD(n.date)}</span><span>${n.icon} ${e(n.label)}<small>${e(n.where || '')}</small></span></div>`; }).join('')}</div>` : '<div class="crm-muted">Rien à l\'horizon. 🎉</div>'}
        </div>
        <div style="height:90px"></div>
      </div>`;
  }
  window.DASH = { render };
  // rafraîchir quand les données bougent
  let t = null; const later = () => { clearTimeout(t); t = setTimeout(() => { if (document.body.dataset.tab === 'accueil') render(); }, 400); };
  ['mb_contacts', 'mb_tx', 'mb_lst'].forEach(() => {});
  setInterval(later, 15000);
  window.addEventListener('load', () => setTimeout(render, 1200));
})();
