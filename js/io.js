// Import/Export: JSON-Snapshot, Excel (SheetJS, global XLSX), AFC-CSV.

import { getData, setData, allTasks, outlineNumbers } from './state.js';

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(content, filename, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- JSON ----------------------------------------------------------------

export function exportJson() {
  downloadBlob(JSON.stringify(getData(), null, 2), `bpml-${stamp()}.json`, 'application/json');
}

export function importJsonFile(file) {
  return file.text().then((txt) => {
    const parsed = JSON.parse(txt);
    if (!parsed.meta || !parsed.areas) throw new Error('Not a valid BPML snapshot (meta/areas missing).');
    setData(parsed, `JSON import “${file.name}”`);
  });
}

// ---- Excel-Export --------------------------------------------------------

export function exportExcel() {
  const data = getData();
  const codes = data.meta.countries.map((c) => c.code);
  const rows = allTasks().map(({ area, group, proc, task }) => {
    const row = {
      'ID': task.id,
      'Area': area.name,
      'Process Group': group.name,
      'Process': proc.name,
      'Task': task.name,
      'Description': task.description || '',
      'Harmonized': task.harmonized ? 'yes' : 'no',
      'Responsible': task.owner || '',
      'System': task.system || '',
      'Transaction': task.transaction || '',
      'WD': task.closingDay,
      'Frequency': task.frequency || '',
      'Predecessors': (task.dependsOn || []).join(', '),
      'AFC Type': task.afc?.type || '',
      'Duration (min)': task.afc?.duration ?? '',
      'Job': task.afc?.jobName || '',
      'Status': task.status || '',
    };
    for (const code of codes) {
      const c = (task.countries || {})[code];
      row[code] = !c || c.applies === false ? 'n/a' : c.variant ? c.variant : 'Standard';
    }
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BPML');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([out]), `bpml-${stamp()}.xlsx`, 'application/octet-stream');
}

// ---- Excel-Import --------------------------------------------------------

const COLUMN_ALIASES = {
  area: ['bereich', 'area', 'l1', 'prozessbereich', 'process area'],
  group: ['prozessgruppe', 'group', 'l2', 'process group', 'teilprozess'],
  process: ['prozess', 'process', 'l3'],
  name: ['task', 'aktivität', 'aktivitaet', 'activity', 'l4', 'task name', 'tätigkeit', 'taetigkeit'],
  description: ['beschreibung', 'description', 'details'],
  owner: ['verantwortlich', 'owner', 'responsible', 'verantwortung', 'rolle'],
  system: ['system'],
  transaction: ['transaktion', 'transaction', 'tcode', 't-code', 'app'],
  closingDay: ['tag', 'closing day', 'workday', 'wt', 'arbeitstag', 'day', 'offset'],
  frequency: ['frequenz', 'frequency', 'häufigkeit', 'haeufigkeit', 'rhythmus'],
  dependsOn: ['vorgänger', 'vorgaenger', 'predecessor', 'depends', 'abhängigkeit', 'abhaengigkeit'],
  afcType: ['afc-typ', 'afc typ', 'task type', 'tasktyp', 'typ', 'type'],
  status: ['status'],
  harmonized: ['harmonisiert', 'harmonized', 'global template', 'standard'],
  id: ['id', 'nr', 'no', 'nummer'],
  duration: ['dauer (min)', 'dauer', 'duration', 'duration (min)', 'planned duration'],
  jobName: ['job', 'job-name', 'jobname', 'job name', 'job template', 'job-vorlage'],
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

function parseClosingDay(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return Math.round(v);
  const m = /([+-]?\s*\d+)/.exec(String(v).replace(/wt|k|day|tag/gi, ''));
  return m ? parseInt(m[1].replace(/\s/g, ''), 10) : 0;
}

const STANDARD_CELL = /^(x|✓|✔|ja|yes|std|standard|s)$/i;
const NA_CELL = /^(-|–|n\/a|na|nein|no|nicht relevant|)$/i;

/**
 * Liest die erste Tabelle der Arbeitsmappe und baut daraus die Hierarchie.
 * Länderspalten werden über die in meta.countries definierten Codes/Namen
 * erkannt; unbekannte Großbuchstaben-Spalten (2–3 Zeichen) werden als neues
 * Land übernommen.
 */
// Erkennt einen von dieser App erzeugten Export am versteckten „_bpml"-Blatt
// und lädt den eingebetteten Snapshot verlustfrei.
function loadEmbeddedSnapshot(wb, file) {
  if (!wb.SheetNames.includes('_bpml')) return null;
  const sheet = wb.Sheets['_bpml'];
  const cellVal = (addr) => (sheet[addr] ? sheet[addr].v : undefined);
  if (cellVal('A1') !== 'BPML-JSON-V1') return null;
  const chunks = Number(cellVal('B1')) || 0;
  let json = '';
  for (let r = 2; r < 2 + chunks; r++) json += cellVal(`A${r}`) || '';
  const parsed = JSON.parse(json);
  if (!parsed.meta || !parsed.areas) throw new Error('Embedded snapshot is incomplete.');
  const n = allTasksCount(parsed);
  setData(parsed, `Excel snapshot “${file.name}” loaded (${n} tasks)`);
  return { tasks: n, sheet: '_bpml', unmapped: [], countries: [], snapshot: true };
}

function allTasksCount(d) {
  let n = 0;
  for (const a of d.areas || []) for (const g of a.groups || []) for (const p of g.processes || []) n += (p.tasks || []).length;
  return n;
}

export function importExcelFile(file) {
  return file.arrayBuffer().then((buf) => {
    const wb = XLSX.read(buf, { type: 'array' });
    const embedded = loadEmbeddedSnapshot(wb, file);
    if (embedded) return embedded;
    const wsName = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wsName], { defval: '' });
    if (!rows.length) throw new Error(`Sheet “${wsName}” is empty.`);

    const headers = Object.keys(rows[0]);
    const map = {};
    const countryCols = [];
    const known = getData().meta.countries;
    const unmapped = [];

    for (const h of headers) {
      const n = normalizeHeader(h);
      let matched = false;
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.includes(n)) { map[field] = h; matched = true; break; }
      }
      if (matched) continue;
      const country =
        known.find((c) => c.code.toLowerCase() === n || c.name.toLowerCase() === n) ||
        (/^[a-z]{2}$/i.test(n) ? { code: h.toUpperCase(), name: h.toUpperCase() } : null);
      if (country) countryCols.push({ header: h, code: country.code, name: country.name });
      else unmapped.push(h);
    }
    if (!map.name) throw new Error('No task column found (expected e.g. “Task” or “Activity”).');

    const meta = JSON.parse(JSON.stringify(getData().meta));
    for (const cc of countryCols) {
      if (!meta.countries.some((c) => c.code === cc.code)) {
        meta.countries.push({ code: cc.code, name: cc.name, entities: [] });
      }
    }

    const areas = [];
    let aSeq = 0, gSeq = 0, pSeq = 0, tSeq = 0;
    const findOrPush = (arr, name, make) => {
      let hit = arr.find((x) => x.name === name);
      if (!hit) { hit = make(); arr.push(hit); }
      return hit;
    };

    for (const row of rows) {
      const taskName = String(row[map.name] || '').trim();
      if (!taskName) continue;
      const areaName = String(row[map.area] || 'Allgemein').trim() || 'Allgemein';
      const groupName = String(row[map.group] || 'Allgemein').trim() || 'Allgemein';
      const procName = String(row[map.process] || groupName).trim() || groupName;

      const area = findOrPush(areas, areaName, () => ({ id: `A${++aSeq}`, name: areaName, groups: [] }));
      const group = findOrPush(area.groups, groupName, () => ({ id: `G${++gSeq}`, name: groupName, processes: [] }));
      const proc = findOrPush(group.processes, procName, () => ({ id: `P${++pSeq}`, name: procName, tasks: [] }));

      const countries = {};
      for (const c of meta.countries) countries[c.code] = { applies: true, variant: null };
      for (const cc of countryCols) {
        const raw = String(row[cc.header] ?? '').trim();
        if (NA_CELL.test(raw)) countries[cc.code] = { applies: false, variant: null };
        else if (STANDARD_CELL.test(raw)) countries[cc.code] = { applies: true, variant: null };
        else countries[cc.code] = { applies: true, variant: raw };
      }

      const harmRaw = map.harmonized ? String(row[map.harmonized]).trim().toLowerCase() : '';
      proc.tasks.push({
        id: map.id && String(row[map.id]).trim() ? String(row[map.id]).trim() : `T${++tSeq}`,
        name: taskName,
        description: map.description ? String(row[map.description]).trim() : '',
        harmonized: harmRaw ? /^(ja|yes|x|✓|true|1)$/.test(harmRaw) : !Object.values(countries).some((c) => c.variant),
        countries,
        owner: map.owner ? String(row[map.owner]).trim() : '',
        raci: { r: '', a: '' },
        system: map.system ? String(row[map.system]).trim() : '',
        transaction: map.transaction ? String(row[map.transaction]).trim() : '',
        closingDay: parseClosingDay(map.closingDay ? row[map.closingDay] : 0),
        frequency: map.frequency ? String(row[map.frequency]).trim() || 'Monthly' : 'Monthly',
        dependsOn: map.dependsOn
          ? String(row[map.dependsOn]).split(/[,;]/).map((s) => s.trim()).filter(Boolean)
          : [],
        afc: {
          type: map.afcType ? String(row[map.afcType]).trim() || 'Manual' : 'Manual',
          duration: map.duration && row[map.duration] !== '' ? Math.round(Number(row[map.duration])) || 30 : 30,
          jobName: map.jobName ? String(row[map.jobName]).trim() || null : null,
        },
        status: map.status ? String(row[map.status]).trim() || meta.statusValues[0] : meta.statusValues[0],
        comments: [],
      });
    }

    const days = [];
    for (const a of areas) for (const g of a.groups) for (const p of g.processes) for (const t of p.tasks) days.push(t.closingDay);
    meta.closingDayRange = {
      from: Math.min(-5, ...days),
      to: Math.max(10, ...days),
    };

    setData(
      { meta, areas, changeLog: getData().changeLog || [] },
      `Excel import “${file.name}” (${days.length} tasks, sheet “${wsName}”)`
    );
    return { tasks: days.length, sheet: wsName, unmapped, countries: countryCols.map((c) => c.code) };
  });
}

// ---- AFC-Export ----------------------------------------------------------

export function exportAfcCsv() {
  const sep = ';';
  const esc = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const no = outlineNumbers();
  const header = [
    'Folder', 'No.', 'Task Name', 'Task Type', 'Closing Day Offset',
    'Responsible', 'Accountable', 'Planned Duration (min)', 'Job Template',
    'Predecessors', 'Frequency', 'Description', 'Countries', 'Status',
  ];
  const lines = [header.join(sep)];
  for (const { group, task } of allTasks()) {
    const scope = Object.entries(task.countries || {})
      .filter(([, c]) => c.applies !== false)
      .map(([code, c]) => (c.variant ? `${code}*` : code))
      .join(', ');
    lines.push([
      esc(group.name), esc(no.get(task.id) || ''), esc(task.name), esc(task.afc?.type || 'Manual'),
      esc(task.closingDay), esc(task.raci?.r || task.owner || ''), esc(task.raci?.a || ''),
      esc(task.afc?.duration ?? ''), esc(task.afc?.jobName || ''),
      esc((task.dependsOn || []).map((d) => no.get(d) || d).join(', ')), esc(task.frequency || ''),
      esc(task.description || ''), esc(scope), esc(task.status || ''),
    ].join(sep));
  }
  downloadBlob('﻿' + lines.join('\n'), `afc-tasks-${stamp()}.csv`, 'text/csv;charset=utf-8');
}

export function exportAfcJson() {
  const no = outlineNumbers();
  const folders = new Map();
  for (const { group, task } of allTasks()) {
    if (!folders.has(group.id)) folders.set(group.id, { folder: group.name, tasks: [] });
    folders.get(group.id).tasks.push({
      no: no.get(task.id) || '',
      name: task.name,
      type: task.afc?.type || 'Manual',
      closingDayOffset: task.closingDay,
      responsible: task.raci?.r || task.owner || '',
      accountable: task.raci?.a || '',
      plannedDurationMinutes: task.afc?.duration ?? null,
      jobTemplate: task.afc?.jobName || null,
      predecessors: (task.dependsOn || []).map((d) => no.get(d) || d),
      frequency: task.frequency || null,
      countries: Object.entries(task.countries || {})
        .filter(([, c]) => c.applies !== false)
        .map(([code, c]) => ({ code, variant: c.variant || null })),
    });
  }
  const payload = { taskListTemplate: getData().meta.title || 'BPML', folders: [...folders.values()] };
  downloadBlob(JSON.stringify(payload, null, 2), `afc-tasks-${stamp()}.json`, 'application/json');
}
