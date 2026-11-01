import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileSearch,
  HeartPulse,
  Inbox,
  Lock,
  Loader2,
  Moon,
  Play,
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
  CollecteResult,
  CommandResult,
  CommandeFix,
  CriticalEvent,
  Diagnostic,
  ProblemDevice,
  SystemInfo,
  WinUpdate,
  WingetPackage,
} from "./types";
import { Terminal } from "./components/Terminal";
import { ModaleConfirmation } from "./components/ModaleConfirmation";
import { ModaleAudit } from "./components/ModaleAudit";
import { ModaleMaintenance } from "./components/ModaleMaintenance";
import type { TerminalEntry } from "./components/Terminal";
import { LienExterne } from "./components/LienExterne";
import { usePiegeFocus } from "./hooks/usePiegeFocus";
import {
  SEVERITES,
  cleJourLocal,
  formatDate,
  lienRecherche,
  libelleJour,
  severityClass,
} from "./lib/evenements";
import { copierTexte } from "./lib/pressepapiers";
import { rapportMarkdown } from "./lib/rapport";
import { COLONNES, MAJ_APPS } from "./lib/catalogue";
import type { SortDir, SortKey } from "./lib/catalogue";




export default function App() {
  const [events, setEvents] = useState<CriticalEvent[]>([]);
  const [selected, setSelected] = useState<CriticalEvent | null>(null);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [avertissements, setAvertissements] = useState<string[]>([]);
  const [limite, setLimite] = useState<string>("50");
  const [inclureAvert, setInclureAvert] = useState(false);
  const [relanceEnCours, setRelanceEnCours] = useState(false);
  const [canal, setCanal] = useState<string>("Tous");
  const [severite, setSeverite] = useState<string>("Toutes");
  const [recherche, setRecherche] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [depuis, setDepuis] = useState<string>("24");
  const [elevated, setElevated] = useState<boolean | null>(null);
  const [terminal, setTerminal] = useState<TerminalEntry[]>([]);
  const [terminalOuvert, setTerminalOuvert] = useState(false);
  const [confirmCmd, setConfirmCmd] = useState<CommandeFix | null>(null);
  const majModalRef = useRef<HTMLDivElement>(null);
  const confirmModalRef = useRef<HTMLDivElement>(null);
  const auditModalRef = useRef<HTMLDivElement>(null);
  const [runningCmd, setRunningCmd] = useState<string | null>(null);
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
  const [autoRefresh, setAutoRefresh] = useState("0");
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem("libre-eventlog-theme") ?? "sombre";
    } catch {
      return "sombre";
    }
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const chargerRef = useRef<() => void>(() => {});
  const detailRef = useRef<HTMLElement>(null);
  const [terminalHauteur, setTerminalHauteur] = useState(240);
  const dragTerminal = useRef<{ y: number; h: number } | null>(null);

  function commencerRedimension(e: React.PointerEvent) {
    dragTerminal.current = { y: e.clientY, h: terminalHauteur };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function bougerRedimension(e: React.PointerEvent) {
    if (!dragTerminal.current) return;
    const delta = dragTerminal.current.y - e.clientY;
    setTerminalHauteur(
      Math.min(600, Math.max(140, dragTerminal.current.h + delta)),
    );
  }

  function finirRedimension() {
    dragTerminal.current = null;
  }
  const nextId = useRef(1);
  const termRef = useRef<HTMLDivElement>(null);
  const diagSeq = useRef(0);
  const collecteSeq = useRef(0);

  // Piège de focus actif pour chaque modale ouverte.
  usePiegeFocus(majModalRef, majOuverte);
  usePiegeFocus(confirmModalRef, !!confirmCmd);
  usePiegeFocus(auditModalRef, auditOuverte);

  useEffect(() => {
    invoke<boolean>("check_elevation")
      .then(setElevated)
      .catch(() => setElevated(false));
  }, []);

  // Toujours à jour pour les raccourcis clavier et l'auto-refresh.
  chargerRef.current = charger;

  // Raccourcis clavier : F5 analyser, Ctrl+F recherche, Ctrl+T terminal.
  // Ignorés pendant qu'une modale est ouverte : le clavier appartient à
  // la modale (piège de focus, Échap), Ctrl+F ne doit pas voler le focus
  // vers la recherche d'arrière-plan.
  const modaleOuverte = !!confirmCmd || majOuverte || auditOuverte;
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

  // Auto-rafraîchissement de la collecte.
  useEffect(() => {
    if (autoRefresh === "0") return;
    const minutes = Number(autoRefresh);
    const timer = setInterval(() => chargerRef.current(), minutes * 60_000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  // Thème clair/sombre persistant. Le chrome de la fenêtre (barre de titre
  // Windows) suit le même thème, sinon le mode clair garde une barre sombre.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().setTheme(theme === "sombre" ? "dark" : "light"),
      )
      .catch(() => {
        /* hors webview Tauri (navigateur) : pas de chrome à synchroniser */
      });
    try {
      localStorage.setItem("libre-eventlog-theme", theme);
    } catch {
      /* persistance indisponible */
    }
  }, [theme]);

  // Échap ferme uniquement la modale de premier plan (une confirmation
  // peut s'ouvrir par-dessus la fenêtre Maintenance : Échap ne doit pas
  // fermer les deux d'un coup).
  useEffect(() => {
    if (!confirmCmd && !majOuverte && !auditOuverte) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (confirmCmd) setConfirmCmd(null);
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

  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [terminal]);

  async function charger(overLimite?: string, overAvert?: boolean) {
    // Séquence : deux collectes peuvent se chevaucher (auto-refresh + clic,
    // ou changement rapide de filtre) ; seule la plus récente doit
    // s'appliquer, sinon un résultat ancien écrase le nouveau.
    const seq = ++collecteSeq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<CollecteResult>("get_critical_events", {
        limit: Number(overLimite ?? limite),
        inclureAvertissements: overAvert ?? inclureAvert,
      });
      if (collecteSeq.current !== seq) return;
      setEvents(result.events);
      setAvertissements(result.avertissements);
      // L'auto-refresh ne doit pas éjecter l'utilisateur de sa lecture :
      // la sélection est conservée si l'événement est toujours collecté.
      if (selected) {
        const toujours = result.events.find(
          (e) =>
            e.recordId === selected.recordId &&
            e.canal === selected.canal &&
            e.timestamp === selected.timestamp &&
            e.provider === selected.provider &&
            e.eventId === selected.eventId,
        );
        if (toujours) setSelected(toujours);
        else {
          setSelected(null);
          setDiagnostic(null);
        }
      }
    } catch (e) {
      if (collecteSeq.current !== seq) return;
      setError(String(e));
      // Cohérence de l'écran d'erreur : la table est vidée, le panneau
      // détail et les bandeaux ne doivent pas montrer un état fantôme.
      setEvents([]);
      setAvertissements([]);
      setSelected(null);
      setDiagnostic(null);
    } finally {
      if (collecteSeq.current === seq) setLoading(false);
    }
  }

  async function selectionner(e: CriticalEvent) {
    // Séquence : évite qu'un diagnostic obsolète écrase celui d'un
    // événement sélectionné plus récemment (clics rapides).
    const seq = ++diagSeq.current;
    setSelected(e);
    setDiagnostic(null);
    setDiagLoading(true);
    try {
      const d = await invoke<Diagnostic>("get_diagnostic", { event: e });
      if (diagSeq.current === seq) setDiagnostic(d);
    } catch {
      if (diagSeq.current === seq) setDiagnostic({ event: e, fix: null });
    } finally {
      if (diagSeq.current === seq) setDiagLoading(false);
    }
  }

  // Clé d'identité d'un correctif en cours : label + commande. La seule
  // chaîne de commande ne suffit pas — la base référence parfois la même
  // commande pour plusieurs événements (disk 7 et disk 11) et le spinner
  // « Exécution en cours » tournait alors sur toutes les cartes jumelles.
  function cleCommande(cmd: CommandeFix): string {
    return `${cmd.label}|${cmd.commande}`;
  }

  async function executerCommande(cmd: CommandeFix) {
    const id = nextId.current++;
    const time = new Date().toLocaleTimeString("fr-FR");
    setTerminalOuvert(true);
    setTerminal((t) => [
      ...t,
      { id, label: cmd.label, commande: cmd.commande, result: null, error: null, running: true, time },
    ]);
    setRunningCmd(cleCommande(cmd));
    try {
      const res = await invoke<CommandResult>("run_diagnostic_command", {
        commande: cmd.commande,
        timeoutSecs: cmd.timeoutSecs ?? null,
      });
      setTerminal((t) =>
        t.map((e) => (e.id === id ? { ...e, result: res, running: false } : e)),
      );
    } catch (err) {
      setTerminal((t) =>
        t.map((e) =>
          e.id === id ? { ...e, error: String(err), running: false } : e,
        ),
      );
    } finally {
      setRunningCmd(null);
    }
  }

  function demanderExecution(cmd: CommandeFix) {
    if (cmd.confirme) {
      setConfirmCmd(cmd);
    } else {
      executerCommande(cmd);
    }
  }

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

  async function executerMajApps(ids: string[]) {
    setMajOuverte(false);
    const id = nextId.current++;
    const time = new Date().toLocaleTimeString("fr-FR");
    setTerminalOuvert(true);
    setTerminal((t) => [
      ...t,
      {
        id,
        label: MAJ_APPS.label,
        commande: `${MAJ_APPS.commande} — ${ids.length} paquet(s)`,
        result: null,
        error: null,
        running: true,
        time,
      },
    ]);
    setRunningCmd(MAJ_APPS.commande);
    try {
      const res = await invoke<CommandResult>("update_applications", { ids });
      setTerminal((t) =>
        t.map((e) => (e.id === id ? { ...e, result: res, running: false } : e)),
      );
    } catch (err) {
      setTerminal((t) =>
        t.map((e) =>
          e.id === id ? { ...e, error: String(err), running: false } : e,
        ),
      );
    } finally {
      setRunningCmd(null);
    }
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

  async function executerWuInstall(ids: string[]) {
    setMajOuverte(false);
    const id = nextId.current++;
    const time = new Date().toLocaleTimeString("fr-FR");
    setTerminalOuvert(true);
    setTerminal((t) => [
      ...t,
      {
        id,
        label: "Mises à jour Windows",
        commande: `Installation de ${ids.length} mise(s) à jour Windows via l'agent Windows Update`,
        result: null,
        error: null,
        running: true,
        time,
      },
    ]);
    setRunningCmd("windows-update");
    try {
      const res = await invoke<CommandResult>("install_windows_updates", {
        updateIds: ids,
      });
      setTerminal((t) =>
        t.map((e) => (e.id === id ? { ...e, result: res, running: false } : e)),
      );
    } catch (err) {
      setTerminal((t) =>
        t.map((e) =>
          e.id === id ? { ...e, error: String(err), running: false } : e,
        ),
      );
    } finally {
      setRunningCmd(null);
      // Rafraîchit la liste en arrière-plan : les mises à jour installées
      // disparaissent, celles en attente de redémarrage restent listées.
      chargerWu();
    }
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

  const canauxDisponibles = useMemo(
    () => ["Tous", ...Array.from(new Set(events.map((e) => e.canal)))],
    [events],
  );

  // Si le canal filtré n'existe plus dans la nouvelle collecte (ex. Security
  // collecté une fois en administrateur puis application relancée non
  // élevée), le filtre ne correspondrait plus à rien : retour à « Tous ».
  useEffect(() => {
    if (canal !== "Tous" && !canauxDisponibles.includes(canal)) {
      setCanal("Tous");
    }
  }, [canauxDisponibles, canal]);

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
    await copierTexte(rapportMarkdown(audit, planAction));
    setRapportCopie(true);
    setTimeout(() => setRapportCopie(false), 2000);
  }

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const now = Date.now();
    const fenetres: Record<string, number> = {
      "1": 3600_000,
      "24": 24 * 3600_000,
      "168": 7 * 24 * 3600_000,
    };
    const fenetre = fenetres[depuis];
    const liste = events.filter((e) => {
      if (canal !== "Tous" && e.canal !== canal) return false;
      if (severite !== "Toutes" && e.severity !== severite) return false;
      if (fenetre) {
        const t = new Date(e.timestamp).getTime();
        if (!Number.isNaN(t) && now - t > fenetre) return false;
      }
      if (
        q &&
        !e.provider.toLowerCase().includes(q) &&
        !String(e.eventId).includes(q) &&
        !e.messageRaw.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return liste.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "fr") * dir;
    });
  }, [events, canal, severite, recherche, sortKey, sortDir, depuis]);

  function trier(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "timestamp" || key === "eventId" ? "desc" : "asc");
    }
  }

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
              onClick={() => setTheme((t) => (t === "sombre" ? "clair" : "sombre"))}
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
        <div className="toolbar-filtres" role="group" aria-label="Filtres de la liste">
        <select value={canal} onChange={(e) => setCanal(e.target.value)} aria-label="Filtrer par canal">
          {canauxDisponibles.map((c) => (
            <option key={c}>{c}</option>
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
        <select value={depuis} onChange={(e) => setDepuis(e.target.value)} aria-label="Filtrer par période">
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
        <div
          className="table-wrap"
          role="region"
          aria-label="Liste des événements"
          onKeyDown={naviguerClavier}
        >
          <table className="events-table">
            <thead>
              <tr>
                {COLONNES.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={col.align === "right" ? "align-right" : ""}
                    aria-sort={
                      sortKey === col.key
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button className="sort-btn" onClick={() => trier(col.key)}>
                      {col.label}
                      <span className="sort-arrow" aria-hidden="true">
                        {sortKey === col.key &&
                          (sortDir === "asc" ? (
                            <ChevronUp className="icon" size={13} aria-hidden="true" />
                          ) : (
                            <ChevronDown className="icon" size={13} aria-hidden="true" />
                          ))}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtres.map((e, i) => {
                // Regroupement par jour, uniquement dans le tri par date
                // (le tri par défaut) : en-têtes « Aujourd'hui », « Hier »…
                const lignes: React.ReactNode[] = [];
                const cleJour = cleJourLocal(e.timestamp);
                if (sortKey === "timestamp" && (i === 0 || cleJourLocal(filtres[i - 1].timestamp) !== cleJour)) {
                  lignes.push(
                    <tr key={`jour-${cleJour}`} className="groupe-jour">
                      <td colSpan={5}>{libelleJour(cleJour)}</td>
                    </tr>,
                  );
                }
                lignes.push(
                  <tr
                    key={`${e.recordId}-${e.canal}-${e.timestamp}-${i}`}
                    className={`${selected === e ? "selected" : ""} ${e.level === 1 ? "niveau-critique" : ""}`}
                    tabIndex={0}
                    onClick={() => selectionner(e)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.preventDefault();
                        selectionner(e);
                      }
                    }}
                  >
                    <td className="mono">{formatDate(e.timestamp)}</td>
                    <td>{e.canal}</td>
                    <td title={e.provider}>{e.provider}</td>
                    <td className="mono align-right">{e.eventId}</td>
                    <td>
                      <span className={`badge ${severityClass(e)}`}>
                        <span className="badge-point" aria-hidden="true" />
                        {e.severity}
                      </span>
                    </td>
                  </tr>,
                );
                return lignes;
              })}
              {loading && filtres.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    <span className="icon-circle">
                      <Loader2 className="icon spin" aria-hidden="true" />
                    </span>
                    <strong>Collecte des événements…</strong>
                    <span>
                      Interrogation des canaux System, Application, WHEA-Logger et
                      Diagnostics-Performance.
                    </span>
                  </td>
                </tr>
              )}
              {filtres.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    <span className="icon-circle">
                      <Inbox className="icon" aria-hidden="true" />
                    </span>
                    <strong>
                      {events.length === 0
                        ? "Aucun événement collecté"
                        : "Aucun résultat"}
                    </strong>
                    <span>
                      {events.length === 0
                        ? "Lancez « Analyser le journal » pour collecter les événements critiques et erreurs de la machine."
                        : "Aucun événement ne correspond à ces filtres."}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="detail" aria-live="polite" aria-busy={diagLoading} ref={detailRef}>
          {!selected && (
            <div className="detail-empty">
              <span className="icon-circle">
                <FileSearch className="icon" aria-hidden="true" />
              </span>
              <p>Sélectionnez un événement pour voir son diagnostic et les correctifs exécutables.</p>
            </div>
          )}
          {selected && (
            <>
              <div className={`detail-tete ${severityClass(selected)}`}>
                <div className="detail-tete-titre">
                  <h2>
                    {selected.provider} <span className="mono">— {selected.eventId}</span>
                  </h2>
                  <span className={`badge ${severityClass(selected)}`}>
                    <span className="badge-point" aria-hidden="true" />
                    {selected.severity}
                  </span>
                </div>
                <div className="detail-meta">
                  <span className="chip mono">{formatDate(selected.timestamp)}</span>
                  <span className="chip">{selected.canal}</span>
                  {selected.computer && <span className="chip">{selected.computer}</span>}
                  {selected.processId != null && (
                    <span className="chip mono">PID {selected.processId}</span>
                  )}
                  {selected.recordId != null && selected.recordId > 0 && (
                    <span className="chip mono">#{selected.recordId}</span>
                  )}
                </div>
              </div>

              <div className="section">
                <h3>Message brut</h3>
                <pre>{selected.messageRaw || "Aucun message."}</pre>
              </div>

              <div className="section">
                <h3>Diagnostic</h3>
                {diagLoading && (
                  <div className="skeleton">
                    <div className="skeleton-line" />
                    <div className="skeleton-line short" />
                    <div className="skeleton-line" />
                  </div>
                )}
                {!diagLoading && diagnostic && !diagnostic.fix && (
                  <div className="fix">
                    <p>
                      Aucun correctif connu pour cet événement. Consultez la base
                      Microsoft.
                    </p>
                    <LienExterne className="btn" href={lienRecherche(selected)}>
                      <Search className="icon" aria-hidden="true" />
                      Rechercher sur support.microsoft.com
                      <span className="sr-only"> (ouvre un nouvel onglet)</span>
                    </LienExterne>
                  </div>
                )}
                {!diagLoading && diagnostic?.fix && (
                  <div className="fix">
                    <h4>{diagnostic.fix.titre}</h4>
                    <p className="cause">{diagnostic.fix.cause}</p>
                    <ol>
                      {diagnostic.fix.etapes.map((etape, i) => (
                        <li key={i}>{etape}</li>
                      ))}
                    </ol>
                    <div className="fix-footer">
                      <span className="badge categorie">{diagnostic.fix.categorie}</span>
                      <LienExterne className="btn" href={lienRecherche(selected)}>
                        <ExternalLink className="icon" aria-hidden="true" />
                        Plus d'infos (support.microsoft.com)
                        <span className="sr-only"> (ouvre un nouvel onglet)</span>
                      </LienExterne>
                    </div>

                    {diagnostic.fix.commandes.length > 0 && (
                      <div className="commandes">
                        <h3>Correctifs exécutables</h3>
                        {diagnostic.fix.commandes.map((cmd, i) => {
                          const blocked = cmd.elevation && elevated === false;
                          const running = runningCmd === cleCommande(cmd);
                          const busy = runningCmd !== null;
                          return (
                            <div key={i} className={`cmd-card ${blocked ? "blocked" : ""}`}>
                              <div className="cmd-head">
                                <div>
                                  <strong>{cmd.label}</strong>
                                  {cmd.description && (
                                    <p className="cmd-desc">{cmd.description}</p>
                                  )}
                                </div>
                                <button
                                  className="btn small"
                                  onClick={() => demanderExecution(cmd)}
                                  disabled={blocked || busy}
                                  title={
                                    blocked
                                      ? "Nécessite de relancer l'application en administrateur"
                                      : cmd.confirme
                                        ? "Une confirmation sera demandée"
                                        : "Exécuter dans la fenêtre principale"
                                  }
                                >
                                  {running ? (
                                    <Loader2 className="icon spin" aria-hidden="true" />
                                  ) : blocked ? (
                                    <Lock className="icon" aria-hidden="true" />
                                  ) : (
                                    <>
                                      <Play className="icon" aria-hidden="true" />
                                      Exécuter
                                    </>
                                  )}
                                </button>
                              </div>
                              <code className="cmd-line">{cmd.commande}</code>
                              {cmd.confirme && !blocked && (
                                <span className="cmd-flag">
                                  <AlertTriangle className="icon" aria-hidden="true" /> Confirmation requise
                                </span>
                              )}
                              {cmd.elevation && !blocked && (
                                <span className="cmd-flag">
                                  <Lock className="icon" aria-hidden="true" /> Droits administrateur
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
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
        />
      )}

      {majOuverte && (
        <ModaleMaintenance
          elevated={elevated}
          runningCmd={runningCmd}
          onFermer={() => setMajOuverte(false)}
          onOngletChange={(cle) => {
            if (cle === "bios" && !hwCharge && !hwChargement) chargerMateriel();
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
