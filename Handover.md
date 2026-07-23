# Handover – BPML Einzelabschlüsse & SAP AFC-Design

Übergabedokumentation der Web-App zur **Business Process Master List (BPML)** für das
gemeinsame Prozessdesign der Einzelabschlüsse und die Vorbereitung des Imports nach
**SAP Advanced Financial Closing (AFC)**.

> Kurzfassung für Eilige: Statische HTML/CSS/JS-App ohne Build-Schritt. Alle Daten
> liegen in **einer JSON-Struktur**, versioniert als Seed in `data/bpml.json`, zur
> Laufzeit im **localStorage** des Browsers. Fünf Ansichten (Tabelle, Länder-Matrix,
> Closing-Kalender, BPMN-Flow, AFC-Design) arbeiten alle auf denselben Daten. Hosting
> über GitHub Pages, lokaler Start über einen einfachen HTTP-Server.

---

## 1. Zweck & Einsatzszenario

Die App wird in Workshops zum Prozessdesign der Einzelabschlüsse eingesetzt. Sie erfüllt
drei Aufgaben:

1. **Prozesslandkarte pflegen** – eine hierarchische Prozessliste (Bereich → Gruppe →
   Prozess → Task) gemeinsam bearbeiten, ohne Excel-Chaos.
2. **Harmonisierung sichtbar machen** – pro Task und Land festhalten, was globaler
   Standard ist und wo lokale Abweichungen bestehen (Global-Template-Gedanke).
3. **AFC-Import vorbereiten** – die fachliche Prozessliste in eine Struktur überführen,
   die sich als AFC-Task-Liste (Ordner, Tasks, Offsets, Jobs, Abhängigkeiten)
   exportieren lässt, inklusive Vollständigkeits- und Konsistenz-Checks.

Zusätzlich erzeugt die App automatisch **BPMN-2.0-Diagramme** und einen
**Closing-Kalender** aus denselben Daten, sodass Tabelle, Ablaufdiagramm und Zeitplan
nie auseinanderlaufen.

---

## 2. Technischer Überblick

| Aspekt | Umsetzung |
|---|---|
| Art | Statische Single-Page-App, **kein Build-Schritt**, reine ES-Module |
| Sprache | HTML, CSS, Vanilla JavaScript (ES2020+) |
| Persistenz | `localStorage` (`bpml-data-v1`), Seed aus `data/bpml.json` |
| Externe Libraries | **bpmn-js** (BPMN-Viewer), **SheetJS/xlsx** (Excel-Import) und **ExcelJS** (formatierter Excel-Export) – **vendored** unter `js/vendor/`, kein CDN |
| Hosting | GitHub Pages (Workflow unter `.github/workflows/`) |
| Browser | Moderne Desktop-/Tablet-Browser; responsive bis ~900 px (Tabelle wird zu Karten) |
| Abhängigkeiten/Netz | Läuft komplett offline im Browser; nur der initiale Seed-`fetch` braucht den lokalen Server bzw. Pages |

**Warum vendored Libraries?** Damit die App auch in restriktiven Kundennetzen ohne
CDN-Zugriff funktioniert. Beide Bibliotheken liegen als Minified-Bundles im Repo.

---

## 3. Projektstruktur

```
BPML/
├── index.html              App-Shell: Topbar, Tabs, Toolbar, Drawer, Toast
├── README.md               Kurzanleitung für Endnutzer
├── Handover.md             ← dieses Dokument
├── css/
│   ├── app.css             Layout, Theme (CSS-Variablen), Responsive, Print
│   ├── bpmn-js.css         Styles des BPMN-Viewers
│   └── diagram-js.css      Styles der diagram-js-Engine (Basis von bpmn-js)
├── data/
│   ├── bpml.json           Versionierter Seed (vollständiger Snapshot)
│   └── schema.md           Datenmodell- und Excel-Mapping-Dokumentation
├── js/
│   ├── app.js              Einstieg: Routing (Tabs/Hash), Toolbar-Verdrahtung
│   ├── state.js            Zentrale Datenhaltung + Struktur-API (CRUD, Move)
│   ├── io.js               Import (Excel), Export (JSON, AFC-CSV/JSON), flacher Excel-Export
│   ├── xlsx-export.js      Formatierter 6-Blatt-Excel-Export (ExcelJS) – „⬇ Excel“
│   ├── editor.js           Task-Detail-Editor (Drawer), Toast, Format-Helfer
│   ├── vendor/
│   │   ├── bpmn-navigated-viewer.min.js
│   │   ├── xlsx.full.min.js
│   │   └── exceljs.min.js
│   └── views/
│       ├── table.js        Ansicht „BPML-Tabelle“
│       ├── matrix.js       Ansicht „Länder-Matrix“
│       ├── calendar.js     Ansicht „Closing-Kalender“
│       ├── bpmn.js         Ansicht „Prozess-Flow (BPMN)“ + BPMN-XML-Generator
│       └── afc.js          Ansicht „AFC-Design“
├── docs/
│   └── BPML-Konzept.xlsx   Personas, User Stories, Gap-Analyse & Export-Spezifikation
└── .github/workflows/      GitHub-Pages-Deployment
```

### Modul-Zusammenspiel

```
                 ┌───────────────┐
                 │   app.js      │  Routing + Toolbar
                 └──────┬────────┘
                        │ ruft die aktive View
        ┌───────────────┼───────────────────────────┐
        ▼               ▼                            ▼
   views/*.js  ◄──►  editor.js  ◄──►  state.js  ◄──►  io.js
   (rendern)        (Drawer)      (Daten +         (Import/
                                   CRUD-API)         Export)
                        │                │
                        └── alle lesen/schreiben ──┘
                             dieselben Daten
                                   │
                            localStorage  ←  data/bpml.json (Seed)
```

- **`state.js`** ist die einzige Quelle der Wahrheit. Jede Mutation läuft über die dort
  exportierten Funktionen, ruft danach `persist()` (schreibt localStorage) und `notify()`
  (informiert die Views). Views registrieren sich in `app.js` über `onChange(render)`,
  daher rendert die App nach jeder Änderung neu.
- **Views** sind reine Renderfunktionen `render<View>(root)`, die das `<main id="view-root">`
  neu aufbauen.
- **`editor.js`** stellt den gemeinsamen Task-Detail-Editor (Drawer) für alle Views bereit.

---

## 4. Datenmodell (Kurzreferenz)

Vollständige Referenz inkl. Excel-Mapping: **[`data/schema.md`](data/schema.md)**.

### Hierarchie (4 Ebenen)

| Ebene | Feld | Bedeutung |
|---|---|---|
| L1 | `areas[]` | Prozessbereich (z. B. „Record to Report – Abschluss") |
| L2 | `areas[].groups[]` | Prozessgruppe (z. B. „Hauptbuch") → wird zum **AFC-Ordner** |
| L3 | `groups[].processes[]` | Prozess (Gruppierung für BPMN-Flow) |
| L4 | `processes[].tasks[]` | **Task** – die AFC-relevante Einheit |

Die **Array-Reihenfolge ist zugleich die Anzeige- und Exportreihenfolge**. Drag & Drop
ändert genau diese Reihenfolge bzw. hängt Knoten in ein anderes Parent-Array um. IDs
(`A#`, `G#`, `P#`, `T#`) bleiben dabei stabil, `dependsOn`-Verweise gültig.

### Wichtige Task-Felder

| Feld | Bedeutung / Steuert |
|---|---|
| `id`, `name`, `description` | Identität und Fachtext |
| `harmonized` | Teil des globalen Standard-Templates? (Chip „lokal", wenn `false`) |
| `countries` | Je Land: `applies` (relevant?), `variant` (Abweichungstext / `null` = Standard), optional `reason` – speist **Matrix**, **Länder-Chips**, **Harmonisierungs-KPI** |
| `owner`, `raci.r`, `raci.a` | Verantwortlichkeiten (Responsible/Accountable) |
| `system`, `transaction` | System und Transaktion/Fiori-App/Job |
| `closingDay` | Workday-Offset zum Stichtag (0 = Ultimo) – **Position im Kalender** |
| `frequency` | monatlich / quartalsweise / jährlich |
| `dependsOn[]` | Vorgänger-Task-IDs – **steuert BPMN-Reihenfolge & Gateways** |
| `afc.type` | Manuell / Job / Workflow / Prüfung / Meilenstein – Farbe & BPMN-Knotentyp |
| `afc.duration`, `afc.jobName` | Geplante Dauer (Min), Job-Template (bei Typ „Job") |
| `status` | Entwurf / In Abstimmung / Final |
| `comments[]` | Workshop-Kommentare `{who, when, text}` |

### Meta

- `meta.title`, `meta.client` – Kopfzeile der App.
- `meta.countries[]` – Länder mit Buchungskreisen (`entities`); definiert Spalten von
  Matrix und Länder-Filter.
- `meta.closingDayRange` – sichtbarer Bereich des Kalenders (wird beim Import
  automatisch auf die Datenspanne erweitert).
- `meta.statusValues`, `meta.afcTaskTypes`, `meta.frequencyValues` – **strikte**
  Auswahllisten für die Dropdowns (Status, AFC-Typ, Frequenz).
- `meta.ownerValues`, `meta.raciRValues`, `meta.raciAValues`, `meta.systemValues`,
  `meta.transactionValues`, `meta.jobValues` – **Vorschlagslisten** für die Freitextfelder
  (als Datalist neben den bereits verwendeten Werten angeboten).
- Alle vorstehenden Listen sind in der App über **🏷 Feldwerte verwalten** editierbar
  (siehe 5.3a).
- `changeLog[]` – automatisch geführtes Änderungsprotokoll (siehe 5.7).

---

## 5. Features im Detail

Alle Features arbeiten auf denselben Daten. Änderungen in einer Ansicht sind sofort in
allen anderen sichtbar und werden automatisch gespeichert.

### 5.1 Navigation & App-Shell (`app.js`, `index.html`)

- Fünf Tabs schalten zwischen den Ansichten um; die aktive Ansicht steht zusätzlich im
  **URL-Hash** (`#table`, `#matrix`, `#calendar`, `#bpmn`, `#afc`) – Ansichten sind damit
  verlink- und per Browser-Zurück navigierbar.
- Kopfzeile zeigt `meta.title` und `meta.client`.
- **Drawer** (rechtes Panel) für Task-Details und das Änderungsprotokoll; schließt per
  ✕, Klick auf den Hintergrund.
- **Toast** für kurze Rückmeldungen (Import-Ergebnisse, „gespeichert", Fehler).

### 5.2 BPML-Tabelle (`views/table.js`)

Die zentrale Bearbeitungsansicht der gesamten Hierarchie.

**Anzeigen & Navigieren**
- Baumdarstellung Bereich → Gruppe → Prozess → Task mit Ein-/Ausklappen (`▸`/`▾`).
- Pro Task: ID, Name, Verantwortlich, System/Transaktion, Tag (Workday-Offset), AFC-Typ,
  Länder-Chips (`✓`/`◐`/nicht relevant) und Status-Chip. Abweichungen werden unter dem
  Task-Namen aufgelistet, nicht-harmonisierte Tasks mit „lokal"-Chip markiert.

**Filtern & Suchen**
- Volltextsuche (Name, System, Transaktion, Owner, ID, Beschreibung).
- Filter nach Land, Prozessgruppe, Status und Harmonisierung (nur harmonisierte / nur
  mit Abweichungen).
- KPI-Chip „Harmonisiert: x %" über allen Tasks.

**Struktur bearbeiten (alle vier Ebenen)**
- **Umbenennen**: ✎-Button oder Doppelklick auf die Zeile; Enter speichert, Esc bricht ab.
- **Anlegen**: „+ Bereich" (oben rechts) sowie „+ Gruppe" / „+ Prozess" / „+ Task" an der
  jeweiligen Zeile. Ein neuer Task öffnet direkt den Detail-Editor.
- **Löschen**: 🗑 an der Zeile – inklusive Unterbaum, mit Bestätigung und Anzahl
  betroffener Tasks. `dependsOn`-Verweise auf gelöschte Tasks werden automatisch bereinigt.
- **Drag & Drop** am ⋮⋮-Griff:
  - Ablegen **auf** einer übergeordneten Zeile hängt ans Ende an (Task → Prozess,
    Prozess → Gruppe, Gruppe → Bereich).
  - Ablegen **zwischen** gleichartigen Zeilen sortiert davor/dahinter ein.
  - Task-IDs bleiben stabil, Abhängigkeiten und BPMN-Flows bleiben intakt.
- **Ohne Maus** (Tablet): Verschieben im Task-Editor über „Prozess (Verschieben nach…)".
- **Prozessnummer** (Spalte `No.`, z. B. `1.2.1.3`): positionsbasierte Hierarchie-Nummer
  (WBS-Stil), abgeleitet aus der Baum-Position (`outlineNumbers()` in `state.js`). Wird bei
  jedem Verschieben/Umsortieren automatisch neu vergeben, ist **nicht gespeichert**. Sie ist
  der **sichtbare Identifier** in allen Ansichten und Exporten (inkl. Vorgänger). Die
  stabilen `A/G/P/T…`-IDs bleiben **intern** (Schlüssel für `dependsOn`, BPMN, Round-Trip),
  werden aber **nicht mehr angezeigt**.

### 5.3 Länder-Matrix (`views/matrix.js`)

Vergleich Tasks × Länder zur Harmonisierungsanalyse.

- **KPI-Leiste**: Harmonisierungsgrad in %, Anzahl Standard-Zellen, Abweichungen und
  nicht-relevante Zellen.
- **Matrix**: Zeilen = Tasks (nach Prozessgruppe gruppiert, je Gruppe eigener
  Harmonisierungs-% als farbiger Chip), Spalten = Länder.
  - `✓` Standard (harmonisiert) · `◐` Abweichung (Tooltip zeigt Details) · `–` nicht
    relevant.
- **Interaktion**:
  - **Klick auf eine Zelle** schaltet den Zustand um: Standard → Abweichung (mit
    Textabfrage) → nicht relevant → wieder Standard.
  - **Klick auf den Task-Namen** öffnet den Detail-Editor.
  - **🌐 Länder verwalten** (auch als Toolbar-Button 🌐): öffnet den Länder-Manager
    (`openCountryManager` in `editor.js`) zum Hinzufügen, Umbenennen, Code-Ändern und
    Löschen von Ländern. Datenoperationen in `state.js` (`addCountry` / `deleteCountry` /
    `updateCountry`): ein neues Land wird bei allen Tasks als „Standard“ angelegt, ein
    gelöschtes aus allen Tasks entfernt, eine Code-Änderung migriert die Schlüssel in
    `task.countries` überall mit.

> Definition Harmonisierungsgrad: Anteil der **relevanten** Land-Zellen ohne Abweichung
> (`std / (std + variant)`), berechnet in `harmonizationStats()` in `state.js`.

### 5.3a Feldwerte verwalten (`editor.js`, `state.js`) — 🏷 Toolbar

Zentrale Stelle, um die **möglichen Einträge aller Editor-Felder** anzupassen. Öffnet über
den Toolbar-Button 🏷 (`openFieldValueManager` in `editor.js`) ein Panel mit einem Block je
Feld. Grundlage ist die Definitionstabelle `FIELD_LISTS` in `state.js`, die jedes Feld auf
seine Meta-Liste (`meta.*Values` bzw. `meta.afcTaskTypes`) und seinen Task-Pfad abbildet.

Zwei Feldtypen:

- **Dropdown-Felder (strict)** – Status, AFC-Typ, Frequenz. Der Editor bietet ausschließlich
  Werte aus der Liste an.
  - **Umbenennen** (Inline-Edit eines Werts) migriert den Wert über
    `renameFieldValue(key, alt, neu)` in **allen** betroffenen Tasks mit.
  - **Löschen** eines noch verwendeten Werts fragt via `deleteFieldValue` nach einem
    **Ersatzwert** (der wiederum in der Liste liegen muss); ungenutzte Werte werden direkt
    entfernt.
- **Vorschlag-Felder (frei)** – Verantwortlich (Org.), R, A, System, Transaktion,
  Job-Template. Freitext bleibt erlaubt; die gepflegte Liste erscheint zusammen mit den
  bereits im Datenbestand vorkommenden Werten (`fieldSuggestions` = kuratierte Liste ∪
  benutzte Werte) als `<datalist>` am jeweiligen Eingabefeld.

Hinzufügen ist für beide Typen gleich (`addFieldValue`). Alle Operationen laufen über die
`state.js`-API (Persistenz, Undo/Redo, Änderungsprotokoll) und rendern das Panel neu. Die
Editor-Dropdowns nehmen einen ggf. „off-list“ gesetzten Aktualwert defensiv mit auf, damit
Altbestände nie unsichtbar werden.

### 5.4 Closing-Kalender (`views/calendar.js`)

Workday-Timeline des Abschlussprozesses.

- Spalten = Workdays von `closingDayRange.from` bis `to` (z. B. WT−5 … WT+12); **WT0** ist
  der Periodenstichtag und hervorgehoben.
- **Schwimmbahnen** je Prozessgruppe; jeder Task sitzt in der Spalte seines `closingDay`.
- **Farbe** je AFC-Typ (Manuell / Job / Workflow / Prüfung / Meilenstein), Legende unten.
- **Länderfilter**: „Alle Länder (Global Template)" oder ein einzelnes Land; im
  Länder-Modus werden nur relevante Tasks gezeigt und Abweichungen (gestrichelter Rand)
  landesspezifisch markiert.
- Klick auf einen Task öffnet den Editor; Tooltip zeigt Typ, Vorgänger und Abweichung.

### 5.5 Prozess-Flow / BPMN (`views/bpmn.js`)

Automatisch generierte BPMN-2.0-Diagramme – **nicht von Hand gepflegt**, daher immer
konsistent zur Tabelle.

- **Scope-Auswahl**: gesamter Bereich, eine Prozessgruppe oder ein einzelner Prozess.
- **Automatisches Layout** (`buildBpmnXml`):
  - Tasks werden **topologisch nach `dependsOn`** in Rang-Spalten sortiert; Tasks ohne
    Beziehung ordnen sich innerhalb ihres Rangs nach `closingDay`.
  - Start-/End-Event werden automatisch angehängt (Wurzeln nach Start, Blätter zu Ende).
  - AFC-Typ bestimmt den BPMN-Knotentyp: Job → `scriptTask`, Workflow → `userTask`, sonst
    `task`.
  - Zyklen werden abgefangen (kein Endlos-Layout).
- **Rendering** über bpmn-js `NavigatedViewer` (Zoom/Pan). Buttons „Einpassen" und
  **„BPMN-XML herunterladen"** (`.bpmn` für Signavio/Camunda). Klick auf einen Task-Knoten
  öffnet den Editor.
- **Sprung aus dem Editor**: Der Button „Prozess-Flow ↗" im Task-Editor öffnet direkt den
  BPMN-Flow des zugehörigen Prozesses (via `sessionStorage`-Fokus).

### 5.6 AFC-Design (`views/afc.js`)

Aufbereitung und Qualitätssicherung für den SAP-AFC-Import.

- **KPIs**: Tasks gesamt, Tasks mit fehlenden AFC-Angaben, zyklische Abhängigkeiten.
- **Design-Checks für den AFC-Import**:
  - Fehlende Pflichtangaben je Task: AFC-Typ, Closing Day, Verantwortlicher, Job-Name
    (wenn Typ = „Job").
  - **Zyklenerkennung** über `dependsOn` (DFS) – Zyklen brächen den AFC-Ablauf.
  - Jeder Befund ist als Link direkt zum betroffenen Task anklickbar.
- **Ordner-Vorschau**: je Prozessgruppe ein aufklappbarer „Ordner" (📁) mit der Task-Liste
  (ID, Task, Typ, Offset, Responsible, Dauer, Job, Vorgänger, Länder-Scope, Status).
  Länder mit `*` haben eine Abweichung.
- **Export** (siehe 5.8): AFC-Task-Liste als **CSV** oder **JSON**.

### 5.7 Detail-Editor (`editor.js`)

Gemeinsamer Task-Editor (Drawer), aus jeder Ansicht per Klick erreichbar.

- Bearbeitet **alle** Task-Felder: Name, Beschreibung, Verantwortlich, Status,
  RACI (R/A), System, Transaktion, Closing Day, Frequenz, AFC-Typ, Dauer, Job-Name,
  Harmonisiert-Flag, Vorgänger (Mehrfachauswahl) und je Land **Scope, Abweichung und
  Begründung** (`reason`). Hinweis: Bis zu diesem Stand wurde der Länder-Scope aus dem
  Editor gar nicht gespeichert (`countries` fehlte im Patch) – jetzt behoben.
- **Verschieben**: „Prozess (Verschieben nach…)" hängt den Task in einen anderen Prozess um.
- **Kommentare**: Workshop-Kommentare mit Name und Datum hinzufügen.
- Aktionen: Speichern, „Prozess-Flow ↗" (Sprung ins BPMN), Löschen (mit Bestätigung).

### 5.8 Änderungsprotokoll (`state.js` / `app.js`)

- Jede strukturelle Änderung (Umbenennen, Anlegen, Löschen, Verschieben, Task-Edit,
  Import, Kommentar) schreibt einen Eintrag mit Zeitstempel in `changeLog`.
- Der 🕘-Button in der Toolbar öffnet das Protokoll im Drawer (die jüngsten 500 Einträge).
- Das Protokoll ist Teil des Snapshots und wird mit JSON exportiert.

---

## 6. Datenhaltung & Zusammenarbeit

### Persistenz-Modell

1. Beim ersten Start lädt `initState()` den Seed `data/bpml.json` per `fetch`.
2. Ab dann liegt der Arbeitsstand im **localStorage** (`bpml-data-v1`) – jede Änderung
   wird sofort geschrieben. Beim nächsten Aufruf wird der localStorage-Stand geladen, der
   Seed **nicht** erneut gelesen.
3. **↺ (Reset)** löscht den localStorage-Eintrag und lädt den Seed neu.

### Undo/Redo (`state.js`)

- `persist()` legt vor jeder Änderung einen **Schnappschuss** des gesamten Datenstands auf
  einen Undo-Stack (max. 60); `undo()` / `redo()` stellen ihn wieder her. Da der
  `changeLog` Teil des Snapshots ist, wird auch der Protokolleintrag mit zurückgenommen.
- Bedienung: Toolbar **↶ / ↷** oder `Strg+Z` / `Strg+Umschalt+Z` (bzw. `Strg+Y`). In
  Eingabefeldern greift bewusst die native Text-Rückgängig-Funktion (`app.js` prüft das
  aktive Element).

### Bearbeiter / Urheber (`state.js`, `app.js`, `editor.js`)

- **👤**-Button setzt einen Bearbeiter-Namen (localStorage `bpml-editor`). `addLog()` schreibt
  ihn als `who` in jeden Protokolleintrag; im Kommentarfeld ist er vorbelegt.

### Backups & Wiederherstellung (`state.js`, `app.js`) — Sicherheitsnetz „Phase 1"

- **Rollierende Wiederherstellungspunkte** in einem **separaten** localStorage-Schlüssel
  `bpml-backups-v1` (max. 20). Dadurch überleben sie **↺ Reset** (das nur `bpml-data-v1`
  löscht).
- Ein Backup entsteht automatisch **vor jedem Reset/Import** (`backupNow` in `setData` /
  `resetToSeed`), **periodisch** ~90 s nach der letzten Änderung (`scheduleAutoBackup` →
  `backupIfChanged`, angestoßen in `persist()`) und beim **Schließen des Tabs**
  (`beforeunload` → `backupIfChanged`). Zusätzlich manuell über den 🗄-Button.
- **🗄-Panel** (`renderBackups` in `app.js`): Liste mit Zeitstempel/Anlass/Task-Anzahl,
  je Eintrag **Restore / Download / Löschen**, plus „Create backup now" und „Download
  current (JSON)". `restoreBackup` sichert vorher den aktuellen Stand („before restore"),
  ist also selbst umkehrbar. Bei `QuotaExceededError` wird der älteste Snapshot verworfen.

### Schema-Migration (`state.js`)

- `meta.schemaVersion` + `migrate(d)` laufen bei **jedem Laden/Import** (`initState`,
  `setData`, `restoreBackup`). `migrate` normalisiert die Struktur defensiv (fehlende
  Felder/Arrays) und hebt künftig ältere Stände über eine versionierte Migrationskette auf
  die aktuelle Version — so brechen Tool-Weiterentwicklungen den gespeicherten Stand nicht.

> Wichtig für die Übergabe: Der Arbeitsstand lebt **pro Browser/Gerät**. Es gibt keine
> serverseitige Speicherung. Ergebnisse aus Workshops müssen über **Export** gesichert und
> ins Repo committet werden, sonst gehen sie beim Browser-/Gerätewechsel verloren.

### Import / Export (Toolbar)

| Button | Funktion |
|---|---|
| ⬆ Excel | **Von dieser App erzeugten Export verlustfrei wieder laden** (eingebetteter Snapshot) *oder* eine fremde BPML-Excel importieren (Mapping siehe `data/schema.md`) |
| ⬆ JSON | Exportierten Snapshot wieder laden |
| ⬇ Excel | **Formatiertes Workbook** `bpml-export-<Datum>.xlsx` (ExcelJS, `js/xlsx-export.js`) mit 6 Blättern |
| ⬇ JSON | Vollständigen Snapshot als `.json` exportieren (Seed-kompatibel) |
| 🕘 | Änderungsprotokoll |
| ↺ | Auf Seed-Daten zurücksetzen |

**Formatierter Excel-Export** (`js/xlsx-export.js`, ExcelJS): `buildWorkbook(ExcelJS, data)`
erzeugt sechs Blätter – **Deckblatt** (KPIs, Legende, Konsistenz-Checks), **BPML**
(gruppierte Hierarchie, Freeze, Status-/Harmonisierungsfarben, R/A), **Länder-Matrix**
(Ampel ✓/◐/–, Harmonisierungs-% je Gruppe, Abweichung als Zellkommentar),
**Länderspezifika** (je Abweichung eine Zeile mit Begründung, Autofilter),
**Abschlusskalender** (Task-Zeitstrahl, Zellfarbe je AFC-Typ, WT0 betont) und
**AFC-Task-Liste** (flach, maschinenlesbar, Autofilter). Die Kernfunktion ist DOM-frei
und daher isoliert testbar; nur der Aufhänger `exportFormattedExcel(data)` nutzt Browser-APIs.
Der alte flache Export (`exportExcel` in `io.js`) bleibt als Funktion erhalten, ist aber
nicht mehr verdrahtet.

**Round-Trip** (`xlsx-export.js` → `io.js`): Der formatierte Export enthält ein
**verstecktes Blatt `_bpml`** (`state: veryHidden`, für Menschen unsichtbar) mit dem
vollständigen Datenstand als JSON (in 30 000-Zeichen-Blöcke aufgeteilt, da Excel-Zellen
begrenzt sind). Beim Import erkennt `loadEmbeddedSnapshot()` das Blatt am Marker
`BPML-JSON-V1` und lädt den Stand **verlustfrei** – so wandert ein per Mail verschickter
Export 1:1 zurück in die App. Fehlt das Blatt, greift der klassische Flach-Parser für
fremde Excels.

**Excel-Import** (`io.js`): liest die erste Tabelle, erkennt Spalten über Aliasse
(deutsch/englisch, Groß-/Kleinschreibung egal), baut die Hierarchie über gleiche
Bereichs-/Gruppen-/Prozessnamen auf und mappt Länderspalten (`x`/`✓` → Standard, leer/`–`/
`n/a` → nicht relevant, sonstiger Text → Abweichung). Nicht erkannte Spalten werden im
Toast gemeldet. Neue 2-buchstabige Länderspalten werden automatisch als Land übernommen.

**AFC-Export** (`io.js`, aus der AFC-Ansicht):
- **CSV** (`;`-getrennt, mit BOM für Excel): Spalten Folder, Task ID, Name, Type, Closing
  Day Offset, Responsible, Accountable, Duration, Job Template, Predecessors, Frequency,
  Description, Countries, Status.
- **JSON**: nach Ordnern (Prozessgruppen) gruppierte Task-Liste mit denselben Feldern –
  Vorlage für ein AFC-Import-Skript.

> Der versionierte Referenzstand ist immer `data/bpml.json`. Empfehlung: nach jedem
> Workshop **⬇ JSON** exportieren, die Datei nach `data/bpml.json` legen und committen.

---

## 7. Lokale Entwicklung

Ein Webserver ist nötig, weil die App `data/bpml.json` per `fetch` lädt (kein
`file://`):

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

- **Kein Build, kein npm install** – Dateien direkt bearbeiten und Seite neu laden.
- Beim Testen von Datenmodell-Änderungen ggf. localStorage leeren (↺ in der App oder
  DevTools → Application → Local Storage → `bpml-data-v1` löschen), sonst überdeckt der
  gespeicherte Stand den neuen Seed.

---

## 8. Hosting über GitHub Pages

- Deployment über den Workflow in `.github/workflows/` (`actions/deploy-pages`).
- **Achtung – Branch-Bindung**: Der Workflow-Trigger ist derzeit auf den Branch
  `claude/financial-closing-bpmn-design-5qrro6` (aktueller Default-Branch) beschränkt. Der
  Kommentar im Workflow weist darauf hin: **Wird der Default-Branch auf `main` umgestellt,
  muss der `branches:`-Trigger dort angepasst werden.**
- Nach dem Deploy ist die App unter `https://<user>.github.io/BPML/` erreichbar.
- Alternativ manuell: Repo-Einstellungen → **Pages** → „Deploy from a branch".

---

## 9. Erweiterungspunkte für die Übernahme

Wo man typische Anpassungen vornimmt:

| Aufgabe | Ort |
|---|---|
| Auswahlwerte / Vorschläge aller Felder ändern | **In-App: 🏷 Feldwerte verwalten** (`openFieldValueManager`); Definition in `FIELD_LISTS` (`state.js`), gespeichert in `meta.*Values` / `meta.afcTaskTypes` |
| Neues Feld in den Feldwert-Manager aufnehmen | Eintrag in `FIELD_LISTS` (`state.js`) ergänzen (`key`, `field`-Pfad, `label`, `strict`) und Migration um die neue `meta`-Liste erweitern |
| Länder/Buchungskreise ändern | **In-App: 🌐 Länder verwalten** (oder `meta.countries` in `data/bpml.json`); Logik in `state.js` (`addCountry`/`deleteCountry`/`updateCountry`) |
| Neues Task-Feld | `state.js` (`newTask`-Template), `editor.js` (Formular), ggf. `io.js` (Export/Import) und Views |
| Excel-Spalten-Mapping erweitern | `COLUMN_ALIASES` in `io.js` |
| BPMN-Layout/Knotenlogik | `buildBpmnXml()` in `views/bpmn.js` |
| Formatierter Excel-Export (Blätter, Spalten, Farben) | `buildWorkbook()` in `js/xlsx-export.js` |
| AFC-Exportformat | `exportAfcCsv` / `exportAfcJson` in `io.js` |
| Neue Ansicht/Tab | View-Modul in `js/views/`, in `app.js` registrieren, Tab in `index.html` |
| Theme/Farben/Responsive | CSS-Variablen und Media-Queries in `css/app.css` |

**Architektur-Konventionen**
- Datenmutationen **immer** über die API in `state.js` (nie direkt am `getData()`-Objekt),
  damit Persistenz, Änderungsprotokoll und Re-Render greifen.
- Views bauen ihren DOM bei jedem Render neu auf; keinen Zustand in der View halten
  (Ausnahme: reine UI-Zustände wie eingeklappte Knoten/Filter, die bewusst modul-lokal
  gehalten werden).
- HTML aus Nutzereingaben stets über `escapeHtml()` bzw. `xmlEscape()` einsetzen.

---

## 10. Offene Punkte / Bekannte Einschränkungen

> Umgesetzt bisher: formatierter Excel-Export, **verlustfreier Round-Trip**
> (Export → Mail → wieder einladen), **Undo/Redo**, **Bearbeiter/Urheber** im Protokoll,
> **Abweichungsgrund** im Editor (+ Fix des nicht gespeicherten Länder-Scopes), englische
> Standardsprache, **Prozessnummer** (interne IDs verborgen), **Backups &
> Wiederherstellung + Schema-Migration** (Sicherheitsnetz gegen Datenverlust), **Frequenz
> in der Tabelle** (inkl. „Ongoing“) sowie **🏷 Feldwerte verwalten** (Auswahllisten &
> Vorschläge aller Felder in-App editierbar).

Noch offen:

- **Keine Mehrbenutzer-Synchronisation.** Zusammenarbeit läuft über Export/Import + Git,
  nicht live. Für parallele Bearbeitung müsste ein Backend ergänzt werden.
- **Audit-Trail** erfasst jetzt den Urheber, ist aber noch nicht separat exportierbar; der
  Name ist frei wählbar (keine Authentifizierung).
- **Seed enthält Beispieldaten.** `meta.client` weist ausdrücklich darauf hin, dass die
  Seed-Daten durch den Import der echten Kunden-Excel ersetzt werden. Das
  Excel-Spalten-Mapping wird an das reale Layout angepasst, sobald es vorliegt
  (Phase-0-Punkt, siehe `data/schema.md`).
- **Pages-Workflow ist an den aktuellen Default-Branch gebunden** (siehe 8).
- **localStorage-Grenze**: sehr große BPMLs könnten das Speicherlimit erreichen; ein
  Fehler wird in der Konsole geloggt. Für große Datenmengen mit JSON-Snapshots arbeiten.
- **BPMN-Gateways**: Parallelität wird über Split/Join aus den `dependsOn`-Beziehungen
  abgeleitet; sehr komplexe Verzweigungen sind bewusst vereinfacht dargestellt.

---

## 11. Weiterführende Dokumentation

- **[`README.md`](README.md)** – Kurzanleitung für Endnutzer (Ansichten, Bedienung).
- **[`data/schema.md`](data/schema.md)** – vollständiges Datenmodell und Excel-Mapping.
- Quellcode ist durchgängig deutsch kommentiert; jede Datei beginnt mit einem
  Kopfkommentar zu ihrer Aufgabe.
