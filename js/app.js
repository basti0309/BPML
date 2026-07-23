import {
  initState, getData, onChange, resetToSeed, undo, redo, canUndo, canRedo, getEditor, setEditor,
  backupNow, backupIfChanged, listBackups, getBackup, restoreBackup, deleteBackup, schemaVersion,
} from './state.js';
import { exportJson, importJsonFile, importExcelFile } from './io.js';
import { exportFormattedExcel } from './xlsx-export.js';
import { renderTable } from './views/table.js';
import { renderMatrix } from './views/matrix.js';
import { renderCalendar } from './views/calendar.js';
import { renderBpmn } from './views/bpmn.js';
import { renderAfc } from './views/afc.js';
import { closeDrawer, showToast, openDrawerHtml, openCountryManager, openFieldValueManager } from './editor.js';

const views = {
  table: renderTable,
  matrix: renderMatrix,
  calendar: renderCalendar,
  bpmn: renderBpmn,
  afc: renderAfc,
};

let current = location.hash.replace('#', '') || 'table';
if (!views[current]) current = 'table';

function render() {
  const root = document.getElementById('view-root');
  root.innerHTML = '';
  views[current](root);
  document.querySelectorAll('#nav-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === current);
  });
  const meta = getData().meta;
  document.getElementById('app-title').textContent = meta.title || 'BPML';
  document.getElementById('app-client').textContent = meta.client || '';
  syncToolbar();
}

function syncToolbar() {
  const u = document.getElementById('btn-undo');
  const r = document.getElementById('btn-redo');
  if (u) u.disabled = !canUndo();
  if (r) r.disabled = !canRedo();
  const ed = document.getElementById('btn-editor');
  if (ed) {
    const name = getEditor();
    ed.textContent = name ? `👤 ${name}` : '👤';
    ed.title = name ? `Editor: ${name} (click to change)` : 'Set editor name (for change log & comments)';
  }
}

function switchView(name) {
  current = name;
  location.hash = name;
  closeDrawer();
  render();
}

async function main() {
  await initState();

  document.getElementById('nav-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) switchView(btn.dataset.view);
  });

  window.addEventListener('hashchange', () => {
    const name = location.hash.replace('#', '');
    if (views[name] && name !== current) switchView(name);
  });

  onChange(render);

  // ---- Toolbar ----
  const fileExcel = document.getElementById('file-excel');
  const fileJson = document.getElementById('file-json');

  document.getElementById('btn-undo').onclick = () => { if (undo()) showToast('Undone.'); };
  document.getElementById('btn-redo').onclick = () => { if (redo()) showToast('Redone.'); };

  document.getElementById('btn-editor').onclick = () => {
    const name = prompt('Your name (appears in the change log and on comments):', getEditor());
    if (name !== null) { setEditor(name); syncToolbar(); showToast(name.trim() ? `Editor: ${name.trim()}` : 'Editor name cleared.'); }
  };

  document.getElementById('btn-countries').onclick = () => openCountryManager();
  document.getElementById('btn-fields').onclick = () => openFieldValueManager();

  // Keyboard shortcuts for undo/redo – only outside input fields (native text
  // undo applies there).
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); if (undo()) showToast('Undone.'); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); if (redo()) showToast('Redone.'); }
  });

  document.getElementById('btn-import-excel').onclick = () => fileExcel.click();
  document.getElementById('btn-import-json').onclick = () => fileJson.click();
  document.getElementById('btn-export-excel').onclick = async () => {
    try {
      await exportFormattedExcel(getData());
      showToast('Excel export created (6 sheets: Cover, BPML, Country Matrix, Country Specifics, Calendar, AFC).', 5000);
    } catch (err) {
      showToast(`Excel export failed: ${err.message}`, 7000);
    }
  };
  document.getElementById('btn-export-json').onclick = () => exportJson();

  fileExcel.onchange = async () => {
    const f = fileExcel.files[0];
    fileExcel.value = '';
    if (!f) return;
    try {
      const res = await importExcelFile(f);
      let msg;
      if (res.snapshot) {
        msg = `State loaded from “${f.name}”: ${res.tasks} tasks.`;
      } else {
        msg = `Excel imported: ${res.tasks} tasks from “${res.sheet}”`;
        if (res.countries.length) msg += `, countries: ${res.countries.join(', ')}`;
        if (res.unmapped.length) msg += ` – ignored columns: ${res.unmapped.join(', ')}`;
      }
      showToast(msg, 6000);
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 8000);
    }
  };

  fileJson.onchange = async () => {
    const f = fileJson.files[0];
    fileJson.value = '';
    if (!f) return;
    try {
      await importJsonFile(f);
      showToast(`JSON “${f.name}” imported.`);
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 8000);
    }
  };

  document.getElementById('btn-reset').onclick = () => {
    if (confirm('Discard all local changes and reset to the versioned seed data?\n\nA backup is created first — you can restore it from 🗄 Backups.')) {
      resetToSeed();
    }
  };

  document.getElementById('btn-backups').onclick = () => renderBackups();

  document.getElementById('btn-log').onclick = () => {
    const log = getData().changeLog || [];
    const items = log.length
      ? log.map((l) => `<li><b>${l.when}</b>${l.who ? ` · ${escapeHtml(l.who)}` : ''} – ${escapeHtml(l.what)}</li>`).join('')
      : '<li>No changes yet.</li>';
    openDrawerHtml(`<h2>Change Log</h2><ul class="log-list">${items}</ul>`);
  };

  // Capture the final state when the tab is closed (only if it changed).
  window.addEventListener('beforeunload', () => backupIfChanged('session end'));

  document.getElementById('drawer-close').onclick = closeDrawer;
  document.getElementById('drawer').addEventListener('click', (e) => {
    if (e.target.id === 'drawer') closeDrawer();
  });

  render();
}

function renderBackups() {
  const backups = listBackups(); // oldest first: [{i, when, label, tasks}]
  const rows = backups.length
    ? backups
        .slice()
        .reverse()
        .map(
          (b) => `<li>
            <div class="bk-meta"><b>${b.when}</b> · ${escapeHtml(b.label)} · ${b.tasks} tasks</div>
            <div class="bk-actions">
              <button class="btn mini" data-restore="${b.i}">Restore</button>
              <button class="btn mini" data-download="${b.i}">⬇</button>
              <button class="btn mini danger" data-delete="${b.i}" title="Delete backup">🗑</button>
            </div>
          </li>`
        )
        .join('')
    : '<li class="muted">No backups yet.</li>';

  openDrawerHtml(`
    <h2>Backups &amp; restore</h2>
    <div class="muted" style="margin-bottom:10px">
      Automatic restore points (last 20) stored in this browser. They survive “Reset”, and one is
      made automatically before every reset/import and periodically while you work. For off-device
      safety, still export ⬇ JSON to your own storage now and then.
    </div>
    <div class="drawer-actions">
      <button class="btn primary" id="bk-now">Create backup now</button>
      <button class="btn" id="bk-dl-current">Download current (JSON)</button>
    </div>
    <ul class="log-list backup-list">${rows}</ul>
    <div class="muted" style="margin-top:8px">Data schema version: ${schemaVersion()}</div>
  `);

  document.getElementById('bk-now').onclick = () => { backupNow('manual'); renderBackups(); showToast('Backup created.'); };
  document.getElementById('bk-dl-current').onclick = () => exportJson();

  document.querySelector('.backup-list').addEventListener('click', (e) => {
    const r = e.target.closest('[data-restore]');
    const d = e.target.closest('[data-download]');
    const x = e.target.closest('[data-delete]');
    if (r) {
      if (confirm('Restore this backup? Your current state is backed up first.')) {
        if (restoreBackup(Number(r.dataset.restore))) { renderBackups(); showToast('Backup restored.'); }
      }
    } else if (d) {
      downloadBackup(Number(d.dataset.download));
    } else if (x) {
      if (confirm('Delete this backup?')) { deleteBackup(Number(x.dataset.delete)); renderBackups(); }
    }
  });
}

function downloadBackup(index) {
  const b = getBackup(index);
  if (!b) return;
  const blob = new Blob([JSON.stringify(b.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bpml-backup-${b.when.replace(/[: ]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

main();
