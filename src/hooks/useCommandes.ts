import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CommandResult, CommandeFix } from "../types";
import type { TerminalEntry } from "../components/Terminal";
import { cleCommande } from "../lib/catalogue";

// Ligne de sortie diffusée par le backend (événement « terminal://ligne »).
interface LigneTerminal {
  id: number;
  flux: "out" | "err";
  texte: string;
}

// Nombre max de lignes conservées par entrée (mémoire bornée : un sfc
// ou un DISM peut produire des dizaines de milliers de lignes).
const MAX_LIGNES = 2000;

// Exécution des commandes dans le terminal intégré : ajout d'entrée,
// verrou d'exécution unique (runningCmd), sortie diffusée en temps réel
// via l'événement « terminal://ligne », annulation des commandes
// annulables, resize de la zone et modale de confirmation.
// `lancerTacheTerminal` est la primitive partagée par les correctifs,
// les mises à jour d'applications et Windows Update.
export function useCommandes() {
  const [terminal, setTerminal] = useState<TerminalEntry[]>([]);
  const [terminalOuvert, setTerminalOuvert] = useState(false);
  const [confirmCmd, setConfirmCmd] = useState<CommandeFix | null>(null);
  const [runningCmd, setRunningCmd] = useState<string | null>(null);
  const [terminalHauteur, setTerminalHauteur] = useState(240);
  const dragTerminal = useRef<{ y: number; h: number } | null>(null);
  const nextId = useRef(1);
  const termRef = useRef<HTMLDivElement>(null);

  // Réception du flux temps réel : chaque ligne arrivée alimente l'entrée
  // correspondante du terminal (les commandes exécutées hors terminal —
  // scans — n'émettant pas d'événement, le listener est inactif pour elles).
  useEffect(() => {
    const promesse = listen<LigneTerminal>("terminal://ligne", (e) => {
      const { id, flux, texte } = e.payload;
      setTerminal((t) =>
        t.map((entry) => {
          if (entry.id !== id) return entry;
          const lignes =
            flux === "out"
              ? [...entry.lignes, texte].slice(-MAX_LIGNES)
              : entry.lignes;
          return { ...entry, lignes };
        }),
      );
    });
    return () => {
      promesse.then((unlisten) => unlisten());
    };
  }, []);

  // Suivi du bas du terminal : ne suit le défilement QUE si l'utilisateur
  // est déjà en bas — le streaming ne doit pas voler son ascenseur.
  useEffect(() => {
    const el = termRef.current;
    if (!el) return;
    const enBas = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (enBas) {
      el.scrollTop = el.scrollHeight;
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
    tache: (entreeId: number) => Promise<CommandResult>,
    annulable = true,
  ) {
    const id = nextId.current++;
    const time = new Date().toLocaleTimeString("fr-FR");
    setTerminalOuvert(true);
    setTerminal((t) => [
      ...t,
      {
        id,
        label,
        commande: commandeAffichee,
        result: null,
        error: null,
        running: true,
        time,
        lignes: [],
        annulable,
        annulee: false,
      },
    ]);
    setRunningCmd(cleRunning);
    try {
      const res = await tache(id);
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
      (entreeId) =>
        invoke<CommandResult>("run_diagnostic_command", {
          commande: cmd.commande,
          timeoutSecs: cmd.timeoutSecs ?? null,
          entreeId,
        }),
      cmd.annulable !== false,
    );
  }

  // Annule la commande d'une entrée : le backend tue l'arbre de processus
  // (taskkill /T /F) ; l'entrée est marquée annulée côté UI immédiatement.
  async function annulerCommande(entreeId: number) {
    setTerminal((t) =>
      t.map((e) => (e.id === entreeId ? { ...e, annulee: true, running: false } : e)),
    );
    try {
      await invoke<boolean>("annuler_commande", { entreeId });
    } catch {
      /* le processus s'est terminé entre-temps : le résultat normal arrive */
    }
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
    annulerCommande,
  };
}
