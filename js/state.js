// Zentrale Datenhaltung: lädt den Seed aus data/bpml.json, hält Änderungen in
// localStorage und benachrichtigt die Views über ein CustomEvent.

const LS_KEY = 'bpml-data-v1';

let data = null;
const listeners = new Set();

export function getData() {
  return data;
}

export async function initState() {
  const stored = localStorage.getItem(LS_KEY);
  if (stored) {
    try {
      data = JSON.parse(stored);
      return data;
    } catch (e) {
      console.warn('localStorage-Daten unlesbar, lade Seed', e);
    }
  }
  const res = await fetch('data/bpml.json');
  data = await res.json();
  persist(false);
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

function persist(notifyViews = true) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('localStorage voll?', e);
  }
  if (notifyViews) notify();
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
  data.changeLog.unshift({ when: new Date().toISOString().slice(0, 16).replace('T', ' '), what });
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

export function nextTaskId() {
  let max = 0;
  for (const { task } of allTasks()) {
    const m = /^T(\d+)$/.exec(task.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `T${max + 1}`;
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
  for (const area of data.areas) {
    for (const group of area.groups) {
      for (const proc of group.processes) {
        const i = proc.tasks.findIndex((t) => t.id === id);
        if (i >= 0) {
          const [gone] = proc.tasks.splice(i, 1);
          // Abhängigkeiten auf den gelöschten Task entfernen
          for (const { task } of allTasks()) {
            task.dependsOn = (task.dependsOn || []).filter((d) => d !== id);
          }
          addLog(`Task ${id} „${gone.name}“ gelöscht`);
          persist();
          return;
        }
      }
    }
  }
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
