# Libre EventLog

Application desktop Windows (Tauri 2) : **lecteur d'événements Windows avec diagnostics en français** et **outil de maintenance complet** (mises à jour applications, Windows/pilotes, correctifs système, audit de santé).

## Fonctionnalités

### Lecteur d'événements
- 🔍 Canaux : `System`, `Application`, `Security` (si administrateur), `WHEA-Logger`, `Diagnostics-Performance`
- Niveaux Critique / Erreur / Avertissement (optionnel), limite 50/200/500 par canal
- Filtres : canal, sévérité, période, recherche libre, tri par colonne
- Champs enrichis par événement : machine, PID, n° d'enregistrement
- 🧠 Base de connaissances **35 entrées** (`src-tauri/knowledge_base.json`) : Kernel-Power 41, WHEA 17/18/19/20, disk 7/11/51/153, Ntfs 50/55, volsnap 25, volmgr 162, SCM 7000/7001/7024/7031/7034/7045, DCOM 10016, Tcpip 4233, DNS 1014, épuisement mémoire, Application Error 1000/Hang 1002, .NET 1026, démarrage lent 100/101/108, échecs de connexion 4625…
- Correctifs exécutables (lecture seule) attachés aux diagnostics pertinents

### 🩺 Audit de santé
- Collecte tous les canaux, agrège par problème, **score /100 par catégorie** (stockage, matériel, système, réseau, démarrage…)
- Jauges visuelles, top des problèmes, clic = filtre sur l'événement
- **Rapport Markdown** : copie ou téléchargement `.md`
- **Plan d'action** : étapes cochables, persistées en local

### 🛠 Maintenance (4 onglets)
- **Applications** : mise à jour sélective via `winget` (liste, cases à cocher), purge des installateurs résiduels, détection des anciennes versions/doublons
- **Windows & pilotes** : scan et installation des mises à jour via l'agent Windows Update (API COM), pilotes marqués, détection de redémarrage requis
- **Matériel & BIOS** : fabricant/modèle/version BIOS/numéro de série (CIM), liens officiels du constructeur, périphériques en erreur avec code et signification (PnP)
- **Correctifs système** : sfc /scannow, DISM CheckHealth/ScanHealth/RestoreHealth, combo DISM+sfc, chkdsk /scan, flushdns, réinitialisation pile réseau

### UX
- Terminal intégré (copie, historique horodaté, codes de sortie)
- Relance en administrateur guidée (UAC)
- Raccourcis : `F5` analyser, `Ctrl+F` recherche, `Ctrl+T` terminal, `Échap` fermer
- Auto-refresh (5/15/30 min), thème clair/sombre persistant

## Sécurité

- **Catalogue fixe** : aucune commande arbitraire saisie par l'utilisateur
- **Liste blanche deny-by-default** : chaque segment de commande doit commencer par un exécutable ou un cmdlet autorisé (découpage conscient de la syntaxe PowerShell : guillemets, hashtables)
- **Denylist** destructrice en second filet (Format-Volume, Remove-Item, reg delete…)
- Timeouts par commande (plafond 2 h), processes tués au dépassement
- Commandes Tauri async (`spawn_blocking`) : l'UI ne se gèle jamais
- CSP durcie, création de fenêtre console masquée, élévation explicite
- Tests d'intégration en **lecture seule uniquement**

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
pnpm tauri build # MSI + NSIS dans src-tauri/target/release/bundle
```

> Conseil : lancez l'application **en administrateur** pour accéder au canal
> Security et aux commandes nécessitant une élévation (bouton intégré).

## Tests

```bash
cd src-tauri && cargo test   # 26 tests (unitaires + intégrations réelles lecture seule)
pnpm test                   # 21 tests frontend (Vitest, fonctions pures)
```
