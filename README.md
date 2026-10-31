# Libre EventLog

Application desktop Windows (Tauri 2) qui lit le journal d'événements Windows, affiche les événements **critiques et erreurs**, et propose des **correctifs en français** selon le code d'erreur (EventID, provider).

## Fonctionnalités

- 🔍 Lecture des canaux `System` et `Application` via `wevtutil` (niveaux 1 = Critique et 2 = Erreur uniquement).
- 📋 Liste triée avec filtres : canal, sévérité, recherche libre (provider, ID, message).
- 🩺 Panneau détail : message brut + **diagnostic expliqué en français** (cause probable, étapes de correction).
- 🧠 Base de connaissances versionnée (`src-tauri/knowledge_base.json`) : Kernel-Power 41, WHEA 18/19, disk 7/153, NTFS 55, SCM 7000/7031/7034, WindowsUpdate 20, EventLog 6008, BugCheck 1001, Application Error 1000…
- 🔗 Lien de recherche vers `support.microsoft.com` pour les événements inconnus.

## Prérequis

- Windows 10/11
- [Node.js](https://nodejs.org) ≥ 18 et pnpm (ou npm)
- [Rust](https://rustup.rs) (toolchain stable)

## Démarrage

```bash
pnpm install
pnpm tauri dev
```

## Build (installateur Windows)

```bash
pnpm tauri dev   # développement
pnpm tauri build # MSI + NSIS dans src-tauri/target/release/bundle
```

## Architecture

- **Backend Rust** (`src-tauri/src/lib.rs`)
  - `get_critical_events()` : `#[tauri::command]` qui exécute `wevtutil qe <canal> /q:"*[System[(Level=1 or Level=2)]]" /f:json` et parse le JSON.
  - `get_diagnostic(event)` : retourne l'événement + le correctif correspondant de la base de connaissances.
  - `CriticalEvent { timestamp, canal, provider, event_id, level, severity, message_raw }`.
- **Base de correctifs** (`src-tauri/knowledge_base.json`) : donnée versionnée embarquée à la compilation (`include_str!`), enrichissable sans toucher au code Rust.
- **Frontend React/TS** (`src/`) : table + filtres + panneau détail, UI entièrement en français.

## Notes

- La lecture des canaux `System`/`Application` fonctionne généralement sans droits admin. En cas d'accès refusé sur un canal custom, l'erreur est affichée proprement dans l'UI.
- Pour aller plus loin (v2) : monitoring temps réel (`EvtSubscribe`), export rapport (CSV/HTML), correction guidée (redémarrage de service via `sc`).

## Licence

MIT
