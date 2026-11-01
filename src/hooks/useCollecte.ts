import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  CollecteResult,
  CriticalEvent,
  Diagnostic,
} from "../types";
import type { SortDir, SortKey } from "../lib/catalogue";

// Collecte des événements et navigation dedans : requête wevtutil via
// get_critical_events (garde de séquence contre les collectes
// concurrentes, préservation de la sélection au rechargement), filtres
// (canal, sévérité, période, recherche, tri), auto-refresh et
// sélection d'un événement avec son diagnostic (garde de séquence).
export function useCollecte() {
  const [events, setEvents] = useState<CriticalEvent[]>([]);
  const [selected, setSelected] = useState<CriticalEvent | null>(null);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [avertissements, setAvertissements] = useState<string[]>([]);
  const [limite, setLimite] = useState<string>("50");
  const [inclureAvert, setInclureAvert] = useState(false);
  const [canal, setCanal] = useState<string>("Tous");
  const [severite, setSeverite] = useState<string>("Toutes");
  const [recherche, setRecherche] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [depuis, setDepuis] = useState<string>("24");
  const [autoRefresh, setAutoRefresh] = useState("0");
  const diagSeq = useRef(0);
  const collecteSeq = useRef(0);
  // Toujours à jour pour les raccourcis clavier et l'auto-refresh.
  const chargerRef = useRef<() => void>(() => {});

  async function charger(overLimite?: string, overAvert?: boolean) {
    // Séquence : deux collectes peuvent se chevaucher (auto-refresh + clic,
    // ou changement rapide de filtre) ; seule la plus récente doit
    // s'appliquer, sinon un résultat ancien écrase le nouveau.
    const seq = ++collecteSeq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<CollecteResult>("get_critical_events", {
        limit: Number(overLimite ?? limite),
        inclureAvertissements: overAvert ?? inclureAvert,
      });
      if (collecteSeq.current !== seq) return;
      setEvents(result.events);
      setAvertissements(result.avertissements);
      // L'auto-refresh ne doit pas éjecter l'utilisateur de sa lecture :
      // la sélection est conservée si l'événement est toujours collecté.
      if (selected) {
        const toujours = result.events.find(
          (e) =>
            e.recordId === selected.recordId &&
            e.canal === selected.canal &&
            e.timestamp === selected.timestamp &&
            e.provider === selected.provider &&
            e.eventId === selected.eventId,
        );
        if (toujours) setSelected(toujours);
        else {
          setSelected(null);
          setDiagnostic(null);
        }
      }
    } catch (e) {
      if (collecteSeq.current !== seq) return;
      setError(String(e));
      // Cohérence de l'écran d'erreur : la table est vidée, le panneau
      // détail et les bandeaux ne doivent pas montrer un état fantôme.
      setEvents([]);
      setAvertissements([]);
      setSelected(null);
      setDiagnostic(null);
    } finally {
      if (collecteSeq.current === seq) setLoading(false);
    }
  }

  async function selectionner(e: CriticalEvent) {
    // Séquence : évite qu'un diagnostic obsolète écrase celui d'un
    // événement sélectionné plus récemment (clics rapides).
    const seq = ++diagSeq.current;
    setSelected(e);
    setDiagnostic(null);
    setDiagLoading(true);
    try {
      const d = await invoke<Diagnostic>("get_diagnostic", { event: e });
      if (diagSeq.current === seq) setDiagnostic(d);
    } catch {
      if (diagSeq.current === seq) setDiagnostic({ event: e, fix: null });
    } finally {
      if (diagSeq.current === seq) setDiagLoading(false);
    }
  }

  chargerRef.current = charger;

  // Auto-rafraîchissement de la collecte.
  useEffect(() => {
    if (autoRefresh === "0") return;
    const minutes = Number(autoRefresh);
    const timer = setInterval(() => chargerRef.current(), minutes * 60_000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  const canauxDisponibles = useMemo(
    () => ["Tous", ...Array.from(new Set(events.map((e) => e.canal)))],
    [events],
  );

  // Si le canal filtré n'existe plus dans la nouvelle collecte (ex. Security
  // collecté une fois en administrateur puis application relancée non
  // élevée), le filtre ne correspondrait plus à rien : retour à « Tous ».
  useEffect(() => {
    if (canal !== "Tous" && !canauxDisponibles.includes(canal)) {
      setCanal("Tous");
    }
  }, [canauxDisponibles, canal]);

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const now = Date.now();
    const fenetres: Record<string, number> = {
      "1": 3600_000,
      "24": 24 * 3600_000,
      "168": 7 * 24 * 3600_000,
    };
    const fenetre = fenetres[depuis];
    const liste = events.filter((e) => {
      if (canal !== "Tous" && e.canal !== canal) return false;
      if (severite !== "Toutes" && e.severity !== severite) return false;
      if (fenetre) {
        const t = new Date(e.timestamp).getTime();
        if (!Number.isNaN(t) && now - t > fenetre) return false;
      }
      if (
        q &&
        !e.provider.toLowerCase().includes(q) &&
        !String(e.eventId).includes(q) &&
        !e.messageRaw.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return liste.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "fr") * dir;
    });
  }, [events, canal, severite, recherche, sortKey, sortDir, depuis]);

  function trier(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "timestamp" || key === "eventId" ? "desc" : "asc");
    }
  }

  return {
    events,
    avertissements,
    error,
    setError,
    loading,
    limite,
    setLimite,
    inclureAvert,
    setInclureAvert,
    autoRefresh,
    setAutoRefresh,
    charger,
    chargerRef,
    canauxDisponibles,
    canal,
    setCanal,
    severite,
    setSeverite,
    recherche,
    setRecherche,
    depuis,
    setDepuis,
    sortKey,
    sortDir,
    trier,
    filtres,
    selected,
    selectionner,
    diagnostic,
    diagLoading,
  };
}
