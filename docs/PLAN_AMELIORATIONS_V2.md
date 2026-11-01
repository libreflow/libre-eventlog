# Plan d'amélioration v2 — Libre EventLog

> Feuille de route détaillée pour transformer Libre EventLog en **utilitaire de
> diagnostic et maintenance Windows complet** : lecteur d'événements étendu,
> base de connaissances riche, audit de santé avec rapport, et UX soignée.
> Chaque jalon est autonome, testé, et livré par commit(s) distincts.

## État actuel (post v0.3)

| Domaine | État |
|---|---|
| Lecteur d'événements (System + Application, niveaux 1-2, 50/canal, XML) | ✅ |
| Diagnostic par provider/EventID (15 entrées, commandes exécutables) | ✅ |
| Terminal intégré, élévation, denylist, timeout par commande | ✅ |
| Maintenance : applications winget (sélection) + résidus | ✅ |
| Maintenance : Windows Update & pilotes (API COM WUA) | ✅ |
| Maintenance : Matériel & BIOS (CIM/PnP, liens fabricant) | ✅ |
| Correctifs système (sfc, DISM, chkdsk, réseau…) | ✅ |
| Tests : 20 Rust (dont 5 intégrations réelles), clippy 0 warning | ✅ |
| Canaux limités, pas d'avertissements, limite fixe | ❌ |
| Base de connaissances pauvre (15 entrées) | ❌ |
| Pas d'audit de santé / rapport / export | ❌ |
| CSP désactivée, pas de relance admin guidée | ❌ |
| Pas de raccourcis clavier, ni auto-refresh, ni thème clair | ❌ |

---

## M1 — Robustesse & qualité (1 commit)

**Objectif : consolider l'existant avant d'étendre.**

1. **CSP durcie** dans `tauri.conf.json` (`default-src 'self'; style-src 'self'
   'unsafe-inline'; img-src 'self' data:`) — validation visuelle en dev + build.
2. **Détection d'élévation fiable** : remplacer `net session` (échoue si le
   service Serveur est coupé) par la lecture du token via
   `whoami /groups | find "S-1-16-12288"` (integrité haute) avec fallback.
3. **Relance en administrateur guidée** : bouton « 🔐 Relancer en
   administrateur » dans l'en-tête quand non élevé → `Start-Process -Verb
   RunAs` (l'app se ferme, Windows affiche l'invite UAC, l'app relancée
   elevated). Une seule tentative, pas de boucle.
4. **Cache de la base de connaissances** : parse unique via `OnceLock`
   (actuellement re-parsée à chaque diagnostic).
5. **Avertissement winget** dans la modale Applications : « fermez vos
   applications avant la mise à jour — une app en cours d'exécution peut
   figer sa mise à jour (cas Terminal/MSIX) ou casser la chaîne d'outils en
   cours » (leçon Node.js).
6. **Terminal** : bouton « Copier la sortie » (presse-papiers), limitation de
   la hauteur mémorisée.
7. Micro-fixes : severity « Inconnu » pour level 0 (filtrage), doublons de
   clés React, focus trap minimal des modales (focus au premier bouton).

Tests : cargo test + nouveaux tests (élévation parsing, cache KB),
tsc/build, smoke dev, test visuel CSP.

## M2 — Lecteur d'événements étendu (1-2 commits)

**Objectif : réaliser la Phase 1 du plan d'audit initial.**

1. **Canaux supplémentaires** (paramétrables dans la barre d'outils) :
   - `Security` (accessible si élevé, sinon masqué avec tooltip)
   - `Microsoft-Windows-WHEA-Logger/Operational` (erreurs matérielles)
   - `Microsoft-Windows-Diagnostics-Performance/Operational` (dégradations
     de démarrage)
2. **Niveau Avertissement (Level=3)** : requête XPath étendue + libellé
   « Avertissement » doré dans l'UI + filtre sévérité à 3 valeurs.
3. **Limite configurable** : sélecteur 50 / 200 / 500 événements par canal.
4. **Modèle enrichi** : `processId`, `threadId`, `computer`,
   `eventRecordId`, `userId` (anonymisé : nom simple) parsés du XML,
   affichés dans le panneau détail.
5. **Tri décroissant garanti côté backend** (par EventRecordID).
6. Gestion des canaux inaccessibles : erreur par canal ignorée avec
   compteur d'avertissement au lieu d'un échec global.

Tests : parser XML étendu (nouveaux champs), requête XPath level 3, tests
d'intégration wevtutil réels par canal, tsc/build.

## M3 — Base de connaissances enrichie (1-2 commits)

**Objectif : couvrir les événements Windows les plus fréquents.**

~25 nouvelles entrées (priorisation par fréquence réelle) :

| Catégorie | Provider + EventID |
|---|---|
| Stockage | disk 7/11/51/153, Ntfs 55, volmgr 162, volsnap 25 (existant) |
| Matériel | WHEA-Logger 17/18/19/20, Kernel-Power 41 (existant) |
| Système | Service Control Manager 7000/7001/7031/7045, DCOM 10016 |
| Réseau | Tcpip 4233, DNS Client 1014 |
| Démarrage | Diagnostics-Performance 100/101/108/110 |
| Application | Application Error 1000, Hang 1002, .NET Runtime 1026 |

Pour chaque entrée : `titre`, `cause`, `etapes`, `categorie`, et quand c'est
pertinent une ou deux **commandes de lecture sûres** (ex. pour WHEA :
`Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-WHEA-Logger/Operational'} -MaxEvents 20 | Format-Table`).

+ **Validation au build** : test Rust qui vérifie le JSON (schéma) et que
  toutes les commandes de la base passent la denylist.
+ `messageMatch` optionnel (mots-clés dans le message) pour lever les
  ambiguïtés quand plusieurs entrées partagent un EventID.

Tests : validité JSON + denylist sur toutes les commandes (test Rust),
lookup provider/eventId (test unitaire sur la base embarquée).

## M4 — Audit complet & rapport (2 commits)

**Objectif : Phase 4 du plan d'audit initial — le différenciateur.**

1. **Bouton « 🩺 Lancer un audit complet »** (barre d'outils) :
   - collecte tous les canaux (7 jours, niveau 1-3)
   - agrégation par (provider, eventId) avec compteur d'occurrences
   - score de santé par catégorie : stockage / matériel / système / réseau /
     démarrage — note /100 par catégorie (pénalité par occurrence, plafonnée)
     et note globale pondérée
2. **Vue « Santé du système »** : jauges par catégorie (CSS pur), top 5 des
   problèmes récurrents avec lien direct vers le diagnostic de l'événement.
3. **Export du rapport** : Markdown généré (résumé, scores, top problèmes,
   correctifs suggérés par entrée de base), bouton « Copier le rapport » +
   sauvegarde en fichier via dialog (plugin Tauri `dialog`) — si plugin trop
   lourd, copie presse-papiers + ouverture du dossier.
4. **Plan d'action persistant** : checklist des étapes cochées (localStorage),
   consultable depuis le rapport.

Tests : calcul des scores (tests unitaires Rust purs), génération Markdown
(snapshot test), tsc/build, smoke.

## M5 — UX & finitions (1 commit)

1. **Raccourcis clavier** : `F5` analyser, `Ctrl+F` focus recherche, `Échap`
   fermeture (déjà partiel — à harmoniser), `Ctrl+T` basculer le terminal.
2. **Auto-refresh optionnel** : select 5/15/30 min (re-collecte silencieuse).
3. **Thème clair** : `prefers-color-scheme` + toggle manuel (variables CSS
   déjà en place, ajouter le jeu de couleurs claires).
4. **Toast de feedback** pour succès/échecs des actions longues (remplace le
   bandeau unique pour les opérations terminal).
5. Responsive : modale maintenance plein écran sur petit écran.

Tests : tsc/build, vérif visuelle, a11y basique (labels, focus visibles).

## M6 — Sécurité renforcée (1 commit)

1. **Liste blanche de cmdlets pour les correctifs type `action`**
   (deny-by-default) : le premier token de chaque commande doit être dans
   une liste (`sfc`, `DISM`, `chkdsk`, `ipconfig`, `netsh`, `powercfg`,
   `Get-WinEvent`, `Get-PhysicalDisk`, `Repair-Volume`, `Get-CimInstance`,
   `winget`…) — la denylist reste en second filet.
2. **Pass audit capacités Tauri** : aucune capability/plugin exposé au-delà
   du strict nécessaire, vérification `tauri.conf.json`.
3. Documentation README mise à jour (fonctionnalités, sécurité, limites).

---

## Jalons & ordre d'exécution

| Jalon | Contenu | Priorité | Effort estimé |
|---|---|---|---|
| M1 | Robustesse & qualité | Haute (consolide) | 0,5 j |
| M2 | Lecteur étendu | Haute (cœur métier) | 1 j |
| M3 | Base de connaissances | Haute (valeur directe) | 1 j |
| M4 | Audit & rapport | Haute (différenciateur) | 1,5 j |
| M5 | UX & finitions | Moyenne | 0,5-1 j |
| M6 | Sécurité | Moyenne | 0,5 j |

## Stratégie de test transverse

- Chaque jalon : `cargo test` (tests unitaires + intégrations réelles
  lecture seule), `cargo clippy` 0 warning, `tsc --noEmit`, `vite build`,
  smoke `tauri dev` (lancement sans panic).
- Les tests d'intégration restent **lecture seule** (wevtutil, CIM, PnP,
  winget list) — aucune mise à jour/repair exécutée en test.
- Chaque jalon = 1-2 commits conventionnels, message détaillé, push sur
  validation de l'utilisateur.

## Hors périmètre (explicitement)

- Exécution de commandes arbitraires saisies par l'utilisateur (non,
  catalogue fixe uniquement — sécurité).
- Mises à jour BIOS automatisées depuis les sites fabricants (aucune API
  universelle légitime — liens officiels uniquement).
- Désinstallation automatique des « résidus » de registre (détection
  seule : trop de faux positifs pour supprimer sans risque).
