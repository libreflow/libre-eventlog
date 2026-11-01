import { useMemo } from "react";
import { AlertTriangle, Layers } from "lucide-react";
import type { CriticalEvent } from "../types";
import { formatDate, grouperProblemes, severityClass } from "../lib/evenements";

// Vue alternative de la liste : une ligne par problème (provider + eventId)
// plutôt qu'une ligne par événement. Clic sur une ligne = filtre la vue
// événements sur ce problème (provider + eventId), comme l'audit de santé.
export function VueProblemes({
  events,
  totalFiltres,
  onFiltreProbleme,
}: {
  events: CriticalEvent[];
  totalFiltres: number;
  onFiltreProbleme: (provider: string, eventId: number) => void;
}) {
  const problemes = useMemo(() => grouperProblemes(events), [events]);

  return (
    <div
      className="table-wrap"
      role="region"
      aria-label="Problèmes agrégés"
    >
      <table className="events-table">
        <thead>
          <tr>
            <th scope="col">
              <button className="sort-btn" type="button">
                Sévérité
              </button>
            </th>
            <th scope="col">Occurrences</th>
            <th scope="col">Problème</th>
            <th scope="col" className="align-right">ID</th>
            <th scope="col">Dernière occurrence</th>
          </tr>
        </thead>
        <tbody>
          {problemes.map((p) => (
            <tr
              key={`${p.provider}-${p.eventId}`}
              className={p.level === 1 ? "niveau-critique" : ""}
              tabIndex={0}
              onClick={() => onFiltreProbleme(p.provider, p.eventId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onFiltreProbleme(p.provider, p.eventId);
                }
              }}
              title="Filtrer la vue événements sur ce problème"
            >
              <td>
                <span className={`badge ${severityClass({ level: p.level })}`}>
                  <span className="badge-point" aria-hidden="true" />
                  {p.level === 1 ? "Critique" : p.level === 2 ? "Erreur" : "Avertissement"}
                </span>
              </td>
              <td className="mono align-right">{p.count}×</td>
              <td title={p.provider}>{p.provider}</td>
              <td className="mono align-right">{p.eventId}</td>
              <td className="mono">{formatDate(p.dernierIso)}</td>
            </tr>
          ))}
          {problemes.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-state">
                <span className="icon-circle">
                  <Layers className="icon" aria-hidden="true" />
                </span>
                <strong>Aucun événement à agréger</strong>
                <span>
                  Lancez « Analyser le journal » : les {totalFiltres > 0 ? `${totalFiltres} événement(s) filtré(s)` : "événements"} se regrouperont par problème.
                </span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {problemes.length > 0 && (
        <p className="warn-banner" style={{ borderTop: "none" }}>
          <AlertTriangle className="icon warn" aria-hidden="true" /> {problemes.length} problème(s) distinct(s) —{" "}
          {totalFiltres} événement(s). Cliquez un problème pour filtrer la vue détaillée.
        </p>
      )}
    </div>
  );
}
