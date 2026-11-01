import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, CommandeFix } from "../types";
import type { TerminalEntry } from "../components/Terminal";
import { cleCommande } from "../lib/catalogue";

// Exécution des commandes dans le terminal intégré : ajout d'entrée,
// verrou d'exécution unique (runningCmd), mise à jour à la fin, resize
// de la zone, et modale de confirmation pour les commandes qui la
// demandent. `lancerTacheTerminal` est la primitive partagée par les
// correctifs, les mises à jour d'applications et Windows Update.
export function useCommandes() {
  const [terminal, setTerminal] = useState<TerminalEntry[]>([]);
  const [terminalOuvert, setTerminalOuvert] = useState(false);
  const [confirmCmd, setConfirmCmd] = useState<CommandeFix | null>(null);
  const [runningCmd, setRunningCmd] = useState<string | null>(null);
  const [terminalHauteur, setTerminalHauteur] = useState(240);
  const dragTerminal = useRef<{ y: number; h: number } | null>(null);
  const nextId = useRef(1);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [terminal]);

  function commencerRedimension(e: React.PointerEvent) {
    dragTerminal.current = { y: e.clientY, h: terminalHauteur };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function bougerRedimension(e: React.PointerEvent) {
    if (!dragTerminal.current) return;
    const delta = dragTerminal.current.y - e.clientY;
    setTerminalHauteur(
      Math.min(600, Math.max(140, dragTerminal.current.h + delta)),
    );
  }

  function finirRedimension() {
    dragTerminal.current = null;
  }

  async function lancerTacheTerminal(
    label: string,
    commandeAffichee: string,
    cleRunning: string,
    tache: () => Promise<CommandResult>,
  ) {
    const id = nextId.current++;
    const time = new Date().toLocaleTimeString("fr-FR");
    setTerminalOuvert(true);
    setTerminal((t) => [
      ...t,
      { id, label, commande: commandeAffichee, result: null, error: null, running: true, time },
    ]);
    setRunningCmd(cleRunning);
    try {
      const res = await tache();
      setTerminal((t) =>
        t.map((e) => (e.id === id ? { ...e, result: res, running: false } : e)),
      );
    } catch (err) {
      setTerminal((t) =>
        t.map((e) =>
          e.id === id ? { ...e, error: String(err), running: false } : e,
        ),
      );
    } finally {
      setRunningCmd(null);
    }
  }

  function executerCommande(cmd: CommandeFix) {
    return lancerTacheTerminal(
      cmd.label,
      cmd.commande,
      cleCommande(cmd),
      () =>
        invoke<CommandResult>("run_diagnostic_command", {
          commande: cmd.commande,
          timeoutSecs: cmd.timeoutSecs ?? null,
        }),
    );
  }

  function demanderExecution(cmd: CommandeFix) {
    if (cmd.confirme) {
      setConfirmCmd(cmd);
    } else {
      executerCommande(cmd);
    }
  }

  return {
    terminal,
    setTerminal,
    terminalOuvert,
    setTerminalOuvert,
    confirmCmd,
    setConfirmCmd,
    runningCmd,
    terminalHauteur,
    termRef,
    commencerRedimension,
    bougerRedimension,
    finirRedimension,
    executerCommande,
    demanderExecution,
    lancerTacheTerminal,
  };
}
