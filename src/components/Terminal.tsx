import type { RefObject } from "react";
import {
  CheckCircle2,
  Copy,
  Loader2,
  TerminalSquare,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { CommandResult } from "../types";
import { copierTexte } from "../lib/pressepapiers";

export interface TerminalEntry {
  id: number;
  label: string;
  commande: string;
  result: CommandResult | null;
  error: string | null;
  running: boolean;
  time: string;
}

// Terminal intégré : historique horodaté des commandes exécutées, sortie
// brute, codes de sortie, redimensionnement par poignée et bouton de
// restauration flottant quand il est réduit.
export function Terminal({
  ouvert,
  onOuvrir,
  onFermer,
  onEffacer,
  hauteur,
  entries,
  termRef,
  onCommencerRedimension,
  onBougerRedimension,
  onFinirRedimension,
}: {
  ouvert: boolean;
  onOuvrir: () => void;
  onFermer: () => void;
  onEffacer: () => void;
  hauteur: number;
  entries: TerminalEntry[];
  termRef: RefObject<HTMLDivElement | null>;
  onCommencerRedimension: (e: React.PointerEvent) => void;
  onBougerRedimension: (e: React.PointerEvent) => void;
  onFinirRedimension: () => void;
}) {
  if (!ouvert) {
    if (entries.length === 0) return null;
    return (
      <button className="btn terminal-restore" onClick={onOuvrir}>
        <TerminalSquare className="icon" aria-hidden="true" /> Terminal ({entries.length})
      </button>
    );
  }
  return (
    <div
      className="terminal"
      role="log"
      aria-label="Terminal des commandes exécutées"
      style={{ flexBasis: hauteur }}
    >
      <div
        className="terminal-poignee"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Redimensionner le terminal"
        onPointerDown={onCommencerRedimension}
        onPointerMove={onBougerRedimension}
        onPointerUp={onFinirRedimension}
        onPointerCancel={onFinirRedimension}
      />
      <div className="terminal-head">
        <span className="terminal-title">
          <TerminalSquare className="icon" aria-hidden="true" />
          Terminal — exécution PowerShell
        </span>
        <div className="terminal-actions">
          <button
            className="btn small"
            onClick={onEffacer}
            disabled={entries.length === 0}
          >
            <Trash2 className="icon" aria-hidden="true" />
            Effacer
          </button>
          <button className="btn small" onClick={onFermer}>
            <X className="icon" aria-hidden="true" />
            Réduire
          </button>
        </div>
      </div>
      <div className="terminal-body" ref={termRef}>
        {entries.length === 0 && (
          <p className="terminal-empty">
            Aucune commande exécutée. Les résultats des correctifs s'afficheront ici,
            sans ouvrir de fenêtre externe.
          </p>
        )}
        {entries.map((entry) => {
          const res = entry.result;
          return (
            <div
              key={entry.id}
              className={`term-entry ${entry.running ? "running" : res ? (res.exitCode === 0 ? "term-ok" : "term-ko") : ""}`}
            >
              <div className="term-cmd-line">
                <span className="term-time">{entry.time}</span>
                <span className="term-label">{entry.label}</span>
              </div>
              <code className="cmd-line">{entry.commande}</code>
              {entry.running && (
                <p className="term-status">
                  <Loader2 className="icon spin" aria-hidden="true" /> Exécution en cours…
                </p>
              )}
              {entry.error && <pre className="term-err">{entry.error}</pre>}
              {res && (
                <>
                  {res.stdout && <pre className="term-out">{res.stdout}</pre>}
                  {res.stderr && <pre className="term-err">{res.stderr}</pre>}
                  <p className="term-status">
                    {res.exitCode === 0 ? (
                      <CheckCircle2 className="icon ok" aria-hidden="true" />
                    ) : (
                      <XCircle className="icon err" aria-hidden="true" />
                    )}
                    Terminé en {res.durationMs} ms — code{" "}
                    {res.exitCode ?? "?"}
                    <button
                      className="btn small copier-btn"
                      onClick={() =>
                        copierTexte(`${entry.commande}\n${res.stdout}\n${res.stderr}`)
                      }
                      title="Copier la commande et sa sortie"
                    >
                      <Copy className="icon" aria-hidden="true" />
                      Copier
                    </button>
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
