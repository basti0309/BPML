// Zentrale Datenhaltung: lädt den Seed aus data/bpml.json, hält Änderungen in
// localStorage und benachrichtigt die Views über ein CustomEvent.

const LS_KEY = 'bpml-data-v1';
const ED_KEY = 'bpml-editor';
const BACKUP_KEY = 'bpml-backups-v1';
const HISTORY_MAX = 60;
const BACKUP_MAX = 20;            // rolling restore points kept in this browser
const BACKUP_DEBOUNCE_MS = 90000; // auto-backup ~90s after the last change
const SCHEMA_VERSION = 1;

let data = null;
const listeners = new Set();

// Undo/Redo: snapshots of the whole dataset. `committed` is the last saved state;
// each mutation pushes it onto the undo stack.
let committed = null;
const undoStack = [];
const redoStack = [];
const clone = (o) => JSON.parse(JSON.stringify(o));

// Auto-backup bookkeeping
let backupTimer = null;
let lastBackupHash = null;

export function getData() {
  return data;
}

// ---- Editor name (for change log & comments) -----------------------------
export function getEditor() {
  return localStorage.getItem(ED_KEY) || '';
}
export function setEditor(name) {
  const n = (name || '').trim();
  if (n) localStorage.setItem(ED_KEY, n);
  else localStorage.removeItem(ED_KEY);
}

// ---- Schema migration ----------------------------------------------------
// Runs on every load/import so an older state is upgraded to the current shape
// instead of breaking when the tool's data model evolves. Add future structural
// migrations keyed by version where indicated.
function migrate(d) {
  if (!d || typeof d !== 'object') return d;
  d.meta = d.meta || {};
  d.meta.countries = d.meta.countries || [];
  d.meta.statusValues = d.meta.statusValues && d.meta.statusValues.length ? d.meta.statusValues : ['Draft', 'In Review', 'Final'];
  d.meta.afcTaskTypes = d.meta.afcTaskTypes && d.meta.afcTaskTypes.length ? d.meta.afcTaskTypes : ['Manual', 'Job', 'Workflow', 'Check', 'Milestone'];
  d.meta.frequencyValues = d.meta.frequencyValues && d.meta.frequencyValues.length ? d.meta.frequencyValues : ['Monthly', 'Quarterly', 'Yearly', 'Ongoing'];
  d.areas = d.areas || [];
  d.changeLog = d.changeLog || [];
  for (const area of d.areas)
    for (const g of area.groups || [])
      for (const p of g.processes || [])
        for (const t of p.tasks || []) {
          t.countries = t.countries || {};
          t.afc = t.afc || { type: 'Manual', duration: null, jobName: null };
          t.raci = t.raci || { r: '', a: '' };
          t.dependsOn = t.dependsOn || [];
          t.comments = t.comments || [];
        }
  // Future structural migrations (example):
  //   const v = d.meta.schemaVersion || 0;
  //   if (v < 2) { /* transform */ }
  d.meta.schemaVersion = SCHEMA_VERSION;
  return d;
}

export async function initState() {
  const stored = localStorage.getItem(LS_KEY);
  if (stored) {
    try {
      data = migrate(JSON.parse(stored));
      committed = clone(data);
      lastBackupHash = JSON.stringify(data);
      writeLS();
      return data;
    } catch (e) {
      console.warn('localStorage data unreadable, loading seed', e);
    }
  }
  const res = await fetch('data/bpml.json');
  data = migrate(await res.json());
  committed = clone(data);
  lastBackupHash = JSON.stringify(data);
  writeLS();
  return data;
}

export function setData(next, logText) {
  backupNow('before import/load'); // keep the current state as a restore point
  data = migrate(next);
  if (logText) addLog(logText);
  persist();
}

export function resetToSeed() {
  backupNow('before reset'); // survives the reset (separate storage key)
  localStorage.removeItem(LS_KEY);
  location.reload();
}

function writeLS() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('localStorage full?', e);
  }
}

function persist(notifyViews = true) {
  if (notifyViews && committed !== null) {
    undoStack.push(committed);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack.length = 0;
  }
  committed = clone(data);
  writeLS();
  if (notifyViews) {
    scheduleAutoBackup();
    notify();
  }
}

// ---- Backups (restore points) --------------------------------------------
function countTasks(d) {
  let n = 0;
  for (const a of d.areas || []) for (const g of a.groups || []) for (const p of g.processes || []) n += (p.tasks || []).length;
  return n;
}
function readBackups() {
  try { return JSON.parse(localStorage.getItem(BACKUP_KEY)) || []; } catch (e) { return []; }
}
function writeBackups(list) {
  let arr = list.slice(-BACKUP_MAX);
  while (arr.length) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(arr)); return; }
    catch (e) { arr = arr.slice(1); } // drop oldest on quota error and retry
  }
  try { localStorage.setItem(BACKUP_KEY, '[]'); } catch (e) { /* ignore */ }
}
export function backupNow(label) {
  if (!data) return null;
  const list = readBackups();
  const snap = {
    when: new Date().toISOString().slice(0, 16).replace('T', ' '),
    label: label || 'manual',
    tasks: countTasks(data),
    data: clone(data),
  };
  list.push(snap);
  writeBackups(list);
  lastBackupHash = JSON.stringify(data);
  return snap;
}
export function backupIfChanged(label) {
  if (!data) return;
  if (JSON.stringify(data) !== lastBackupHash) backupNow(label);
}
function scheduleAutoBackup() {
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => { backupTimer = null; backupIfChanged('auto'); }, BACKUP_DEBOUNCE_MS);
}
export function listBackups() {
  return readBackups().map((b, i) => ({ i, when: b.when, label: b.label, tasks: b.tasks }));
}
export function getBackup(index) {
  return readBackups()[index] || null;
}
export function restoreBackup(index) {
  const b = readBackups()[index];
  if (!b) return false;
  backupNow('before restore'); // make the restore itself reversible
  data = migrate(clone(b.data));
  addLog(`Restored backup from ${b.when} (${b.label})`);
  persist();
  return true;
}
export function deleteBackup(index) {
  const list = readBackups();
  if (index < 0 || index >= list.length) return;
  list.splice(index, 1);
  writeBackups(list);
}
export const schemaVersion = () => SCHEMA_VERSION;

// ---- Undo / Redo ---------------------------------------------------------
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(clone(data));
  const prev = undoStack.pop();
  data = clone(prev);
  committed = clone(prev);
  writeLS();
  notify();
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(clone(data));
  const next = redoStack.pop();
  data = clone(next);
  committed = clone(next);
  writeLS();
  notify();
  return true;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn(data));
}

export function addLog(what) {
  if (!data.changeLog) data.changeLog = [];
  const who = getEditor();
  data.changeLog.unshift({ when: new Date().toISOString().slice(0, 16).replace('T', ' '), who, what });
  if (data.changeLog.length > 500) data.changeLog.length = 500;
}

// ---- Zugriffshelfer ------------------------------------------------------

export function allTasks() {
  const out = [];
  for (const area of data.areas || []) {
    for (const group of area.groups || []) {
      for (const proc of group.processes || []) {
        for (const task of proc.tasks || []) {
          out.push({ area, group, proc, task });
        }
      }
    }
  }
  return out;
}

export function taskById(id) {
  return allTasks().find((t) => t.task.id === id) || null;
}

/**
 * Positional hierarchy numbers (WBS-style), e.g. "1.2.1.3". Derived purely from each
 * node's position in the tree, so drag & drop and reordering re-assign them
 * automatically. The stable IDs (A/G/P/T…) are unaffected. Returns a Map(id → number).
 */
export function outlineNumbers(d = data) {
  const map = new Map();
  (d.areas || []).forEach((area, ai) => {
    const an = `${ai + 1}`;
    map.set(area.id, an);
    (area.groups || []).forEach((group, gi) => {
      const gn = `${an}.${gi + 1}`;
      map.set(group.id, gn);
      (group.processes || []).forEach((proc, pi) => {
        const pn = `${gn}.${pi + 1}`;
        map.set(proc.id, pn);
        (proc.tasks || []).forEach((task, ti) => map.set(task.id, `${pn}.${ti + 1}`));
      });
    });
  });
  return map;
}

export function updateTask(id, patch, logText) {
  const hit = taskById(id);
  if (!hit) return;
  Object.assign(hit.task, patch);
  addLog(logText || `Task “${hit.task.name}” updated`);
  persist();
}

export function addComment(id, who, text) {
  const hit = taskById(id);
  if (!hit) return;
  if (!hit.task.comments) hit.task.comments = [];
  hit.task.comments.push({ who: who || 'Workshop', when: new Date().toISOString().slice(0, 10), text });
  addLog(`Comment added to “${hit.task.name}”`);
  persist();
}

export function nextId(prefix) {
  let max = 0;
  const scan = (id) => {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  };
  for (const area of data.areas || []) {
    scan(area.id);
    for (const group of area.groups || []) {
      scan(group.id);
      for (const proc of group.processes || []) {
        scan(proc.id);
        for (const task of proc.tasks || []) scan(task.id);
      }
    }
  }
  return `${prefix}${max + 1}`;
}

export function nextTaskId() {
  return nextId('T');
}

// ---- Struktur-API (alle Ebenen) ------------------------------------------

const KIND_LABEL = { area: 'Area', group: 'Process Group', process: 'Process', task: 'Task' };

/** Findet einen Knoten beliebiger Ebene: {kind, node, parentArray, index, parents}. */
export function findNode(id) {
  for (let ai = 0; ai < (data.areas || []).length; ai++) {
    const area = data.areas[ai];
    if (area.id === id) return { kind: 'area', node: area, parentArray: data.areas, index: ai, parents: {} };
    for (let gi = 0; gi < (area.groups || []).length; gi++) {
      const group = area.groups[gi];
      if (group.id === id) return { kind: 'group', node: group, parentArray: area.groups, index: gi, parents: { area } };
      for (let pi = 0; pi < (group.processes || []).length; pi++) {
        const proc = group.processes[pi];
        if (proc.id === id) return { kind: 'process', node: proc, parentArray: group.processes, index: pi, parents: { area, group } };
        for (let ti = 0; ti < (proc.tasks || []).length; ti++) {
          if (proc.tasks[ti].id === id) {
            return { kind: 'task', node: proc.tasks[ti], parentArray: proc.tasks, index: ti, parents: { area, group, proc } };
          }
        }
      }
    }
  }
  return null;
}

export function renameNode(id, name) {
  const hit = findNode(id);
  if (!hit || !name.trim()) return;
  const old = hit.node.name;
  hit.node.name = name.trim();
  if (old !== hit.node.name) addLog(`${KIND_LABEL[hit.kind]} renamed: “${old}” → “${hit.node.name}”`);
  persist();
}

export function addArea(name) {
  const area = { id: nextId('A'), name: name || 'New Area', groups: [] };
  data.areas.push(area);
  addLog(`Area “${area.name}” created`);
  persist();
  return area;
}

export function addGroup(areaId, name) {
  const hit = findNode(areaId);
  if (!hit || hit.kind !== 'area') return null;
  const group = { id: nextId('G'), name: name || 'New Process Group', processes: [] };
  hit.node.groups.push(group);
  addLog(`Process group “${group.name}” created in “${hit.node.name}”`);
  persist();
  return group;
}

export function addProcess(groupId, name) {
  const hit = findNode(groupId);
  if (!hit || hit.kind !== 'group') return null;
  const proc = { id: nextId('P'), name: name || 'New Process', tasks: [] };
  hit.node.processes.push(proc);
  addLog(`Process “${proc.name}” created in “${hit.node.name}”`);
  persist();
  return proc;
}

/** Alle Task-IDs im Unterbaum eines Knotens. */
export function taskIdsWithin(node, kind) {
  if (kind === 'task') return [node.id];
  if (kind === 'process') return (node.tasks || []).map((t) => t.id);
  if (kind === 'group') return (node.processes || []).flatMap((p) => (p.tasks || []).map((t) => t.id));
  return (node.groups || []).flatMap((g) => (g.processes || []).flatMap((p) => (p.tasks || []).map((t) => t.id)));
}

/** Löscht einen Knoten beliebiger Ebene samt Unterbaum, bereinigt dependsOn. */
export function deleteNode(id) {
  const hit = findNode(id);
  if (!hit) return;
  const gone = new Set(taskIdsWithin(hit.node, hit.kind));
  hit.parentArray.splice(hit.index, 1);
  for (const { task } of allTasks()) {
    task.dependsOn = (task.dependsOn || []).filter((d) => !gone.has(d));
  }
  addLog(`${KIND_LABEL[hit.kind]} “${hit.node.name}” deleted (${gone.size} tasks)`);
  persist();
}

const CHILD_KIND = { area: 'group', group: 'process', process: 'task' };

/**
 * Hängt einen Knoten um bzw. sortiert ihn um.
 * targetParentId: neuer Parent (Prozess für Task, Gruppe für Prozess, Bereich
 * für Gruppe; 'root' für Bereiche). index: Zielposition im Parent-Array
 * (weggelassen = ans Ende).
 */
export function moveNode(id, targetParentId, index) {
  const src = findNode(id);
  if (!src) return false;

  let targetArray;
  let targetLabel;
  if (src.kind === 'area') {
    if (targetParentId !== 'root') return false;
    targetArray = data.areas;
    targetLabel = 'top level';
  } else {
    const target = findNode(targetParentId);
    if (!target || CHILD_KIND[target.kind] !== src.kind) return false;
    targetArray =
      src.kind === 'task' ? target.node.tasks : src.kind === 'process' ? target.node.processes : target.node.groups;
    targetLabel = `„${target.node.name}“`;
  }

  // Aus der Quelle entfernen; Ziel-Index korrigieren, wenn im selben Array
  // vor der Einfügeposition entfernt wurde.
  src.parentArray.splice(src.index, 1);
  let insertAt = index === undefined || index === null ? targetArray.length : index;
  if (targetArray === src.parentArray && src.index < insertAt) insertAt--;
  insertAt = Math.max(0, Math.min(insertAt, targetArray.length));
  targetArray.splice(insertAt, 0, src.node);

  addLog(`${KIND_LABEL[src.kind]} “${src.node.name}” moved to ${targetLabel}`);
  persist();
  return true;
}

export function newTask(procId, template) {
  for (const area of data.areas) {
    for (const group of area.groups) {
      for (const proc of group.processes) {
        if (proc.id !== procId) continue;
        const countries = {};
        for (const c of data.meta.countries) countries[c.code] = { applies: true, variant: null };
        const task = Object.assign(
          {
            id: nextTaskId(),
            name: 'New Task',
            description: '',
            harmonized: true,
            countries,
            owner: '',
            raci: { r: '', a: '' },
            system: '',
            transaction: '',
            closingDay: 0,
            frequency: 'Monthly',
            dependsOn: [],
            afc: { type: 'Manual', duration: 30, jobName: null },
            status: data.meta.statusValues[0] || 'Draft',
            comments: [],
          },
          template || {}
        );
        proc.tasks.push(task);
        addLog(`New task created in “${proc.name}”`);
        persist();
        return task;
      }
    }
  }
  return null;
}

export function deleteTask(id) {
  deleteNode(id);
}

// ---- Länder-Verwaltung ----------------------------------------------------

/** Fügt ein Land hinzu; jeder Task bekommt eine Standard-Zelle. */
export function addCountry(code, name, entities) {
  const c = String(code || '').trim().toUpperCase();
  const nm = String(name || '').trim() || c;
  if (!c) return { error: 'Please enter a country code.' };
  if (!/^[A-Z0-9]{1,6}$/.test(c)) return { error: 'Code: 1–6 letters/digits.' };
  if (!data.meta.countries) data.meta.countries = [];
  if (data.meta.countries.some((x) => x.code.toUpperCase() === c)) return { error: `Country “${c}” already exists.` };
  data.meta.countries.push({ code: c, name: nm, entities: entities || [] });
  for (const { task } of allTasks()) {
    if (!task.countries) task.countries = {};
    if (!task.countries[c]) task.countries[c] = { applies: true, variant: null };
  }
  addLog(`Country ${c} “${nm}” added`);
  persist();
  return { ok: true, code: c };
}

/** Removes a country from the meta list and from every task. */
export function deleteCountry(code) {
  const list = data.meta.countries || [];
  const idx = list.findIndex((x) => x.code === code);
  if (idx < 0) return { error: 'Country not found.' };
  const nm = list[idx].name;
  list.splice(idx, 1);
  for (const { task } of allTasks()) {
    if (task.countries) delete task.countries[code];
  }
  addLog(`Country ${code} “${nm}” deleted`);
  persist();
  return { ok: true };
}

/** Changes code (with key migration across all tasks), name or company codes. */
export function updateCountry(code, patch) {
  const country = (data.meta.countries || []).find((x) => x.code === code);
  if (!country) return { error: 'Country not found.' };
  if (patch.code !== undefined) {
    const nc = String(patch.code || '').trim().toUpperCase();
    if (!nc) return { error: 'Code must not be empty.' };
    if (!/^[A-Z0-9]{1,6}$/.test(nc)) return { error: 'Code: 1–6 letters/digits.' };
    if (nc !== code) {
      if (data.meta.countries.some((x) => x.code.toUpperCase() === nc)) return { error: `Country “${nc}” already exists.` };
      for (const { task } of allTasks()) {
        if (task.countries && task.countries[code] !== undefined) {
          task.countries[nc] = task.countries[code];
          delete task.countries[code];
        }
      }
      addLog(`Country ${code} → ${nc} (code changed)`);
      country.code = nc;
    }
  }
  if (patch.name !== undefined) country.name = String(patch.name).trim() || country.code;
  if (patch.entities !== undefined) country.entities = patch.entities;
  persist();
  return { ok: true, code: country.code };
}

// Harmonisierungsgrad: Anteil der Land-Zellen ohne Abweichung (nur relevante Zellen)
export function harmonizationStats(tasks) {
  let std = 0, variant = 0, na = 0;
  const codes = data.meta.countries.map((c) => c.code);
  for (const task of tasks) {
    for (const code of codes) {
      const c = (task.countries || {})[code];
      if (!c || c.applies === false) na++;
      else if (c.variant) variant++;
      else std++;
    }
  }
  const rel = std + variant;
  return { std, variant, na, pct: rel ? Math.round((std / rel) * 100) : 100 };
}
