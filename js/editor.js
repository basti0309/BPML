// Gemeinsamer Detail-Editor (Drawer) für Tasks + Toast-Helfer.

import { getData, taskById, updateTask, deleteTask, addComment, allTasks, moveNode, getEditor } from './state.js';

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
  if (d === 0) return 'WT0';
  return d > 0 ? `WT+${d}` : `WT${d}`;
}

export function statusChip(status) {
  const cls = status === 'Final' ? 'ok' : status === 'In Abstimmung' ? 'warn' : 'info';
  return `<span class="chip ${cls}">${escapeHtml(status || '–')}</span>`;
}

/** Öffnet den Editor für einen Task. */
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
  const freqOpts = ['monatlich', 'quartalsweise', 'jährlich']
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
          <option value="var" ${cc.applies !== false && cc.variant ? 'selected' : ''}>Abweichung</option>
          <option value="na" ${cc.applies === false ? 'selected' : ''}>n/a</option>
        </select>
        <input class="c-variant" placeholder="Abweichung (kurz)" value="${escapeHtml(cc.variant || '')}" />
        <input class="c-reason" placeholder="Begründung" value="${escapeHtml(cc.reason || '')}" />
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
      <label class="full">Task-Name
        <input id="f-name" value="${escapeHtml(task.name)}" />
      </label>
      <label class="full">Beschreibung
        <textarea id="f-desc">${escapeHtml(task.description || '')}</textarea>
      </label>
      <label>Verantwortlich (Org.)
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
      <label>Transaktion / App / Job
        <input id="f-txn" value="${escapeHtml(task.transaction || '')}" />
      </label>
      <label>Closing Day (Workday-Offset)
        <input id="f-day" type="number" step="1" value="${task.closingDay ?? 0}" />
      </label>
      <label>Frequenz
        <select id="f-freq">${freqOpts}</select>
      </label>
      <label>AFC-Task-Typ
        <select id="f-afc-type">${typeOpts}</select>
      </label>
      <label>Geplante Dauer (Min)
        <input id="f-afc-dur" type="number" min="0" value="${task.afc?.duration ?? ''}" />
      </label>
      <label>Job-Name (bei Typ Job)
        <input id="f-afc-job" value="${escapeHtml(task.afc?.jobName || '')}" />
      </label>
      <label>Harmonisiert (Global Template)
        <select id="f-harm">
          <option value="1" ${task.harmonized ? 'selected' : ''}>ja</option>
          <option value="0" ${!task.harmonized ? 'selected' : ''}>nein</option>
        </select>
      </label>
      <label class="full">Vorgänger (Mehrfachauswahl mit Strg/Cmd)
        <select id="f-deps" multiple size="4">${depOpts}</select>
      </label>
      <label class="full">Prozess (Verschieben nach…)
        <select id="f-move">${procOpts}</select>
      </label>
    </div>

    <fieldset class="country-block" id="country-block">
      <legend>Länder-Scope & Abweichungen</legend>
      ${countryRows}
    </fieldset>

    <div class="drawer-actions">
      <button class="btn primary" id="f-save">Speichern</button>
      <button class="btn" id="f-goto-bpmn" title="Prozess im BPMN-Flow anzeigen">Prozess-Flow ↗</button>
      <button class="btn" id="f-delete" style="margin-left:auto;color:var(--bad)">Löschen</button>
    </div>

    <div class="comments">
      <b>Kommentare</b>
      ${comments || '<div class="muted">Noch keine Kommentare.</div>'}
      <div class="comment-add">
        <input id="c-who" placeholder="Name" style="max-width:110px" value="${escapeHtml(getEditor())}" />
        <input id="c-text" placeholder="Kommentar für den Workshop…" />
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
      else if (mode === 'var') countries[code] = { applies: true, variant: variant || 'Abweichung (Details offen)', reason: reason || null };
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
    showToast(`${task.id} gespeichert.`);
  };

  q('#f-delete').onclick = () => {
    if (confirm(`Task ${task.id} „${task.name}“ wirklich löschen?`)) {
      deleteTask(task.id);
      closeDrawer();
      showToast(`${task.id} gelöscht.`);
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
    openTaskEditor(task.id); // neu rendern
  };
}
