// AFC-Design-Sicht: Ordnerstruktur (je Prozessgruppe), Vollständigkeits-Checks
// und Export der Task-Liste als CSV/JSON für SAP Advanced Financial Closing.

import { getData, allTasks } from '../state.js';
import { openTaskEditor, escapeHtml, fmtDay, statusChip } from '../editor.js';
import { exportAfcCsv, exportAfcJson } from '../io.js';

export function renderAfc(root) {
  const data = getData();

  // Vollständigkeits-Checks
  const issues = [];
  for (const { task } of allTasks()) {
    const miss = [];
    if (!task.afc?.type) miss.push('AFC type');
    if (task.closingDay === null || task.closingDay === undefined) miss.push('Closing day');
    if (!(task.raci?.r || task.owner)) miss.push('Responsible');
    if (task.afc?.type === 'Job' && !task.afc?.jobName) miss.push('Job name');
    if (miss.length) issues.push({ task, miss });
  }
  const cycles = findCycles();

  const kpiPanel = document.createElement('div');
  kpiPanel.className = 'kpi-row';
  const nTasks = allTasks().length;
  kpiPanel.innerHTML = `
    <div class="kpi"><div class="val">${nTasks}</div><div class="muted">Tasks total</div></div>
    <div class="kpi ${issues.length ? 'warn' : 'ok'}"><div class="val">${issues.length}</div><div class="muted">Tasks with missing AFC data</div></div>
    <div class="kpi ${cycles.length ? 'warn' : 'ok'}"><div class="val">${cycles.length}</div><div class="muted">Cyclic dependencies</div></div>
  `;
  root.appendChild(kpiPanel);

  const checkPanel = document.createElement('div');
  checkPanel.className = 'panel';
  const issueItems = issues
    .map(
      (i) =>
        `<li><a href="#" data-open="${i.task.id}"><b>${i.task.id}</b> ${escapeHtml(i.task.name)}</a> – missing: ${i.miss.join(', ')}</li>`
    )
    .join('');
  const cycleItems = cycles.map((c) => `<li>Cycle: ${c.join(' → ')}</li>`).join('');
  checkPanel.innerHTML = `
    <b>Design checks for the AFC import</b>
    <ul class="check-list">
      ${issueItems || '<li>✅ All tasks have type, offset and responsible.</li>'}
      ${cycleItems || '<li>✅ No cyclic dependencies.</li>'}
    </ul>
    <div class="drawer-actions">
      <button class="btn primary" id="afc-csv">⬇ AFC task list (CSV)</button>
      <button class="btn" id="afc-json">⬇ AFC task list (JSON)</button>
    </div>
    <div class="muted" style="margin-top:6px">
      Structure: task-list template “${escapeHtml(data.meta.title || 'BPML')}” → one folder per process group → tasks with
      type, workday offset, responsible, duration, job template and predecessors. Countries marked * have deviations –
      consider dedicated task variants or separate task lists per company code in AFC there.
    </div>
  `;
  root.appendChild(checkPanel);

  // Ordner-Vorschau
  const folderPanel = document.createElement('div');
  folderPanel.className = 'panel';
  const folders = [];
  for (const area of data.areas) {
    for (const group of area.groups) {
      const tasks = group.processes.flatMap((p) => p.tasks);
      if (!tasks.length) continue;
      const rows = tasks
        .map((t) => {
          const scope = Object.entries(t.countries || {})
            .filter(([, c]) => c.applies !== false)
            .map(([code, c]) => (c.variant ? `${code}*` : code))
            .join(', ');
          return `<tr>
            <td><a href="#" data-open="${t.id}"><b>${t.id}</b></a></td>
            <td>${escapeHtml(t.name)}</td>
            <td>${escapeHtml(t.afc?.type || '–')}</td>
            <td>${fmtDay(t.closingDay ?? 0)}</td>
            <td>${escapeHtml(t.raci?.r || t.owner || '–')}</td>
            <td>${t.afc?.duration ?? '–'}</td>
            <td>${escapeHtml(t.afc?.jobName || '–')}</td>
            <td>${escapeHtml((t.dependsOn || []).join(', ') || '–')}</td>
            <td>${escapeHtml(scope)}</td>
            <td>${statusChip(t.status)}</td>
          </tr>`;
        })
        .join('');
      folders.push(`<details class="afc-folder" open>
        <summary>📁 ${escapeHtml(group.name)} <span class="muted">(${tasks.length} tasks)</span></summary>
        <table class="afc">
          <thead><tr><th>ID</th><th>Task</th><th>Type</th><th>Offset</th><th>Responsible</th><th>Duration (min)</th><th>Job</th><th>Predecessors</th><th>Countries</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </details>`);
    }
  }
  folderPanel.innerHTML = `<b>Task list template: ${escapeHtml(data.meta.title || 'BPML')}</b><div style="margin-top:8px">${folders.join('')}</div>`;
  root.appendChild(folderPanel);

  root.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-open]');
    if (link) {
      e.preventDefault();
      openTaskEditor(link.dataset.open);
    }
  });
  checkPanel.querySelector('#afc-csv').onclick = exportAfcCsv;
  checkPanel.querySelector('#afc-json').onclick = exportAfcJson;
}

function findCycles() {
  const tasks = allTasks().map((t) => t.task);
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn || []]));
  const cycles = [];
  const state = new Map(); // 0=unbesucht 1=offen 2=fertig
  const path = [];
  const dfs = (id) => {
    state.set(id, 1);
    path.push(id);
    for (const p of deps.get(id) || []) {
      if (!deps.has(p)) continue;
      if (state.get(p) === 1) {
        cycles.push([...path.slice(path.indexOf(p)), p]);
      } else if (!state.get(p)) {
        dfs(p);
      }
    }
    path.pop();
    state.set(id, 2);
  };
  for (const t of tasks) if (!state.get(t.id)) dfs(t.id);
  return cycles;
}
