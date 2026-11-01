# Plan d'amélioration v3 — Libre EventLog

> Feuille de route post-audit (14 passes d'audit + correction, ~40 correctifs
> livrés). Le plan v2 est **entièrement livré** : ce plan part de l'état réel
> du code (v0.3+, 25 tests, build release vérifié) et cible la v1.0.
>
> Conventions : effort **S** (< 2 h), **M** (½-1 jour), **L** (2-4 jours),
> **XL** (> 1 semaine). Chaque item est livré par commit(s) distincts avec
> tests. Les fichiers cités sont les points d'entrée réels du code.

## État actuel consolidé

| Domaine | État |
|---|---|
| Lecteur 5 canaux, niveaux 1-3, limite/canal, filtres, tri, regroupement par jour | ✅ |
| KB 35 entrées, correctifs exécutables, liste blanche + denylist PowerShell | ✅ |
| Terminal intégré, exécution avec confirmation, timeouts par commande | ✅ |
| Maintenance : winget / Windows Update (COM) / matériel BIOS (CIM/PnP) / correctifs système | ✅ |
| Audit de santé (scores par catégorie, plan d'action persistant, rapport .md) | ✅ |
| Sécurité : CSP, capabilities minimales + opener, encodages UTF-8/cp1252 maîtrisés | ✅ |
| Tests : 25 Rust (6 de non-régression d'audit), clippy 0, tsc strict, build release OK | ✅ |
| Qualité : contrastes WCAG AA deux thèmes, focus traps, aria (log, busy, sort) | ✅ |

Dette identifiée lors des audits (non bloquante, à traiter en P0) :
`App.tsx` ≈ 2 100 lignes monolithique, `lib.rs` ≈ 2 000 lignes monolithique,
`types.ts` dupliqué à la main depuis les structs Rust (risque de dérive),
aucun test frontend, aucune CI, sortie des commandes non streamée.

---

## Phase 0 — Fondations techniques (préalable à tout le reste)

> **Objectif : rendre le code maintenable et les régressions impossibles.**
> Effort total : ~2 L. Aucun changement visible pour l'utilisateur.

### 0.1 Découpage du frontend (M-L)
`src/App.tsx` contient l'application entière : table, détail, terminal, trois
modales, ~25 états `useState`, toute la logique de commandes.

- Extraire par feature :
  - `src/components/TableEvenements.tsx` (table, tri, regroupement jour,
    navigation clavier, day headers)
  - `src/components/PanneauDetail.tsx` (détail + diagnostic + cmd-cards)
  - `src/components/Terminal.tsx` (entries, redimensionnement, restore)
  - `src/components/ModaleMaintenance.tsx` (4 onglets + états wu/hw)
  - `src/components/ModaleAudit.tsx` (anneaux, catégories, plan d'action)
  - `src/components/ModaleConfirmation.tsx`
  - `src/components/LienExterne.tsx`, `src/components/Anneau.tsx`
- Extraire la logique en hooks :
  - `src/hooks/useCollecte.ts` (charger + seq + préservation sélection)
  - `src/hooks/useCommandes.ts` (terminal, runningCmd, confirmation)
  - `src/hooks/useTheme.ts` (localStorage + setTheme fenêtre)
  - `src/hooks/usePiegeFocus.ts` (focus trap + restauration)
- **Critères d'acceptation** : aucun composant > 400 lignes ; aucun `useState`
  hors d'un composant/hook nommé ; `tsc` strict + build verts ; zéro changement
  de comportement (revue visuelle des 3 modales + table + terminal).
- **Risque** : régressions subtiles d'état → livrer en une série de commits
  mécaniques (un fichier par commit), sans refactor logique simultané.

### 0.2 Découpage du backend (M)
`src-tauri/src/lib.rs` : types, collecte, parsing XML, sécurité, PowerShell,
winget, WU, CIM, audit, KB, 25 tests.

- Modules : `types.rs`, `collecte.rs` (wevtutil + parsing XML), `securite.rs`
  (denylist/liste blanche/segments), `powershell.rs` (spawn, timeout, décodage),
  `winget.rs`, `wu.rs`, `materiel.rs`, `audit.rs`, `kb.rs`, `commands.rs`
  (uniquement les `#[tauri::command]`).
- **Critères d'acceptation** : `cargo test` 25/25 inchangés, clippy 0, aucun
  `pub` inutile entre modules (éviter les fuites d'API interne).

### 0.3 Types générés : éliminer la duplication Rust/TS (M)
`src/types.ts` recopie à la main les structs Rust (`CriticalEvent`,
`CommandeFix`, `AuditSante`…). Toute évolution côté Rust sans mise à jour du
TS = bug silencieux (champ `undefined` au runtime, invisible pour `tsc`).

- Introduire [`tauri-specta`](https://github.com/specta-rs/tauri-specta) v2 :
  dériver les types, générer `src/bindings.ts` à la compilation Rust
  (`export_before_build`), supprimer `types.ts`.
- Alternative plus légère si tauri-specta bloque : test Rust qui sérialise
  chaque struct en `serde_json::Value` et compare aux clés attendues
  (verrou le contrat camelCase champ par champ).
- **Critères d'acceptation** : plus aucune déclaration de type dupliquée ;
  un test échoue si un champ Rust est renommé sans migration TS.

### 0.4 Tests frontend (M)
Aucun test JS/TS aujourd'hui.

- Ajouter **Vitest + @testing-library/react** (deps dev uniquement) :
  - `libelleJour` / `cleJourLocal` (bords : minuit, UTC+13, NaN, année)
  - `severityClass`, `formatDate` (timestamp invalide)
  - `segments_powershell` équivalents côté UI : `filtres` (filtres combinés,
    fenêtre temporelle, recherche insensible à la casse, tri multi-clés)
  - `rapportMarkdown` (échappement des `|` dans les titres, cases du plan)
- **Critères d'acceptation** : `pnpm test` vert en CI ; les fonctions pures
  extraites en `src/lib/*.ts` purs (sans React) pour être testables.

### 0.5 CI GitHub Actions (S-M)
- `.github/workflows/ci.yml` sur `windows-latest` :
  1. `pnpm install --frozen-lockfile`
  2. `pnpm exec tsc --noEmit`
  3. `pnpm build`
  4. `cargo fmt --check` + `cargo clippy -- -D warnings`
  5. `cargo test` (les intégrations réelles wevtutil/winget tournent sur un
     runner Windows — lecture seule, sûres)
  6. `cargo tauri build --no-bundle` (artefact : exe release)
- **Critères d'acceptation** : PR bloquée si une étape échoue ; build ~< 10 min.

### 0.6 Lint/format (S)
- ESLint 9 flat config + `eslint-plugin-react-hooks` (le commentaire
  `eslint-disable-next-line react-hooks/exhaustive-deps` de `App.tsx`
  référence un linter qui n'existe pas encore dans le projet) + Prettier ;
  scripts `pnpm lint`, `pnpm fmt`. `cargo fmt` déjà applicable côté Rust.

---

## Phase 1 — Feedback temps réel sur les commandes (cœur UX de la v1.0)

> **Objectif : ne plus jamais laisser l'utilisateur devant 20 minutes de
> silence pendant un `sfc /scannow`.** Effort : ~1 L.

### 1.1 Streaming de la sortie (L)
Aujourd'hui `attendre_avec_timeout` capture tout et ne rend la main qu'à la
fin ; le terminal affiche « Exécution en cours… » pendant toute la durée.

- Côté Rust : lire `stdout` ligne à ligne dans le thread de pompage et
  émettre un événement Tauri par ligne :
  ```rust
  app.emit("terminal://ligne", LigneTerminal { id, texte }) // via AppHandle
  ```
  Passer l'`AppHandle` aux commandes (`tauri::State` / argument `app`).
- Côté TS : `listen<LigneTerminal>("terminal://ligne", …)` (capability
  `core:event:default` déjà présente) ; l'entrée de terminal passe de
  « running » à « streaming » et s'alimente au fil de l'eau ; scroll auto
  uniquement si l'utilisateur est en bas (ne pas voler le scroll).
- Purger les lignes au-delà de ~2 000 par entrée (mémoire bornée).
- **Critères d'acceptation** : un `DISM /ScanHealth` montre ses premières
  lignes < 2 s après le lancement ; la sortie finale reste identique à
  l'actuelle ; test Rust : émission d'au moins 1 événement pour une
  commande multi-lignes.

### 1.2 Annulation d'une commande (M)
Aucun moyen d'annuler ; le timeout est le seul filet (jusqu'à 2 h).

- Rust : commande `annuler_commande(id)` → `Child::kill` via un
  `HashMap<u64, Child>` global (Mutex) rempli au spawn, vidé à la fin ;
  tuer aussi les petits-fils via `taskkill /PID <p> /T /F` (un installateur
  winget survit au kill du père direct).
- UI : bouton « Annuler » sur l'entrée running du terminal ; l'entrée passe
  en « annulée » (liseré gris) plutôt qu'en erreur.
- **Attention** : ne pas permettre l'annulation pendant `sfc` (risque de
  corruption du magasin en cours d'écriture) → champ `annulable: bool` dans
  `CommandeFix`, `false` pour sfc/DISM/chkdsk.
- **Critères d'acceptation** : un `powercfg /energy /duration 10` annulé
  libère le bouton « Exécuter » immédiatement ; pas de processus orphelin
  (vérifier dans le Gestionnaire des tâches).

### 1.3 Notification système de fin (S-M)
- Plugin `tauri-plugin-notification` ; option (défaut : on) « me prévenir
  quand une commande longue se termine » ; notification seulement si
  `durationMs > 60 s` et la fenêtre minimisée (`isMinimized`).
- Persistance du choix dans `localStorage` (`libre-eventlog-notifications`).

---

## Phase 2 — Lecteur d'événements

> Effort : ~1,5 L.

### 2.1 Rendu structuré des EventData (L)
`messageRaw` est du JSON brut (`{"DeviceName":"\\Device\\..."}`) : illisible
pour un non-technicien.

- Backend : remplacer la sérialisation brute par une liste
  `parametres: Vec<(String, String)>` (ordre du XML préservé — les clés
  `Data N` anonymes restent positionnelles).
- Frontend : dans le panneau détail, afficher « Paramètres » en tableau clé /
  valeur (table à 2 colonnes, valeurs en `mono`), **conserver** le JSON brut
  derrière un `<details>` (utile au support/copie).
- Bonus M : décoder les valeurs binaires hex (ex. NTSTATUS `00000000` →
  `STATUS_SUCCESS` pour les 20 codes les plus fréquents de la KB).
- **Critères d'acceptation** : événement 4625 affiche Compte / Domaine /
  Source réseau / Type d'échec nommés ; aucun test existant ne casse (le
  champ `messageRaw` reste pour compat rapport).

### 2.2 Virtualisation de la table (M)
Avec « 500/canal » + avertissements, jusqu'à ~2 500 lignes dans le DOM.

- Introduire `@tanstack/react-virtual` sur le `tbody` (les en-têtes de jour
  deviennent des lignes virtuelles de hauteur fixe ; mesure dynamique
  seulement si nécessaire — viser des lignes à hauteur constante).
- **Critères d'acceptation** : scroll fluide à 2 500 lignes (< 16 ms/frame) ;
  navigation clavier (flèches) et sélection inchangées ; sticky header
  préservé.

### 2.3 Filtre par provider (S-M)
La recherche libre fait déjà l'affaire, mais :
- Menu déroulant « Source » construit comme « Canal » (dérivé des
  événements collectés, trié par fréquence) + compte par provider dans les
  options (`disk (47)`).
- Lien depuis le panneau détail : cliquer le chip provider filtre la liste.
- Réutiliser le mécanisme d'auto-reset « canal disparu » (round 1) pour le
  provider.

### 2.4 Export des événements filtrés (S-M)
- Bouton « Exporter (.csv) » dans la toolbar : exporte `filtres` courant
  (toutes colonnes + params JSON) ; génération côté TS (`Blob` + ancre
  attachée, même mécanique que le rapport .md, round 2) — pas de nouveau
  canal Rust nécessaire.
- Nom : `evenements-YYYYMMDD-HHmm.csv` ; échapper les `"` et `;`
  (séparateur `;` + BOM UTF-8 pour Excel FR).

### 2.5 Canaux personnalisables (M)
- Liste de canaux supplémentaires éditable par l'utilisateur (ex.
  `Microsoft-Windows-Windows Defender/Operational`, `Microsoft-Windows-
  WindowsUpdateClient/Operational`), persistée dans
  `localStorage` (`libre-eventlog-canaux`) ; badge « inaccessible » si
  wevtutil échoue (le mécanisme d'avertissements existe déjà).
- Pré-proposer 4 canaux utiles cochables sans saisie libre.

### 2.6 Filtre temporel côté backend (S)
Le filtre « dernière heure / 24 h / 7 j » est appliqué côté frontend sur des
événements déjà collectés (la limite/canal peut donc exclure des événements
anciens pertinents). Ajouter `TimeCreated` dans le XPath :
`*[System[(timediff(@SystemTime) <= 86400000)]]` — supprime le filtrage
post-hoc et rend la période réellement exacte.
- **Critères d'acceptation** : le filtre « 7 jours » avec limite 50 ne rate
  plus d'événements récents noyés sous des plus anciens.

---

## Phase 3 — Diagnostic & base de connaissances

> Effort : ~1 L + enrichissement continu.

### 3.1 Messages localisés (M-L)
wevtutil ne rend pas les messages (pas de accès aux `Metadata` des providers).
- Option A (précise, M-L) : requêter les messages via
  `wevtutil qe … /f:RenderedXml` **dans la langue de l'OS** — le
  `RenderedXml` inclut `<RenderingInfo>` avec le message complet.
  Vérifier la compat perf (1 requête de plus par sélection, seulement pour
  l'événement sélectionné, pas pour la liste) ; cache LRU (256 entrées).
- Affichage : « Message » humain en tête du panneau détail, params bruts en
  second.
- **Critères d'acceptation** : un événement 41 Kernel-Power affiche le
  message français complet de Windows ; fallback propre si le provider
  n'a pas de DLL de message (rare).

### 3.2 Regroupement « par problème » dans la liste (M)
Vue alternative de la table (toggle « Par événement / Par problème ») :
une ligne par (provider, eventId) avec occurrences, dernière occurrence,
sévérité max — même agrégation que l'audit (réutiliser `calculer_audit`
côté backend avec un paramètre de regroupement, ou agréger côté TS).
- Clic : filtre la liste sur ce problème (déjà le comportement de l'audit).

### 3.3 Enrichissement de la KB (continu, données)
- Les 35 entrées actuelles couvrent déjà toutes celles listées par le README
  (Ntfs 50/55, volmgr 162, WHEA 17/18/19/20, SCM 7000-7045, DCOM 10016,
  DNS 1014, Application Error/Hang, démarrage 100/101/108, 4625) — vérifié.
- Cible 60+ entrées sur les lacunes réelles : `EventLog 6008` (arrêt brutal
  sans extinction propre), `Kernel-Power 506/507` (intégrité système),
  `User32 1074` (redémarrage initié par un processus), `Application Error
  1001` (WER), `Microsoft-Windows-Windows-Defender 1116/5001`,
  `Wininit 11`, `Disk 154` (cache non appris), `iaStor/stornvme`
  (contrôleurs NVMe), `WHEA 46/47` ( liens PCIe), `BugCheck 1001`,
  `Microsoft-Windows-Time-Service 46` (horloge).
- Chaque entrée : `titre`/`cause`/`etapes` en français, `categorie` parmi
  les 8 existantes (minuscules — invariant de l'audit), commandes passant
  la liste blanche (test existant `base_de_connaissances_valide`), timeouts
  adaptés si > 2 min (leçon powercfg, round 3 de l'audit initial).
- Ajouter un test : chaque `categorie` ∈ ensemble fermé connu.

### 3.4 Statistiques « après correctif » (S-M)
Après une commande de correctif réussie (exit 0) sur un événement
sélectionné, proposer « Vérifier » : re-collecte ciblée (canal + provider +
eventId, `wevtutil` XPath direct) et affiche le delta d'occurrences depuis
l'instant T du correctif (stocké dans `localStorage`). Boucle
diagnostic → correctif → vérification fermée.

---

## Phase 4 — Audit de santé

> Effort : ~1 L.

### 4.1 Historique de scores (M)
- À chaque audit : `{ date, global, categories: {nom: score} }` dans
  `localStorage` (clé `libre-eventlog-audits`, plafond 50 entrées, purge
  FIFO) ; sparkline SVG du score global dans la modale + tableau des 5
  derniers audits.
- Rapport .md : ajouter la tendance (« +4 depuis le précédent »).

### 4.2 Comparaison avant/après (M)
- Bouton « Comparer avec… » : sélection de deux audits de l'historique →
  tableau catégories (Δ score) + problèmes apparus/résolus.
- Cas d'usage : lancer l'audit, appliquer les correctifs, re-lancer,
  prouver l'amélioration.

### 4.3 Rapport HTML (S-M)
- Même contenu que le .md, rendu en HTML autonome (CSS inline, sans
  dépendance) : partageable tel quel ; le .md reste pour l'édition.
- Ajouter : version de l'app, OS (`cmd /c ver` ou `Get-CimInstance
  Win32_OperatingSystem`), modèle machine, durée de disponibilité (uptime).

### 4.4 Pondération de l'audit (S)
- Le score global actuel est une moyenne **non pondérée** des catégories
  (« non identifie » pèse autant que « stockage »). Pondérer par nombre
  d'événements agrégés, ou exclure « non identifie » du global et
  l'afficher à part (décision produit — proposer la 2e option).
- Test : deux jeux d'événements avec scores attendus documentés.

---

## Phase 5 — Maintenance

> Effort : ~1 L.

### 5.1 Progression winget (M-L)
`update_applications` est séquentiel et muet. Avec le streaming (phase 1) :
- Émettre un événement par paquet (« Installation de X… », « X : ok ») ;
- Permettre la mise à jour **parallèle** (2 workers max ; winget supporte
  des installs concurrentes de sources différentes mais risque de
  contention MSI — rester séquentiel par défaut, option de parallélisme
  expérimentale).
- Badge « redémarrage requis » dans la modale après échec/finalisation.

### 5.2 Désinstallation sélective (M)
- Onglet Applications : bouton « Désinstaller » par paquet via
  `winget uninstall --id <id> --exact` (même gate de sécurité ; confirmation
  obligatoire systématique ; purge résidus réutilisable).
- Cas d'usage principal : ancienne version en double détectée par le scan
  des résidus.

### 5.3 Windows Update : filtres et listes (S-M)
- Séparer onglet « Qualité mensuelle » / « Pilotes » / « Facultatifs » (le
  `kind` existe déjà dans `WinUpdate`).
- Case « inclure les facultatifs » (le scan les exclut déjà ? non — il
  liste tout `IsInstalled=0` ; ajouter le filtre `BrowseOnly`/`IsMandatory`
  côté PS si demandé).
- Détection du redémarrage déjà présente → la remonter dans la modale
  (badge persistant dans l'en-tête après fermeture, pas seulement dans le
  terminal).

### 5.4 Nettoyage disque guidé (M)
- Onglet Correctifs : `cleanmgr /sageset` non interactif impossible —
  préférer un audit lecteur : `Get-PSDrive -PSProvider FileSystem`, taille
  des dossiers temp connus (`%TEMP%`, `C:\Windows\Temp`,
  `C:\Windows\SoftwareDistribution\Download` via fs directement, pas de
  PowerShell), proposition de purge ciblée avec confirmation et total
  libérable estimé (réutiliser `taille_entree`/`taille_lisible`).

---

## Phase 6 — Sécurité & confiance

> Effort : ~1 L.

### 6.1 Journal d'audit local (M)
- `tauri-plugin-log` : chaque exécution de commande (label, commande,
  exit code, durée, élevé ou non) dans `%APPDATA%/libre-eventlog/logs/`
  (rotation 1 Mo × 5) ; rubrique « Journal » dans la modale Maintenance
  (consultation + purge). Justification : traçabilité de l'outil qui
  exécute des commandes système.

### 6.2 Empreinte du catalogue (S-M)
- Au chargement, la KB est embarquée (`include_str!`) : tant que le binaire
  n'est pas retouché, elle est de confiance. Documenter l'invariant + test
  SHA-256 de `knowledge_base.json` figé dans un test (échec explicite si
  le fichier change sans mise à jour de l'empreinte — force la revue).
- Alternative plus souple : garder le test de validité actuel et ajouter
  empreinte en warning CI.

### 6.3 Surface frontend (S)
- `dangerouslySetInnerHTML` : interdit par revue (aucun aujourd'hui) —
  ajouter une règle ESLint `react/forbid-elements` ou check CI grep.
- Vérifier `connect-src` : après la phase 1 (streaming), aucun besoin réseau
  additionnel (IPC local uniquement) — s'assurer qu'aucun fetch HTTP n'est
  introduit.

### 6.4 Signature & SmartScreen (M)
- `tauri.conf.json` : configurer la signature d'installateur (signtool)
  quand un certificat sera disponible ; sinon documenter clairement le
  warning SmartScreen dans le README.

---

## Phase 7 — Distribution & métier

> Effort : ~1 L.

### 7.1 Mise à jour automatique (L)
- `tauri-plugin-updater` + endpoints (GitHub Releases) ; signature des
  artefacts ; opt-in explicite (« Vérifier les mises à jour de l'app »).

### 7.2 Profils d'utilisation (M)
- « Mode technicien » (défaut actuel : tout) vs « Mode simple » : masque les
  cmd-cards, n'affiche que diagnostic + étapes ; réduit la barre d'outils à
  Analyser / Audit. Persisté (`libre-eventlog-profil`). Objectif : grand
  public sans risque.

### 7.3 Multi-poste (XL — hors v1.0)
- Collecte distante (WinRM/`wevtutil /r:<machine>`) : envisagé mais gros
  chantier sécurité — explicitement **hors périmètre v1.0**.

---

## Priorisation recommandée

| Ordre | Contenu | Effort cumulé | Valeur |
|---|---|---|---|
| 1 | **Phase 0** (dette : découpages, types générés, tests FE, CI) | ~2 L | Enable everything |
| 2 | **1.1 + 1.2** (streaming + annulation) | +1,5 L | Plus grande douleur UX actuelle |
| 3 | **2.1 + 2.4** (EventData structuré + export CSV) | +1 L | Lisibilité grand public |
| 4 | **3.1** (messages localisés) | +1 L | Complète le diagnostic |
| 5 | **4.1 + 4.2** (historique + diff d'audit) | +1 L | Boucle de preuve d'amélioration |
| 6 | 2.2, 2.3, 2.5, 2.6, 3.2, 3.3, 3.4 | +2 L | Confort lecteur |
| 7 | 5.x (maintenance) | +1,5 L | Étend la promesse « maintenance » |
| 8 | 6.x + 7.x (sécurité, distri) | +2 L | Confiance et livraison |

Total estimé : **~12-14 jours-j homme** jusqu'à une v1.0 cohérente.

## Invariants à préserver (héritage des 14 passes d'audit)

Toute PR doit respecter ces acquis — chacun coûte un vrai bug corrigé :

1. **Sécurité** : liste blanche deny-by-default + denylist (dont
   `wevtutil cl`, `advfirewall set/del/add`) ; jamais de commande arbitraire
   saisie ; tests de non-régression obligatoires pour toute évolution du gate.
2. **Encodages** : tout PowerShell via `spawn_powershell` (préfixe UTF-8) ;
   erreurs wevtutil via `decoder_console` ; winget = UTF-8 natif.
3. **Async** : toute commande Tauri susceptible d'attendre un processus est
   `async` + `spawn_blocking` (leçon `relancer_admin`, round 4).
4. **Races** : gardes de séquence (collecte, diagnostic) ; sélections
   préservées au rechargement.
5. **Erreurs visibles** : aucune erreur capturée ne peut rester invisible
   derrière une modale (leçons WU round 5, matériel round 11).
6. **A11y** : WCAG AA sur les deux thèmes (résultats recalculés, pas à
   l'intuition) ; focus traps + restauration ; `role="log"` terminal ;
   raccourcis désactivés derrière une modale.
7. **Types** : champs sérialisés `camelCase` côté Rust, `timeoutSecs`
   transporté jusqu'au frontend.
8. **Tests d'intégration réels en lecture seule uniquement** (jamais
   d'installation/suppression en test).
