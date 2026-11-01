import { describe, expect, it } from "vitest";
import type { AuditSante } from "../types";
import { enregistrerAudit, evolution, lireHistorique, type EntreeAudit } from "./audits";

// localStorage n'existe pas en environnement node : un substitut minimal
// en mémoire pour tester la logique de plafonnement et de dédoublonnage.
const memoire = new Map<string, string>();
const localStorageSubstitut = {
  getItem: (k: string) => memoire.get(k) ?? null,
  setItem: (k: string, v: string) => void memoire.set(k, v),
};
(globalThis as Record<string, unknown>).localStorage = localStorageSubstitut;

const audit = (date: string, global: number): AuditSante => ({
  global,
  categories: [
    { categorie: "systeme", score: global, problemes: 1 },
  ],
  problemes: [],
  totalEvenements: 10,
  genereLe: date,
});

describe("historique d'audits", () => {
  it("enregistre et dédoublonne par date (rechargement sans doublon)", () => {
    let h = enregistrerAudit(audit("2026-11-01 13:00", 60));
    expect(h).toHaveLength(1);
    h = enregistrerAudit(audit("2026-11-01 13:00", 65));
    expect(h).toHaveLength(1);
    expect(h[0].global).toBe(65);
    h = enregistrerAudit(audit("2026-11-01 14:00", 70));
    expect(h).toHaveLength(2);
    expect(h[0].date).toBe("2026-11-01 14:00");
  });

  it("plafonne l'historique à 50 entrées", () => {
    memoire.clear();
    for (let i = 0; i < 55; i++) {
      enregistrerAudit(audit(`2026-11-${i}`, i));
    }
    expect(lireHistorique()).toHaveLength(50);
  });
});

describe("evolution", () => {
  const historique: EntreeAudit[] = [
    { date: "b", global: 70, categories: {} },
    { date: "a", global: 60, categories: {} },
  ];
  it("calcule l'écart avec l'audit précédent", () => {
    expect(evolution(historique, "b")).toBe(10);
    expect(evolution(historique, "a")).toBeNull();
  });
  it("retourne null pour une date inconnue", () => {
    expect(evolution(historique, "z")).toBeNull();
  });
});
