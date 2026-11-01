# Plan d'amélioration v3 — Libre EventLog

> Feuille de route post-audit (14 passes d'audit + correction, ~40 correctifs
> livrés). Le plan v2 est **entièrement livré** : ce plan part de l'état réel
> du code (v0.3.0+, build release vérifié) et cible la v1.0.
>
> **Mise à jour** : la grande majorité de ce plan est désormais LIVRÉE
> (voir « État d'avancement »). Ce document conserve la structure d'origine,
> annote chaque item de son statut, et enregistre le retour d'expérience.
> Conventions d'effort inchangées : **S** (< 2 h), **M** (½-1 jour),
> **L** (2-4 jours), **XL** (> 1 semaine).

## État d'avancement (janvier 2026)

| Phase | Statut | Livré |
|---|---|---|
| 0 — Fondations | ✅ 100 % | 0.1 à 0.6 |
| 1 — Feedback temps réel | ✅ 100 % | 1.1 streaming, 1.2 annulation, 1.3 notifications |
| 2 — Lecteur d'événements | ✅ 100 % | 2.1 à 2.6 |
| 3 — Diagnostic & KB | ✅ 100 % | 3.1 messages localisés, 3.2 vue par problème, 3.3 KB 44 entrées, 3.4 vérification post-correctif |
| 4 — Audit de santé | ✅ 4.1 + 4.4 | historique + sparkline + pondération ; restent 4.2 diff, 4.3 HTML |
| 5 — Maintenance | 🔶 5.2 | désinstallation sélective ; restent 5.1 parallélisme, 5.3 onglets WU, 5.4 nettoyage guidé |
| 6 — Sécurité & confiance | 🔶 6.1 | journal local ; restent 6.2 empreinte, 6.3 greps CI, 6.4 signature |
| 7 — Distribution | ⬜ | 7.1 updater, 7.2 profils, 7.3 multi-poste (hors v1.0) |

Tests : **37 Rust** (contrat de sérialisation, sécurité, streaming, LRU,
canaux, comptage) + **40 Vitest** (fonctions pures). CI GitHub Actions
verte en continu, artefact exe à chaque push.

---

## Phase 0 — Fondations techniques ✅ LIVRÉE

- ✅ **0.1 Découpage du frontend** — App.tsx : 2 006 → ~750 lignes ;
  7 composants (`TableEvenements`, `PanneauDetail`, `Terminal`,
  `ModaleMaintenance`, `ModaleAudit`, `ModaleConfirmation`, plus
  `Anneau`/`LienExterne`/`ModaleCanaux`/`VueProblemes` ajoutés plus tard) ;
  hooks `useCollecte`, `useCommandes`, `useTheme`, `usePiegeFocus`.
- ✅ **0.2 Découpage du backend** — lib.rs : 2 038 → ~660 lignes ; 10 modules
  (`types`, `securite`, `powershell`, `collecte`, `winget`, `wu`,
  `materiel`, `audit`, `kb`, `journal`, `messages`). Vérifié par
  comparaison multiset : zéro ligne perdue.
- ✅ **0.3 Types Rust↔TS** — variante « lite » retenue : test de contrat
  `contrat_serialisation_frontend` qui sérialise chaque struct et compare
  ses clés camelCase exactes à `src/types.ts` (tauri-specta jugé
  disproportionné pour la taille du projet).
- ✅ **0.4 Tests frontend** — Vitest, 40 tests des fonctions pures.
- ✅ **0.5 CI** — `windows-latest` : tsc, vitest, build, fmt --check,
  clippy `--all-targets -D warnings`, 37 tests, `tauri build --no-bundle`,
  artefact uploadé.
- ✅ **0.6 Lint/format** — `cargo fmt` appliqué (rustfmt dans la CI) ;
  ESLint/Prettier frontend restent à configurer si le projet grandit
  (voir « reste »).

## Phase 1 — Feedback temps réel ✅ LIVRÉE

- ✅ **1.1 Streaming** — `attendre_avec_timeout` lit ligne à ligne et émet
  `terminal://ligne` (AppHandle + id d'entrée) ; les trois commandes longues
  (correctifs, winget, Windows Update) diffusent ; plafond 2 000 lignes
  par entrée ; défilement intelligent (suit le bas sans voler
  l'ascenseur).
- ✅ **1.2 Annulation** — registre `entreeId → PID`, `taskkill /T /F` (arbre
  complet : un kill simple laissait sfc/installateurs orphelins) ;
  `CommandeFix.annulable` (défaut true) ; sfc/DISM/chkdsk non annulables ;
  état « annulée » distinct de l'échec.
- ✅ **1.3 Notifications** — plugin `tauri-plugin-notification` ; si
  commande > 1 min ET fenêtre minimisée ; bascule cloche persistée.

## Phase 2 — Lecteur d'événements ✅ LIVRÉE

- ✅ **2.1 EventData structuré** — `parametres` ordonnés (l'ordre du
  document) dans `CriticalEvent` ; tableau clé/valeur lisible ; JSON brut
  conservé derrière `<details>` pour le support, inchangé pour la
  recherche et le CSV.
- ✅ **2.2 Virtualisation** — fenêtrage à hauteur fixe (40 px), lignes
  d'espacement, sémantique `<table>` et en-tête collant conservés ;
  `fenetreVisible()` pure testée.
- ✅ **2.3 Filtre par source** — sélecteur trié par fréquence + auto-reset ;
  bouton filtre dans le panneau détail.
- ✅ **2.4 Export CSV** — `;` + BOM UTF-8, échappement anti-injection,
  3 tests.
- ✅ **2.5 Canaux personnalisables** — `canauxSupplementaires` dans
  `get_critical_events` (dédupliqués, indisponible = avertissement) ;
  `ModaleCanaux` avec 4 canaux utiles aux noms RÉELS vérifiés par
  `wevtutil el`, saisie libre, persistance.
- ✅ **2.6 Filtre temporel backend** — XPath `timediff(@SystemTime) <= N`
  dans wevtutil ; le sélecteur de période relance la collecte.

## Phase 3 — Diagnostic & base de connaissances ✅ LIVRÉE

- ✅ **3.1 Messages localisés** — `wevtutil /f:RenderedXml` ciblé par
  `EventRecordID` (jamais sur toute la liste), cache LRU 256 entrées,
  entités XML dé-échappées ; la sortie CP1252 passe par `decoder_console`.
- ✅ **3.2 Vue « par problème »** — bascule dans la toolbar ;
  `grouperProblemes()` pure ; tri gravité puis volume ; clic = filtre.
- ✅ **3.3 Enrichissement KB** — 35 → 44 entrées (6008, Kernel-Power 506,
  User32 1074, disk 154, WHEA 46/47/1001, WER 1001, Defender 1116) ;
  test d'ensemble fermé des catégories.
- ✅ **3.4 Vérification post-correctif** — correctif réussi = instant T
  persisté ; bouton « Vérifier » : `compter_evenements` (XPath provider
  revalidé + eventId + fenêtre timediff) ; « 0 occurrence = problème
  résolu ». Le pipeline de commandes retourne `CommandResult | null`.

## Phase 4 — Audit de santé 🔶 PARTIELLE

- ✅ **4.1 Historique de scores** — localStorage plafonné 50, dédoublonné
  par date, sparkline SVG, badge de tendance, ligne dans le rapport.
- ⬜ **4.2 Comparaison avant/après (M)** — sélection de deux audits de
  l'historique, Δ score par catégorie, problèmes apparus/résolus.
  L'historique (4.1) fournit déjà les données.
- ⬜ **4.3 Rapport HTML (S-M)** — même contenu que le .md, CSS inline,
  + version app, OS, modèle, uptime.
- ✅ **4.4 Pondération** — `score_global()` : « non identifie » exclu du
  global (rien d'actionnable), repli sans 100 mensonger ; 4 tests.

## Phase 5 — Maintenance 🔶 PARTIELLE

- ✅ **5.1 (partiel)** — le streaming (1.1) diffuse chaque paquet winget
  en temps réel ; le parallélisme d'installation reste non livré
  (contention MSI : garder séquentiel par défaut).
- ✅ **5.2 Désinstallation sélective** — `desinstaller_application`
  (id revalidé, `--exact --silent`), confirmation systématique via
  `demanderTacheTerminal` (généralisation de la modale aux tâches hors
  catalogue), bouton par ligne.
- ⬜ **5.3 Windows Update : filtres et listes (S-M)** — séparer qualité /
  pilotes / facultatifs ; badge « redémarrage requis » persistant dans
  l'en-tête (le terminal le montre déjà).
- ⬜ **5.4 Nettoyage disque guidé (M)** — audit des dossiers temp
  (`%TEMP%`, `C:\Windows\Temp`, `SoftwareDistribution\Download`), total
  libérable estimé (réutiliser `taille_entree`/`taille_lisible`), purge
  ciblée avec confirmation via `demanderTacheTerminal`.

## Phase 6 — Sécurité & confiance 🔶 PARTIELLE

- ✅ **6.1 Journal d'audit local** — `tauri-plugin-log` (rotation 512 Ko) ;
  chaque commande système journalisée (commande, exit, durée, élévation) ;
  onglet « Journal » dans la modale Maintenance (lecture, purge).
- ⬜ **6.2 Empreinte du catalogue (S-M)** — SHA-256 de
  `knowledge_base.json` figé dans un test : échec explicite si le
  fichier change sans mise à jour de l'empreinte (force la revue).
- ⬜ **6.3 Surface frontend (S)** — grep CI interdisant
  `dangerouslySetInnerHTML` ; vérifier qu'aucun fetch HTTP n'est
  introduit (CSP actuelle).
- ⬜ **6.4 Signature & SmartScreen (M)** — configurer signtool quand un
  certificat sera disponible.

## Phase 7 — Distribution ⬜ NON DÉMARRÉE

- ⬜ **7.1 Auto-update (L)** — `tauri-plugin-updater` + GitHub Releases,
  signature des artefacts, opt-in explicite.
- ⬜ **7.2 Profils (M)** — « mode simple » (masque cmd-cards, barre
  d'outils réduite) vs « technicien », persisté.
- ⬜ **7.3 Multi-poste (XL)** — explicitement hors périmètre v1.0.

## Priorisation restante

| Ordre | Contenu | Effort |
|---|---|---|
| 1 | 6.2 (empreinte KB) + 6.3 (greps CI) | S-M |
| 2 | 5.3 (onglets WU + badge reboot) | S-M |
| 3 | 5.4 (nettoyage guidé) | M |
| 4 | 4.2 (diff d'audits) + 4.3 (rapport HTML) | M+M |
| 5 | 7.2 (profils) | M |
| 6 | 7.1 (auto-update) | L |
| 7 | 5.1 (parallélisme winget expérimental) | M-L |

Total estimé pour boucler la v1.0 : **~4-6 jours-homme**.

---

## Retour d'expérience de la livraison

À conserver pour toute future contribution — chaque point a coûté un vrai
débogage ou a évité un bug :

1. **Les manifestes Windows ne s'appliquent pas aux binaires de test.**
   Dès qu'un code référence `AppHandle::emit`, tao/wry importe
   `SetWindowSubclass` (comctl32 **v6** uniquement). Les binaires de test,
   sans le manifest de l'app, chargent comctl32 v5 et refusent de se
   lancer (`STATUS_ENTRYPOINT_NOT_FOUND`). Correctif dans `build.rs` :
   manifeste externe avec dépendance Common-Controls v6 (l'embed direct
   entre en conflit de ressource RT_MANIFEST avec celui de tauri-build).
2. **wevtutil RenderedXml sort en CP1252, pas en UTF-8** (contrairement au
   XML brut). `decoder_console` (UTF-8 strict puis repli Windows-1252)
   couvre les deux — toute nouvelle sortie d'outil Windows doit être
   vérifiée à l'octet près avant `String::from_utf8_lossy`.
3. **Les noms de canaux se vérifient par `wevtutil el`, pas de tête** :
   « Microsoft-Windows-Windows **Defender**/Operational » (espace), pas
   « Windows-Defender ». Une entrée KB a été corrigée pour ça — la
   commande aurait échoué sur toute machine.
4. **Les runners GitHub sont lents** : un test de débit calé sur une
   machine locale (15 s) échoue à froid (PowerShell + 8000
   interpolations) ; les tests de performance prennent des marges
   larges, la régression reste détectable par timeout consommé.
5. **Un kill n'est jamais suffisant** : `taskkill /T /F` ou rien — les
   petits-fils (sfc, installateurs winget) survivent au kill du père
   direct et continuent d'écrire dans des tubes orphelins.
6. **Toute chaîne injectée dans un XPath/argument de processus est
   revalidée** : provider de `compter_evenements` (guillemets, <, >, &),
   id de `desinstaller_application` (whitespace, séparateurs), GUID WU
   (hexadécimal) — même si la valeur vient de notre propre scan.
7. **La CI travaille pour nous** : 4 incidents détectés sur runs réels
   avant tout utilisateur (PnP sans nom convivial sur VM, winget absent
   sur Windows Server, comctl32, runner lent).
8. **Les hooks retournent leur résultat** (`CommandResult | null`) :
   la vérification post-correctif (3.4) en avait besoin — généraliser
   tôt évite de retravailler les signatures.

## Invariants à préserver (héritage des 14 passes d'audit)

Toute PR doit respecter ces acquis — chacun coûte un vrai bug corrigé :

1. **Sécurité** : liste blanche deny-by-default + denylist (dont
   `wevtutil cl`, `advfirewall set/del/add`) ; jamais de commande
   arbitraire saisie ; tests de non-régression obligatoires pour toute
   évolution du gate.
2. **Encodages** : tout PowerShell via `spawn_powershell` (préfixe UTF-8) ;
   sorties wevtutil (XML et RenderedXml) via `decoder_console` ; winget
   est UTF-8 natif.
3. **Async** : toute commande Tauri susceptible d'attendre un processus
   est `async` + `spawn_blocking`.
4. **Races** : gardes de séquence (collecte, diagnostic, message rendu) ;
   sélections préservées au rechargement.
5. **Erreurs visibles** : aucune erreur capturée ne peut rester invisible
   derrière une modale (leçons WU, matériel) ; états vides explicites.
6. **A11y** : WCAG AA sur les deux thèmes ; focus traps + restauration ;
   `role="log"` terminal ; raccourcis désactivés derrière une modale ;
   `aria-sort`, `aria-pressed`, `aria-busy`.
7. **Types** : champs sérialisés `camelCase` côté Rust — le test de
   contrat échoue sinon ; `timeoutSecs`/`annulable` transportés jusqu'au
   frontend.
8. **Tests d'intégration réels en lecture seule uniquement** ; tolérants
   aux environnements (canal absent, runner sans winget, périphérique
   sans nom).
9. **Toute action destructive exige une confirmation** (catalogue ou
   `demanderTacheTerminal`) et laisse une trace dans le journal local.
10. **Manifeste Common-Controls v6** pour les binaires de test (build.rs)
    — tout nouveau `emit` re-déclencherait le piège sinon.
