import { useRef } from "react";
import { Check, Copy, Download, HeartPulse, Loader2 } from "lucide-react";
import type { AuditSante } from "../types";
import { Anneau } from "./Anneau";
import { usePiegeFocus } from "../hooks/usePiegeFocus";
import { severityClass } from "../lib/evenements";
import { clePlanAction } from "../lib/rapport";
import type { EntreeAudit } from "../lib/audits";

// Modale d'audit de santé : anneau de score global, jauges par catégorie,
// problèmes agrégés avec plan d'action cochable, rapport Markdown.
export function ModaleAudit({
  audit,
  chargement,
  planAction,
  onToggleEtape,
  onFermer,
  onFiltreProbleme,
  onCopier,
  rapportCopie,
  onTelecharger,
  historique,
  evolutionPrecedente,
}: {
  audit: AuditSante | null;
  chargement: boolean;
  planAction: Record<string, boolean>;
  onToggleEtape: (cle: string) => void;
  onFermer: () => void;
  onFiltreProbleme: (eventId: number) => void;
  onCopier: () => void;
  rapportCopie: boolean;
  onTelecharger: () => void;
  historique: EntreeAudit[];
  evolutionPrecedente: number | null;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  usePiegeFocus(modalRef, true);
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-title"
      onClick={() => !chargement && onFermer()}
    >
      <div className="modal modal-maj" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <h3 id="audit-title">
          <HeartPulse className="icon" aria-hidden="true" /> Audit de santé
        </h3>

        {chargement && (
          <p className="maj-status">
            <Loader2 className="icon spin" aria-hidden="true" /> Collecte et agrégation des événements…
          </p>
        )}

        {!chargement && audit && (
          <>
            <p className="cmd-desc">
              {audit.totalEvenements} événement(s) analysé(s) le {audit.genereLe}.
              Le score pénalise chaque problème par gravité et par nombre d'occurrences.
            </p>

            <div className="audit-entete">
              <Anneau score={audit.global} taille={116} gros />
              {historique.length > 1 && <SparklineAudits historique={historique} />}
              <div className="audit-entete-texte">
                <strong>Score global de santé</strong>
                <span>
                  {audit.totalEvenements} événement(s) analysé(s) — {audit.problemes.length} problème(s) distinct(s)
                </span>
                <span className="audit-date">{audit.genereLe}</span>
                {evolutionPrecedente != null && (
                  <span
                    className={
                      evolutionPrecedente > 0 ? "audit-tendance hausse" : evolutionPrecedente < 0 ? "audit-tendance baisse" : "audit-tendance stable"
                    }
                  >
                    {evolutionPrecedente > 0
                      ? `+${evolutionPrecedente} pt vs audit précédent`
                      : evolutionPrecedente < 0
                        ? `${evolutionPrecedente} pt vs audit précédent`
                        : "score stable"}
                  </span>
                )}
                {historique.length > 1 && (
                  <span className="audit-historique">
                    Précédents : {historique.slice(1, 5).map((e) => `${e.date} (${e.global})`).join(" · ")}
                  </span>
                )}
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
                        <span className={`badge ${severityClass({ level: p.level })}`}>
                          {p.count}×
                        </span>
                        <button
                          className="audit-probleme-titre"
                          onClick={() => onFiltreProbleme(p.eventId)}
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
                                    onChange={() => onToggleEtape(cleEtape)}
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
              <button className="btn" onClick={onFermer}>
                Fermer
              </button>
              <button className="btn" onClick={onCopier}>
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
              <button className="btn primary" onClick={onTelecharger}>
                <Download className="icon" aria-hidden="true" /> Télécharger (.md)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


// Sparkline des scores globaux (20 derniers audits, ordre chronologique).
function SparklineAudits({ historique }: { historique: EntreeAudit[] }) {
  const points = [...historique].slice(0, 20).reverse();
  const largeur = 120;
  const hauteur = 40;
  const pas = points.length > 1 ? largeur / (points.length - 1) : 0;
  const coords = points
    .map((e, i) => `${(i * pas).toFixed(1)},${(hauteur - (e.global / 100) * hauteur).toFixed(1)}`)
    .join(" ");
  const dernier = points[points.length - 1];
  return (
    <svg
      width={largeur}
      height={hauteur}
      className="audit-sparkline"
      role="img"
      aria-label={`Évolution du score : ${points.map((p) => p.global).join(", ")}`}
    >
      <polyline
        points={coords}
        fill="none"
        stroke={dernier.global >= 80 ? "var(--ok)" : dernier.global >= 50 ? "var(--warn)" : "var(--danger)"}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
