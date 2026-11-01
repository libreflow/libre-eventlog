import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  CommandResult,
  CommandeFix,
  CriticalEvent,
  Diagnostic,
  WinUpdate,
  WingetPackage,
} from "./types";

const CANAUX = ["Tous", "System", "Application"] as const;
const SEVERITES = ["Toutes", "Critique", "Erreur"] as const;

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
      "réinitialise Winsock et le cache ARP — utile après une infection ou des soucis réseau. ⚠️ Redémarrage requis pour Winsock ; la connexion peut être brièvement coupée pendant l'opération",
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

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });
}

function lienRecherche(e: CriticalEvent): string {
  const q = `${e.provider} ${e.eventId}`;
  return `https://support.microsoft.com/results?q=${encodeURIComponent(q)}`;
}

function severityClass(e: CriticalEvent): string {
  return e.level === 1 ? "critique" : "erreur";
}

export default function App() {
  const [events, setEvents] = useState<CriticalEvent[]>([]);
  const [selected, setSelected] = useState<CriticalEvent | null>(null);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
  const [runningCmd, setRunningCmd] = useState<string | null>(null);
  const [majOuverte, setMajOuverte] = useState(false);
  const [majChargement, setMajChargement] = useState(false);
  const [majPaquets, setMajPaquets] = useState<WingetPackage[]>([]);
  const [majSelection, setMajSelection] = useState<Set<string>>(new Set());
  const [majOnglet, setMajOnglet] = useState<"apps" | "windows" | "correctifs">("apps");
  const [wuPaquets, setWuPaquets] = useState<WinUpdate[]>([]);
  const [wuSelection, setWuSelection] = useState<Set<string>>(new Set());
  const [wuChargement, setWuChargement] = useState(false);
  const [wuScanFait, setWuScanFait] = useState(false);
  const nextId = useRef(1);
  const termRef = useRef<HTMLDivElement>(null);
  const diagSeq = useRef(0);

  useEffect(() => {
    invoke<boolean>("check_elevation")
      .then(setElevated)
      .catch(() => setElevated(false));
  }, []);

  useEffect(() => {
    if (!confirmCmd && !majOuverte) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setConfirmCmd(null);
        setMajOuverte(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmCmd, majOuverte]);

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

  async function charger() {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<CriticalEvent[]>("get_critical_events");
      setEvents(result);
      setSelected(null);
      setDiagnostic(null);
    } catch (e) {
      setError(String(e));
      setEvents([]);
    } finally {
      setLoading(false);
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
    setWuScanFait(true);
    try {
      const res = await invoke<WinUpdate[]>("list_windows_updates");
      setWuPaquets(res);
      setWuSelection(new Set(res.map((u) => u.updateId)));
    } catch (e) {
      setWuPaquets([]);
      setError(String(e));
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
  const nbErreurs = filtres.length - nbCritiques;

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src="/icon.svg" alt="" className="logo-img" aria-hidden="true" />
          <div>
            <h1>Libre EventLog</h1>
            <p>Événements critiques et erreurs Windows, avec correctifs suggérés</p>
          </div>
        </div>
        <div className="stats" role="status">
          <span
            className={`stat ${elevated === false ? "muted" : elevated ? "admin" : ""}`}
            title={
              elevated === null
                ? "Vérification des droits…"
                : elevated
                  ? "Application lancée en administrateur : toutes les commandes sont disponibles"
                  : "Application non élevée : les commandes marquées 🔐 nécessitent un relancement en administrateur"
            }
          >
            {elevated === null ? "⏳ Droits…" : elevated ? "🔐 Administrateur" : "⛔ Mode limité"}
          </span>
          <span className="stat critique">
            <strong>{nbCritiques}</strong> critique{nbCritiques > 1 ? "s" : ""}
          </span>
          <span className="stat erreur">
            <strong>{nbErreurs}</strong> erreur{nbErreurs > 1 ? "s" : ""}
          </span>
          {events.length > 0 && (
            <span className="stat muted">
              {filtres.length} / {events.length} affiché{filtres.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </header>

      <div className="toolbar">
        <button className="btn primary" onClick={charger} disabled={loading}>
          {loading ? "Chargement…" : "Analyser le journal"}
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
          {elevated === false ? "🔒" : "🛠"} Maintenance
        </button>
        <select value={canal} onChange={(e) => setCanal(e.target.value)} aria-label="Filtrer par canal">
          {CANAUX.map((c) => (
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
        <div className="search">
          <span className="search-icon" aria-hidden="true">🔍</span>
          <input
            type="search"
            placeholder="Rechercher (provider, ID, message)…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            aria-label="Rechercher un événement"
          />
          {recherche && (
            <button className="search-clear" onClick={() => setRecherche("")} aria-label="Effacer la recherche">
              ✕
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          ⚠️ {error}
        </div>
      )}

      <div className={`layout ${terminalOuvert ? "avec-terminal" : ""}`}>
        <div className="table-wrap" role="region" aria-label="Liste des événements">
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
                        {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtres.map((e, i) => (
                <tr
                  key={`${e.timestamp}-${e.provider}-${i}`}
                  className={selected === e ? "selected" : ""}
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
                      {e.severity === "Critique" ? "●" : "▲"} {e.severity}
                    </span>
                  </td>
                </tr>
              ))}
              {filtres.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} className="empty">
                    {events.length === 0
                      ? "Aucun événement. Cliquez sur « Analyser le journal »."
                      : "Aucun résultat pour ces filtres."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="detail" aria-live="polite">
          {!selected && (
            <div className="detail-empty">
              <img src="/icon.svg" alt="" className="detail-logo" aria-hidden="true" />
              <p>Sélectionnez un événement pour voir le diagnostic et les correctifs exécutables.</p>
            </div>
          )}
          {selected && (
            <>
              <h2>
                {selected.provider} <span className="mono">— {selected.eventId}</span>
              </h2>
              <p className="meta">
                {formatDate(selected.timestamp)} · {selected.canal} ·{" "}
                <span className={`badge ${severityClass(selected)}`}>{selected.severity}</span>
              </p>

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
                      Aucun correctif connu pour cet événément. Consultez la base
                      Microsoft.
                    </p>
                    <a
                      className="btn"
                      href={lienRecherche(selected)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      🔍 Rechercher sur support.microsoft.com
                      <span className="sr-only"> (ouvre un nouvel onglet)</span>
                    </a>
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
                      <a
                        className="btn"
                        href={lienRecherche(selected)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        🔍 Plus d'infos (support.microsoft.com)
                        <span className="sr-only"> (ouvre un nouvel onglet)</span>
                      </a>
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
                                  {running ? "⏳…" : blocked ? "🔒" : "▶ Exécuter"}
                                </button>
                              </div>
                              <code className="cmd-line">{cmd.commande}</code>
                              {cmd.confirme && !blocked && (
                                <span className="cmd-flag">⚠️ Confirmation requise</span>
                              )}
                              {cmd.elevation && !blocked && (
                                <span className="cmd-flag">🔐 Droits administrateur</span>
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
        <div className="terminal" role="region" aria-label="Terminal des commandes exécutées">
          <div className="terminal-head">
            <span className="terminal-title">⌨ Terminal — exécution PowerShell</span>
            <div className="terminal-actions">
              <button
                className="btn small"
                onClick={() => setTerminal([])}
                disabled={terminal.length === 0}
              >
                Effacer
              </button>
              <button className="btn small" onClick={() => setTerminalOuvert(false)}>
                ✕ Réduire
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
            {terminal.map((entry) => (
              <div key={entry.id} className="term-entry">
                <div className="term-cmd-line">
                  <span className="term-time">{entry.time}</span>
                  <span className="term-label">{entry.label}</span>
                </div>
                <code className="cmd-line">{entry.commande}</code>
                {entry.running && <p className="term-status">⏳ Exécution en cours…</p>}
                {entry.error && <pre className="term-err">{entry.error}</pre>}
                {entry.result && (
                  <>
                    {entry.result.stdout && (
                      <pre className="term-out">{entry.result.stdout}</pre>
                    )}
                    {entry.result.stderr && (
                      <pre className="term-err">{entry.result.stderr}</pre>
                    )}
                    <p className="term-status">
                      {entry.result.exitCode === 0 ? "✅" : "❌"} Terminé en{" "}
                      {entry.result.durationMs} ms — code {entry.result.exitCode ?? "?"}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!terminalOuvert && terminal.length > 0 && (
        <button className="btn terminal-restore" onClick={() => setTerminalOuvert(true)}>
          ⌨ Terminal ({terminal.length})
        </button>
      )}

      {majOuverte && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="maj-title"
          onClick={() => !majChargement && setMajOuverte(false)}
        >
          <div className="modal modal-maj" onClick={(e) => e.stopPropagation()}>
            <h3 id="maj-title">🛠 Maintenance</h3>

            <div className="maj-onglets" role="tablist" aria-label="Sections de maintenance">
              {(
                [
                  ["apps", "Applications"],
                  ["windows", "Windows & pilotes"],
                  ["correctifs", "Correctifs système"],
                ] as const
              ).map(([cle, libelle]) => (
                <button
                  key={cle}
                  role="tab"
                  aria-selected={majOnglet === cle}
                  className={`maj-onglet ${majOnglet === cle ? "actif" : ""}`}
                  onClick={() => setMajOnglet(cle)}
                >
                  {libelle}
                </button>
              ))}
            </div>

            {majOnglet === "apps" && (
              <>
                <p className="cmd-desc">{MAJ_APPS.description}</p>

                {majChargement && (
                  <p className="maj-status">⏳ Recherche des mises à jour disponibles…</p>
                )}

                {!majChargement && majPaquets.length === 0 && (
                  <p className="maj-status">✅ Aucune mise à jour d'application disponible. Tout est à jour !</p>
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
                    ⬆ Mettre à jour ({majSelection.size})
                  </button>
                </div>
              </>
            )}

            {majOnglet === "windows" && (
              <>
                <p className="cmd-desc">
                  Mises à jour Windows et pilotes via l'agent Windows Update (WSUS/Windows Update
                  configuré sur la machine). Le scan peut prendre plusieurs minutes ; les pilotes
                  sont marqués 🔧.
                </p>

                {wuChargement && (
                  <p className="maj-status">⏳ Recherche des mises à jour Windows et pilotes…</p>
                )}

                {!wuChargement && !wuScanFait && (
                  <p className="maj-status">
                    Lancez une recherche pour afficher les mises à jour Windows et pilotes disponibles.
                  </p>
                )}

                {!wuChargement && wuScanFait && wuPaquets.length === 0 && (
                  <p className="maj-status">✅ Aucune mise à jour Windows ni pilote en attente.</p>
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
                          {u.kind === "Driver" ? "🔧 " : ""}
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
                    🔄 Rechercher
                  </button>
                  <button
                    className="btn primary"
                    disabled={wuChargement || wuSelection.size === 0 || runningCmd !== null}
                    onClick={() => executerWuInstall([...wuSelection])}
                  >
                    ⬇ Installer ({wuSelection.size})
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
                          {blocked ? "🔒" : "▶ Exécuter"}
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
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="confirm-title">⚠️ Confirmer l'exécution</h3>
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
                ▶ Exécuter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
