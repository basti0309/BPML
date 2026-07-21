# Data model & Excel mapping

The app keeps all data in one JSON structure (`data/bpml.json` as the versioned seed,
in the browser's localStorage at runtime). Every export is a complete snapshot.

## Hierarchy

| Level | Field | Meaning | Example |
|---|---|---|---|
| L1 | `areas[]` | Process area | Record to Report – Close |
| L2 | `areas[].groups[]` | Process group | General Ledger, Intercompany |
| L3 | `groups[].processes[]` | Process | Provisions and Accruals |
| L4 | `processes[].tasks[]` | Task (AFC-relevant unit) | Run depreciation |

## Task fields

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Unique ID (T1, T2, …) |
| `name` | string | Task name |
| `description` | string | Description / work instruction |
| `harmonized` | bool | Part of the harmonized global template? |
| `countries` | map | Per country: `applies` (relevant?), `variant` (deviation text, or null = standard), `reason` |
| `owner` | string | Responsible organizational unit |
| `raci` | object | `r` = Responsible, `a` = Accountable |
| `system` | string | System (SAP S/4, AFC, local tools …) |
| `transaction` | string | Transaction / Fiori app / job |
| `closingDay` | int | Workday offset to the period-end date (−5 … +12, 0 = period-end) |
| `frequency` | string | Monthly / Quarterly / Yearly |
| `dependsOn` | string[] | Predecessor task IDs (drives calendar & BPMN) |
| `afc` | object | `type` (Manual/Job/Workflow/Check/Milestone), `duration` (minutes), `jobName` |
| `status` | string | Draft / In Review / Final |
| `comments` | array | Workshop comments `{who, when, text}` |

## Ordering

The array order (`areas`, `groups`, `processes`, `tasks`) is also the display and export
order. Drag & drop in the table changes exactly this order or re-parents nodes into a
different parent array; IDs stay stable and `dependsOn` references remain valid.

A **positional process number** (WBS-style, e.g. `1.2.1.3`) is derived from this order at
display/export time (`outlineNumbers()` in `state.js`). It is **not stored** and
re-numbers automatically on drag & drop / reorder; the stable IDs are unaffected.

## Meta

- `meta.countries`: countries with company codes (`entities`) – add, rename and delete them
  in the app via “🌐 Manage countries”
- `meta.closingDayRange`: display range of the closing calendar
- `meta.statusValues`, `meta.afcTaskTypes`: pick lists

## Excel import (in-app)

The import (button “Import Excel”) reads the first sheet with recognizable column headers.
Expected/recognized columns (case-insensitive; German and English titles are mapped):

| Excel column (aliases) | Target field |
|---|---|
| Area / Bereich / L1 | Area name |
| Process Group / Group / L2 | Group name |
| Process / Prozess / L3 | Process name |
| Task / Activity / Aktivität / L4 | `task.name` |
| Description / Beschreibung | `task.description` |
| Responsible / Owner / Verantwortlich | `task.owner` |
| System | `task.system` |
| Transaction / Transaktion / TCode | `task.transaction` |
| WD / Closing Day / Workday / Tag | `task.closingDay` (number, “WD+3” → 3) |
| Frequency / Frequenz | `task.frequency` |
| Predecessors / Vorgänger / Depends | `task.dependsOn` (comma-separated) |
| AFC Type / Task Type | `task.afc.type` |
| Status | `task.status` |
| Country columns (DE, FR, US, … or country names) | `countries[XX]`: empty/`-`/`n/a` → not relevant, `x`/`✓`/`Standard` → standard, any other text → deviation |

Unrecognized columns are ignored and reported in the import dialog.
**Once the real customer Excel is available, this mapping will be adapted to its column
layout** (phase-0 item from the plan).

> A workbook produced by this app additionally carries the full state in a hidden `_bpml`
> sheet, so “⬆ Excel” reloads it losslessly.

## AFC export

The AFC export flattens the hierarchy: process group → AFC folder, task → AFC task with
fields type, offset (`closingDay`), responsible, duration, job name, dependencies. Format:
CSV (columns matching the AFC task-list template) and JSON.
