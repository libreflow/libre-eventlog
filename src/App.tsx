import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CriticalEvent, Diagnostic } from "./types";

const CANAUX = ["Tous", "System", "Application"];
const SEVERITES = ["Toutes", "Critique", "Erreur"];

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

export default function App() {
  const [events, setEvents] = useState<CriticalEvent[]>([]);
  const [selected, setSelected] = useState<CriticalEvent | null>(null);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [canal, setCanal] = useState("Tous");
  const [severite, setSeverite] = useState("Toutes");
  const [recherche, setRecherche] = useState("");

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
    try {
      const d = await invoke<Diagnostic>("get_diagnostic", { event: e });
      setDiagnostic(d);
    } catch {
      setDiagnostic({ event: e, fix: null });
    }
  }

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return events.filter((e) => {
      if (canal !== "Tous" && e.canal !== canal) return false;
      if (severite !== "Toutes" && e.severity !== severite) return false;
      if (
        q &&
        !e.provider.toLowerCase().includes(q) &&
        !String(e.eventId).includes(q) &&
        !e.messageRaw.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [events, canal, severite, recherche]);

  return (
    <div className="app">
      <header className="header">
        <h1>🩺 Libre EventLog</h1>
        <p>Événements critiques et erreurs Windows, avec correctifs suggérés</p>
      </header>

      <div className="toolbar">
        <button className="btn primary" onClick={charger} disabled={loading}>
          {loading ? "Chargement…" : "Analyser le journal"}
        </button>
        <select value={canal} onChange={(e) => setCanal(e.target.value)}>
          {CANAUX.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={severite} onChange={(e) => setSeverite(e.target.value)}>
          {SEVERITES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Rechercher (provider, ID, message)…"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
        />
        <span className="count">{filtres.length} événement(s)</span>
      </div>

      {error && <div className="error">⚠️ {error}</div>}

      <div className="layout">
        <table className="events-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Canal</th>
              <th>Source</th>
              <th>ID</th>
              <th>Sévérité</th>
            </tr>
          </thead>
          <tbody>
            {filtres.map((e, i) => (
              <tr
                key={`${e.timestamp}-${i}`}
                className={selected === e ? "selected" : ""}
                onClick={() => selectionner(e)}
              >
                <td>{formatDate(e.timestamp)}</td>
                <td>{e.canal}</td>
                <td>{e.provider}</td>
                <td>{e.eventId}</td>
                <td>
                  <span className={`badge ${e.level === 1 ? "critique" : "erreur"}`}>
                    {e.severity}
                  </span>
                </td>
              </tr>
            ))}
            {filtres.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  Aucun événement. Cliquez sur « Analyser le journal ».
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <aside className="detail">
          {!selected && <p className="empty">Sélectionnez un événement pour voir le diagnostic.</p>}
          {selected && (
            <>
              <h2>{selected.provider} — {selected.eventId}</h2>
              <p className="meta">
                {formatDate(selected.timestamp)} · {selected.canal} ·{" "}
                <span className={`badge ${selected.level === 1 ? "critique" : "erreur"}`}>
                  {selected.severity}
                </span>
              </p>

              <div className="raw">
                <h3>Message brut</h3>
                <pre>{selected.messageRaw || "Aucun message."}</pre>
              </div>

              <div className="fix">
                <h3>Diagnostic</h3>
                {diagnostic === null && <p>Analyse…</p>}
                {diagnostic && !diagnostic.fix && (
                  <div>
                    <p>
                      Aucun correctif connu pour cet événement. Consultez la
                      base Microsoft.
                    </p>
                    <a
                      className="btn"
                      href={lienRecherche(selected)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      🔍 Rechercher sur support.microsoft.com
                    </a>
                  </div>
                )}
                {diagnostic?.fix && (
                  <div>
                    <h4>{diagnostic.fix.titre}</h4>
                    <p className="cause">{diagnostic.fix.cause}</p>
                    <ol>
                      {diagnostic.fix.etapes.map((etape, i) => (
                        <li key={i}>{etape}</li>
                      ))}
                    </ol>
                    <span className="badge categorie">{diagnostic.fix.categorie}</span>
                    <a
                      className="btn"
                      href={lienRecherche(selected)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      🔍 Plus d'infos (support.microsoft.com)
                    </a>
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
