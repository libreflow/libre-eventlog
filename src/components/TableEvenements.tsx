import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Inbox, Loader2 } from "lucide-react";
import type { CriticalEvent } from "../types";
import { COLONNES } from "../lib/catalogue";
import type { SortDir, SortKey } from "../lib/catalogue";
import { cleJourLocal, formatDate, libelleJour, severityClass } from "../lib/evenements";
import { fenetreVisible } from "../lib/virtualisation";

// Hauteur fixe des lignes (événements ET en-têtes de jour) : condition de
// la virtualisation — pas de mesure par ligne.
const HAUTEUR_LIGNE = 40;
// Lignes rendues au-delà du viewport, de part et d'autre.
const SURDIMENSION = 10;

type LigneVirtuelle =
  | { type: "jour"; cle: string }
  | { type: "evenement"; e: CriticalEvent; i: number };

// Table des événements virtualisée : seules les lignes visibles (plus le
// surdimensionnement) existent dans le DOM — jusqu'à ~2 500 événements
// collectés en flux quasi continu. Des lignes d'espacement haut/bas
// conservent la hauteur de défilement réelle, la sémantique <table>
// (aria-sort, scope) et l'en-tête collant.
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
  const conteneurRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [hauteurViewport, setHauteurViewport] = useState(600);

  useEffect(() => {
    const el = conteneurRef.current;
    if (el) setHauteurViewport(el.clientHeight);
  }, []);
  useEffect(() => {
    const maj = () => {
      const el = conteneurRef.current;
      if (el) setHauteurViewport(el.clientHeight);
    };
    window.addEventListener("resize", maj);
    return () => window.removeEventListener("resize", maj);
  }, []);

  // Aplatissement événements + en-têtes de jour : une seule liste
  // virtualisée (le regroupement ne s'affiche que dans le tri par date).
  const lignes = useMemo<LigneVirtuelle[]>(() => {
    const out: LigneVirtuelle[] = [];
    filtres.forEach((e, i) => {
      if (sortKey === "timestamp") {
        const cleJour = cleJourLocal(e.timestamp);
        if (i === 0 || cleJourLocal(filtres[i - 1].timestamp) !== cleJour) {
          out.push({ type: "jour", cle: cleJour });
        }
      }
      out.push({ type: "evenement", e, i });
    });
    return out;
  }, [filtres, sortKey]);

  const [debut, fin] = fenetreVisible(
    scrollTop,
    hauteurViewport,
    lignes.length,
    HAUTEUR_LIGNE,
    SURDIMENSION,
  );

  const ligneEspacement = (hauteur: number, cle: string) =>
    hauteur > 0 ? (
      <tr key={cle} aria-hidden="true" style={{ height: `${hauteur}px` }}>
        <td colSpan={5} style={{ padding: 0, border: 0 }} />
      </tr>
    ) : null;

  return (
    <div
      className="table-wrap"
      role="region"
      aria-label="Liste des événements"
      onKeyDown={onNaviguerClavier}
      ref={conteneurRef}
      onScroll={(ev) => setScrollTop(ev.currentTarget.scrollTop)}
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
          {ligneEspacement(debut * HAUTEUR_LIGNE, "espace-haut")}
          {lignes.slice(debut, fin).map((ligne) => {
            if (ligne.type === "jour") {
              return (
                <tr key={`jour-${ligne.cle}`} className="groupe-jour">
                  <td colSpan={5}>{libelleJour(ligne.cle)}</td>
                </tr>
              );
            }
            const e = ligne.e;
            return (
              <tr
                key={`${e.recordId}-${e.canal}-${e.timestamp}-${ligne.i}`}
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
              </tr>
            );
          })}
          {ligneEspacement((lignes.length - fin) * HAUTEUR_LIGNE, "espace-bas")}
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
