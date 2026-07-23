# BPML – Single-Entity Closings & SAP AFC Design

Interactive, editable Business Process Master List (BPML) for the collaborative
process design of single-entity closings – a static web app, hostable via GitHub Pages.

## Views

| Tab | Purpose |
|---|---|
| **BPML Table** | Hierarchical process list (Area → Group → Process → Task), filters, search, inline detail editor, create/delete tasks |
| **Country Matrix** | Tasks × countries: ✓ standard, ◐ deviation, – not relevant; harmonization KPIs; click a cell to change its state |
| **Closing Calendar** | Workday timeline (WD−x … WD+y) with swimlanes per process group, country filter |
| **Process Flow (BPMN)** | BPMN diagrams generated automatically from predecessor relationships (bpmn-js), XML download for Signavio/Camunda |
| **AFC Design** | Folder/task structure for SAP Advanced Financial Closing, completeness checks, export as CSV/JSON |

## Editing the structure (BPML Table)

- **Rename**: ✎ button or double-click on area/group/process/task; Enter saves, Esc cancels.
- **Add**: “+ Area” (top right), “+ Group” / “+ Process” / “+ Task” directly on the respective row.
- **Delete**: 🗑 on the row — deletes the whole subtree (with confirmation and the number of affected tasks); predecessor references to deleted tasks are cleaned up automatically.
- **Drag & drop**: grab the ⋮⋮ handle. Dropping **onto** a parent row appends to the end (task → process, process → group, group → area); dropping **between** rows of the same kind sorts before/after. Task IDs stay stable and dependencies/BPMN flows remain intact.
- **Process number**: the `No.` column (e.g. `1.2.1.3`) is a positional hierarchy number (WBS-style), assigned automatically from the tree position and **re-numbered on every move/reorder**. It is the **visible identifier** throughout the app and the exports (including predecessors). Internally, stable IDs still key dependencies, the BPMN flow and the lossless round-trip, but they are no longer displayed.
- **Without a mouse** (tablet): move a task via “Process (move to…)” in the task editor.

## Working with the app

The app is the primary working tool; exports are for sending around **and** for loading states back in.

- **↶ / ↷ Undo / Redo** any change (also via `Ctrl+Z` / `Ctrl+Shift+Z`; inside input fields the native text-undo applies).
- **👤 Editor**: set your name — it appears in the change log and pre-fills on comments.
- **🌐 Manage countries**: add, rename, change a code (migrated across all tasks) or delete countries (also via “Manage countries” in the Country Matrix). A new country is initially added as “Standard” for every task.
- **🏷 Manage field values**: customize the entries offered for each field. **Dropdown** fields (Status, AFC type, Frequency) are strict — renaming a value updates every task that uses it, deleting an in-use value asks for a replacement. **Suggestion** fields (Responsible/R/A, System, Transaction, Job) offer a curated list plus values already in use, while still allowing free text.
- All changes are saved to the browser immediately (localStorage).
- **🗄 Backups & restore**: automatic restore points (last 20) kept in this browser. One is made **before every reset/import** and **periodically while you work**; the panel lets you **restore**, download or delete them. They survive **↺ Reset**. For off-device safety, still export **⬇ JSON** to your own storage now and then.
- **Safe tool updates**: the app carries a `schemaVersion` and migrates older states forward on load, so improving the tool doesn't lose or break your data — it lives in your browser (and your exports), independent of the code.

## Exports & reloading

- **⬇ Excel**: nicely formatted workbook `bpml-export-<date>.xlsx` with six sheets
  (Cover with KPIs & checks, grouped BPML, Country Matrix, Country Specifics, Closing
  Calendar, AFC Task List) – incl. freeze panes, auto-filters, traffic-light colors and
  comments. Layout described in [`docs/BPML-Konzept.xlsx`](docs/BPML-Konzept.xlsx). **The
  export embeds the full state** and can be loaded back in via “⬆ Excel”.
- **⬇ JSON**: export the full snapshot (e.g. for versioning in the repo).
- **⬆ Excel**: **losslessly reload an export produced by this app** – or import a foreign
  BPML Excel (column mapping, see [`data/schema.md`](data/schema.md)).
- **⬆ JSON**: load an exported snapshot again.
- **↺**: reset to the versioned seed (`data/bpml.json`).

The versioned state lives in [`data/bpml.json`](data/bpml.json); the data model is
documented in [`data/schema.md`](data/schema.md).

## Run locally

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

(A server is required because the app loads `data/bpml.json` via fetch.)

## Hosting via GitHub Pages

1. Merge the branch into the deploy branch (the repo's default branch).
2. Repo settings → **Pages** → Source: “Deploy from a branch”.
3. The app is then reachable at `https://<user>.github.io/BPML/`.

## Tech

- Static HTML/CSS/JS without a build step (ES modules).
- Vendored libraries (no CDN, works in restrictive networks too) under `js/vendor/`:
  [bpmn-js](https://github.com/bpmn-io/bpmn-js) (BPMN viewer),
  [SheetJS](https://sheetjs.com/) (Excel import) and
  [ExcelJS](https://github.com/exceljs/exceljs) (formatted Excel export).
