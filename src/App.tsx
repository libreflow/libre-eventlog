import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Download,
  HeartPulse,
  Lock,
  Loader2,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Sun,
  Wrench,
  X,
} from "lucide-react";
import type {
  AuditSante,
  CommandResult,
  ProblemDevice,
  SystemInfo,
  WinUpdate,
  WingetPackage,
} from "./types";
import { Terminal } from "./components/Terminal";
import { ModaleConfirmation } from "./components/ModaleConfirmation";
import { ModaleAudit } from "./components/ModaleAudit";
import { ModaleMaintenance } from "./components/ModaleMaintenance";
import { TableEvenements } from "./components/TableEvenements";
import { VueProblemes } from "./components/VueProblemes";
import { ModaleCanaux } from "./components/ModaleCanaux";
import { PanneauDetail } from "./components/PanneauDetail";
import { usePiegeFocus } from "./hooks/usePiegeFocus";
import { useTheme } from "./hooks/useTheme";
import { useCommandes } from "./hooks/useCommandes";
import { useCollecte } from "./hooks/useCollecte";
import { SEVERITES } from "./lib/evenements";
import { copierTexte } from "./lib/pressepapiers";
import { rapportMarkdown } from "./lib/rapport";
import { Layers, Radio } from "lucide-react";
import { MAJ_APPS } from "./lib/catalogue";
import { telechargerCsv } from "./lib/export";
import { enregistrerAudit, evolution, lireHistorique, type EntreeAudit } from "./lib/audits";




export default function App() {
  const {
    events,
    avertissements,
    error,
    setError,
    loading,
    limite,
    setLimite,
    inclureAvert,
    setInclureAvert,
    autoRefresh,
    setAutoRefresh,
    charger,
    chargerRef,
    canauxDisponibles,
    canal,
    setCanal,
    providersDisponibles,
    provider,
    setProvider,
    severite,
    setSeverite,
    recherche,
    setRecherche,
    depuis,
    setDepuis,
    sortKey,
    sortDir,
    trier,
    filtres,
    selected,
    selectionner,
    diagnostic,
    diagLoading,
    message,
    messageChargement,
    canauxPerso,
    setCanauxPerso,
  } = useCollecte();
  const [elevated, setElevated] = useState<boolean | null>(null);
  const [relanceEnCours, setRelanceEnCours] = useState(false);
  const {
    terminal,
    setTerminal,
    terminalOuvert,
    setTerminalOuvert,
    confirmCmd,
    setConfirmCmd,
    runningCmd,
    terminalHauteur,
    termRef,
    commencerRedimension,
    bougerRedimension,
    finirRedimension,
    executerCommande,
    demanderExecution,
    lancerTacheTerminal,
    annulerCommande,
    notifications,
    setNotifications,
  } = useCommandes();
  const [majOuverte, setMajOuverte] = useState(false);
  const [majChargement, setMajChargement] = useState(false);
  const [majPaquets, setMajPaquets] = useState<WingetPackage[]>([]);
  const [majSelection, setMajSelection] = useState<Set<string>>(new Set());
  const [wuPaquets, setWuPaquets] = useState<WinUpdate[]>([]);
  const [wuSelection, setWuSelection] = useState<Set<string>>(new Set());
  const [wuChargement, setWuChargement] = useState(false);
  const [wuScanFait, setWuScanFait] = useState(false);
  const [wuErreur, setWuErreur] = useState<string | null>(null);
  const [hwInfo, setHwInfo] = useState<SystemInfo | null>(null);
  const [hwProblemes, setHwProblemes] = useState<ProblemDevice[]>([]);
  const [hwChargement, setHwChargement] = useState(false);
  const [hwCharge, setHwCharge] = useState(false);
  const [hwErreur, setHwErreur] = useState<string | null>(null);
  const [auditOuverte, setAuditOuverte] = useState(false);
  const [auditChargement, setAuditChargement] = useState(false);
  const [audit, setAudit] = useState<AuditSante | null>(null);
  const [planAction, setPlanAction] = useState<Record<string, boolean>>({});
  const [rapportCopie, setRapportCopie] = useState(false);
  const [historiqueAudits, setHistoriqueAudits] = useState<EntreeAudit[]>([]);
  const [journal, setJournal] = useState<string[]>([]);
  const [vue, setVue] = useState<"evenements" | "problemes">("evenements");
  const [canauxOuverte, setCanauxOuverte] = useState(false);
  const [chargementJournal, setChargementJournal] = useState(false);
  const { theme, basculerTheme } = useTheme();
  const searchRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const majModalRef = useRef<HTMLDivElement>(null);
  const confirmModalRef = useRef<HTMLDivElement>(null);
  const auditModalRef = useRef<HTMLDivElement>(null);

  // Piège de focus actif pour chaque modale ouverte.
  usePiegeFocus(majModalRef, majOuverte);
  usePiegeFocus(confirmModalRef, !!confirmCmd);
  usePiegeFocus(auditModalRef, auditOuverte);

  useEffect(() => {
    invoke<boolean>("check_elevation")
      .then(setElevated)
      .catch(() => setElevated(false));
  }, []);

  // Raccourcis clavier : F5 analyser, Ctrl+F recherche, Ctrl+T terminal.
  // Ignorés pendant qu'une modale est ouverte : le clavier appartient à
  // la modale (piège de focus, Échap), Ctrl+F ne doit pas voler le focus
  // vers la recherche d'arrière-plan.
  const modaleOuverte = !!confirmCmd || majOuverte || auditOuverte || canauxOuverte;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (modaleOuverte) return;
      if (ev.key === "F5") {
        ev.preventDefault();
        chargerRef.current();
      } else if (ev.ctrlKey && ev.key.toLowerCase() === "f") {
        ev.preventDefault();
        searchRef.current?.focus();
      } else if (ev.ctrlKey && ev.key.toLowerCase() === "t") {
        ev.preventDefault();
        setTerminalOuvert((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modaleOuverte]);

  // Échap ferme uniquement la modale de premier plan (une confirmation
  // peut s'ouvrir par-dessus la fenêtre Maintenance : Échap ne doit pas
  // fermer les deux d'un coup).
  useEffect(() => {
    if (!confirmCmd && !majOuverte && !auditOuverte && !canauxOuverte) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (confirmCmd) setConfirmCmd(null);
      else if (canauxOuverte) setCanauxOuverte(false);
      else if (majOuverte) {
        // Mêmes gardes que le clic sur l'overlay : pas de fermeture pendant
        // un chargement (winget, scan Windows Update, lecture CIM).
        if (!majChargement && !wuChargement && !hwChargement) setMajOuverte(false);
      } else if (!auditChargement) setAuditOuverte(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    confirmCmd,
    majOuverte,
    auditOuverte,
    canauxOuverte,
    majChargement,
    wuChargement,
    hwChargement,
    auditChargement,
  ]);

  useEffect(() => {
    document.title = selected
      ? `${selected.provider} (${selected.eventId}) — Libre EventLog`
      : "Libre EventLog";
  }, [selected]);

  async function ouvrirMiseAJour() {
    setMajOuverte(true);
    setMajChargement(true);
    setMajPaquets([]);
    setMajSelection(new Set());
    try {
      const res = await invoke<WingetPackage[]>("list_available_updates");
      setMajPaquets(res);
      setMajSelection(new Set(res.map((p) => p.id)));
    } catch (e) {
      setMajOuverte(false);
      setError(String(e));
    } finally {
      setMajChargement(false);
    }
  }

  function togglePaquet(id: string) {
    setMajSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleTout() {
    setMajSelection((s) =>
      s.size === majPaquets.length
        ? new Set()
        : new Set(majPaquets.map((p) => p.id)),
    );
  }

  async function chargerJournal() {
    setChargementJournal(true);
    try {
      const lignes = await invoke<string[]>("lire_journal", { maxLignes: 500 });
      setJournal(lignes);
    } catch (e) {
      setError(String(e));
    } finally {
      setChargementJournal(false);
    }
  }

  async function purgerJournal() {
    try {
      await invoke("purger_journal");
      setJournal([]);
    } catch (e) {
      setError(String(e));
    }
  }

  function executerMajApps(ids: string[]) {
    setMajOuverte(false);
    lancerTacheTerminal(
      MAJ_APPS.label,
      `${MAJ_APPS.commande} — ${ids.length} paquet(s)`,
      MAJ_APPS.commande,
      (entreeId) => invoke<CommandResult>("update_applications", { ids, entreeId }),
    );
  }

  async function chargerWu() {
    setWuChargement(true);
    setWuErreur(null);
    try {
      const res = await invoke<WinUpdate[]>("list_windows_updates");
      setWuPaquets(res);
      setWuSelection(new Set(res.map((u) => u.updateId)));
      // Marqué seulement ici : un scan échoué ne doit pas s'afficher comme
      // « aucune mise à jour en attente ».
      setWuScanFait(true);
    } catch (e) {
      setWuPaquets([]);
      setWuErreur(String(e));
    } finally {
      setWuChargement(false);
    }
  }

  function toggleWu(id: string) {
    setWuSelection((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleToutWu() {
    setWuSelection((s) =>
      s.size === wuPaquets.length
        ? new Set()
        : new Set(wuPaquets.map((u) => u.updateId)),
    );
  }

  function executerWuInstall(ids: string[]) {
    setMajOuverte(false);
    // Rafraîchit la liste en arrière-plan après l'installation : les mises
    // à jour installées disparaissent, celles en attente de redémarrage
    // restent listées.
    lancerTacheTerminal(
      "Mises à jour Windows",
      `Installation de ${ids.length} mise(s) à jour Windows via l'agent Windows Update`,
      "windows-update",
      (entreeId) => invoke<CommandResult>("install_windows_updates", { updateIds: ids, entreeId }),
    ).finally(() => chargerWu());
  }

  async function relancerAdmin() {
    setRelanceEnCours(true);
    try {
      await invoke("relancer_admin");
      // L'instance élevée démarre : on ferme cette instance.
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (e) {
      setError(String(e));
      setRelanceEnCours(false);
    }
  }

  async function chargerMateriel() {
    setHwChargement(true);
    setHwErreur(null);
    try {
      const [info, problemes] = await Promise.all([
        invoke<SystemInfo>("get_system_info"),
        invoke<ProblemDevice[]>("list_problem_devices"),
      ]);
      setHwInfo(info);
      setHwProblemes(problemes);
      setHwCharge(true);
    } catch (e) {
      // Erreur affichée dans l'onglet : la bannière globale est invisible
      // derrière l'overlay de la modale ouverte.
      setHwErreur(String(e));
    } finally {
      setHwChargement(false);
    }
  }

  // Plan d'action persistant (localStorage) : étapes cochées par problème.
  function toggleEtapePlan(cle: string) {
    const n = { ...planAction, [cle]: !planAction[cle] };
    setPlanAction(n);
    try {
      localStorage.setItem("libre-eventlog-plan", JSON.stringify(n));
    } catch {
      /* persistance indisponible : l'état reste en mémoire */
    }
  }

  useEffect(() => {
    setHistoriqueAudits(lireHistorique());
  }, []);

  useEffect(() => {
    try {
      const brut = localStorage.getItem("libre-eventlog-plan");
      if (brut) setPlanAction(JSON.parse(brut));
    } catch {
      /* pas de persistance disponible */
    }
  }, []);

  async function ouvrirAudit() {
    setAuditOuverte(true);
    setAuditChargement(true);
    try {
      const res = await invoke<AuditSante>("get_health_audit");
      setAudit(res);
      // Historique local (plafonné, dédoublonné par date) : sparkline et
      // tendance du rapport.
      setHistoriqueAudits(enregistrerAudit(res));
    } catch (e) {
      setError(String(e));
      setAuditOuverte(false);
    } finally {
      setAuditChargement(false);
    }
  }

  function telechargerRapport() {
    if (!audit) return;
    const blob = new Blob([rapportMarkdown(audit, planAction)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-libre-eventlog-${audit.genereLe.replace(/[: ]/g, "-")}.md`;
    // L'ancre doit être dans le document pour déclencher le téléchargement
    // dans WebView2 ; l'URL d'objet n'est libérée qu'après un délai, le
    // téléchargement démarre de façon asynchrone.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function copierRapport() {
    if (!audit) return;
    await copierTexte(rapportMarkdown(audit, planAction, evolution(historiqueAudits, audit.genereLe)));
    setRapportCopie(true);
    setTimeout(() => setRapportCopie(false), 2000);
  }

  // Navigation clavier entre les lignes (Flèche haut/bas).
  function naviguerClavier(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (filtres.length === 0) return;
    e.preventDefault();
    const idx = selected ? filtres.findIndex((ev) => ev === selected) : -1;
    const suivant =
      e.key === "ArrowDown"
        ? Math.min(filtres.length - 1, idx + 1)
        : Math.max(0, idx - 1);
    selectionner(filtres[suivant]);
  }

  // Sur écran étroit, la sélection d'une ligne fait défiler jusqu'au
  // panneau détail (sinon l'utilisateur ne voit pas qu'il s'est ouvert).
  useEffect(() => {
    if (!selected) return;
    if (window.matchMedia("(max-width: 900px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const nbCritiques = filtres.filter((e) => e.level === 1).length;
  const nbErreurs = filtres.filter((e) => e.level === 2).length;
  const nbAvertissements = filtres.filter((e) => e.level === 3).length;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src="/icon.svg" alt="" className="logo-img" aria-hidden="true" />
          <div>
            <h1>Libre EventLog</h1>
            <p>Diagnostic, maintenance et audit de santé Windows</p>
          </div>
        </div>
        <div className="header-droite">
          <div className="stats" role="status">
            <span
              className={`stat ${elevated === false ? "muted" : elevated ? "admin" : ""}`}
              title={
                elevated === null
                  ? "Vérification des droits…"
                  : elevated
                    ? "Application lancée en administrateur : toutes les commandes sont disponibles"
                    : "Application non élevée : les commandes marquées nécessitent un relancement en administrateur"
              }
            >
              {elevated === null ? (
                <Loader2 className="icon spin" aria-hidden="true" />
              ) : elevated ? (
                <ShieldCheck className="icon ok" aria-hidden="true" />
              ) : (
                <ShieldOff className="icon muted" aria-hidden="true" />
              )}
              {elevated === null ? "Vérification…" : elevated ? "Administrateur" : "Mode limité"}
            </span>
            <span className="stat critique">
              <strong>{nbCritiques}</strong> critique{nbCritiques > 1 ? "s" : ""}
            </span>
            <span className="stat erreur">
              <strong>{nbErreurs}</strong> erreur{nbErreurs > 1 ? "s" : ""}
            </span>
            {nbAvertissements > 0 && (
              <span className="stat avertissement">
                <strong>{nbAvertissements}</strong> avertissement{nbAvertissements > 1 ? "s" : ""}
              </span>
            )}
            {events.length > 0 && (
              <span className="stat muted">
                {filtres.length} / {events.length} affiché{filtres.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="header-actions">
            {elevated === false && (
              <button
                className="btn small"
                onClick={relancerAdmin}
                disabled={relanceEnCours}
                title="Affiche l'invite UAC puis relance l'application avec les droits administrateur"
              >
                {relanceEnCours ? (
                  <Loader2 className="icon spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="icon" aria-hidden="true" />
                )}
                Relancer en admin
              </button>
            )}
            <button
              className="btn small btn-ghost"
              onClick={basculerTheme}
              title="Basculer le thème clair/sombre"
              aria-label="Basculer le thème"
            >
              {theme === "sombre" ? <Sun className="icon" aria-hidden="true" /> : <Moon className="icon" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      <div className="toolbar">
        <button className="btn primary" onClick={() => charger()} disabled={loading}>
          {loading ? (
            <Loader2 className="icon spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="icon" aria-hidden="true" />
          )}
          {loading ? "Analyse…" : "Analyser le journal"}
        </button>
        <button
          className="btn"
          onClick={ouvrirMiseAJour}
          disabled={elevated === false || runningCmd !== null || majChargement}
          title={
            elevated === false
              ? "Nécessite de relancer l'application en administrateur"
              : "Maintenance : mise à jour des applications (winget), mises à jour Windows et pilotes, correctifs système (sfc, DISM…)"
          }
        >
          {elevated === false ? (
            <Lock className="icon" aria-hidden="true" />
          ) : (
            <Wrench className="icon" aria-hidden="true" />
          )}
          Maintenance
        </button>
        <button
          className="btn"
          onClick={ouvrirAudit}
          disabled={auditChargement}
          title="Collecte les événements de tous les canaux, agrège les problèmes et calcule un score de santé par catégorie"
        >
          <HeartPulse className="icon" aria-hidden="true" />
          Audit de santé
        </button>
        <button
          className="btn"
          onClick={() => telechargerCsv(filtres)}
          disabled={filtres.length === 0}
          title="Exporter les événements filtrés au format CSV (Excel, séparateur point-virgule)"
        >
          <Download className="icon" aria-hidden="true" />
          Exporter (.csv)
        </button>
        <div className="toolbar-filtres" role="group" aria-label="Filtres de la liste">
        <div className="vue-bascule" role="group" aria-label="Mode d'affichage de la liste">
          <button
            className={`maj-onglet ${vue === "evenements" ? "actif" : ""}`}
            onClick={() => setVue("evenements")}
            aria-pressed={vue === "evenements"}
            title="Une ligne par événement collecté"
          >
            Événements
          </button>
          <button
            className={`maj-onglet ${vue === "problemes" ? "actif" : ""}`}
            onClick={() => setVue("problemes")}
            aria-pressed={vue === "problemes"}
            title="Une ligne par problème : occurrences regroupées par source et ID"
          >
            <Layers className="icon" size={12} aria-hidden="true" /> Problèmes
          </button>
        </div>
        <button
          className="btn small btn-ghost"
          onClick={() => setCanauxOuverte(true)}
          title="Canaux supplémentaires à collecter (Defender, réseau, BITS…)"
          aria-pressed={canauxOuverte}
        >
          <Radio className="icon" aria-hidden="true" /> Canaux
          {canauxPerso.length > 0 ? ` (${canauxPerso.length})` : ""}
        </button>
        <select value={canal} onChange={(e) => setCanal(e.target.value)} aria-label="Filtrer par canal">
          {canauxDisponibles.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          aria-label="Filtrer par source"
        >
          {providersDisponibles.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          value={severite}
          onChange={(e) => setSeverite(e.target.value)}
          aria-label="Filtrer par sévérité"
        >
          {SEVERITES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          value={depuis}
          onChange={(e) => {
            setDepuis(e.target.value);
            // Le filtre de période est appliqué par wevtutil : changer la
            // période doit relancer la collecte, pas seulement re-filtrer.
            charger(undefined, undefined, e.target.value);
          }}
          aria-label="Filtrer par période"
        >
          <option value="1">Dernière heure</option>
          <option value="24">Dernières 24 h</option>
          <option value="168">7 derniers jours</option>
          <option value="0">Tout l'historique</option>
        </select>
        <select
          value={inclureAvert ? "3" : "2"}
          onChange={(e) => {
            setInclureAvert(e.target.value === "3");
            charger(undefined, e.target.value === "3");
          }}
          aria-label="Niveaux de sévérité collectés"
          title="Les avertissements (niveau 3) sont ignorés par défaut pour se concentrer sur les vrais problèmes"
        >
          <option value="2">Critiques + erreurs</option>
          <option value="3">+ Avertissements</option>
        </select>
        <select
          value={limite}
          onChange={(e) => {
            setLimite(e.target.value);
            charger(e.target.value);
          }}
          aria-label="Limite d'événements par canal"
        >
          <option value="50">50 / canal</option>
          <option value="200">200 / canal</option>
          <option value="500">500 / canal</option>
        </select>
        <select
          value={autoRefresh}
          onChange={(e) => setAutoRefresh(e.target.value)}
          aria-label="Rafraîchissement automatique"
          title="Re-collecte les événements périodiquement"
        >
          <option value="0">Auto-refresh : off</option>
          <option value="5">5 min</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
        </select>
        </div>
        <div className="search">
          <Search className="search-icon" aria-hidden="true" />
          <input
            type="search"
            ref={searchRef}
            placeholder="Rechercher (provider, ID, message)…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            aria-label="Rechercher un événement"
          />
          {recherche && (
            <button className="search-clear" onClick={() => setRecherche("")} aria-label="Effacer la recherche">
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          <AlertTriangle className="icon warn" aria-hidden="true" />
          <span className="error-texte">{error}</span>
          <button
            className="error-fermer"
            onClick={() => setError(null)}
            aria-label="Fermer le message d'erreur"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}

      {avertissements.length > 0 && (
        <div className="warn-banner" role="status">
          {avertissements.map((a, i) => (
            <p key={i}>
              <AlertTriangle className="icon warn" aria-hidden="true" /> {a}
            </p>
          ))}
        </div>
      )}

      <div className={`layout ${terminalOuvert ? "avec-terminal" : ""}`}>
        {vue === "evenements" ? (
        <TableEvenements
          filtres={filtres}
          totalEvenements={events.length}
          selected={selected}
          sortKey={sortKey}
          sortDir={sortDir}
          loading={loading}
          onTrier={trier}
          onSelectionner={selectionner}
          onNaviguerClavier={naviguerClavier}
        />
        ) : (
          <VueProblemes
            events={filtres}
            totalFiltres={filtres.length}
            onFiltreProbleme={(provider, eventId) => {
              setProvider(provider);
              setRecherche(String(eventId));
              setVue("evenements");
            }}
          />
        )}

        <PanneauDetail
          selected={selected}
          diagnostic={diagnostic}
          diagLoading={diagLoading}
          elevated={elevated}
          runningCmd={runningCmd}
          onDemanderExecution={demanderExecution}
          detailRef={detailRef}
          onFiltreProvider={(p) => setProvider(p)}
          message={message}
          messageChargement={messageChargement}
        />
      </div>

      <Terminal
        ouvert={terminalOuvert}
        onOuvrir={() => setTerminalOuvert(true)}
        onFermer={() => setTerminalOuvert(false)}
        onEffacer={() => setTerminal([])}
        hauteur={terminalHauteur}
        entries={terminal}
        termRef={termRef}
        onCommencerRedimension={commencerRedimension}
        onBougerRedimension={bougerRedimension}
        onFinirRedimension={finirRedimension}
        onAnnuler={annulerCommande}
        notifications={notifications}
        onToggleNotifications={() => setNotifications((n) => !n)}
      />

      {auditOuverte && (
        <ModaleAudit
          audit={audit}
          chargement={auditChargement}
          planAction={planAction}
          onToggleEtape={toggleEtapePlan}
          onFermer={() => setAuditOuverte(false)}
          onFiltreProbleme={(eventId) => {
            setRecherche(String(eventId));
            setCanal("Tous");
            setAuditOuverte(false);
          }}
          onCopier={copierRapport}
          rapportCopie={rapportCopie}
          onTelecharger={telechargerRapport}
          historique={historiqueAudits}
          evolutionPrecedente={audit ? evolution(historiqueAudits, audit.genereLe) : null}
        />
      )}

      {majOuverte && (
        <ModaleMaintenance
          elevated={elevated}
          runningCmd={runningCmd}
          onFermer={() => setMajOuverte(false)}
          onOngletChange={(cle) => {
            if (cle === "bios" && !hwCharge && !hwChargement) chargerMateriel();
            if (cle === "journal") chargerJournal();
          }}
          chargementApps={majChargement}
          paquetsApps={majPaquets}
          selectionApps={majSelection}
          onTogglePaquet={togglePaquet}
          onToggleTout={toggleTout}
          onMajApps={executerMajApps}
          chargementWu={wuChargement}
          scanFaitWu={wuScanFait}
          erreurWu={wuErreur}
          paquetsWu={wuPaquets}
          selectionWu={wuSelection}
          onToggleWu={toggleWu}
          onToggleToutWu={toggleToutWu}
          onRechercherWu={chargerWu}
          onInstallerWu={executerWuInstall}
          chargementHw={hwChargement}
          erreurHw={hwErreur}
          infoHw={hwInfo}
          chargeHw={hwCharge}
          problemesHw={hwProblemes}
          onActualiserHw={chargerMateriel}
          onExecuterCorrectif={demanderExecution}
          journal={journal}
          chargementJournal={chargementJournal}
          onRafraichirJournal={chargerJournal}
          onPurgerJournal={purgerJournal}
        />
      )}

      {canauxOuverte && (
        <ModaleCanaux
          canaux={canauxPerso}
          onFermer={() => setCanauxOuverte(false)}
          onEnregistrer={(liste) => {
            setCanauxPerso(liste);
            // Re-collecte immédiate avec les nouveaux canaux.
            charger();
          }}
        />
      )}

      {confirmCmd && (
        <ModaleConfirmation
          cmd={confirmCmd}
          elevated={elevated}
          onAnnuler={() => setConfirmCmd(null)}
          onExecuter={(c) => {
            setConfirmCmd(null);
            executerCommande(c);
          }}
        />
      )}
    </div>
  );
}
