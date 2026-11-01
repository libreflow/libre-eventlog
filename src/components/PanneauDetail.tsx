import { ExternalLink, FileSearch, Loader2, Lock, Play, Search, AlertTriangle } from "lucide-react";
import type { CriticalEvent, Diagnostic } from "../types";
import { LienExterne } from "./LienExterne";
import { formatDate, lienRecherche, severityClass } from "../lib/evenements";
import { cleCommande } from "../lib/catalogue";

// Panneau détail : événement sélectionné (en-tête teinté par sévérité,
// chips méta), message brut, diagnostic (titre, cause, étapes) et
// correctifs exécutables avec leurs garde-fous (élévation, confirmation).
export function PanneauDetail({
  selected,
  diagnostic,
  diagLoading,
  elevated,
  runningCmd,
  onDemanderExecution,
  detailRef,
}: {
  selected: CriticalEvent | null;
  diagnostic: Diagnostic | null;
  diagLoading: boolean;
  elevated: boolean | null;
  runningCmd: string | null;
  onDemanderExecution: (cmd: import("../types").CommandeFix) => void;
  detailRef: React.RefObject<HTMLElement | null>;
}) {
  return (
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
                              onClick={() => onDemanderExecution(cmd)}
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
  );
}
