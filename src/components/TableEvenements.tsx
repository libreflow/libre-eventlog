import { ChevronDown, ChevronUp, Inbox, Loader2 } from "lucide-react";
import type { CriticalEvent } from "../types";
import { COLONNES } from "../lib/catalogue";
import type { SortDir, SortKey } from "../lib/catalogue";
import { cleJourLocal, formatDate, libelleJour, severityClass } from "../lib/evenements";

// Table des événements : en-têtes triables (aria-sort), regroupement par
// jour local dans le tri par date, navigation clavier (Flèches sur le
// conteneur, Enter/Espace sur une ligne), états vide et chargement.
export function TableEvenements({
  filtres,
  totalEvenements,
  selected,
  sortKey,
  sortDir,
  loading,
  onTrier,
  onSelectionner,
  onNaviguerClavier,
}: {
  filtres: CriticalEvent[];
  totalEvenements: number;
  selected: CriticalEvent | null;
  sortKey: SortKey;
  sortDir: SortDir;
  loading: boolean;
  onTrier: (key: SortKey) => void;
  onSelectionner: (e: CriticalEvent) => void;
  onNaviguerClavier: (e: React.KeyboardEvent) => void;
}) {
  return (
    <div
      className="table-wrap"
      role="region"
      aria-label="Liste des événements"
      onKeyDown={onNaviguerClavier}
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
                <button className="sort-btn" onClick={() => onTrier(col.key)}>
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
                onClick={() => onSelectionner(e)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    onSelectionner(e);
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
                  {totalEvenements === 0
                    ? "Aucun événement collecté"
                    : "Aucun résultat"}
                </strong>
                <span>
                  {totalEvenements === 0
                    ? "Lancez « Analyser le journal » pour collecter les événements critiques et erreurs de la machine."
                    : "Aucun événement ne correspond à ces filtres."}
                </span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
