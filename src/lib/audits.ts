import type { AuditSante } from "../types";

// Historique local des audits (plafonné — les plus récents d'abord).
// Sert à la sparkline de la modale d'audit et à la tendance du rapport.
export interface EntreeAudit {
  date: string;
  global: number;
  categories: Record<string, number>;
}

const CLE = "libre-eventlog-audits";
const PLAFOND = 50;

export function lireHistorique(): EntreeAudit[] {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return [];
    const liste = JSON.parse(brut) as EntreeAudit[];
    return Array.isArray(liste) ? liste.slice(0, PLAFOND) : [];
  } catch {
    return [];
  }
}

// Enregistre un audit et retourne l'historique à jour (le plus récent en
// tête). Le même audit rechargé ne duplique pas d'entrée : la clé est la
// date de génération à la minute.
export function enregistrerAudit(audit: AuditSante): EntreeAudit[] {
  const entree: EntreeAudit = {
    date: audit.genereLe,
    global: audit.global,
    categories: Object.fromEntries(
      audit.categories.map((c) => [c.categorie, c.score]),
    ),
  };
  const historique = [
    entree,
    ...lireHistorique().filter((e) => e.date !== entree.date),
  ].slice(0, PLAFOND);
  try {
    localStorage.setItem(CLE, JSON.stringify(historique));
  } catch {
    /* persistance indisponible : l'historique reste en mémoire */
  }
  return historique;
}

// Écart de score global avec l'audit précédent (null si aucun précédent).
export function evolution(historique: EntreeAudit[], dateActuelle: string): number | null {
  const index = historique.findIndex((e) => e.date === dateActuelle);
  if (index < 0 || index + 1 >= historique.length) return null;
  return historique[index].global - historique[index + 1].global;
}
