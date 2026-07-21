// Formatierter Excel-Export (ExcelJS): sechs Blätter – Deckblatt, BPML,
// Länder-Matrix, Länderspezifika, Abschlusskalender, AFC-Task-Liste.
// buildWorkbook() ist bewusst frei von DOM/State-Abhängigkeiten, damit sie
// unabhängig testbar bleibt; exportFormattedExcel() ist der Browser-Aufhänger.

// ---- Farbpalette (ARGB, an die App angelehnt) ------------------------------
const C = {
  navy: 'FF1F3B57', accent: 'FF0A6ED1', accSoft: 'FFE3F0FC',
  ok: 'FF1F8A4C', okSoft: 'FFE4F4EA', warn: 'FFB8860B', warnSoft: 'FFFBF1D5',
  crit: 'FFC0392B', critSoft: 'FFFBE7E4', na: 'FF97A3B4', naSoft: 'FFEEF1F5',
  white: 'FFFFFFFF', ink: 'FF1E2733', muted: 'FF66748A', line: 'FFD7DEE9', zebra: 'FFF5F8FC',
};
const TYPE_COLOR = {
  Manuell: 'FF0A6ED1', Job: 'FF6C4FB3', Workflow: 'FF0E7D74', Prüfung: 'FFB8860B', Meilenstein: 'FF334A63',
};
const FONT = 'Arial';
const thin = { style: 'thin', color: { argb: C.line } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

// ---- kleine Helfer ---------------------------------------------------------
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const fmtDay = (d) => (d === 0 ? 'WT0' : d > 0 ? `WT+${d}` : `WT${d}`);
const stamp = () => new Date().toISOString().slice(0, 10);

function styleHeaderRow(row, lastCol) {
  row.height = 24;
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, size: 10.5, bold: true, color: { argb: C.white } };
    cell.fill = fill(C.navy);
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = BORDER;
  }
}

function allTasks(data) {
  const out = [];
  for (const area of data.areas || [])
    for (const group of area.groups || [])
      for (const proc of group.processes || [])
        for (const task of proc.tasks || []) out.push({ area, group, proc, task });
  return out;
}

function harmonization(tasks, codes) {
  let std = 0, variant = 0, na = 0;
  for (const t of tasks)
    for (const code of codes) {
      const c = (t.countries || {})[code];
      if (!c || c.applies === false) na++;
      else if (c.variant) variant++;
      else std++;
    }
  const rel = std + variant;
  return { std, variant, na, pct: rel ? Math.round((std / rel) * 100) : 100 };
}

function findCycles(tasks) {
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn || []]));
  const cycles = [];
  const state = new Map();
  const path = [];
  const dfs = (id) => {
    state.set(id, 1); path.push(id);
    for (const p of deps.get(id) || []) {
      if (!deps.has(p)) continue;
      if (state.get(p) === 1) cycles.push([...path.slice(path.indexOf(p)), p]);
      else if (!state.get(p)) dfs(p);
    }
    path.pop(); state.set(id, 2);
  };
  for (const t of tasks) if (!state.get(t.id)) dfs(t.id);
  return cycles;
}

function statusFill(status) {
  if (status === 'Final') return { bg: C.okSoft, fg: C.ok };
  if (status === 'In Abstimmung') return { bg: C.warnSoft, fg: C.warn };
  return { bg: C.naSoft, fg: C.muted };
}

// ===========================================================================
export function buildWorkbook(ExcelJS, data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BPML-App';
  wb.created = new Date();
  const meta = data.meta || {};
  const codes = (meta.countries || []).map((c) => c.code);
  const tasksFlat = allTasks(data);
  const allT = tasksFlat.map((t) => t.task);
  const stats = harmonization(allT, codes);
  const cycles = findCycles(allT);

  buildCover(ExcelJS, wb, data, meta, codes, allT, stats, cycles);
  buildBpml(wb, data);
  buildMatrix(wb, data, meta, codes);
  buildSpecifics(wb, data, meta);
  buildCalendar(wb, data, meta, allT);
  buildAfc(wb, data);
  return wb;
}

// ---- 1) Deckblatt ----------------------------------------------------------
function buildCover(ExcelJS, wb, data, meta, codes, allT, stats, cycles) {
  const ws = wb.addWorksheet('Deckblatt', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 3 }, { width: 26 }, { width: 26 }, { width: 26 }, { width: 26 }];

  ws.mergeCells('B2:E2');
  const t = ws.getCell('B2');
  t.value = meta.title || 'BPML Einzelabschlüsse';
  t.font = { name: FONT, size: 20, bold: true, color: { argb: C.navy } };
  ws.getRow(2).height = 30;

  ws.mergeCells('B3:E3');
  const sub = ws.getCell('B3');
  sub.value = 'Business Process Master List · Export für Prozessdesign & SAP AFC';
  sub.font = { name: FONT, size: 11, italic: true, color: { argb: C.muted } };

  const metaRows = [
    ['Kunde', meta.client || '–'],
    ['Stand', stamp()],
    ['Version', meta.version ? String(meta.version) : '0.9 (Entwurf)'],
    ['Länder / Buchungskreise', codes.join(', ') || '–'],
  ];
  let r = 5;
  for (const [k, v] of metaRows) {
    ws.getCell(`B${r}`).value = k;
    ws.getCell(`B${r}`).font = { name: FONT, size: 10, bold: true, color: { argb: C.muted } };
    ws.mergeCells(`C${r}:E${r}`);
    ws.getCell(`C${r}`).value = v;
    ws.getCell(`C${r}`).font = { name: FONT, size: 10, color: { argb: C.ink } };
    r++;
  }

  // KPI-Kacheln
  r += 1;
  const kpis = [
    ['Tasks gesamt', allT.length, C.accent],
    ['Harmonisierungsgrad', `${stats.pct} %`, C.ok],
    ['Länderabweichungen', stats.variant, C.warn],
    ['Standard-Zellen', stats.std, C.navy],
  ];
  const kpiRow = r;
  kpis.forEach((k, i) => {
    const col = 2 + i;
    const c = ws.getCell(kpiRow, col);
    c.value = k[1];
    c.font = { name: FONT, size: 22, bold: true, color: { argb: k[2] } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.fill = fill(C.zebra); c.border = BORDER;
    const l = ws.getCell(kpiRow + 1, col);
    l.value = k[0];
    l.font = { name: FONT, size: 9.5, color: { argb: C.muted } };
    l.alignment = { vertical: 'top', horizontal: 'center', wrapText: true };
    l.fill = fill(C.zebra); l.border = BORDER;
  });
  ws.getRow(kpiRow).height = 34;
  ws.getRow(kpiRow + 1).height = 24;

  // Legende
  r = kpiRow + 3;
  sectionLabel(ws, `B${r}`, 'Legende');
  const legend = [
    ['✓  Standard – Teil des Global Template', C.ok],
    ['◐  Abweichung – lokale Besonderheit (Kommentar zeigt Details)', C.warn],
    ['–  nicht relevant für dieses Land', C.na],
    ['AFC-Typ: Manuell · Job · Workflow · Prüfung · Meilenstein (Farbe im Kalender)', C.accent],
  ];
  r++;
  for (const [text, argb] of legend) {
    ws.getCell(`B${r}`).value = '';
    ws.getCell(`B${r}`).fill = fill(argb); ws.getCell(`B${r}`).border = BORDER;
    ws.mergeCells(`C${r}:E${r}`);
    ws.getCell(`C${r}`).value = text;
    ws.getCell(`C${r}`).font = { name: FONT, size: 10, color: { argb: C.ink } };
    r++;
  }

  // Konsistenz-Checks
  r += 1;
  sectionLabel(ws, `B${r}`, 'Konsistenz-Checks für den AFC-Import');
  r++;
  const missing = [];
  for (const t of allT) {
    const m = [];
    if (!t.afc?.type) m.push('AFC-Typ');
    if (t.closingDay === null || t.closingDay === undefined) m.push('Closing Day');
    if (!(t.raci?.r || t.owner)) m.push('Verantwortlicher');
    if (t.afc?.type === 'Job' && !t.afc?.jobName) m.push('Job-Name');
    if (m.length) missing.push(`${t.id} – fehlt: ${m.join(', ')}`);
  }
  const checks = [
    missing.length ? `⚠  ${missing.length} Task(s) mit fehlenden Pflichtangaben` : '✓  Alle Tasks mit Typ, Offset & Verantwortlichem',
    cycles.length ? `⚠  ${cycles.length} zyklische Abhängigkeit(en)` : '✓  Keine zyklischen Abhängigkeiten',
  ];
  for (const line of checks) {
    ws.mergeCells(`B${r}:E${r}`);
    const c = ws.getCell(`B${r}`);
    c.value = line;
    const bad = line.startsWith('⚠');
    c.font = { name: FONT, size: 10, bold: true, color: { argb: bad ? C.warn : C.ok } };
    r++;
  }
  for (const line of missing.slice(0, 12)) {
    ws.mergeCells(`B${r}:E${r}`);
    ws.getCell(`B${r}`).value = `   ${line}`;
    ws.getCell(`B${r}`).font = { name: FONT, size: 9.5, color: { argb: C.muted } };
    r++;
  }
}

function sectionLabel(ws, ref, text) {
  const c = ws.getCell(ref);
  c.value = text.toUpperCase();
  c.font = { name: FONT, size: 9, bold: true, color: { argb: C.accent } };
}

// ---- 2) BPML (Hierarchie mit Gruppierung) ----------------------------------
function buildBpml(wb, data) {
  const ws = wb.addWorksheet('BPML', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
    properties: { outlineLevelRow: 2, summaryBelow: false },
    pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 },
  });
  const cols = [
    ['ID', 9], ['Task', 40], ['Beschreibung', 42], ['R', 18], ['A', 18], ['System', 14],
    ['Transaktion', 16], ['AFC-Typ', 12], ['WT', 8], ['Dauer', 8], ['Job', 16],
    ['Frequenz', 13], ['Vorgänger', 14], ['Harmon.', 12], ['Status', 15],
  ];
  const LAST = cols.length;
  ws.columns = cols.map(([, w]) => ({ width: w }));
  const header = ws.addRow(cols.map(([h]) => h));
  styleHeaderRow(header, LAST);

  for (const area of data.areas || []) {
    const nTasks = (area.groups || []).reduce((n, g) => n + g.processes.reduce((m, p) => m + p.tasks.length, 0), 0);
    const aRow = ws.addRow([`▾  ${area.name}   (${nTasks} Tasks)`]);
    aRow.outlineLevel = 0;
    ws.mergeCells(aRow.number, 1, aRow.number, LAST);
    styleBand(aRow, C.navy, C.white, 12);

    for (const group of area.groups || []) {
      const gRow = ws.addRow([`▾  ${group.name}`]);
      gRow.outlineLevel = 1;
      ws.mergeCells(gRow.number, 1, gRow.number, LAST);
      styleBand(gRow, C.accSoft, C.navy, 11);

      for (const proc of group.processes || []) {
        for (const task of proc.tasks || []) {
          const devs = Object.entries(task.countries || {})
            .filter(([, c]) => c.applies !== false && c.variant)
            .map(([code]) => code);
          const harm = devs.length ? `◐ ${devs.join(', ')}` : '✓';
          const row = ws.addRow([
            task.id, task.name, task.description || '', task.raci?.r || task.owner || '', task.raci?.a || '',
            task.system || '', task.transaction || '', task.afc?.type || '', fmtDay(task.closingDay ?? 0),
            task.afc?.duration ?? '', task.afc?.jobName || '', task.frequency || '',
            (task.dependsOn || []).join(', '), harm, task.status || '',
          ]);
          row.outlineLevel = 2;
          styleTaskRow(row, LAST);
          row.getCell(1).font = { name: FONT, size: 10, bold: true, color: { argb: C.accent } };
          row.getCell(9).alignment = { horizontal: 'center' };
          row.getCell(9).font = { name: 'Consolas', size: 10, color: { argb: C.ink } };
          // Harmonisierung
          const hc = row.getCell(14);
          hc.alignment = { horizontal: 'center' };
          hc.font = { name: FONT, size: 10, bold: true, color: { argb: devs.length ? C.warn : C.ok } };
          hc.fill = fill(devs.length ? C.warnSoft : C.okSoft);
          // Status
          const sc = row.getCell(15);
          const sf = statusFill(task.status);
          sc.alignment = { horizontal: 'center' };
          sc.font = { name: FONT, size: 9.5, bold: true, color: { argb: sf.fg } };
          sc.fill = fill(sf.bg);
        }
      }
    }
  }
}

function styleBand(row, bg, fg, size) {
  row.height = 20;
  const c = row.getCell(1);
  c.font = { name: FONT, size, bold: true, color: { argb: fg } };
  c.fill = fill(bg);
  c.alignment = { vertical: 'middle', horizontal: 'left' };
}

function styleTaskRow(row, lastCol) {
  row.height = 30;
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    if (!cell.font) cell.font = { name: FONT, size: 10, color: { argb: C.ink } };
    cell.alignment = Object.assign({ vertical: 'top', wrapText: true }, cell.alignment || {});
    cell.border = BORDER;
  }
}

// ---- 3) Länder-Matrix ------------------------------------------------------
function buildMatrix(wb, data, meta, codes) {
  const ws = wb.addWorksheet('Länder-Matrix', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1, showGridLines: false }],
  });
  ws.columns = [{ width: 46 }, ...codes.map(() => ({ width: 8 }))];
  const LAST = codes.length + 1;
  const header = ws.addRow(['Task', ...codes]);
  styleHeaderRow(header, LAST);
  for (let i = 2; i <= LAST; i++) header.getCell(i).alignment = { horizontal: 'center', vertical: 'middle' };

  for (const area of data.areas || []) {
    for (const group of area.groups || []) {
      const gTasks = group.processes.flatMap((p) => p.tasks);
      if (!gTasks.length) continue;
      const gs = harmonization(gTasks, codes);
      const gRow = ws.addRow([`${group.name}          harmonisiert: ${gs.pct} %`]);
      ws.mergeCells(gRow.number, 1, gRow.number, LAST);
      const gc = gRow.getCell(1);
      gc.font = { name: FONT, size: 10.5, bold: true, color: { argb: gs.pct >= 90 ? C.ok : gs.pct >= 70 ? C.warn : C.crit } };
      gc.fill = fill(C.accSoft);
      gRow.height = 19;

      for (const proc of group.processes)
        for (const task of proc.tasks) {
          const row = ws.addRow([`${task.id}  ${task.name}`, ...codes.map(() => '')]);
          row.height = 18;
          const nameCell = row.getCell(1);
          nameCell.font = { name: FONT, size: 10, color: { argb: C.ink } };
          nameCell.border = BORDER;
          codes.forEach((code, i) => {
            const cell = row.getCell(i + 2);
            const c = (task.countries || {})[code];
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = BORDER;
            cell.font = { name: FONT, size: 11, bold: true };
            if (!c || c.applies === false) {
              cell.value = '–'; cell.fill = fill(C.naSoft); cell.font.color = { argb: C.na };
            } else if (c.variant) {
              cell.value = '◐'; cell.fill = fill(C.warnSoft); cell.font.color = { argb: C.warn };
              cell.note = c.variant + (c.reason ? ` — ${c.reason}` : '');
            } else {
              cell.value = '✓'; cell.fill = fill(C.okSoft); cell.font.color = { argb: C.ok };
            }
          });
        }
    }
  }
}

// ---- 4) Länderspezifika ----------------------------------------------------
function buildSpecifics(wb, data, meta) {
  const ws = wb.addWorksheet('Länderspezifika', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 },
  });
  const cols = [
    ['Bereich', 26], ['Prozessgruppe', 26], ['Prozess', 24], ['Task-ID', 9], ['Task', 34],
    ['Land', 8], ['Abweichung', 38], ['Begründung', 28], ['Status', 15], ['Bestätigt', 11],
  ];
  const LAST = cols.length;
  ws.columns = cols.map(([, w]) => ({ width: w }));
  const header = ws.addRow(cols.map(([h]) => h));
  styleHeaderRow(header, LAST);

  let any = false;
  for (const { area, group, proc, task } of allTasks(data)) {
    for (const code of (meta.countries || []).map((c) => c.code)) {
      const c = (task.countries || {})[code];
      if (!c || c.applies === false || !c.variant) continue;
      any = true;
      const sf = statusFill(task.status);
      const row = ws.addRow([
        area.name, group.name, proc.name, task.id, task.name, code, c.variant, c.reason || '', task.status || '', '☐',
      ]);
      row.height = 26;
      for (let i = 1; i <= LAST; i++) {
        const cell = row.getCell(i);
        cell.font = { name: FONT, size: 10, color: { argb: C.ink } };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = BORDER;
      }
      row.getCell(4).font = { name: FONT, size: 10, bold: true, color: { argb: C.accent } };
      const lc = row.getCell(6);
      lc.alignment = { horizontal: 'center', vertical: 'middle' };
      lc.font = { name: 'Consolas', size: 10, bold: true, color: { argb: C.navy } };
      const sc = row.getCell(9);
      sc.alignment = { horizontal: 'center', vertical: 'middle' };
      sc.font = { name: FONT, size: 9.5, bold: true, color: { argb: sf.fg } };
      sc.fill = fill(sf.bg);
      row.getCell(10).alignment = { horizontal: 'center', vertical: 'middle' };
    }
  }
  if (!any) {
    const row = ws.addRow(['Keine Länderabweichungen – alle Tasks sind harmonisiert.']);
    ws.mergeCells(row.number, 1, row.number, LAST);
    row.getCell(1).font = { name: FONT, size: 10, italic: true, color: { argb: C.muted } };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ws.rowCount), column: LAST } };
}

// ---- 5) Abschlusskalender --------------------------------------------------
function buildCalendar(wb, data, meta, allT) {
  const ws = wb.addWorksheet('Abschlusskalender', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 },
  });
  const days = allT.map((t) => t.closingDay ?? 0);
  const from = Math.min(meta.closingDayRange?.from ?? -5, ...days);
  const to = Math.max(meta.closingDayRange?.to ?? 10, ...days);
  const dayList = [];
  for (let d = from; d <= to; d++) dayList.push(d);

  ws.columns = [{ width: 24 }, { width: 40 }, ...dayList.map(() => ({ width: 7 }))];
  const LAST = 2 + dayList.length;
  const header = ws.addRow(['Prozessgruppe', 'Task', ...dayList.map(fmtDay)]);
  styleHeaderRow(header, LAST);
  dayList.forEach((d, i) => {
    const cell = header.getCell(3 + i);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    if (d === 0) cell.fill = fill(C.accent);
  });

  let lastGroup = null;
  for (const area of data.areas || [])
    for (const group of area.groups || []) {
      const gtasks = group.processes.flatMap((p) => p.tasks);
      if (!gtasks.length) continue;
      for (const task of gtasks) {
        const row = ws.addRow([group.name === lastGroup ? '' : group.name, `${task.id}  ${task.name}`, ...dayList.map(() => '')]);
        lastGroup = group.name;
        row.height = 18;
        row.getCell(1).font = { name: FONT, size: 9.5, bold: true, color: { argb: C.muted } };
        row.getCell(1).alignment = { vertical: 'middle' };
        row.getCell(2).font = { name: FONT, size: 9.5, color: { argb: C.ink } };
        row.getCell(2).alignment = { vertical: 'middle' };
        row.getCell(2).border = BORDER;
        const type = task.afc?.type || 'Manuell';
        const argb = TYPE_COLOR[type] || TYPE_COLOR.Manuell;
        dayList.forEach((d, i) => {
          const cell = row.getCell(3 + i);
          cell.border = BORDER;
          if (d === 0) cell.fill = fill(C.accSoft);
          if ((task.closingDay ?? 0) === d) {
            cell.value = task.id;
            cell.fill = fill(argb);
            cell.font = { name: 'Consolas', size: 8.5, bold: true, color: { argb: C.white } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.note = `${task.name} · ${type} · ${fmtDay(d)}`;
          }
        });
      }
    }
  // Legende
  const leg = ws.addRow(['Legende', 'Manuell · Job · Workflow · Prüfung · Meilenstein   |   WT0 = Periodenstichtag']);
  leg.getCell(1).font = { name: FONT, size: 9, bold: true, color: { argb: C.accent } };
  leg.getCell(2).font = { name: FONT, size: 9, color: { argb: C.muted } };
}

// ---- 6) AFC-Task-Liste -----------------------------------------------------
function buildAfc(wb, data) {
  const ws = wb.addWorksheet('AFC-Task-Liste', {
    views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 },
  });
  const cols = [
    ['Folder', 22], ['Task ID', 9], ['Task Name', 40], ['Type', 12], ['Closing Day Offset', 10],
    ['Responsible', 20], ['Accountable', 20], ['Planned Duration (min)', 12], ['Job Template', 18],
    ['Predecessors', 14], ['Frequency', 13], ['Countries', 22], ['Status', 15],
  ];
  const LAST = cols.length;
  ws.columns = cols.map(([, w]) => ({ width: w }));
  const header = ws.addRow(cols.map(([h]) => h));
  styleHeaderRow(header, LAST);

  for (const { group, task } of allTasks(data)) {
    const scope = Object.entries(task.countries || {})
      .filter(([, c]) => c.applies !== false)
      .map(([code, c]) => (c.variant ? `${code}*` : code))
      .join(', ');
    const row = ws.addRow([
      group.name, task.id, task.name, task.afc?.type || 'Manuell', task.closingDay ?? 0,
      task.raci?.r || task.owner || '', task.raci?.a || '', task.afc?.duration ?? '', task.afc?.jobName || '',
      (task.dependsOn || []).join(', '), task.frequency || '', scope, task.status || '',
    ]);
    row.height = 16;
    for (let i = 1; i <= LAST; i++) {
      const cell = row.getCell(i);
      cell.font = { name: FONT, size: 9.5, color: { argb: C.ink } };
      cell.alignment = { vertical: 'middle' };
      cell.border = BORDER;
    }
    row.getCell(2).font = { name: FONT, size: 9.5, bold: true, color: { argb: C.accent } };
    row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
    const sf = statusFill(task.status);
    const sc = row.getCell(13);
    sc.font = { name: FONT, size: 9, bold: true, color: { argb: sf.fg } };
    sc.fill = fill(sf.bg);
    sc.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ws.rowCount), column: LAST } };
}

// ---- Browser-Aufhänger -----------------------------------------------------
export async function exportFormattedExcel(data) {
  const ExcelJS = window.ExcelJS;
  if (!ExcelJS) throw new Error('ExcelJS nicht geladen.');
  const wb = buildWorkbook(ExcelJS, data);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bpml-export-${stamp()}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
