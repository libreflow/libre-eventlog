import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, CommandeFix, CriticalEvent, Diagnostic } from "./types";

const CANAUX = ["Tous", "System", "Application"] as const;
const SEVERITES = ["Toutes", "Critique", "Erreur"] as const;

// Maintenance intégrée : mise à jour de toutes les applications via winget,
// purge des installateurs résiduels et détection des anciennes versions.
// `commande` est purement indicative : l'exécution passe par la commande
// Tauri dédiée `update_applications` (voir executerCommande).
const MAJ_APPS: CommandeFix = {
  label: "Mettre à jour toutes les applications",
  description:
    "winget upgrade --all, purge des installateurs résiduels et détection des anciennes versions",
  commande: "winget upgrade --all --silent (maintenance intégrée)",
  type: "action",
  elevation: true,
  confirme: true,
};

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
  const nextId = useRef(1);
  const termRef = useRef<HTMLDivElement>(null);
  const diagSeq = useRef(0);

  useEffect(() => {
    invoke<boolean>("check_elevation")
      .then(setElevated)
      .catch(() => setElevated(false));
  }, []);

  useEffect(() => {
    if (!confirmCmd) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setConfirmCmd(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmCmd]);

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
      const res =
        cmd === MAJ_APPS
          ? await invoke<CommandResult>("update_applications")
          : await invoke<CommandResult>("run_diagnostic_command", {
              commande: cmd.commande,
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
          onClick={() => demanderExecution(MAJ_APPS)}
          disabled={elevated === false || runningCmd !== null}
          title={
            elevated === false
              ? "Nécessite de relancer l'application en administrateur"
              : "Met à jour toutes les applications via winget, purge les installateurs résiduels et liste les anciennes versions (peut prendre plusieurs minutes)"
          }
        >
          {elevated === false ? "🔒" : "⬆"} Mettre à jour les apps
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
