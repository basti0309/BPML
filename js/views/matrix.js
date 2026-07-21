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
    <div class="kpi ok"><div class="val">${total.pct}%</div><div class="muted">Harmonization (cells without deviation)</div></div>
    <div class="kpi"><div class="val">${total.std}</div><div class="muted">Standard cells</div></div>
    <div class="kpi warn"><div class="val">${total.variant}</div><div class="muted">Deviations</div></div>
    <div class="kpi"><div class="val">${total.na}</div><div class="muted">not relevant</div></div>
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
        <span class="chip ${gs.pct >= 90 ? 'ok' : gs.pct >= 70 ? 'warn' : 'bad'}" style="float:right">harmonized: ${gs.pct}%</span></th></tr>`);
      for (const proc of group.processes) {
        for (const task of proc.tasks) {
          const cells = codes
            .map((code) => {
              const c = (task.countries || {})[code];
              if (!c || c.applies === false) return `<td class="cell na" data-task="${task.id}" data-code="${code}" title="not relevant – click to change">–</td>`;
              if (c.variant) return `<td class="cell var" data-task="${task.id}" data-code="${code}" title="${escapeHtml(c.variant)}${c.reason ? ' – ' + escapeHtml(c.reason) : ''} (click to change)">◐</td>`;
              return `<td class="cell std" data-task="${task.id}" data-code="${code}" title="Standard – click to change">✓</td>`;
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
      <button class="btn" id="btn-manage-countries">🌐 Manage countries</button>
      <span class="muted">Add / rename / delete columns</span>
    </div>
    <div class="muted" style="margin-bottom:8px">
      ✓ Standard (harmonized) · ◐ deviation (tooltip shows details) · – not relevant.
      Clicking a cell cycles the state (Standard → deviation → n/a); clicking the task name opens the editor.
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
      const text = prompt(`Describe the deviation for ${code} on ${hit.task.id} “${hit.task.name}”:`, '');
      if (text === null) return;
      next = { applies: true, variant: text.trim() || 'Deviation (details pending)' };
    } else next = { applies: false, variant: null };
    countries[code] = next;
    updateTask(hit.task.id, { countries }, `Matrix: ${hit.task.id}/${code} → ${next.applies === false ? 'n/a' : next.variant ? 'Deviation' : 'Standard'}`);
    showToast(`${hit.task.id} / ${code} updated.`);
  });
}
