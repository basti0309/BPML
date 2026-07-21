// Closing-Kalender: Workday-Timeline mit Schwimmbahnen je Prozessgruppe.

import { getData } from '../state.js';
import { openTaskEditor, escapeHtml, fmtDay } from '../editor.js';

const filter = { country: '' };

export function renderCalendar(root) {
  const data = getData();
  const meta = data.meta;

  const days = [];
  for (const a of data.areas) for (const g of a.groups) for (const p of g.processes) for (const t of p.tasks) days.push(t.closingDay ?? 0);
  const from = Math.min(meta.closingDayRange?.from ?? -5, ...days);
  const to = Math.max(meta.closingDayRange?.to ?? 10, ...days);
  const nDays = to - from + 1;

  const countryOpts = meta.countries
    .map((c) => `<option value="${c.code}" ${filter.country === c.code ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');

  const panel = document.createElement('div');
  panel.className = 'panel';

  const headCols = [];
  for (let d = from; d <= to; d++) {
    headCols.push(`<div class="cal-daycol ${d === 0 ? 'zero' : ''}">${fmtDay(d)}</div>`);
  }

  const lanes = [];
  for (const area of data.areas) {
    for (const group of area.groups) {
      const tasks = group.processes
        .flatMap((p) => p.tasks)
        .filter((t) => {
          if (!filter.country) return true;
          const c = (t.countries || {})[filter.country];
          return c && c.applies !== false;
        });
      if (!tasks.length) continue;

      const cells = [];
      for (let d = from; d <= to; d++) {
        const dayTasks = tasks.filter((t) => (t.closingDay ?? 0) === d);
        const items = dayTasks
          .map((t) => {
            const hasVariant = filter.country
              ? Boolean((t.countries || {})[filter.country]?.variant)
              : Object.values(t.countries || {}).some((c) => c.applies !== false && c.variant);
            const varText = filter.country ? (t.countries || {})[filter.country]?.variant : null;
            const type = (t.afc?.type || 'Manual').replace(/[^A-Za-z]/g, '');
            const deps = (t.dependsOn || []).length ? ` · after ${(t.dependsOn || []).join(', ')}` : '';
            return `<div class="cal-task type-${type} ${hasVariant ? 'has-variant' : ''}"
              data-task="${t.id}"
              title="${escapeHtml(t.name)} (${escapeHtml(t.afc?.type || '')}${deps})${varText ? '\nDeviation: ' + escapeHtml(varText) : ''}">${t.id} ${escapeHtml(t.name)}</div>`;
          })
          .join('');
        cells.push(`<div class="cal-cell ${d === 0 ? 'zero' : ''}">${items}</div>`);
      }
      lanes.push(`
        <div class="cal-lane-label">${escapeHtml(group.name)}</div>
        <div class="cal-lane" style="grid-template-columns: repeat(${nDays}, minmax(64px, 1fr))">${cells.join('')}</div>
      `);
    }
  }

  panel.innerHTML = `
    <div class="filterbar">
      <select id="cal-country"><option value="">All countries (global template)</option>${countryOpts}</select>
      <span class="muted">WD0 = period-end date · click a task to open the editor · dashed border = country deviation</span>
    </div>
    <div class="cal-wrap">
      <div class="cal-grid" style="grid-template-columns: 1fr">
        <div style="display:grid;grid-template-columns:180px 1fr">
          <div></div>
          <div class="cal-head" style="grid-template-columns: repeat(${nDays}, minmax(64px, 1fr));display:grid">${headCols.join('')}</div>
        </div>
        ${lanes.map((l) => `<div style="display:grid;grid-template-columns:180px 1fr">${l}</div>`).join('')}
      </div>
    </div>
    <div class="legend">
      <span><span class="swatch" style="background:var(--accent)"></span>Manual</span>
      <span><span class="swatch" style="background:#6c4fb3"></span>Job</span>
      <span><span class="swatch" style="background:#0e7d74"></span>Workflow</span>
      <span><span class="swatch" style="background:#b8860b"></span>Check</span>
      <span><span class="swatch" style="background:#1e2733"></span>Milestone</span>
    </div>
  `;
  root.appendChild(panel);

  panel.querySelector('#cal-country').onchange = (e) => {
    filter.country = e.target.value;
    root.innerHTML = '';
    renderCalendar(root);
  };

  panel.addEventListener('click', (e) => {
    const t = e.target.closest('.cal-task');
    if (t) openTaskEditor(t.dataset.task);
  });
}
