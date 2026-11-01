import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Plus, Radio, X } from "lucide-react";
import { usePiegeFocus } from "../hooks/usePiegeFocus";

// Canaux utiles pré-proposés (noms réels vérifiés par wevtutil el).
const CANAUX_PREDEFINIS: { canal: string; description: string }[] = [
  {
    canal: "Microsoft-Windows-Windows Defender/Operational",
    description: "Menaces détectées, analyses antivirus",
  },
  {
    canal: "Microsoft-Windows-NetworkProfile/Operational",
    description: "Connexions et profils réseau",
  },
  {
    canal: "Microsoft-Windows-SMBClient/Operational",
    description: "Partages et fichiers réseau",
  },
  {
    canal: "Microsoft-Windows-Bits-Client/Operational",
    description: "Téléchargements (Windows Update)",
  },
];

// Modale des canaux personnalisés : canaux utiles cochables, saisie libre,
// liste courante avec retrait. Un canal absent de la machine est signalé
// par un bandeau d'avertissement à la collecte, jamais bloquant.
export function ModaleCanaux({
  canaux,
  onFermer,
  onEnregistrer,
}: {
  canaux: string[];
  onFermer: () => void;
  onEnregistrer: (liste: string[]) => void;
}) {
  const [liste, setListe] = useState<string[]>(canaux);
  const [saisie, setSaisie] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  usePiegeFocus(modalRef, true);

  useEffect(() => {
    setListe(canaux);
  }, [canaux]);

  const basculer = (canal: string) => {
    setListe((l) =>
      l.includes(canal) ? l.filter((c) => c !== canal) : [...l, canal],
    );
  };

  const ajouterSaisie = () => {
    const canal = saisie.trim();
    if (canal && !liste.includes(canal)) {
      setListe((l) => [...l, canal]);
    }
    setSaisie("");
  };

  const predefinis = new Set(CANAUX_PREDEFINIS.map((c) => c.canal));
  const libres = liste.filter((c) => !predefinis.has(c));

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="canaux-title"
    >
      <div className="modal" ref={modalRef}>
        <h3 id="canaux-title">
          <Radio className="icon" aria-hidden="true" /> Canaux supplémentaires
        </h3>
        <p className="cmd-desc">
          Ces canaux s'ajoutent à ceux couverts par défaut (System, Application,
          Security si administrateur, WHEA-Logger, Diagnostics-Performance). Un
          canal indisponible sur cette machine est signalé à la collecte, sans
          bloquer les autres.
        </p>

        <div className="maj-liste" role="group" aria-label="Canaux utiles">
          {CANAUX_PREDEFINIS.map((c) => (
            <label key={c.canal} className="maj-item">
              <input
                type="checkbox"
                checked={liste.includes(c.canal)}
                onChange={() => basculer(c.canal)}
              />
              <span className="maj-nom" title={c.canal}>
                {c.canal}
              </span>
              <span className="hw-code">{c.description}</span>
            </label>
          ))}
          {libres.map((c) => (
            <label key={c} className="maj-item">
              <input
                type="checkbox"
                checked={liste.includes(c)}
                onChange={() => basculer(c)}
              />
              <span className="maj-nom" title={c}>
                {c}
              </span>
              <button
                className="btn small"
                onClick={() => setListe((l) => l.filter((x) => x !== c))}
                title="Retirer ce canal de la liste"
                aria-label={`Retirer ${c}`}
              >
                <X className="icon" aria-hidden="true" />
              </button>
            </label>
          ))}
        </div>

        <div className="search" style={{ marginTop: 10, minWidth: 0 }}>
          <input
            type="text"
            value={saisie}
            placeholder="Nom de canal exact (ex. Microsoft-Windows-Dhcp-Client/Operational)…"
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                ajouterSaisie();
              }
            }}
            aria-label="Ajouter un canal libre"
          />
          <button className="btn small" onClick={ajouterSaisie} disabled={!saisie.trim()}>
            <Plus className="icon" aria-hidden="true" /> Ajouter
          </button>
        </div>

        {liste.length === 0 && (
          <p className="maj-status">
            <CheckCircle2 className="icon ok" aria-hidden="true" /> Aucun canal
            supplémentaire : la collecte couvre les canaux par défaut.
          </p>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onFermer}>
            Annuler
          </button>
          <button
            className="btn primary"
            onClick={() => {
              onEnregistrer(liste);
              onFermer();
            }}
          >
            Enregistrer et re-collecter ({liste.length})
          </button>
        </div>
      </div>
    </div>
  );
}
