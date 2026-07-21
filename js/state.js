// Zentrale Datenhaltung: lädt den Seed aus data/bpml.json, hält Änderungen in
// localStorage und benachrichtigt die Views über ein CustomEvent.

const LS_KEY = 'bpml-data-v1';
const ED_KEY = 'bpml-editor';
const HISTORY_MAX = 60;

let data = null;
const listeners = new Set();

// Undo/Redo: Schnappschüsse des gesamten Datenstands. `committed` ist der
// zuletzt gespeicherte Stand; jede Mutation legt ihn auf den Undo-Stack.
let committed = null;
const undoStack = [];
const redoStack = [];
const clone = (o) => JSON.parse(JSON.stringify(o));

export function getData() {
  return data;
}

// ---- Bearbeiter (für Protokoll & Kommentare) -----------------------------
export function getEditor() {
  return localStorage.getItem(ED_KEY) || '';
}
export function setEditor(name) {
  const n = (name || '').trim();
  if (n) localStorage.setItem(ED_KEY, n);
  else localStorage.removeItem(ED_KEY);
}

export async function initState() {
  const stored = localStorage.getItem(LS_KEY);
  if (stored) {
    try {
      data = JSON.parse(stored);
      committed = clone(data);
      return data;
    } catch (e) {
      console.warn('localStorage-Daten unlesbar, lade Seed', e);
    }
  }
  const res = await fetch('data/bpml.json');
  data = await res.json();
  committed = clone(data);
  writeLS();
  return data;
}

export function setData(next, logText) {
  data = next;
  if (logText) addLog(logText);
  persist();
}

export function resetToSeed() {
  localStorage.removeItem(LS_KEY);
  location.reload();
}

function writeLS() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('localStorage voll?', e);
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
  if (notifyViews) notify();
}

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

export function updateTask(id, patch, logText) {
  const hit = taskById(id);
  if (!hit) return;
  Object.assign(hit.task, patch);
  addLog(logText || `Task ${id} „${hit.task.name}“ geändert`);
  persist();
}

export function addComment(id, who, text) {
  const hit = taskById(id);
  if (!hit) return;
  if (!hit.task.comments) hit.task.comments = [];
  hit.task.comments.push({ who: who || 'Workshop', when: new Date().toISOString().slice(0, 10), text });
  addLog(`Kommentar zu ${id} ergänzt`);
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

const KIND_LABEL = { area: 'Bereich', group: 'Prozessgruppe', process: 'Prozess', task: 'Task' };

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
  if (old !== hit.node.name) addLog(`${KIND_LABEL[hit.kind]} ${id} umbenannt: „${old}“ → „${hit.node.name}“`);
  persist();
}

export function addArea(name) {
  const area = { id: nextId('A'), name: name || 'Neuer Bereich', groups: [] };
  data.areas.push(area);
  addLog(`Bereich ${area.id} „${area.name}“ angelegt`);
  persist();
  return area;
}

export function addGroup(areaId, name) {
  const hit = findNode(areaId);
  if (!hit || hit.kind !== 'area') return null;
  const group = { id: nextId('G'), name: name || 'Neue Prozessgruppe', processes: [] };
  hit.node.groups.push(group);
  addLog(`Prozessgruppe ${group.id} in „${hit.node.name}“ angelegt`);
  persist();
  return group;
}

export function addProcess(groupId, name) {
  const hit = findNode(groupId);
  if (!hit || hit.kind !== 'group') return null;
  const proc = { id: nextId('P'), name: name || 'Neuer Prozess', tasks: [] };
  hit.node.processes.push(proc);
  addLog(`Prozess ${proc.id} in „${hit.node.name}“ angelegt`);
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
  addLog(`${KIND_LABEL[hit.kind]} ${id} „${hit.node.name}“ gelöscht (${gone.size} Tasks)`);
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
    targetLabel = 'oberste Ebene';
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

  addLog(`${KIND_LABEL[src.kind]} ${id} „${src.node.name}“ nach ${targetLabel} verschoben`);
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
            name: 'Neuer Task',
            description: '',
            harmonized: true,
            countries,
            owner: '',
            raci: { r: '', a: '' },
            system: '',
            transaction: '',
            closingDay: 0,
            frequency: 'monatlich',
            dependsOn: [],
            afc: { type: 'Manuell', duration: 30, jobName: null },
            status: data.meta.statusValues[0] || 'Entwurf',
            comments: [],
          },
          template || {}
        );
        proc.tasks.push(task);
        addLog(`Task ${task.id} in „${proc.name}“ angelegt`);
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
  if (!c) return { error: 'Bitte einen Ländercode angeben.' };
  if (!/^[A-Z0-9]{1,6}$/.test(c)) return { error: 'Code: 1–6 Buchstaben/Ziffern.' };
  if (!data.meta.countries) data.meta.countries = [];
  if (data.meta.countries.some((x) => x.code.toUpperCase() === c)) return { error: `Land „${c}“ existiert bereits.` };
  data.meta.countries.push({ code: c, name: nm, entities: entities || [] });
  for (const { task } of allTasks()) {
    if (!task.countries) task.countries = {};
    if (!task.countries[c]) task.countries[c] = { applies: true, variant: null };
  }
  addLog(`Land ${c} „${nm}“ hinzugefügt`);
  persist();
  return { ok: true, code: c };
}

/** Löscht ein Land aus der Meta-Liste und aus allen Tasks. */
export function deleteCountry(code) {
  const list = data.meta.countries || [];
  const idx = list.findIndex((x) => x.code === code);
  if (idx < 0) return { error: 'Land nicht gefunden.' };
  const nm = list[idx].name;
  list.splice(idx, 1);
  for (const { task } of allTasks()) {
    if (task.countries) delete task.countries[code];
  }
  addLog(`Land ${code} „${nm}“ gelöscht`);
  persist();
  return { ok: true };
}

/** Ändert Code (mit Schlüssel-Migration in allen Tasks), Name oder Buchungskreise. */
export function updateCountry(code, patch) {
  const country = (data.meta.countries || []).find((x) => x.code === code);
  if (!country) return { error: 'Land nicht gefunden.' };
  if (patch.code !== undefined) {
    const nc = String(patch.code || '').trim().toUpperCase();
    if (!nc) return { error: 'Code darf nicht leer sein.' };
    if (!/^[A-Z0-9]{1,6}$/.test(nc)) return { error: 'Code: 1–6 Buchstaben/Ziffern.' };
    if (nc !== code) {
      if (data.meta.countries.some((x) => x.code.toUpperCase() === nc)) return { error: `Land „${nc}“ existiert bereits.` };
      for (const { task } of allTasks()) {
        if (task.countries && task.countries[code] !== undefined) {
          task.countries[nc] = task.countries[code];
          delete task.countries[code];
        }
      }
      addLog(`Land ${code} → ${nc} (Code geändert)`);
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
