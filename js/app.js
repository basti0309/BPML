import { initState, getData, onChange, resetToSeed, undo, redo, canUndo, canRedo, getEditor, setEditor } from './state.js';
import { exportJson, importJsonFile, importExcelFile } from './io.js';
import { exportFormattedExcel } from './xlsx-export.js';
import { renderTable } from './views/table.js';
import { renderMatrix } from './views/matrix.js';
import { renderCalendar } from './views/calendar.js';
import { renderBpmn } from './views/bpmn.js';
import { renderAfc } from './views/afc.js';
import { closeDrawer, showToast, openDrawerHtml, openCountryManager } from './editor.js';

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
    ed.title = name ? `Bearbeiter: ${name} (klicken zum Ändern)` : 'Bearbeiter-Name setzen (für Protokoll & Kommentare)';
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

  document.getElementById('btn-undo').onclick = () => { if (undo()) showToast('Rückgängig gemacht.'); };
  document.getElementById('btn-redo').onclick = () => { if (redo()) showToast('Wiederhergestellt.'); };

  document.getElementById('btn-editor').onclick = () => {
    const name = prompt('Dein Name (erscheint im Änderungsprotokoll und bei Kommentaren):', getEditor());
    if (name !== null) { setEditor(name); syncToolbar(); showToast(name.trim() ? `Bearbeiter: ${name.trim()}` : 'Bearbeiter zurückgesetzt.'); }
  };

  document.getElementById('btn-countries').onclick = () => openCountryManager();

  // Tastenkürzel für Undo/Redo – nur außerhalb von Eingabefeldern (dort greift
  // die native Text-Rückgängig-Funktion).
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); if (undo()) showToast('Rückgängig gemacht.'); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); if (redo()) showToast('Wiederhergestellt.'); }
  });

  document.getElementById('btn-import-excel').onclick = () => fileExcel.click();
  document.getElementById('btn-import-json').onclick = () => fileJson.click();
  document.getElementById('btn-export-excel').onclick = async () => {
    try {
      await exportFormattedExcel(getData());
      showToast('Excel-Export erstellt (6 Blätter: Deckblatt, BPML, Länder-Matrix, Länderspezifika, Kalender, AFC).', 5000);
    } catch (err) {
      showToast(`Excel-Export fehlgeschlagen: ${err.message}`, 7000);
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
        msg = `Stand aus „${f.name}“ geladen: ${res.tasks} Tasks.`;
      } else {
        msg = `Excel importiert: ${res.tasks} Tasks aus „${res.sheet}“`;
        if (res.countries.length) msg += `, Länder: ${res.countries.join(', ')}`;
        if (res.unmapped.length) msg += ` – ignorierte Spalten: ${res.unmapped.join(', ')}`;
      }
      showToast(msg, 6000);
    } catch (err) {
      showToast(`Import fehlgeschlagen: ${err.message}`, 8000);
    }
  };

  fileJson.onchange = async () => {
    const f = fileJson.files[0];
    fileJson.value = '';
    if (!f) return;
    try {
      await importJsonFile(f);
      showToast(`JSON „${f.name}“ importiert.`);
    } catch (err) {
      showToast(`Import fehlgeschlagen: ${err.message}`, 8000);
    }
  };

  document.getElementById('btn-reset').onclick = () => {
    if (confirm('Alle lokalen Änderungen verwerfen und auf die versionierten Seed-Daten zurücksetzen?')) {
      resetToSeed();
    }
  };

  document.getElementById('btn-log').onclick = () => {
    const log = getData().changeLog || [];
    const items = log.length
      ? log.map((l) => `<li><b>${l.when}</b>${l.who ? ` · ${escapeHtml(l.who)}` : ''} – ${escapeHtml(l.what)}</li>`).join('')
      : '<li>Noch keine Änderungen.</li>';
    openDrawerHtml(`<h2>Änderungsprotokoll</h2><ul class="log-list">${items}</ul>`);
  };

  document.getElementById('drawer-close').onclick = closeDrawer;
  document.getElementById('drawer').addEventListener('click', (e) => {
    if (e.target.id === 'drawer') closeDrawer();
  });

  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

main();
