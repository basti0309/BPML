// Länder-Vergleichsmatrix: Tasks × Länder mit Harmonisierungs-KPIs.

import { getData, harmonizationStats, taskById, updateTask } from '../state.js';
import { openTaskEditor, escapeHtml, showToast, openCountryManager } from '../editor.js';

export function renderMatrix(root) {
  const data = getData();
  const meta = data.meta;
  const codes = meta.countries.map((c) => c.code);

  // KPIs gesamt + je Prozessgruppe
  const allT = [];
  for (const a of data.areas) for (const g of a.groups) for (const p of g.processes) allT.push(...p.tasks);
  const total = harmonizationStats(allT);

  const kpis = document.createElement('div');
  kpis.className = 'kpi-row';
  kpis.innerHTML = `
    <div class="kpi ok"><div class="val">${total.pct}%</div><div class="muted">Harmonisierungsgrad (Zellen ohne Abweichung)</div></div>
    <div class="kpi"><div class="val">${total.std}</div><div class="muted">Standard-Zellen</div></div>
    <div class="kpi warn"><div class="val">${total.variant}</div><div class="muted">Abweichungen</div></div>
    <div class="kpi"><div class="val">${total.na}</div><div class="muted">nicht relevant</div></div>
  `;
  root.appendChild(kpis);

  const panel = document.createElement('div');
  panel.className = 'panel';

  const head = `<tr>
    <th style="text-align:left">Task</th>
    ${codes.map((c) => `<th title="${escapeHtml(meta.countries.find((x) => x.code === c)?.name || c)}">${c}</th>`).join('')}
  </tr>`;

  const rows = [];
  for (const area of data.areas) {
    for (const group of area.groups) {
      const gTasks = group.processes.flatMap((p) => p.tasks);
      if (!gTasks.length) continue;
      const gs = harmonizationStats(gTasks);
      rows.push(`<tr class="matrix-group"><th colspan="${codes.length + 1}">${escapeHtml(group.name)}
        <span class="chip ${gs.pct >= 90 ? 'ok' : gs.pct >= 70 ? 'warn' : 'bad'}" style="float:right">harmonisiert: ${gs.pct}%</span></th></tr>`);
      for (const proc of group.processes) {
        for (const task of proc.tasks) {
          const cells = codes
            .map((code) => {
              const c = (task.countries || {})[code];
              if (!c || c.applies === false) return `<td class="cell na" data-task="${task.id}" data-code="${code}" title="nicht relevant – klicken zum Ändern">–</td>`;
              if (c.variant) return `<td class="cell var" data-task="${task.id}" data-code="${code}" title="${escapeHtml(c.variant)}${c.reason ? ' – ' + escapeHtml(c.reason) : ''} (klicken zum Ändern)">◐</td>`;
              return `<td class="cell std" data-task="${task.id}" data-code="${code}" title="Standard – klicken zum Ändern">✓</td>`;
            })
            .join('');
          rows.push(`<tr>
            <td class="rowhead"><a href="#" data-open="${task.id}" style="color:inherit;text-decoration:none"><b>${task.id}</b> ${escapeHtml(task.name)}</a></td>
            ${cells}
          </tr>`);
        }
      }
    }
  }

  panel.innerHTML = `
    <div class="filterbar">
      <button class="btn" id="btn-manage-countries">🌐 Länder verwalten</button>
      <span class="muted">Spalten hinzufügen/umbenennen/löschen</span>
    </div>
    <div class="muted" style="margin-bottom:8px">
      ✓ Standard (harmonisiert) · ◐ Abweichung (Tooltip zeigt Details) · – nicht relevant.
      Klick auf eine Zelle schaltet den Zustand um (Standard → Abweichung → n/a), Klick auf den Task-Namen öffnet den Editor.
    </div>
    <div class="matrix-wrap">
      <table class="matrix">
        <thead>${head}</thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
  root.appendChild(panel);

  panel.querySelector('#btn-manage-countries').onclick = () => openCountryManager();

  panel.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-open]');
    if (link) {
      e.preventDefault();
      openTaskEditor(link.dataset.open);
      return;
    }
    const cell = e.target.closest('td.cell');
    if (!cell) return;
    const hit = taskById(cell.dataset.task);
    if (!hit) return;
    const code = cell.dataset.code;
    const countries = { ...(hit.task.countries || {}) };
    const cur = countries[code] || { applies: true, variant: null };
    let next;
    if (cur.applies === false) next = { applies: true, variant: null };
    else if (!cur.variant) {
      const text = prompt(`Abweichung für ${code} bei ${hit.task.id} „${hit.task.name}“ beschreiben:`, '');
      if (text === null) return;
      next = { applies: true, variant: text.trim() || 'Abweichung (Details offen)' };
    } else next = { applies: false, variant: null };
    countries[code] = next;
    updateTask(hit.task.id, { countries }, `Matrix: ${hit.task.id}/${code} → ${next.applies === false ? 'n/a' : next.variant ? 'Abweichung' : 'Standard'}`);
    showToast(`${hit.task.id} / ${code} aktualisiert.`);
  });
}
