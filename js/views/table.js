// BPML-Tabellenansicht: Hierarchie, Filter, Suche, Editieren auf allen Ebenen
// (Umbenennen, Anlegen, Löschen) und Umhängen/Umsortieren per Drag & Drop.

import {
  getData, allTasks, newTask, harmonizationStats, outlineNumbers,
  findNode, renameNode, addArea, addGroup, addProcess, deleteNode, moveNode, taskIdsWithin, updateTask,
} from '../state.js';
import { openTaskEditor, closeDrawer, escapeHtml, fmtDay, statusChip, showToast } from '../editor.js';

const collapsed = new Set(); // eingeklappte area/group/proc-IDs
const filter = { country: '', group: '', status: '', harm: '', q: '' };

// Welcher Row-Typ nimmt welchen Kind-Typ als Kind bzw. als Geschwister an
const PARENT_OF = { task: 'process', process: 'group', group: 'area' };

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
      <input type="search" id="flt-q" placeholder="Search (task, system, transaction…)" value="${escapeHtml(filter.q)}" />
      <select id="flt-country"><option value="">All countries</option>${countryOpts}</select>
      <select id="flt-group"><option value="">All process groups</option>${groupOpts}</select>
      <select id="flt-status"><option value="">All statuses</option>${statusOpts}</select>
      <select id="flt-harm">
        <option value="">Harmonization: all</option>
        <option value="harm" ${filter.harm === 'harm' ? 'selected' : ''}>harmonized only</option>
        <option value="var" ${filter.harm === 'var' ? 'selected' : ''}>with deviations only</option>
      </select>
      <span class="chip ok" title="Share of country cells without deviation">Harmonized: ${stats.pct}%</span>
      <button class="btn" id="btn-add-area" style="margin-left:auto">+ Area</button>
    </div>
    <div class="muted" style="margin-bottom:8px">
      ✎ or double-click renames · ⋮⋮ drags rows into another group/position ·
      + adds sub-items · 🗑 deletes (incl. subtree)
    </div>
    <div class="tbl-wrap">
      <table class="bpml">
        <thead>
          <tr>
            <th style="width:78px">No.</th>
            <th>Task</th>
            <th>Responsible</th>
            <th>System / Transaction</th>
            <th style="width:60px">WD</th>
            <th>Freq.</th>
            <th>AFC type</th>
            <th>Countries</th>
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

  const rerenderRows = () => renderRows(tbody, getData());
  panel.querySelector('#flt-q').addEventListener('input', (e) => { filter.q = e.target.value; rerenderRows(); });
  panel.querySelector('#flt-country').onchange = (e) => { filter.country = e.target.value; rerenderRows(); };
  panel.querySelector('#flt-group').onchange = (e) => { filter.group = e.target.value; rerenderRows(); };
  panel.querySelector('#flt-status').onchange = (e) => { filter.status = e.target.value; rerenderRows(); };
  panel.querySelector('#flt-harm').onchange = (e) => { filter.harm = e.target.value; rerenderRows(); };

  panel.querySelector('#btn-add-area').onclick = () => {
    const area = addArea();
    startRenameById(area.id);
  };

  tbody.addEventListener('click', (e) => onRowClick(e));
  tbody.addEventListener('dblclick', (e) => {
    const row = e.target.closest('tr[data-node]');
    if (row && !e.target.closest('input')) {
      e.preventDefault();
      // Ein-/Ausklappen des vorausgegangenen Einzelklicks abbrechen,
      // sonst würde die Tabelle unter dem Doppelklick neu gerendert.
      if (pendingToggle) { clearTimeout(pendingToggle); pendingToggle = null; }
      closeDrawer(); // der Einzelklick hat bei Task-Zeilen ggf. den Editor geöffnet
      startRename(row);
    }
  });

  // ---- Drag & Drop (Event-Delegation) ----
  tbody.addEventListener('dragstart', onDragStart);
  tbody.addEventListener('dragover', onDragOver);
  tbody.addEventListener('dragleave', (e) => {
    const row = e.target.closest('tr');
    if (row) clearDropMarks(row);
  });
  tbody.addEventListener('drop', onDrop);
  tbody.addEventListener('dragend', () => {
    dragState = null;
    document.querySelectorAll('.dragging, .drop-before, .drop-after, .drop-into').forEach((el) =>
      el.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-into')
    );
  });
}

// ---------------------------------------------------------------------------

function onRowClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (btn) {
    e.stopPropagation();
    const { action, node } = btn.dataset;
    if (action === 'add-group') { const g = addGroup(node); collapsed.delete(node); if (g) startRenameById(g.id); }
    else if (action === 'add-process') { const p = addProcess(node); collapsed.delete(node); if (p) startRenameById(p.id); }
    else if (action === 'add-task') {
      collapsed.delete(node);
      const t = newTask(node);
      if (t) { openTaskEditor(t.id); showToast('Task created – fill in the details.'); }
    } else if (action === 'rename') {
      startRename(btn.closest('tr[data-node]'));
    } else if (action === 'delete') {
      const hit = findNode(node);
      if (!hit) return;
      const n = taskIdsWithin(hit.node, hit.kind).length;
      const label = { area: 'Area', group: 'Process Group', process: 'Process', task: 'Task' }[hit.kind];
      if (confirm(`Delete ${label} “${hit.node.name}”?${n ? ` ${n} task(s) will be deleted too.` : ''}`)) {
        const name = hit.node.name;
        deleteNode(node);
        showToast(`${label} “${name}” deleted.`);
      }
    }
    return;
  }
  if (e.target.closest('input') || e.target.closest('.drag-handle')) return;
  const row = e.target.closest('tr');
  if (!row) return;
  if (row.dataset.toggle) {
    // Verzögert ein-/ausklappen, damit ein Doppelklick (Umbenennen) den
    // Toggle noch abbrechen kann, bevor die Tabelle neu gerendert wird.
    const id = row.dataset.toggle;
    const tbody = row.closest('tbody');
    if (pendingToggle) clearTimeout(pendingToggle);
    pendingToggle = setTimeout(() => {
      pendingToggle = null;
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      renderRows(tbody, getData());
    }, 250);
  } else if (row.dataset.task) {
    // Ebenfalls verzögert, damit ein Doppelklick (Umbenennen) das Öffnen
    // des Editors abbrechen kann.
    const taskId = row.dataset.task;
    if (pendingToggle) clearTimeout(pendingToggle);
    pendingToggle = setTimeout(() => {
      pendingToggle = null;
      openTaskEditor(taskId);
    }, 250);
  }
}

let pendingToggle = null;

// ---- Inline-Umbenennen ----------------------------------------------------

function startRenameById(id) {
  const row = document.querySelector(`tr[data-node="${id}"]`);
  if (row) {
    row.scrollIntoView({ block: 'center' });
    startRename(row);
  }
}

function startRename(row) {
  if (!row) return;
  const span = row.querySelector('.node-name');
  if (!span || row.querySelector('input.rename')) return;
  const id = row.dataset.node;
  const hit = findNode(id);
  if (!hit) return;
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = hit.node.name;
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    if (save && input.value.trim() && input.value.trim() !== hit.node.name) {
      if (hit.kind === 'task') updateTask(id, { name: input.value.trim() });
      else renameNode(id, input.value); // persist() rendert die View neu
    } else {
      // Abbruch: nur die Zeile zurücksetzen
      renderRows(row.closest('tbody'), getData());
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit(true);
    else if (e.key === 'Escape') commit(false);
  });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

// ---- Drag & Drop ----------------------------------------------------------

let dragState = null; // { kind, id }

function onDragStart(e) {
  const handle = e.target.closest('.drag-handle');
  const row = e.target.closest('tr[data-node]');
  if (!handle || !row) {
    e.preventDefault();
    return;
  }
  dragState = { kind: row.dataset.kind, id: row.dataset.node };
  e.dataTransfer.setData('text/plain', row.dataset.node);
  e.dataTransfer.effectAllowed = 'move';
  row.classList.add('dragging');
}

/** Bestimmt für eine Zielzeile, ob und wie gedroppt werden kann. */
function dropModeFor(row) {
  if (!dragState || !row) return null;
  const targetKind = row.dataset.kind;
  if (row.dataset.node === dragState.id) return null;
  if (targetKind === dragState.kind) return 'sibling'; // davor/danach einsortieren
  if (targetKind === PARENT_OF[dragState.kind]) return 'into'; // ans Ende des Parents
  return null;
}

function clearDropMarks(row) {
  row.classList.remove('drop-before', 'drop-after', 'drop-into');
}

function onDragOver(e) {
  const row = e.target.closest('tr[data-node]');
  const mode = dropModeFor(row);
  document.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach((el) => {
    if (el !== row) el.classList.remove('drop-before', 'drop-after', 'drop-into');
  });
  if (!mode) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarks(row);
  if (mode === 'into') {
    row.classList.add('drop-into');
  } else {
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    row.classList.add(after ? 'drop-after' : 'drop-before');
  }
}

function onDrop(e) {
  const row = e.target.closest('tr[data-node]');
  const mode = dropModeFor(row);
  if (!mode) return;
  e.preventDefault();
  const dragged = dragState;
  dragState = null;

  if (mode === 'into') {
    // In den Parent einhängen (ans Ende); Ziel aufklappen, damit man es sieht
    collapsed.delete(row.dataset.node);
    const ok = moveNode(dragged.id, row.dataset.node === 'root' ? 'root' : row.dataset.node);
    if (ok) showToast('Moved.');
    return;
  }

  // sibling: vor/nach der Zielzeile im (echten) Parent-Array einsortieren
  const target = findNode(row.dataset.node);
  if (!target) return;
  const rect = row.getBoundingClientRect();
  const after = e.clientY > rect.top + rect.height / 2;
  const parentId =
    target.kind === 'area' ? 'root'
    : target.kind === 'group' ? target.parents.area.id
    : target.kind === 'process' ? target.parents.group.id
    : target.parents.proc.id;
  const ok = moveNode(dragged.id, parentId, target.index + (after ? 1 : 0));
  if (ok) showToast('Moved.');
}

// ---- Rendering ------------------------------------------------------------

function countryCells(task, meta) {
  return meta.countries
    .map((c) => {
      const cc = (task.countries || {})[c.code];
      if (!cc || cc.applies === false) return `<span class="chip na" title="not relevant">${c.code}</span>`;
      if (cc.variant) return `<span class="chip warn" title="${escapeHtml(cc.variant)}${cc.reason ? ' – ' + escapeHtml(cc.reason) : ''}">${c.code}◐</span>`;
      return `<span class="chip ok" title="Standard">${c.code}</span>`;
    })
    .join(' ');
}

function rowActions(kind, id) {
  const add = { area: ['add-group', '+ Group'], group: ['add-process', '+ Process'], process: ['add-task', '+ Task'] }[kind];
  return `<span class="row-actions">
    ${add ? `<button class="btn mini" data-action="${add[0]}" data-node="${id}" title="Add ${add[1].slice(2)}">${add[1]}</button>` : ''}
    <button class="btn mini" data-action="rename" data-node="${id}" title="Rename">✎</button>
    <button class="btn mini danger" data-action="delete" data-node="${id}" title="Delete (incl. subtree)">🗑</button>
  </span>`;
}

function handle() {
  return `<span class="drag-handle" draggable="true" title="Drag to move">⋮⋮</span>`;
}

function renderRows(tbody, data) {
  const meta = data.meta;
  const rows = [];
  const no = outlineNumbers(data);
  const numTag = (id) => `<span class="outline-no">${no.get(id) || ''}</span>`;
  const caret = (id) => `<span class="caret">${collapsed.has(id) ? '▸' : '▾'}</span>`;

  for (const area of data.areas) {
    const areaTasks = taskIdsWithinData(area);
    rows.push(`<tr class="row-area" data-toggle="${area.id}" data-node="${area.id}" data-kind="area">
      <td colspan="9">${handle()}${caret(area.id)}${numTag(area.id)}<span class="node-name">${escapeHtml(area.name)}</span>
        <span class="muted">(${areaTasks} tasks)</span>${rowActions('area', area.id)}</td>
    </tr>`);
    if (collapsed.has(area.id)) continue;

    for (const group of area.groups) {
      if (filter.group && group.name !== filter.group) continue;
      rows.push(`<tr class="row-group" data-toggle="${group.id}" data-node="${group.id}" data-kind="group">
        <td colspan="9" style="padding-left:22px">${handle()}${caret(group.id)}${numTag(group.id)}<span class="node-name">${escapeHtml(group.name)}</span>${rowActions('group', group.id)}</td>
      </tr>`);
      if (collapsed.has(group.id)) continue;

      for (const proc of group.processes) {
        rows.push(`<tr class="row-proc" data-toggle="${proc.id}" data-node="${proc.id}" data-kind="process">
          <td colspan="9" style="padding-left:40px">${handle()}${caret(proc.id)}${numTag(proc.id)}<span class="node-name">${escapeHtml(proc.name)}</span>${rowActions('process', proc.id)}</td>
        </tr>`);
        if (collapsed.has(proc.id)) continue;

        for (const task of proc.tasks) {
          if (!taskMatches(task)) continue;
          const variants = Object.entries(task.countries || {})
            .filter(([, c]) => c.applies !== false && c.variant)
            .map(([code, c]) => `${code}: ${escapeHtml(c.variant)}`);
          rows.push(`<tr class="row-task" data-task="${task.id}" data-node="${task.id}" data-kind="task">
            <td data-label="No.">${handle()}<span class="outline-no">${no.get(task.id) || ''}</span></td>
            <td data-label="Task">
              <span class="task-name node-name">${escapeHtml(task.name)}</span>
              ${task.harmonized ? '' : ' <span class="chip warn" title="not part of the global template">local</span>'}
              ${variants.length ? `<div class="dev-list">◐ ${variants.join(' · ')}</div>` : ''}
            </td>
            <td data-label="Responsible">${escapeHtml(task.owner || '–')}</td>
            <td data-label="System">${escapeHtml(task.system || '–')}${task.transaction ? `<div class="muted">${escapeHtml(task.transaction)}</div>` : ''}</td>
            <td data-label="WD"><span class="chip day">${fmtDay(task.closingDay)}</span></td>
            <td data-label="Freq.">${escapeHtml(task.frequency || '–')}</td>
            <td data-label="AFC type">${escapeHtml(task.afc?.type || '–')}</td>
            <td data-label="Countries">${countryCells(task, meta)}</td>
            <td data-label="Status">${statusChip(task.status)}</td>
          </tr>`);
        }
      }
    }
  }
  tbody.innerHTML = rows.join('');
}

function taskIdsWithinData(area) {
  let n = 0;
  for (const g of area.groups) for (const p of g.processes) n += p.tasks.length;
  return n;
}
