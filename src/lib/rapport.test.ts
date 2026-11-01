import { describe, expect, it } from "vitest";
import { clePlanAction, rapportMarkdown } from "./rapport";
import type { AuditSante } from "../types";

describe("clePlanAction", () => {
  it("identifie un problème par provider, eventId et index d'étape", () => {
    expect(clePlanAction({ provider: "disk", eventId: 7, index: 0 })).toBe("disk/7/0");
    expect(clePlanAction({ provider: "disk", eventId: 7, index: 2 })).toBe("disk/7/2");
  });
});

const audit: AuditSante = {
  global: 62,
  categories: [
    { categorie: "stockage", score: 40, problemes: 3 },
    { categorie: "systeme", score: 84, problemes: 1 },
  ],
  problemes: [
    {
      provider: "disk",
      eventId: 7,
      level: 2,
      count: 12,
      titre: "Erreur disque",
      categorie: "stockage",
      etapes: ["Vérifier le disque", "Sauvegarder les données"],
    },
  ],
  totalEvenements: 130,
  genereLe: "2026-11-01 13:00",
};

describe("rapportMarkdown", () => {
  it("inclut le score global, les catégories et les problèmes", () => {
    const md = rapportMarkdown(audit, {});
    expect(md).toContain("# Rapport d'audit — Libre EventLog");
    expect(md).toContain("## Score global : 62/100");
    expect(md).toContain("**stockage** : 40/100 (3 problème(s))");
    expect(md).toContain("### Erreur disque");
    expect(md).toContain("12 occurrence(s)");
  });

  it("marque les étapes cochées du plan d'action", () => {
    const cochee = clePlanAction({ provider: "disk", eventId: 7, index: 0 });
    const md = rapportMarkdown(audit, { [cochee]: true });
    expect(md).toContain("- [x] Vérifier le disque");
    expect(md).toContain("- [ ] Sauvegarder les données");
  });

  it("système sain quand aucun problème", () => {
    const md = rapportMarkdown(
      { ...audit, problemes: [], categories: [] },
      {},
    );
    expect(md).toContain("Aucun problème détecté. Système sain !");
  });
});
