# Datenmodell & Excel-Mapping

Die App hält alle Daten in einer JSON-Struktur (`data/bpml.json` als versionierter Seed,
zur Laufzeit im Browser-localStorage). Jeder Export ist ein vollständiger Snapshot.

## Hierarchie

| Ebene | Feld | Bedeutung | Beispiel |
|---|---|---|---|
| L1 | `areas[]` | Prozessbereich | Record to Report – Abschluss |
| L2 | `areas[].groups[]` | Prozessgruppe | Hauptbuch, Intercompany |
| L3 | `groups[].processes[]` | Prozess | Rückstellungen und Abgrenzungen |
| L4 | `processes[].tasks[]` | Task (AFC-relevante Einheit) | Abschreibungslauf durchführen |

## Task-Felder

| Feld | Typ | Bedeutung |
|---|---|---|
| `id` | string | Eindeutige ID (T1, T2, …) |
| `name` | string | Task-Bezeichnung |
| `description` | string | Beschreibung / Arbeitsanweisung |
| `harmonized` | bool | Teil des harmonisierten Global Template? |
| `countries` | map | Je Land: `applies` (relevant?), `variant` (Abweichungstext oder null = Standard), `reason` (Begründung) |
| `owner` | string | Verantwortliche Organisationseinheit |
| `raci` | object | `r` = Responsible, `a` = Accountable |
| `system` | string | System (SAP S/4, AFC, lokale Tools …) |
| `transaction` | string | Transaktion / Fiori-App / Job |
| `closingDay` | int | Workday-Offset zum Stichtag (−5 … +12, 0 = Ultimo) |
| `frequency` | string | monatlich / quartalsweise / jährlich |
| `dependsOn` | string[] | Vorgänger-Task-IDs (steuert Kalender & BPMN) |
| `afc` | object | `type` (Manuell/Job/Workflow/Prüfung/Meilenstein), `duration` (Minuten), `jobName` |
| `status` | string | Entwurf / In Abstimmung / Final |
| `comments` | array | Workshop-Kommentare `{who, when, text}` |

## Reihenfolge

Die Array-Reihenfolge (`areas`, `groups`, `processes`, `tasks`) ist zugleich die
Anzeige- und Export-Reihenfolge. Drag & Drop in der Tabelle ändert genau diese
Reihenfolge bzw. hängt Knoten in ein anderes Parent-Array um; IDs bleiben dabei
stabil, `dependsOn`-Verweise bleiben gültig.

## Meta

- `meta.countries`: Länder mit Buchungskreisen (`entities`)
- `meta.closingDayRange`: Anzeigebereich des Closing-Kalenders
- `meta.statusValues`, `meta.afcTaskTypes`: Auswahllisten

## Excel-Import (In-App)

Der Import (Button „Excel importieren") liest die erste Tabelle mit erkennbaren
Spaltenüberschriften. Erwartete/erkannte Spalten (Groß-/Kleinschreibung egal,
deutsche und englische Titel werden gemappt):

| Excel-Spalte (Aliasse) | Ziel-Feld |
|---|---|
| Bereich / Area / L1 | Area-Name |
| Prozessgruppe / Group / L2 | Group-Name |
| Prozess / Process / L3 | Process-Name |
| Task / Aktivität / Activity / L4 | `task.name` |
| Beschreibung / Description | `task.description` |
| Verantwortlich / Owner / Responsible | `task.owner` |
| System | `task.system` |
| Transaktion / Transaction / TCode | `task.transaction` |
| Tag / Closing Day / Workday / WT | `task.closingDay` (Zahl, „WT+3" → 3) |
| Frequenz / Frequency | `task.frequency` |
| Vorgänger / Predecessor / Depends | `task.dependsOn` (kommagetrennt) |
| AFC-Typ / Task Type | `task.afc.type` |
| Status | `task.status` |
| Länderspalten (DE, FR, US, … oder Ländernamen) | `countries[XX]`: leer/`-`/`n/a` → nicht relevant, `x`/`✓`/`Standard` → Standard, sonstiger Text → Abweichung |

Nicht erkannte Spalten werden ignoriert und im Import-Dialog gemeldet.
**Sobald die echte Kunden-Excel vorliegt, wird dieses Mapping an deren
Spaltenlayout angepasst** (Phase-0-Punkt aus dem Plan).

## AFC-Export

Der AFC-Export flacht die Hierarchie ab: Prozessgruppe → AFC-Ordner,
Task → AFC-Task mit Feldern Typ, Offset (`closingDay`), Verantwortlicher,
Dauer, Job-Name, Abhängigkeiten. Format: CSV (Spalten analog
AFC-Task-Listen-Vorlage) und JSON.
