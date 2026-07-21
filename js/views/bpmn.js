// Prozess-Flow: generiert BPMN-2.0-XML aus der BPML (Reihenfolge über
// dependsOn, sonst closingDay) und rendert es mit bpmn-js (NavigatedViewer).
// Die Diagramme werden nicht von Hand gepflegt – sie bleiben dadurch immer
// konsistent zur Tabelle.

import { getData } from '../state.js';
import { openTaskEditor, escapeHtml, showToast } from '../editor.js';

let viewer = null;
let currentXml = '';

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Layout: Tasks werden topologisch nach dependsOn in "Spalten" (Ränge)
 * sortiert; Tasks ohne Beziehung ordnen sich nach closingDay ein.
 * Parallele Stränge bekommen Gateways (Split/Join), wenn ein Task mehrere
 * Nachfolger/Vorgänger innerhalb des gewählten Scopes hat.
 */
export function buildBpmnXml(scopeName, tasks) {
  const ids = new Set(tasks.map((t) => t.id));
  const deps = new Map(); // id -> Vorgänger (nur im Scope)
  for (const t of tasks) deps.set(t.id, (t.dependsOn || []).filter((d) => ids.has(d)));

  // Topologische Ränge
  const rank = new Map();
  const visit = (id, stack = new Set()) => {
    if (rank.has(id)) return rank.get(id);
    if (stack.has(id)) return 0; // Zyklus – abfangen
    stack.add(id);
    const preds = deps.get(id) || [];
    const r = preds.length ? Math.max(...preds.map((p) => visit(p, stack))) + 1 : 0;
    stack.delete(id);
    rank.set(id, r);
    return r;
  };
  tasks.forEach((t) => visit(t.id));

  // Tasks ohne echte Abhängigkeiten: nach closingDay hinter den Start sortieren,
  // aber eigene Reihen (Lanes im Layout) vermeiden – wir bilden Spalten je Rang.
  const byRank = new Map();
  for (const t of tasks) {
    const r = rank.get(t.id) ?? 0;
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(t);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);

  const successors = new Map();
  for (const t of tasks) {
    for (const p of deps.get(t.id)) {
      if (!successors.has(p)) successors.set(p, []);
      successors.get(p).push(t.id);
    }
  }

  const NODE_W = 170, NODE_H = 60, GAP_X = 90, GAP_Y = 30, X0 = 180, Y0 = 80;
  const pos = new Map();
  ranks.forEach((r, ci) => {
    const col = byRank.get(r);
    col.sort((a, b) => (a.closingDay ?? 0) - (b.closingDay ?? 0));
    col.forEach((t, ri) => {
      pos.set(t.id, { x: X0 + ci * (NODE_W + GAP_X), y: Y0 + ri * (NODE_H + GAP_Y) });
    });
  });

  const maxCol = ranks.length;
  const startX = 60, startY = Y0 + 11;
  const endX = X0 + maxCol * (NODE_W + GAP_X), endY = startY;

  const flowNodes = [];
  const flowEdges = [];
  const shapes = [];
  const edges = [];

  flowNodes.push(`<startEvent id="StartEvent_1" name="Start close" />`);
  shapes.push(shape('StartEvent_1', startX, startY, 36, 36));
  flowNodes.push(`<endEvent id="EndEvent_1" name="Done" />`);
  shapes.push(shape('EndEvent_1', endX, endY, 36, 36));

  const roots = tasks.filter((t) => (deps.get(t.id) || []).length === 0);
  const leaves = tasks.filter((t) => !(successors.get(t.id) || []).length);

  for (const t of tasks) {
    const p = pos.get(t.id);
    const label = `${t.id} ${t.name}`;
    const type = t.afc?.type === 'Job' ? 'scriptTask' : t.afc?.type === 'Workflow' ? 'userTask' : 'task';
    flowNodes.push(`<${type} id="Task_${t.id}" name="${xmlEscape(label)}" />`);
    shapes.push(shape(`Task_${t.id}`, p.x, p.y, NODE_W, NODE_H));
  }

  let seq = 0;
  const addEdge = (fromId, toId, fromPos, toPos, fromSize, toSize) => {
    const id = `Flow_${++seq}`;
    flowEdges.push(`<sequenceFlow id="${id}" sourceRef="${fromId}" targetRef="${toId}" />`);
    const x1 = fromPos.x + fromSize.w, y1 = fromPos.y + fromSize.h / 2;
    const x2 = toPos.x, y2 = toPos.y + toSize.h / 2;
    const midX = (x1 + x2) / 2;
    edges.push(`<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">
      <di:waypoint x="${x1}" y="${y1}" /><di:waypoint x="${midX}" y="${y1}" />
      <di:waypoint x="${midX}" y="${y2}" /><di:waypoint x="${x2}" y="${y2}" />
    </bpmndi:BPMNEdge>`);
  };

  const size = { w: NODE_W, h: NODE_H };
  const evSize = { w: 36, h: 36 };
  for (const t of roots) addEdge('StartEvent_1', `Task_${t.id}`, { x: startX, y: startY }, pos.get(t.id), evSize, size);
  for (const t of tasks) {
    for (const p of deps.get(t.id)) {
      addEdge(`Task_${p}`, `Task_${t.id}`, pos.get(p), pos.get(t.id), size, size);
    }
  }
  for (const t of leaves) addEdge(`Task_${t.id}`, 'EndEvent_1', pos.get(t.id), { x: endX, y: endY }, size, evSize);

  function shape(id, x, y, w, h) {
    return `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}">
      <dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" />
    </bpmndi:BPMNShape>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  id="Defs_1" targetNamespace="http://bpml.local/afc">
  <process id="Process_1" name="${xmlEscape(scopeName)}" isExecutable="false">
    ${flowNodes.join('\n    ')}
    ${flowEdges.join('\n    ')}
  </process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      ${shapes.join('\n      ')}
      ${edges.join('\n      ')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;
}

function scopeOptions() {
  const data = getData();
  const opts = [];
  for (const area of data.areas) {
    for (const group of area.groups) {
      opts.push({ id: `g:${group.id}`, label: `Process group: ${group.name}`, tasks: group.processes.flatMap((p) => p.tasks) });
      for (const proc of group.processes) {
        opts.push({ id: `p:${proc.id}`, label: `– Process: ${proc.name}`, tasks: proc.tasks });
      }
    }
    const all = area.groups.flatMap((g) => g.processes.flatMap((p) => p.tasks));
    opts.unshift({ id: `a:${area.id}`, label: `Total: ${area.name}`, tasks: all });
  }
  return opts;
}

export function renderBpmn(root) {
  const opts = scopeOptions();
  const focus = sessionStorage.getItem('bpmn-focus');
  sessionStorage.removeItem('bpmn-focus');
  let selected = focus ? opts.find((o) => o.id === `p:${focus}`)?.id : null;
  if (!selected) selected = opts[0]?.id;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="bpmn-toolbar">
      <select id="bpmn-scope">${opts
        .map((o) => `<option value="${o.id}" ${o.id === selected ? 'selected' : ''}>${escapeHtml(o.label)}</option>`)
        .join('')}</select>
      <button class="btn" id="bpmn-fit">Fit</button>
      <button class="btn" id="bpmn-download">Download BPMN XML</button>
      <span class="muted">Diagram is generated automatically from predecessor relationships · click a task to open the editor</span>
    </div>
    <div id="bpmn-canvas"></div>
  `;
  root.appendChild(panel);

  const draw = async () => {
    const opt = scopeOptions().find((o) => o.id === panel.querySelector('#bpmn-scope').value);
    if (!opt) return;
    if (!opt.tasks.length) {
      showToast('This scope has no tasks.');
      return;
    }
    currentXml = buildBpmnXml(opt.label.replace(/^[^:]+: /, ''), opt.tasks);
    if (viewer) { viewer.destroy(); viewer = null; }
    viewer = new BpmnJS({ container: '#bpmn-canvas' });
    try {
      await viewer.importXML(currentXml);
      viewer.get('canvas').zoom('fit-viewport', 'auto');
      viewer.on('element.click', (e) => {
        const m = /^Task_(.+)$/.exec(e.element.id);
        if (m) openTaskEditor(m[1]);
      });
    } catch (err) {
      console.error(err);
      showToast(`BPMN rendering failed: ${err.message}`, 6000);
    }
  };

  panel.querySelector('#bpmn-scope').onchange = draw;
  panel.querySelector('#bpmn-fit').onclick = () => viewer && viewer.get('canvas').zoom('fit-viewport', 'auto');
  panel.querySelector('#bpmn-download').onclick = () => {
    if (!currentXml) return;
    const blob = new Blob([currentXml], { type: 'application/xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prozessflow-${new Date().toISOString().slice(0, 10)}.bpmn`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  draw();
}
