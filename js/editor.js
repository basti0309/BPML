// Gemeinsamer Detail-Editor (Drawer) für Tasks + Toast-Helfer.

import {
  getData, taskById, updateTask, deleteTask, addComment, allTasks, moveNode, getEditor,
  addCountry, deleteCountry, updateCountry,
} from './state.js';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function showToast(msg, ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ms);
}

export function openDrawerHtml(html) {
  document.getElementById('drawer-content').innerHTML = html;
  document.getElementById('drawer').classList.remove('hidden');
}

export function closeDrawer() {
  document.getElementById('drawer').classList.add('hidden');
}

export function fmtDay(d) {
  if (d === 0) return 'WD0';
  return d > 0 ? `WD+${d}` : `WD${d}`;
}

export function statusChip(status) {
  const cls = status === 'Final' ? 'ok' : status === 'In Review' ? 'warn' : 'info';
  return `<span class="chip ${cls}">${escapeHtml(status || '–')}</span>`;
}

/** Opens the editor for a task. */
export function openTaskEditor(taskId) {
  const hit = taskById(taskId);
  if (!hit) return;
  const { area, group, proc, task } = hit;
  const meta = getData().meta;

  const statusOpts = meta.statusValues
    .map((s) => `<option ${s === task.status ? 'selected' : ''}>${escapeHtml(s)}</option>`)
    .join('');
  const typeOpts = meta.afcTaskTypes
    .map((s) => `<option ${s === (task.afc?.type || '') ? 'selected' : ''}>${escapeHtml(s)}</option>`)
    .join('');
  const freqOpts = ['Monthly', 'Quarterly', 'Yearly']
    .map((s) => `<option ${s === task.frequency ? 'selected' : ''}>${s}</option>`)
    .join('');

  const procOpts = [];
  for (const a of getData().areas) {
    for (const g of a.groups) {
      for (const p of g.processes) {
        procOpts.push(
          `<option value="${p.id}" ${p.id === proc.id ? 'selected' : ''}>${escapeHtml(g.name)} › ${escapeHtml(p.name)}</option>`
        );
      }
    }
  }

  const otherTasks = allTasks().filter((t) => t.task.id !== task.id);
  const depOpts = otherTasks
    .map(
      (t) =>
        `<option value="${t.task.id}" ${(task.dependsOn || []).includes(t.task.id) ? 'selected' : ''}>${t.task.id} – ${escapeHtml(t.task.name)}</option>`
    )
    .join('');

  const countryRows = meta.countries
    .map((c) => {
      const cc = (task.countries || {})[c.code] || { applies: true, variant: null };
      return `<div class="country-row" data-code="${c.code}">
        <span class="code" title="${escapeHtml(c.name)}">${c.code}</span>
        <select class="c-applies">
          <option value="std" ${cc.applies !== false && !cc.variant ? 'selected' : ''}>Standard</option>
          <option value="var" ${cc.applies !== false && cc.variant ? 'selected' : ''}>Deviation</option>
          <option value="na" ${cc.applies === false ? 'selected' : ''}>n/a</option>
        </select>
        <input class="c-variant" placeholder="Deviation (short)" value="${escapeHtml(cc.variant || '')}" />
        <input class="c-reason" placeholder="Reason" value="${escapeHtml(cc.reason || '')}" />
      </div>`;
    })
    .join('');

  const comments = (task.comments || [])
    .map((c) => `<div class="comment"><b>${escapeHtml(c.who)}</b> <span class="muted">${escapeHtml(c.when)}</span><br>${escapeHtml(c.text)}</div>`)
    .join('');

  openDrawerHtml(`
    <h2>${escapeHtml(task.id)} – ${escapeHtml(task.name)}</h2>
    <div class="muted">${escapeHtml(area.name)} › ${escapeHtml(group.name)} › ${escapeHtml(proc.name)}</div>

    <div class="form-grid" id="task-form">
      <label class="full">Task name
        <input id="f-name" value="${escapeHtml(task.name)}" />
      </label>
      <label class="full">Description
        <textarea id="f-desc">${escapeHtml(task.description || '')}</textarea>
      </label>
      <label>Responsible (org.)
        <input id="f-owner" value="${escapeHtml(task.owner || '')}" />
      </label>
      <label>Status
        <select id="f-status">${statusOpts}</select>
      </label>
      <label>Responsible (R)
        <input id="f-raci-r" value="${escapeHtml(task.raci?.r || '')}" />
      </label>
      <label>Accountable (A)
        <input id="f-raci-a" value="${escapeHtml(task.raci?.a || '')}" />
      </label>
      <label>System
        <input id="f-system" value="${escapeHtml(task.system || '')}" />
      </label>
      <label>Transaction / app / job
        <input id="f-txn" value="${escapeHtml(task.transaction || '')}" />
      </label>
      <label>Closing day (workday offset)
        <input id="f-day" type="number" step="1" value="${task.closingDay ?? 0}" />
      </label>
      <label>Frequency
        <select id="f-freq">${freqOpts}</select>
      </label>
      <label>AFC task type
        <select id="f-afc-type">${typeOpts}</select>
      </label>
      <label>Planned duration (min)
        <input id="f-afc-dur" type="number" min="0" value="${task.afc?.duration ?? ''}" />
      </label>
      <label>Job name (for type Job)
        <input id="f-afc-job" value="${escapeHtml(task.afc?.jobName || '')}" />
      </label>
      <label>Harmonized (global template)
        <select id="f-harm">
          <option value="1" ${task.harmonized ? 'selected' : ''}>yes</option>
          <option value="0" ${!task.harmonized ? 'selected' : ''}>no</option>
        </select>
      </label>
      <label class="full">Predecessors (multi-select with Ctrl/Cmd)
        <select id="f-deps" multiple size="4">${depOpts}</select>
      </label>
      <label class="full">Process (move to…)
        <select id="f-move">${procOpts}</select>
      </label>
    </div>

    <fieldset class="country-block" id="country-block">
      <legend>Country scope & deviations</legend>
      ${countryRows}
    </fieldset>

    <div class="drawer-actions">
      <button class="btn primary" id="f-save">Save</button>
      <button class="btn" id="f-goto-bpmn" title="Show process in the BPMN flow">Process flow ↗</button>
      <button class="btn" id="f-delete" style="margin-left:auto;color:var(--bad)">Delete</button>
    </div>

    <div class="comments">
      <b>Comments</b>
      ${comments || '<div class="muted">No comments yet.</div>'}
      <div class="comment-add">
        <input id="c-who" placeholder="Name" style="max-width:110px" value="${escapeHtml(getEditor())}" />
        <input id="c-text" placeholder="Comment for the workshop…" />
        <button class="btn" id="c-add">+</button>
      </div>
    </div>
  `);

  const q = (sel) => document.querySelector(sel);

  q('#f-save').onclick = () => {
    const countries = {};
    document.querySelectorAll('#country-block .country-row').forEach((row) => {
      const code = row.dataset.code;
      const mode = row.querySelector('.c-applies').value;
      const variant = row.querySelector('.c-variant').value.trim();
      const reason = row.querySelector('.c-reason').value.trim();
      if (mode === 'na') countries[code] = { applies: false, variant: null };
      else if (mode === 'var') countries[code] = { applies: true, variant: variant || 'Deviation (details pending)', reason: reason || null };
      else countries[code] = { applies: true, variant: null };
    });
    updateTask(task.id, {
      name: q('#f-name').value.trim() || task.name,
      description: q('#f-desc').value.trim(),
      owner: q('#f-owner').value.trim(),
      status: q('#f-status').value,
      raci: { r: q('#f-raci-r').value.trim(), a: q('#f-raci-a').value.trim() },
      system: q('#f-system').value.trim(),
      transaction: q('#f-txn').value.trim(),
      closingDay: parseInt(q('#f-day').value, 10) || 0,
      frequency: q('#f-freq').value,
      harmonized: q('#f-harm').value === '1',
      countries,
      afc: {
        type: q('#f-afc-type').value,
        duration: q('#f-afc-dur').value === '' ? null : parseInt(q('#f-afc-dur').value, 10),
        jobName: q('#f-afc-job').value.trim() || null,
      },
      dependsOn: [...q('#f-deps').selectedOptions].map((o) => o.value),
    });
    const targetProc = q('#f-move').value;
    if (targetProc && targetProc !== proc.id) moveNode(task.id, targetProc);
    closeDrawer();
    showToast(`${task.id} saved.`);
  };

  q('#f-delete').onclick = () => {
    if (confirm(`Delete task ${task.id} “${task.name}”?`)) {
      deleteTask(task.id);
      closeDrawer();
      showToast(`${task.id} deleted.`);
    }
  };

  q('#f-goto-bpmn').onclick = () => {
    closeDrawer();
    sessionStorage.setItem('bpmn-focus', proc.id);
    location.hash = 'bpmn';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  q('#c-add').onclick = () => {
    const text = q('#c-text').value.trim();
    if (!text) return;
    addComment(task.id, q('#c-who').value.trim(), text);
    openTaskEditor(task.id); // re-render
  };
}

/** Manage countries: add, rename, change code/company codes, delete. */
export function openCountryManager() {
  const meta = getData().meta;
  const nTasks = allTasks().length;
  const rows = (meta.countries || [])
    .map(
      (c) => `<tr data-code="${escapeHtml(c.code)}">
        <td><input class="cm-code" value="${escapeHtml(c.code)}" maxlength="6" /></td>
        <td><input class="cm-name" value="${escapeHtml(c.name || '')}" /></td>
        <td><input class="cm-ent" value="${escapeHtml((c.entities || []).join(', '))}" placeholder="Company codes, comma-separated" /></td>
        <td><button class="btn mini danger cm-del" title="Delete country">🗑</button></td>
      </tr>`
    )
    .join('');

  openDrawerHtml(`
    <h2>Manage Countries</h2>
    <div class="muted" style="margin-bottom:10px">
      Code (e.g. DE), name and optional company codes. A new country is initially added as “Standard”
      for all ${nTasks} tasks; deleting removes it from the matrix and from every task.
    </div>
    <table class="cm-table">
      <thead><tr><th style="width:74px">Code</th><th>Name</th><th>Company codes</th><th style="width:34px"></th></tr></thead>
      <tbody id="cm-body">${rows || '<tr><td colspan="4" class="muted">No countries yet.</td></tr>'}</tbody>
    </table>
    <div class="cm-add">
      <input id="cm-new-code" placeholder="Code" maxlength="6" />
      <input id="cm-new-name" placeholder="Name" />
      <button class="btn primary" id="cm-add-btn">+ Add country</button>
    </div>
  `);

  const body = document.getElementById('cm-body');
  body.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-code]');
    if (!tr) return;
    const code = tr.dataset.code;
    if (e.target.classList.contains('cm-name')) {
      updateCountry(code, { name: e.target.value });
    } else if (e.target.classList.contains('cm-ent')) {
      updateCountry(code, { entities: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) });
    } else if (e.target.classList.contains('cm-code')) {
      const res = updateCountry(code, { code: e.target.value });
      if (res && res.error) showToast(res.error, 5000);
      openCountryManager();
    }
  });
  body.addEventListener('click', (e) => {
    const del = e.target.closest('.cm-del');
    if (!del) return;
    const code = del.closest('tr[data-code]').dataset.code;
    if (confirm(`Delete country “${code}”? It will be removed from every task.`)) {
      deleteCountry(code);
      openCountryManager();
      showToast(`Country ${code} deleted.`);
    }
  });
  document.getElementById('cm-add-btn').onclick = () => {
    const res = addCountry(document.getElementById('cm-new-code').value, document.getElementById('cm-new-name').value);
    if (res && res.error) { showToast(res.error, 5000); return; }
    openCountryManager();
    showToast(`Country ${res.code} added.`);
  };
}
