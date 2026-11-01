import { useRef } from "react";
import { AlertTriangle, Play } from "lucide-react";
import type { CommandeFix } from "../types";
import { usePiegeFocus } from "../hooks/usePiegeFocus";

// Confirmation d'exécution d'une commande : description, commande brute,
// avertissement d'élévation si l'app n'est pas élevée. Le piège de focus
// et la restauration du focus sont gérés par le hook.
export function ModaleConfirmation({
  cmd,
  elevated,
  onAnnuler,
  onExecuter,
}: {
  cmd: CommandeFix;
  elevated: boolean | null;
  onAnnuler: () => void;
  onExecuter: (cmd: CommandeFix) => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  usePiegeFocus(modalRef, true);
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div className="modal" ref={modalRef}>
        <h3 id="confirm-title"><AlertTriangle className="icon warn" aria-hidden="true" /> Confirmer l'exécution</h3>
        <p>
          Vous êtes sur le point d'exécuter la commande suivante sur ce système :
        </p>
        {cmd.description && <p className="cmd-desc">{cmd.description}</p>}
        <code className="cmd-line">{cmd.commande}</code>
        {cmd.elevation && elevated === false && (
          <p className="modal-warn">
            🔐 Cette commande nécessite des droits administrateur, mais l'application
            n'est pas élevée. Elle échouera probablement.
          </p>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onAnnuler}>
            Annuler
          </button>
          <button
            className="btn primary"
            onClick={() => onExecuter(cmd)}
          >
            <Play className="icon" aria-hidden="true" />
            Exécuter
          </button>
        </div>
      </div>
    </div>
  );
}
