// BPML-Tabellenansicht: Hierarchie, Filter, Suche, Absprung in den Task-Editor.

import { getData, allTasks, newTask, harmonizationStats } from '../state.js';
import { openTaskEditor, escapeHtml, fmtDay, statusChip, showToast } from '../editor.js';

const collapsed = new Set(); // eingeklappte area/group/proc-IDs
const filter = { country: '', group: '', status: '', harm: '', q: '' };

function taskMatches(task) {
  if (filter.country) {
    const c = (task.countries || {})[filter.country];
    if (!c || c.applies === false) return false;
    if (filter.harm === 'var' && !c.variant) return false;
  }
  if (filter.harm === 'var' && !filter.country) {
    if (!Object.values(task.countries || {}).some((c) => c.applies !== false && c.variant)) return false;
  }
  if (filter.harm === 'harm' && !task.harmonized) return false;
  if (filter.status && task.status !== filter.status) return false;
  if (filter.q) {
    const hay = `${task.id} ${task.name} ${task.description} ${task.owner} ${task.system} ${task.transaction}`.toLowerCase();
    if (!hay.includes(filter.q.toLowerCase())) return false;
  }
  return true;
}

export function renderTable(root) {
  const data = getData();
  const meta = data.meta;

  const countryOpts = meta.countries
    .map((c) => `<option value="${c.code}" ${filter.country === c.code ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
  const groupNames = [...new Set(allTasks().map((t) => t.group.name))];
  const groupOpts = groupNames
    .map((g) => `<option ${filter.group === g ? 'selected' : ''}>${escapeHtml(g)}</option>`)
    .join('');
  const statusOpts = meta.statusValues
    .map((s) => `<option ${filter.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`)
    .join('');

  const stats = harmonizationStats(allTasks().map((t) => t.task));

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="filterbar">
      <input type="search" id="flt-q" placeholder="Suche (Task, System, Transaktion…)" value="${escapeHtml(filter.q)}" />
      <select id="flt-country"><option value="">Alle Länder</option>${countryOpts}</select>
      <select id="flt-group"><option value="">Alle Prozessgruppen</option>${groupOpts}</select>
      <select id="flt-status"><option value="">Alle Status</option>${statusOpts}</select>
      <select id="flt-harm">
        <option value="">Harmonisierung: alle</option>
        <option value="harm" ${filter.harm === 'harm' ? 'selected' : ''}>nur harmonisierte</option>
        <option value="var" ${filter.harm === 'var' ? 'selected' : ''}>nur mit Abweichungen</option>
      </select>
      <span class="chip ok" title="Anteil Land-Zellen ohne Abweichung">Harmonisiert: ${stats.pct}%</span>
    </div>
    <div class="tbl-wrap">
      <table class="bpml">
        <thead>
          <tr>
            <th style="width:70px">ID</th>
            <th>Task</th>
            <th>Verantwortlich</th>
            <th>System / Transaktion</th>
            <th style="width:60px">Tag</th>
            <th>AFC-Typ</th>
            <th>Länder</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody id="bpml-body"></tbody>
      </table>
    </div>
  `;
  root.appendChild(panel);

  const tbody = panel.querySelector('#bpml-body');
  renderRows(tbody, data);

  const rerenderRows = () => renderRows(tbody, data);
  panel.querySelector('#flt-q').addEventListener('input', (e) => { filter.q = e.target.value; rerenderRows(); });
  panel.querySelector('#flt-country').onchange = (e) => { filter.country = e.target.value; rerenderRows(); };
  panel.querySelector('#flt-group').onchange = (e) => { filter.group = e.target.value; rerenderRows(); };
  panel.querySelector('#flt-status').onchange = (e) => { filter.status = e.target.value; rerenderRows(); };
  panel.querySelector('#flt-harm').onchange = (e) => { filter.harm = e.target.value; rerenderRows(); };

  tbody.addEventListener('click', (e) => {
    const addBtn = e.target.closest('button[data-add]');
    if (addBtn) {
      e.stopPropagation();
      const t = newTask(addBtn.dataset.add);
      if (t) { openTaskEditor(t.id); showToast(`${t.id} angelegt – Details ausfüllen.`); }
      return;
    }
    const row = e.target.closest('tr');
    if (!row) return;
    if (row.dataset.toggle) {
      if (collapsed.has(row.dataset.toggle)) collapsed.delete(row.dataset.toggle);
      else collapsed.add(row.dataset.toggle);
      rerenderRows();
    } else if (row.dataset.task) {
      openTaskEditor(row.dataset.task);
    }
  });
}

function countryCells(task, meta) {
  return meta.countries
    .map((c) => {
      const cc = (task.countries || {})[c.code];
      if (!cc || cc.applies === false) return `<span class="chip na" title="nicht relevant">${c.code}</span>`;
      if (cc.variant) return `<span class="chip warn" title="${escapeHtml(cc.variant)}${cc.reason ? ' – ' + escapeHtml(cc.reason) : ''}">${c.code}◐</span>`;
      return `<span class="chip ok" title="Standard">${c.code}</span>`;
    })
    .join(' ');
}

function renderRows(tbody, data) {
  const meta = data.meta;
  const rows = [];
  const caret = (id) => `<span class="caret">${collapsed.has(id) ? '▸' : '▾'}</span>`;

  for (const area of data.areas) {
    const areaTasks = [];
    for (const g of area.groups) for (const p of g.processes) for (const t of p.tasks) areaTasks.push(t);
    rows.push(`<tr class="row-area" data-toggle="${area.id}">
      <td colspan="8">${caret(area.id)}${escapeHtml(area.name)} <span class="muted">(${areaTasks.length} Tasks)</span></td>
    </tr>`);
    if (collapsed.has(area.id)) continue;

    for (const group of area.groups) {
      if (filter.group && group.name !== filter.group) continue;
      rows.push(`<tr class="row-group" data-toggle="${group.id}">
        <td colspan="8" style="padding-left:22px">${caret(group.id)}${escapeHtml(group.name)}</td>
      </tr>`);
      if (collapsed.has(group.id)) continue;

      for (const proc of group.processes) {
        rows.push(`<tr class="row-proc" data-toggle="${proc.id}">
          <td colspan="8" style="padding-left:40px">${caret(proc.id)}${escapeHtml(proc.name)}
            <button class="btn" style="float:right;padding:2px 8px;font-size:11px" data-add="${proc.id}" title="Task in diesem Prozess anlegen">+ Task</button>
          </td>
        </tr>`);
        if (collapsed.has(proc.id)) continue;

        for (const task of proc.tasks) {
          if (!taskMatches(task)) continue;
          const variants = Object.entries(task.countries || {})
            .filter(([, c]) => c.applies !== false && c.variant)
            .map(([code, c]) => `${code}: ${escapeHtml(c.variant)}`);
          rows.push(`<tr class="row-task" data-task="${task.id}">
            <td data-label="ID">${task.id}</td>
            <td data-label="Task">
              <span class="task-name">${escapeHtml(task.name)}</span>
              ${task.harmonized ? '' : ' <span class="chip warn" title="nicht Teil des Global Template">lokal</span>'}
              ${variants.length ? `<div class="dev-list">◐ ${variants.join(' · ')}</div>` : ''}
            </td>
            <td data-label="Verantwortlich">${escapeHtml(task.owner || '–')}</td>
            <td data-label="System">${escapeHtml(task.system || '–')}${task.transaction ? `<div class="muted">${escapeHtml(task.transaction)}</div>` : ''}</td>
            <td data-label="Tag"><span class="chip day">${fmtDay(task.closingDay)}</span></td>
            <td data-label="AFC-Typ">${escapeHtml(task.afc?.type || '–')}</td>
            <td data-label="Länder">${countryCells(task, meta)}</td>
            <td data-label="Status">${statusChip(task.status)}</td>
          </tr>`);
        }
      }
    }
  }
  tbody.innerHTML = rows.join('');
}
