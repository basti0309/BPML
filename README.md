# BPML – Einzelabschlüsse & SAP AFC-Design

Interaktive, editierbare Business Process Master List (BPML) für das gemeinsame
Prozessdesign der Einzelabschlüsse – als statische Web-App, hostbar über GitHub Pages.

## Ansichten

| Tab | Zweck |
|---|---|
| **BPML-Tabelle** | Hierarchische Prozessliste (Bereich → Gruppe → Prozess → Task), Filter, Suche, Inline-Detail-Editor, Tasks anlegen/löschen |
| **Länder-Matrix** | Tasks × Länder: ✓ Standard, ◐ Abweichung, – nicht relevant; Harmonisierungs-KPIs; Klick auf Zelle ändert den Zustand |
| **Closing-Kalender** | Workday-Timeline (WT−x … WT+y) mit Schwimmbahnen je Prozessgruppe, Länderfilter |
| **Prozess-Flow (BPMN)** | Automatisch aus den Vorgänger-Beziehungen generierte BPMN-Diagramme (bpmn-js), XML-Download für Signavio/Camunda |
| **AFC-Design** | Ordner-/Task-Struktur für SAP Advanced Financial Closing, Vollständigkeits-Checks, Export als CSV/JSON |

## Struktur bearbeiten (BPML-Tabelle)

- **Umbenennen**: ✎-Button oder Doppelklick auf Bereich/Gruppe/Prozess/Task, Enter speichert, Esc bricht ab.
- **Anlegen**: „+ Bereich“ (oben rechts), „+ Gruppe“ / „+ Prozess“ / „+ Task“ direkt an der jeweiligen Zeile.
- **Löschen**: 🗑 an der Zeile — löscht inkl. Unterbaum (mit Bestätigung und Anzahl betroffener Tasks); Vorgänger-Verweise auf gelöschte Tasks werden automatisch bereinigt.
- **Drag & Drop**: Am ⋮⋮-Griff ziehen. Ablegen **auf** einer übergeordneten Zeile hängt ans Ende an (Task → Prozess, Prozess → Gruppe, Gruppe → Bereich); Ablegen **zwischen** gleichartigen Zeilen sortiert davor/dahinter ein. Task-IDs bleiben dabei stabil, Abhängigkeiten und BPMN-Flows bleiben intakt.
- **Ohne Maus** (Tablet): im Task-Editor über „Prozess (Verschieben nach…)“.

## Daten & Zusammenarbeit

- Alle Änderungen werden sofort im Browser gespeichert (localStorage).
- **⬇ JSON / ⬇ Excel**: aktuellen Stand exportieren (z.B. nach einem Workshop) und ins Repo committen.
- **⬆ Excel**: bestehende BPML-Excel importieren – Spalten-Mapping siehe [`data/schema.md`](data/schema.md).
- **⬆ JSON**: einen exportierten Snapshot wieder laden.
- **↺**: auf den versionierten Seed (`data/bpml.json`) zurücksetzen.

Der versionierte Stand liegt in [`data/bpml.json`](data/bpml.json); das Datenmodell
ist in [`data/schema.md`](data/schema.md) dokumentiert.

## Lokal starten

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

(Ein Server ist nötig, weil die App `data/bpml.json` per fetch lädt.)

## Hosting über GitHub Pages

1. Branch nach `main` mergen.
2. Repo-Einstellungen → **Pages** → Source: „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
3. Die App ist dann unter `https://<user>.github.io/BPML/` erreichbar.

## Technik

- Statisches HTML/CSS/JS ohne Build-Schritt (ES-Module).
- Vendored Bibliotheken (kein CDN, funktioniert auch in restriktiven Netzen):
  [bpmn-js](https://github.com/bpmn-io/bpmn-js) (Viewer) und
  [SheetJS](https://sheetjs.com/) (Excel-Import/-Export) unter `js/vendor/`.
