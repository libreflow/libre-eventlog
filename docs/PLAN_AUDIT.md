# Plan d'amélioration de l'audit — Libre EventLog

> Feuille de route détaillée pour transformer Libre EventLog d'un simple lecteur
> d'événements en **outil d'audit Windows complet**, avec correctifs guidés et
> exécution de commandes directement dans la fenêtre principale.

## État actuel (v0.1)

| Fonctionnalité | État |
|---|---|
| Lecture événements critiques/erreurs (System, Application, 50/canal) | ✅ |
| Base de connaissances de correctifs statique (JSON embarqué) | ✅ |
| Diagnostic par provider/EventID | ✅ |
| Exécution de correctifs | ❌ (manuel, via étapes texte) |
| Audit guidé | ❌ |
| Historique / export | ❌ |

---

## Phase 1 — Fondations audit (courte durée)

### 1.1 Élargir la collecte
- **Plus de canaux** : `Microsoft-Windows-WHEA-Logger`, `Security` (nécessite
  élévation), `Microsoft-Windows-Diagnostics-Performance` (dégradations au démarrage).
- **Plus de niveaux** : ajouter Avertissement (Level=3) avec filtre UI.
- **Paramètre `limit`** : laisser l'utilisateur choisir 50 / 200 / 500 événements.
- **Plage de dates** : `wevtutil` avec `StartTime`/`EndTime` via requête XPath.

### 1.2 Modèle de données
- Ajouter `processId`, `threadId`, `machine`, `userId`, `keywords` à `CriticalEvent`.
- Horodatage en ISO-8601 strict, tri côté backend par date décroissante.

### 1.3 Fiabilité
- Gérer la sortie XML (fallback) si `wevtutil /f:json` échoue sur les vieux Windows.
- Messages d'erreur différenciés : accès refusé (ouvrir en admin) vs canal vide.

---

## Phase 2 — Correctifs exécutables (PowerShell intégré)

### 2.1 Architecture des commandes
Chaque entrée de la base de connaissances gagne un champ optionnel `commandes` :

```json
{
  "match": { "provider": "disk", "event_id": 7 },
  "titre": "Erreur disque (disk 7)",
  "commandes": [
    {
      "label": "Vérifier l'état S.M.A.R.T.",
      "description": "Affiche les attributs S.M.A.R.T. du disque système",
      "commande": "Get-PhysicalDisk | Get-StorageReliabilityCounter | Format-Table",
      "type": "lecture",
      "elevation": false,
      "confirme": false
    },
    {
      "label": "Vérifier le système de fichiers",
      "commande": " Repair-Volume -DriveLetter C -Scan",
      "type": "action",
      "elevation": true,
      "confirme": true
    }
  ]
}
```

### 2.2 Backend Rust (commandes Tauri)
- `run_diagnostic_command(command: String) -> CommandResult` :
  - Lance `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command <cmd>`.
  - `CreateNoWindow = true` + `OUTPUTPIPE` : **aucune fenêtre console ne s'ouvre**,
    tout est capturé et affiché dans la fenêtre principale.
  - Retourne `{ stdout, stderr, exitCode, durationMs }`.
- `check_elevation() -> bool` : détecte si l'app est lancée en administrateur
  (`net session` ou token Windows).
- Filet de sécurité backend :
  - **Liste blanche de cmdlets** autorisés en type `action` (deny-by-default).
  - Interdiction absolue des opérations destructives non listées
    (`Format-Volume`, `Remove-Partition`, `Clear-Disk`…).
  - Timeout d'exécution (ex. 120 s) avec annulation.

### 2.3 UI dans la fenêtre principale (aucune fenêtre externe)
- Chaque étape de correctif devient une **carte actionable** :
  - Bouton « Exécuter » (icône ▶) pour les commandes de lecture.
  - Bouton « Exécuter (admin requis) » avec badge 🔐 si `elevation: true`.
  - Modale de confirmation intégrée pour `confirme: true` (jamais de `confirm()` natif).
- **Panneau terminal intégré** (onglet ou drawer en bas de la fenêtre) :
  - Affiche stdout/stderr avec coloration (erreur en rouge, warning en jaune).
  - Historique des commandes exécutées, horodatées, avec code de sortie.
  - Bouton copier, effacer, et ré-exécuter.
- **Barre d'état** : « Mode administrateur ✅/⛔ » + indicateur d'activité.

### 2.4 Expérience administrateur
- Si l'app n'est pas élevée : proposer « Relancer en administrateur » via
  `ShellExecuteW "runas"` (une seule relance, même fenêtre afterwards).
- Les commandes nécessitant une élévation sont grisées avec tooltip explicatif.

---

## Phase 3 — Base de connaissances enrichie

### 3.1 Couverture
Priorisation par fréquence réelle des événements Windows :
1. **Stockage** : disk 7/11/51/153, Ntfs 55, volmgr 162.
2. **Matériel** : Kernel-Power 41, WHEA-Logger 17/18/19/20.
3. **Système** : Service Control Manager 7000/7001/7031, DCOM 10016.
4. **Réseau** : Tcpip 4233, DNS 1014.
5. **Démarrage** : Diagnostics-Performance 100-110 (boot degradation).
6. **Application** : crashes Application Error 1000, hangs 1002.

### 3.2 Structure
- `categorie` (materiel/stockage/systeme/reseau/application).
- `gravite` (1-5) pour prioriser l'affichage.
- Mots-clés de message (`messageMatch`) pour lever les ambiguïtés quand plusieurs
  entrées partagent le même EventID.
- Liens vers la documentation Microsoft par entrée.

### 3.3 Contributions
- Validation au build : script CI qui vérifie le JSON (schéma + commandes en liste blanche).
- README : comment ajouter une entrée avec commande.

---

## Phase 4 — Audit guidé et rapport

### 4.1 Mode audit
- Bouton « Lancer un audit complet » :
  1. Collecte tous les événements (tous canaux, 7 derniers jours).
  2. Agrège par problème (provider+eventId).
  3. Score de santé : disque / mémoire / système / réseau / démarrage.
- **Vue « Santé du système »** : jauges par catégorie, note globale /100.

### 4.2 Rapport d'audit
- Export **Markdown** et **HTML** (styles intégrés) :
  résumé, scores, top problèmes, correctifs appliqués, commandes exécutées.
- Bouton « Copier le rapport » pour partage.
- Historique local des audits (comparaison entre deux dates).

### 4.3 Plan d'action
- Checklist persistante (localStorage) : cocher les étapes déjà faites.
- Re-audit ciblé : « Vérifier si le problème est résolu » relance seulement les
  commandes de lecture liées au problème.

---

## Phase 5 — Finitions

- **Paramètres** : canaux par défaut, limite, thème clair/sombre, langue FR/EN.
- **Raccourcis clavier** : F5 analyser, Ctrl+F recherche, Esc ferme modale.
- **Auto-refresh** optionnel (requête toutes les N minutes).
- **CI/CD** : build Windows, tests unitaires du parsing, lint des commandes PS.
- **Icône & identité** : palette et logo appliqués partout (fait ✅).

---

## Sécurité (transverse)

| Règle | Détail |
|---|---|
| Aucune exécution arbitraire | Seules les commandes de la base (liste blanche) sont exécutables |
| Pas de shell visible | `CreateNoWindow`, sortie capturée, tout rendu dans la fenêtre principale |
| Élévation explicite | `elevation` par commande, confirmation modale, relance admin guidée |
| Non-destructif par défaut | Les actions destructives sont interdites même dans la base |
| Timeout | 120 s max, annulation propre |

---

## Jalons suggérés

| Jalon | Contenu | Effort estimé |
|---|---|---|
| M1 | Phase 1 (collecte étendue + modèle) | 1-2 j |
| M2 | Phase 2 (PowerShell intégré, terminal UI) | 2-3 j |
| M3 | Phase 3 (base enrichie + CI) | 2-3 j |
| M4 | Phase 4 (audit guidé + rapports) | 3-4 j |
| M5 | Phase 5 (finitions) | 1-2 j |
