import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CriticalEvent, Diagnostic } from "./types";

const CANAUX = ["Tous", "System", "Application"] as const;
const SEVERITES = ["Toutes", "Critique", "Erreur"] as const;

type SortKey = "timestamp" | "canal" | "provider" | "eventId" | "severity";
type SortDir = "asc" | "desc";

const COLONNES: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "timestamp", label: "Date" },
  { key: "canal", label: "Canal" },
  { key: "provider", label: "Source" },
  { key: "eventId", label: "ID", align: "right" },
  { key: "severity", label: "Sévérité" },
];

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

  useEffect(() => {
    document.title =
      selected
        ? `${selected.provider} (${selected.eventId}) — Libre EventLog`
        : "Libre EventLog";
  }, [selected]);

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
    setSelected(e);
    setDiagnostic(null);
    setDiagLoading(true);
    try {
      const d = await invoke<Diagnostic>("get_diagnostic", { event: e });
      setDiagnostic(d);
    } catch {
      setDiagnostic({ event: e, fix: null });
    } finally {
      setDiagLoading(false);
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
          <span className="logo" aria-hidden="true">🩺</span>
          <div>
            <h1>Libre EventLog</h1>
            <p>Événements critiques et erreurs Windows, avec correctifs suggérés</p>
          </div>
        </div>
        <div className="stats" role="status">
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

      <div className="layout">
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
              <span className="detail-icon" aria-hidden="true">📋</span>
              <p>Sélectionnez un événement pour voir le diagnostic.</p>
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
                      Aucun correctif connu pour cet événement. Consultez la base
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
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
