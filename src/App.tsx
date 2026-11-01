import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileSearch,
  HeartPulse,
  Inbox,
  Lock,
  Loader2,
  Moon,
  Package,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Sun,
  TerminalSquare,
  Trash2,
  Wrench,
  X,
  XCircle,
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

// Canaux dérivés des événements collectés (System, Application, Security,
// WHEA-Logger, Diagnostics-Performance…).
const SEVERITES = ["Toutes", "Critique", "Erreur", "Avertissement", "Info"] as const;

// Maintenance intégrée : sélection des applications à mettre à jour via
// winget, purge des installateurs résiduels et détection des anciennes
// versions. `commande` est purement indicative : l'exécution passe par la
// commande Tauri dédiée `update_applications` (voir executerMajApps).
const MAJ_APPS: CommandeFix = {
  label: "Mettre à jour les applications",
  description:
    "winget upgrade (paquets sélectionnés), purge des installateurs résiduels et détection des anciennes versions",
  commande: "winget upgrade --silent --exact --id <paquet> (maintenance intégrée)",
  type: "action",
  elevation: true,
  confirme: true,
};

// Catalogue de correctifs système prédéfinis (aucune commande arbitraire).
// Exécutés via run_diagnostic_command : confirmation, denylist et terminal
// intégrés. Durées indicatives pour les opérations longues.
const CORRECTIFS_SYSTEME: CommandeFix[] = [
  {
    label: "Vérifier les fichiers système (sfc)",
    description: "sfc /scannow — inspecte et répare les fichiers Windows corrompus (10 à 20 min)",
    commande: "sfc /scannow",
    type: "action",
    elevation: true,
    confirme: true,
    timeoutSecs: 3600,
  },
  {
    label: "Contrôle rapide du magasin de composants",
    description: "DISM CheckHealth — détection rapide d'une corruption du magasin Windows",
    commande: "DISM /Online /Cleanup-Image /CheckHealth",
    type: "action",
    elevation: true,
    confirme: false,
    timeoutSecs: 300,
  },
  {
    label: "Analyser le magasin de composants",
    description: "DISM ScanHealth — analyse approfondie du magasin de composants (long)",
    commande: "DISM /Online /Cleanup-Image /ScanHealth",
    type: "action",
    elevation: true,
    confirme: true,
    timeoutSecs: 3600,
  },
  {
    label: "Réparer le magasin de composants",
    description: "DISM RestoreHealth — répare le magasin via Windows Update (très long, à faire avant sfc)",
    commande: "DISM /Online /Cleanup-Image /RestoreHealth",
    type: "action",
    elevation: true,
    confirme: true,
    timeoutSecs: 7200,
  },
  {
    label: "Analyser le disque système",
    description: "chkdsk C: /scan — vérification en ligne du disque système, sans démontage",
    commande: "chkdsk C: /scan",
    type: "action",
    elevation: true,
    confirme: false,
    timeoutSecs: 3600,
  },
  {
    label: "Vider le cache DNS",
    description: "ipconfig /flushdns — résout les problèmes de résolution de noms",
    commande: "ipconfig /flushdns",
    type: "action",
    elevation: false,
    confirme: false,
    timeoutSecs: 60,
  },
  {
    label: "Réinitialiser la pile réseau",
    description:
      "réinitialise Winsock et le cache ARP — utile après une infection ou des soucis réseau. Attention : redémarrage requis pour Winsock ; la connexion peut être brièvement coupée pendant l'opération",
    commande:
      "netsh winsock reset; netsh int ip reset; arp -d *; ipconfig /release; ipconfig /renew; ipconfig /flushdns",
    type: "action",
    elevation: true,
    confirme: true,
    timeoutSecs: 300,
  },
  {
    label: "Vérifier et réparer les fichiers système en une passe",
    description: "DISM RestoreHealth puis sfc /scannow — le combo recommandé par Microsoft (très long)",
    commande: "DISM /Online /Cleanup-Image /RestoreHealth; sfc /scannow",
    type: "action",
    elevation: true,
    confirme: true,
    timeoutSecs: 7200,
  },
];

type SortKey = "timestamp" | "canal" | "provider" | "eventId" | "severity";
type SortDir = "asc" | "desc";

const COLONNES: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "timestamp", label: "Date" },
  { key: "canal", label: "Canal" },
  { key: "provider", label: "Source" },
  { key: "eventId", label: "ID", align: "right" },
  { key: "severity", label: "Sévérité" },
];

interface TerminalEntry {
  id: number;
  label: string;
  commande: string;
  result: CommandResult | null;
  error: string | null;
  running: boolean;
  time: string;
}

// Liens officiels des principaux fabricants (support + pilotes/BIOS).
// Il n'existe pas d'API universelle de mise à jour BIOS : le support du
// fabricant reste le canal officiel.
const LIENS_FABRICANTS: { motif: string; nom: string; url: string; outil?: string }[] = [
  { motif: "dell", nom: "Support Dell", url: "https://www.dell.com/support", outil: "Dell Command Update (winget : Dell.CommandUpdate)" },
  { motif: "hewlett", nom: "Support HP", url: "https://support.hp.com", outil: "HP Support Assistant (winget : HP.SupportAssistant)" },
  { motif: "hp ", nom: "Support HP", url: "https://support.hp.com", outil: "HP Support Assistant (winget : HP.SupportAssistant)" },
  { motif: "lenovo", nom: "Support Lenovo", url: "https://pcsupport.lenovo.com", outil: "Lenovo System Update (winget : Lenovo.SystemUpdate)" },
  { motif: "asus", nom: "Support ASUS", url: "https://www.asus.com/support/", outil: "MyASUS" },
  { motif: "msi", nom: "Support MSI", url: "https://www.msi.com/support", outil: "MSI Center" },
  { motif: "micro-star", nom: "Support MSI", url: "https://www.msi.com/support", outil: "MSI Center" },
  { motif: "gigabyte", nom: "Support Gigabyte", url: "https://www.gigabyte.com/support", outil: "Gigabyte Control Center" },
  { motif: "asrock", nom: "Support ASRock", url: "https://www.asrock.com/support/" },
  { motif: "acer", nom: "Support Acer", url: "https://www.acer.com/support/", outil: "Care Center" },
  { motif: "predator", nom: "Support Acer Predator", url: "https://www.acer.com/support/" },
  { motif: "samsung", nom: "Support Samsung", url: "https://www.samsung.com/support/" },
  { motif: "microsoft", nom: "Support Microsoft", url: "https://support.microsoft.com" },
  { motif: "toshiba", nom: "Support Dynabook/Toshiba", url: "https://support.dynabook.com" },
  { motif: "dynabook", nom: "Support Dynabook/Toshiba", url: "https://support.dynabook.com" },
];

function fabricantTrouve(manufacturer: string) {
  const m = manufacturer.toLowerCase();
  return LIENS_FABRICANTS.find((f) => m.includes(f.motif));
}

// Signification des codes de problème Gestionnaire de périphériques
// (CM_PROBLEM) les plus fréquents.
const CODES_PROBLEME: Record<string, string> = {
  "1": "Périphérique mal configuré",
  "10": "Le périphérique ne peut pas démarrer",
  "18": "Pilotes à réinstaller",
  "22": "Périphérique désactivé",
  "24": "Périphérique absent ou en panne — débranchez/rebranchez",
  "28": "Pilotes non installés",
  "31": "Ne fonctionne pas correctement avec cette version de Windows",
  "37": "Échec d'initialisation du pilote — réinstallation recommandée",
  "39": "Pilote corrompu ou manquant",
  "43": "Windows a arrêté ce périphérique (problème matériel signalé)",
  "45": "Périphérique non connecté",
  "52": "Windows ne peut pas vérifier la signature numérique du pilote",
};

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Pas de secondes : inutiles pour un journal, elles ajoutent du bruit.
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function lienRecherche(e: CriticalEvent): string {
  const q = `${e.provider} ${e.eventId}`;
  return `https://support.microsoft.com/results?q=${encodeURIComponent(q)}`;
}

function severityClass(e: CriticalEvent): string {
  if (e.level === 1) return "critique";
  if (e.level === 2) return "erreur";
  if (e.level === 3) return "avertissement";
  return "info";
}

// Libellé humain du jour de regroupement : « Aujourd'hui », « Hier », date.
// `dateCle` est de la forme « 2026-10-31 » (YYYY-MM-DD, jour **local** de
// l'événement) : sans composante temps ni fuseau, new Date() la parse comme
// une date locale et le regroupement suit le calendrier de l'utilisateur.
function libelleJour(dateCle: string): string {
  const d = new Date(`${dateCle}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateCle;
  const ref = new Date();
  ref.setHours(12, 0, 0, 0);
  const hier = new Date(ref);
  hier.setDate(hier.getDate() - 1);
  const memeJour = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (memeJour(d, ref)) return "Aujourd'hui";
  if (memeJour(d, hier)) return "Hier";
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// Clé de regroupement par jour : « 2026-10-31 » en date **locale** de
// l'événement (cohérente avec formatDate, qui affiche l'heure locale).
function cleJourLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Piège de focus dans une modale : Tab ne s'échappe pas vers l'arrière-plan.
// Place le focus au premier élément interactif à l'ouverture et le rend à
// l'élément qui avait ouvert la modale à la fermeture.
function usePiegeFocus(ref: React.RefObject<HTMLElement | null>, actif: boolean) {
  useEffect(() => {
    if (!actif || !ref.current) return;
    const racine = ref.current;
    const focusables = () =>
      Array.from(
        racine.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
    const focusAvant = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    focusables()[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;
      const premier = els[0];
      const dernier = els[els.length - 1];
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    };
    racine.addEventListener("keydown", onKeyDown);
    return () => {
      racine.removeEventListener("keydown", onKeyDown);
      // Rend le focus à l'élément qui a ouvert la modale, s'il existe encore.
      if (focusAvant && document.contains(focusAvant)) focusAvant.focus();
    };
  }, [ref, actif]);
}

// Anneau de score (SVG) : la progression s'anime au montage.
function Anneau({
  score,
  taille,
  gros = false,
}: {
  score: number;
  taille: number;
  gros?: boolean;
}) {
  const [anime, setAnime] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setAnime(true));
    return () => cancelAnimationFrame(t);
  }, [score]);
  const epaisseur = gros ? 9 : 7;
  const rayon = (taille - epaisseur * 2) / 2;
  const circonference = 2 * Math.PI * rayon;
  const cible = circonference * (1 - score / 100);
  const classe = score >= 80 ? "ok" : score >= 50 ? "moyen" : "mauvais";
  return (
    <svg
      width={taille}
      height={taille}
      className={`anneau ${classe}`}
      role="img"
      aria-label={`Score ${score} sur 100`}
    >
      <circle
        cx={taille / 2}
        cy={taille / 2}
        r={rayon}
        fill="none"
        className="anneau-fond"
        strokeWidth={epaisseur}
      />
      <circle
        cx={taille / 2}
        cy={taille / 2}
        r={rayon}
        fill="none"
        className="anneau-valeur"
        strokeWidth={epaisseur}
        strokeLinecap="round"
        strokeDasharray={circonference}
        strokeDashoffset={anime ? cible : circonference}
        transform={`rotate(-90 ${taille / 2} ${taille / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className={`anneau-texte ${gros ? "gros" : ""}`}
      >
        {score}
      </text>
    </svg>
  );
}

// Copie dans le presse-papiers avec repli (execCommand) si l'API Clipboard
// n'est pas disponible dans le webview.
async function copierTexte(texte: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texte);
  } catch {
    const zone = document.createElement("textarea");
    zone.value = texte;
    document.body.appendChild(zone);
    zone.select();
    document.execCommand("copy");
    zone.remove();
  }
}

// Ouvre un lien externe dans le navigateur par défaut du système. Une
// webview Tauri n'ouvre pas les target="_blank" d'elle-même : on passe
// par le plugin opener (capacité « opener:default »).
function ouvrirExterne(url: string) {
  invoke("plugin:opener|open_url", { url }).catch(() => {
    /* plugin indisponible : laisser la webview tenter le repli */
  });
}

// Ancre externe : href conservé (clavier, statut hover), ouverture via opener.
function LienExterne({
  href,
  className,
  title,
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        ouvrirExterne(href);
      }}
    >
      {children}
    </a>
  );
}

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
  const [majOnglet, setMajOnglet] = useState<"apps" | "windows" | "bios" | "correctifs">("apps");
  const [wuPaquets, setWuPaquets] = useState<WinUpdate[]>([]);
  const [wuSelection, setWuSelection] = useState<Set<string>>(new Set());
  const [wuChargement, setWuChargement] = useState(false);
  const [wuScanFait, setWuScanFait] = useState(false);
  const [wuErreur, setWuErreur] = useState<string | null>(null);
  const [hwInfo, setHwInfo] = useState<SystemInfo | null>(null);
  const [hwProblemes, setHwProblemes] = useState<ProblemDevice[]>([]);
  const [hwChargement, setHwChargement] = useState(false);
  const [hwCharge, setHwCharge] = useState(false);
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
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
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
  }, []);

  // Auto-rafraîchissement de la collecte.
  useEffect(() => {
    if (autoRefresh === "0") return;
    const minutes = Number(autoRefresh);
    const timer = setInterval(() => chargerRef.current(), minutes * 60_000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  // Thème clair/sombre persistant.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
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
      else if (majOuverte) setMajOuverte(false);
      else setAuditOuverte(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmCmd, majOuverte, auditOuverte]);

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

  async function executerCommande(cmd: CommandeFix) {
    const id = nextId.current++;
    const time = new Date().toLocaleTimeString("fr-FR");
    setTerminalOuvert(true);
    setTerminal((t) => [
      ...t,
      { id, label: cmd.label, commande: cmd.commande, result: null, error: null, running: true, time },
    ]);
    setRunningCmd(cmd.commande);
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
    try {
      const [info, problemes] = await Promise.all([
        invoke<SystemInfo>("get_system_info"),
        invoke<ProblemDevice[]>("list_problem_devices"),
      ]);
      setHwInfo(info);
      setHwProblemes(problemes);
      setHwCharge(true);
    } catch (e) {
      setError(String(e));
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

  // Plan d'action persistant (localStorage) : étapes cochées par problème.
  const clePlanAction = (p: { provider: string; eventId: number; index: number }) =>
    `${p.provider}/${p.eventId}/${p.index}`;

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

  function rapportMarkdown(a: AuditSante, plan: Record<string, boolean>): string {
    const lignes: string[] = [
      `# Rapport d'audit — Libre EventLog`,
      ``,
      `Généré le ${a.genereLe} — ${a.totalEvenements} événement(s) analysé(s)`,
      ``,
      `## Score global : ${a.global}/100`,
      ``,
    ];
    if (a.categories.length > 0) {
      lignes.push(`## Santé par catégorie`, ``);
      for (const c of a.categories) {
        lignes.push(`- **${c.categorie}** : ${c.score}/100 (${c.problemes} problème(s))`);
      }
      lignes.push(``);
    }
    if (a.problemes.length > 0) {
      lignes.push(`## Problèmes détectés`, ``);
      for (const p of a.problemes) {
        lignes.push(
          `### ${p.titre}`,
          ``,
          `- Provider : \`${p.provider}\` — événement ${p.eventId}`,
          `- Gravité : ${p.level === 1 ? "Critique" : p.level === 2 ? "Erreur" : p.level === 3 ? "Avertissement" : "Info"} — ${p.count} occurrence(s)`,
          `- Catégorie : ${p.categorie}`,
          ``,
        );
        if (p.etapes.length > 0) {
          lignes.push(`Étapes recommandées :`);
          for (let i = 0; i < p.etapes.length; i++) {
            const faite = !!plan[clePlanAction({ provider: p.provider, eventId: p.eventId, index: i })];
            lignes.push(`- [${faite ? "x" : " "}] ${p.etapes[i]}`);
          }
          lignes.push(``);
        }
      }
    } else {
      lignes.push(`Aucun problème détecté. Système sain ! 🎉`);
    }
    return lignes.join("\n");
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
          {error}
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

        <aside className="detail" aria-live="polite" ref={detailRef}>
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
                          const running = runningCmd === cmd.commande;
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

      {terminalOuvert && (
        <div
          className="terminal"
          role="region"
          aria-label="Terminal des commandes exécutées"
          style={{ flexBasis: terminalHauteur }}
        >
          <div
            className="terminal-poignee"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Redimensionner le terminal"
            onPointerDown={commencerRedimension}
            onPointerMove={bougerRedimension}
            onPointerUp={finirRedimension}
            onPointerCancel={finirRedimension}
          />
          <div className="terminal-head">
            <span className="terminal-title">
              <TerminalSquare className="icon" aria-hidden="true" />
              Terminal — exécution PowerShell
            </span>
            <div className="terminal-actions">
              <button
                className="btn small"
                onClick={() => setTerminal([])}
                disabled={terminal.length === 0}
              >
                <Trash2 className="icon" aria-hidden="true" />
                Effacer
              </button>
              <button className="btn small" onClick={() => setTerminalOuvert(false)}>
                <X className="icon" aria-hidden="true" />
                Réduire
              </button>
            </div>
          </div>
          <div className="terminal-body" ref={termRef}>
            {terminal.length === 0 && (
              <p className="terminal-empty">
                Aucune commande exécutée. Les résultats des correctifs s'afficheront ici,
                sans ouvrir de fenêtre externe.
              </p>
            )}
            {terminal.map((entry) => {
              const res = entry.result;
              return (
              <div
                key={entry.id}
                className={`term-entry ${entry.running ? "running" : res ? (res.exitCode === 0 ? "term-ok" : "term-ko") : ""}`}
              >
                <div className="term-cmd-line">
                  <span className="term-time">{entry.time}</span>
                  <span className="term-label">{entry.label}</span>
                </div>
                <code className="cmd-line">{entry.commande}</code>
                {entry.running && (
                  <p className="term-status">
                    <Loader2 className="icon spin" aria-hidden="true" /> Exécution en cours…
                  </p>
                )}
                {entry.error && <pre className="term-err">{entry.error}</pre>}
                {res && (
                  <>
                    {res.stdout && <pre className="term-out">{res.stdout}</pre>}
                    {res.stderr && <pre className="term-err">{res.stderr}</pre>}
                    <p className="term-status">
                      {res.exitCode === 0 ? (
                        <CheckCircle2 className="icon ok" aria-hidden="true" />
                      ) : (
                        <XCircle className="icon err" aria-hidden="true" />
                      )}
                      Terminé en {res.durationMs} ms — code{" "}
                      {res.exitCode ?? "?"}
                      <button
                        className="btn small copier-btn"
                        onClick={() =>
                          copierTexte(`${entry.commande}\n${res.stdout}\n${res.stderr}`)
                        }
                        title="Copier la commande et sa sortie"
                      >
                        <Copy className="icon" aria-hidden="true" />
                        Copier
                      </button>
                    </p>
                  </>
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}

      {!terminalOuvert && terminal.length > 0 && (
        <button className="btn terminal-restore" onClick={() => setTerminalOuvert(true)}>
          <TerminalSquare className="icon" aria-hidden="true" /> Terminal ({terminal.length})
        </button>
      )}

      {auditOuverte && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-title"
          onClick={() => !auditChargement && setAuditOuverte(false)}
        >
          <div className="modal modal-maj" ref={auditModalRef} onClick={(e) => e.stopPropagation()}>
            <h3 id="audit-title">
              <HeartPulse className="icon" aria-hidden="true" /> Audit de santé
            </h3>

            {auditChargement && (
              <p className="maj-status">
                <Loader2 className="icon spin" aria-hidden="true" /> Collecte et agrégation des événements…
              </p>
            )}

            {!auditChargement && audit && (
              <>
                <p className="cmd-desc">
                  {audit.totalEvenements} événement(s) analysé(s) le {audit.genereLe}.
                  Le score pénalise chaque problème par gravité et par nombre d'occurrences.
                </p>

                <div className="audit-entete">
                  <Anneau score={audit.global} taille={116} gros />
                  <div className="audit-entete-texte">
                    <strong>Score global de santé</strong>
                    <span>
                      {audit.totalEvenements} événement(s) analysé(s) — {audit.problemes.length} problème(s) distinct(s)
                    </span>
                    <span className="audit-date">{audit.genereLe}</span>
                  </div>
                </div>

                {audit.categories.length > 0 && (
                  <div className="audit-categories">
                    {audit.categories.map((c) => (
                      <div key={c.categorie} className="audit-categorie">
                        <Anneau score={c.score} taille={58} />
                        <div className="audit-categorie-texte">
                          <strong>{c.categorie}</strong>
                          <span>
                            {c.problemes} problème{c.problemes > 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {audit.problemes.length > 0 && (
                  <div className="maj-liste" role="group" aria-label="Problèmes détectés">
                    {audit.problemes.map((p) => {
                      const cle = `${p.provider}/${p.eventId}`;
                      return (
                        <div key={cle} className="audit-probleme">
                          <div className="audit-probleme-tete">
                            <span className={`badge ${severityClass({ level: p.level } as CriticalEvent)}`}>
                              {p.count}×
                            </span>
                            <button
                              className="audit-probleme-titre"
                              onClick={() => {
                                setRecherche(String(p.eventId));
                                setCanal("Tous");
                                setAuditOuverte(false);
                              }}
                              title="Filtrer la liste des événements sur ce problème"
                            >
                              {p.titre}
                            </button>
                          </div>
                          {p.etapes.length > 0 && (
                            <ul className="audit-etapes">
                              {p.etapes.map((etape, i) => {
                                const cleEtape = clePlanAction({ provider: p.provider, eventId: p.eventId, index: i });
                                return (
                                  <li key={i}>
                                    <label className="audit-etape">
                                      <input
                                        type="checkbox"
                                        checked={!!planAction[cleEtape]}
                                        onChange={() => toggleEtapePlan(cleEtape)}
                                      />
                                      <span className={planAction[cleEtape] ? "fait" : ""}>{etape}</span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="modal-actions">
                  <button className="btn" onClick={() => setAuditOuverte(false)}>
                    Fermer
                  </button>
                  <button className="btn" onClick={copierRapport}>
                    {rapportCopie ? (
                      <>
                        <Check className="icon ok" aria-hidden="true" /> Copié !
                      </>
                    ) : (
                      <>
                        <Copy className="icon" aria-hidden="true" /> Copier le rapport
                      </>
                    )}
                  </button>
                  <button className="btn primary" onClick={telechargerRapport}>
                    <Download className="icon" aria-hidden="true" /> Télécharger (.md)
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {majOuverte && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="maj-title"
          onClick={() =>
            !majChargement && !wuChargement && !hwChargement && setMajOuverte(false)
          }
        >
          <div className="modal modal-maj" ref={majModalRef} onClick={(e) => e.stopPropagation()}>
            <h3 id="maj-title"><Wrench className="icon" aria-hidden="true" /> Maintenance</h3>

            <div className="maj-onglets" role="tablist" aria-label="Sections de maintenance">
              {(
                [
                  ["apps", "Applications"],
                  ["windows", "Windows & pilotes"],
                  ["bios", "Matériel & BIOS"],
                  ["correctifs", "Correctifs système"],
                ] as const
              ).map(([cle, libelle]) => (
                <button
                  key={cle}
                  role="tab"
                  aria-selected={majOnglet === cle}
                  className={`maj-onglet ${majOnglet === cle ? "actif" : ""}`}
                  onClick={() => {
                    setMajOnglet(cle);
                    if (cle === "bios" && !hwCharge && !hwChargement) chargerMateriel();
                  }}
                >
                  {libelle}
                </button>
              ))}
            </div>

            {majOnglet === "apps" && (
              <>
                <p className="cmd-desc">{MAJ_APPS.description}</p>
                <p className="cmd-desc">
                  <AlertTriangle className="icon warn" aria-hidden="true" /> Fermez vos applications avant de les mettre à jour : une app en
                  cours d'exécution peut voir sa mise à jour figée (cas Terminal/MSIX)
                  ou faire échouer l'installateur.
                </p>

                {majChargement && (
                  <p className="maj-status"><Loader2 className="icon spin" aria-hidden="true" /> Recherche des mises à jour disponibles…</p>
                )}

                {!majChargement && majPaquets.length === 0 && (
                  <p className="maj-status"><CheckCircle2 className="icon ok" aria-hidden="true" /> Aucune mise à jour d'application disponible. Tout est à jour !</p>
                )}

                {!majChargement && majPaquets.length > 0 && (
                  <div className="maj-liste" role="group" aria-label="Applications à mettre à jour">
                    <label className="maj-item maj-tous">
                      <input
                        type="checkbox"
                        checked={majSelection.size === majPaquets.length}
                        onChange={toggleTout}
                      />
                      <strong>
                        Tout sélectionner ({majSelection.size}/{majPaquets.length})
                      </strong>
                    </label>
                    {majPaquets.map((p) => (
                      <label key={p.id} className="maj-item">
                        <input
                          type="checkbox"
                          checked={majSelection.has(p.id)}
                          onChange={() => togglePaquet(p.id)}
                        />
                        <span className="maj-nom" title={p.id}>
                          {p.name}
                        </span>
                        <span className="maj-versions mono">
                          {p.version} → {p.available}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="modal-actions">
                  <button className="btn" onClick={() => setMajOuverte(false)} disabled={majChargement}>
                    Fermer
                  </button>
                  <button
                    className="btn primary"
                    disabled={majChargement || majSelection.size === 0 || runningCmd !== null}
                    onClick={() => executerMajApps([...majSelection])}
                  >
                    <Package className="icon" aria-hidden="true" /> Mettre à jour ({majSelection.size})
                  </button>
                </div>
              </>
            )}

            {majOnglet === "windows" && (
              <>
                <p className="cmd-desc">
                  Mises à jour Windows et pilotes via l'agent Windows Update (WSUS/Windows Update
                  configuré sur la machine). Le scan peut prendre plusieurs minutes ; les pilotes
                  sont marqués d'une clé.
                </p>

                {wuChargement && (
                  <p className="maj-status"><Loader2 className="icon spin" aria-hidden="true" /> Recherche des mises à jour Windows et pilotes…</p>
                )}

                {!wuChargement && !wuScanFait && !wuErreur && (
                  <p className="maj-status">
                    Lancez une recherche pour afficher les mises à jour Windows et pilotes disponibles.
                  </p>
                )}

                {!wuChargement && wuErreur && (
                  <p className="modal-warn" role="alert">
                    <AlertTriangle className="icon warn" aria-hidden="true" /> La recherche a échoué : {wuErreur}
                  </p>
                )}

                {!wuChargement && wuScanFait && wuPaquets.length === 0 && (
                  <p className="maj-status"><CheckCircle2 className="icon ok" aria-hidden="true" /> Aucune mise à jour Windows ni pilote en attente.</p>
                )}

                {!wuChargement && wuPaquets.length > 0 && (
                  <div className="maj-liste" role="group" aria-label="Mises à jour Windows à installer">
                    <label className="maj-item maj-tous">
                      <input
                        type="checkbox"
                        checked={wuSelection.size === wuPaquets.length}
                        onChange={toggleToutWu}
                      />
                      <strong>
                        Tout sélectionner ({wuSelection.size}/{wuPaquets.length})
                      </strong>
                    </label>
                    {wuPaquets.map((u) => (
                      <label key={u.updateId} className="maj-item">
                        <input
                          type="checkbox"
                          checked={wuSelection.has(u.updateId)}
                          onChange={() => toggleWu(u.updateId)}
                        />
                        <span className="maj-nom" title={u.title}>
                          {u.kind === "Driver" ? <Wrench className="icon" size={12} aria-hidden="true" /> : null}
                          {u.title}
                        </span>
                        <span className="maj-versions mono">{u.sizeMb.toFixed(1)} Mo</span>
                      </label>
                    ))}
                  </div>
                )}

                <div className="modal-actions">
                  <button className="btn" onClick={() => setMajOuverte(false)}>
                    Fermer
                  </button>
                  <button className="btn" onClick={chargerWu} disabled={wuChargement || runningCmd !== null}>
                    <RefreshCw className="icon" aria-hidden="true" /> Rechercher
                  </button>
                  <button
                    className="btn primary"
                    disabled={wuChargement || wuSelection.size === 0 || runningCmd !== null}
                    onClick={() => executerWuInstall([...wuSelection])}
                  >
                    <Download className="icon" aria-hidden="true" /> Installer ({wuSelection.size})
                  </button>
                </div>
              </>
            )}

            {majOnglet === "bios" && (
              <>
                <p className="cmd-desc">
                  <Cpu className="icon" aria-hidden="true" />
                  Informations matériel de cette machine et liens vers le support officiel du
                  fabricant. Il n'existe pas d'API universelle de mise à jour BIOS : les mises à
                  jour de firmware passent par Windows Update (onglet « Windows &amp; pilotes »)
                  sur les machines récentes, sinon par le site ou l'outil officiel du fabricant.
                </p>

                {hwChargement && <p className="maj-status"><Loader2 className="icon spin" aria-hidden="true" /> Lecture des informations matériel…</p>}

                {!hwChargement && hwInfo && (
                  <div className="hw-grille">
                    <div className="hw-item">
                      <span className="hw-label">Fabricant</span>
                      <strong>{hwInfo.manufacturer}</strong>
                    </div>
                    <div className="hw-item">
                      <span className="hw-label">Modèle</span>
                      <strong>{hwInfo.model}</strong>
                    </div>
                    <div className="hw-item">
                      <span className="hw-label">Version BIOS</span>
                      <strong className="mono">{hwInfo.biosVersion || "—"}</strong>
                    </div>
                    <div className="hw-item">
                      <span className="hw-label">Date BIOS</span>
                      <strong>{hwInfo.biosDate || "—"}</strong>
                    </div>
                    {hwInfo.serial && (
                      <div className="hw-item hw-item-large">
                        <span className="hw-label">Numéro de série / Service Tag</span>
                        <strong className="mono">{hwInfo.serial}</strong>
                      </div>
                    )}
                  </div>
                )}

                {!hwChargement && hwInfo && (
                  <div className="hw-actions">
                    {fabricantTrouve(hwInfo.manufacturer) ? (
                      <LienExterne
                        className="btn"
                        href={fabricantTrouve(hwInfo.manufacturer)!.url}
                      >
                        <ExternalLink className="icon" aria-hidden="true" /> {fabricantTrouve(hwInfo.manufacturer)!.nom}
                        <span className="sr-only"> (ouvre un nouvel onglet)</span>
                      </LienExterne>
                    ) : (
                      <span className="maj-status">Fabricant non reconnu — utilisez la recherche ci-dessous.</span>
                    )}
                    <LienExterne
                      className="btn"
                      href={`https://www.google.com/search?q=${encodeURIComponent(
                        `${hwInfo.manufacturer} ${hwInfo.model} BIOS update drivers`,
                      )}`}
                    >
                      <Search className="icon" aria-hidden="true" /> Rechercher mises à jour BIOS/pilotes
                      <span className="sr-only"> (ouvre un nouvel onglet)</span>
                    </LienExterne>
                    <button className="btn" onClick={chargerMateriel} disabled={hwChargement}>
                      <RefreshCw className="icon" aria-hidden="true" /> Actualiser
                    </button>
                  </div>
                )}

                {!hwChargement && hwInfo && fabricantTrouve(hwInfo.manufacturer)?.outil && (
                  <p className="cmd-desc">
                    Outil officiel du fabricant (mises à jour pilotes + BIOS) :{" "}
                    {fabricantTrouve(hwInfo.manufacturer)!.outil}. Il est installable depuis
                    l'onglet Applications s'il est disponible via winget.
                  </p>
                )}

                {!hwChargement && hwCharge && (
                  <div className="maj-liste" role="group" aria-label="Périphériques en erreur">
                    <div className="maj-item maj-tous">
                      <strong>
                        Périphériques avec un problème de pilote ({hwProblemes.length})
                      </strong>
                    </div>
                    {hwProblemes.length === 0 && (
                      <p className="maj-status"><CheckCircle2 className="icon ok" aria-hidden="true" /> Tous les périphériques ont un pilote en état de marche.</p>
                    )}
                    {hwProblemes.map((p) => (
                      <div key={p.instanceId} className="maj-item hw-probleme">
                        <span className="maj-nom" title={p.instanceId}>
                          {p.name}
                        </span>
                        <span className="hw-code">
                          code {p.problemCode || "?"}
                          {CODES_PROBLEME[p.problemCode] ? ` — ${CODES_PROBLEME[p.problemCode]}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="modal-actions">
                  <button className="btn" onClick={() => setMajOuverte(false)}>
                    Fermer
                  </button>
                </div>
              </>
            )}

            {majOnglet === "correctifs" && (
              <>
                <p className="cmd-desc">
                  Correctifs prédéfinis pour les problèmes Windows courants : fichiers système
                  corrompus, magasin de composants, disque, réseau. Chaque exécution demande
                  confirmation (quand nécessaire) et s'affiche dans le terminal intégré.
                </p>

                <div className="maj-liste" role="group" aria-label="Correctifs système">
                  {CORRECTIFS_SYSTEME.map((cmd) => {
                    const blocked = cmd.elevation && elevated === false;
                    return (
                      <div key={cmd.commande} className="maj-correctif">
                        <div className="maj-correctif-corps">
                          <strong>{cmd.label}</strong>
                          <p className="cmd-desc">{cmd.description}</p>
                          <code className="cmd-line">{cmd.commande}</code>
                        </div>
                        <button
                          className="btn small"
                          onClick={() => demanderExecution(cmd)}
                          disabled={blocked || runningCmd !== null}
                          title={
                            blocked
                              ? "Nécessite de relancer l'application en administrateur"
                              : cmd.confirme
                                ? "Une confirmation sera demandée"
                                : "Exécuter dans la fenêtre principale"
                          }
                        >
                          blocked ? <Lock className="icon" aria-hidden="true" /> : (<><Play className="icon" aria-hidden="true" /> Exécuter</>)
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="modal-actions">
                  <button className="btn" onClick={() => setMajOuverte(false)}>
                    Fermer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {confirmCmd && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          onClick={() => setConfirmCmd(null)}
        >
          <div className="modal" ref={confirmModalRef} onClick={(e) => e.stopPropagation()}>
            <h3 id="confirm-title"><AlertTriangle className="icon warn" aria-hidden="true" /> Confirmer l'exécution</h3>
            <p>
              Vous êtes sur le point d'exécuter la commande suivante sur ce système :
            </p>
            {confirmCmd.description && (
              <p className="cmd-desc">{confirmCmd.description}</p>
            )}
            <code className="cmd-line">{confirmCmd.commande}</code>
            {confirmCmd.elevation && elevated === false && (
              <p className="modal-warn">
                🔐 Cette commande nécessite des droits administrateur, mais l'application
                n'est pas élevée. Elle échouera probablement.
              </p>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmCmd(null)}>
                Annuler
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const cmd = confirmCmd;
                  setConfirmCmd(null);
                  executerCommande(cmd);
                }}
              >
                <Play className="icon" aria-hidden="true" />
                Exécuter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
