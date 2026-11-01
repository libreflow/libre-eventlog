import { describe, expect, it } from "vitest";
import {
  SEVERITES,
  cleJourLocal,
  formatDate,
  libelleJour,
  lienRecherche,
  severityClass,
} from "./evenements";

describe("severityClass", () => {
  it("mappe les niveaux aux classes CSS", () => {
    expect(severityClass({ level: 1 })).toBe("critique");
    expect(severityClass({ level: 2 })).toBe("erreur");
    expect(severityClass({ level: 3 })).toBe("avertissement");
    expect(severityClass({ level: 0 })).toBe("info");
    expect(severityClass({ level: 4 })).toBe("info");
  });

  it("accepte un objet partiel (audit agrégé sans cast CriticalEvent)", () => {
    expect(severityClass({ level: 2 })).toBe("erreur");
  });
});

describe("formatDate", () => {
  it("retourne un tiret pour une valeur vide", () => {
    expect(formatDate("")).toBe("—");
  });

  it("retourne l'entrée telle quelle si le timestamp est invalide", () => {
    expect(formatDate("pas-une-date")).toBe("pas-une-date");
  });

  it("formate un timestamp RFC3339 valide", () => {
    const s = formatDate("2026-10-31T23:41:02.183Z");
    expect(s).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(s).not.toContain("Z");
  });
});

describe("lienRecherche", () => {
  it("encode provider et eventId dans l'URL de support", () => {
    const url = lienRecherche({ provider: "Microsoft-Windows-Kernel-Power", eventId: 41 } as never);
    expect(url).toBe(
      "https://support.microsoft.com/results?q=Microsoft-Windows-Kernel-Power%2041",
    );
  });
});

describe("cleJourLocal", () => {
  it("produit YYYY-MM-DD en date locale (régression Invalid Date du regroupement)", () => {
    // Construit en heure locale : indépendant du fuseau du poste de test.
    const d = new Date(2026, 9, 31, 12, 0, 0);
    expect(cleJourLocal(d.toISOString())).toBe("2026-10-31");
  });

  it("passe minuit local compte pour le bon jour", () => {
    const minuit = new Date(2026, 9, 31, 0, 5, 0);
    expect(cleJourLocal(minuit.toISOString())).toBe("2026-10-31");
  });

  it("retourne l'entrée si non parsable", () => {
    expect(cleJourLocal("n/a")).toBe("n/a");
  });
});

describe("libelleJour", () => {
  it("identifie aujourd'hui et hier à partir de clés calculées", () => {
    const aujourdhui = cleJourLocal(new Date().toISOString());
    const hier = new Date();
    hier.setDate(hier.getDate() - 1);
    expect(libelleJour(aujourdhui)).toBe("Aujourd'hui");
    expect(libelleJour(cleJourLocal(hier.toISOString()))).toBe("Hier");
  });

  it("retourne une date lisible pour un jour plus ancien", () => {
    const s = libelleJour("2020-01-15");
    expect(s).toBe("mercredi 15 janvier");
  });

  it("retourne la clé brute si non parsable (jamais Invalid Date)", () => {
    expect(libelleJour("n/a")).toBe("n/a");
  });
});

describe("SEVERITES", () => {
  it("valeur par défaut en tête", () => {
    expect(SEVERITES[0]).toBe("Toutes");
    expect(SEVERITES).toContain("Info");
  });
});

import { grouperProblemes } from "./evenements";

describe("grouperProblemes", () => {
  const ev = (provider: string, eventId: number, level: number, timestamp: string) =>
    ({ provider, eventId, level, timestamp, canal: "System" }) as never;

  it("agrège par couple provider/eventId et compte les occurrences", () => {
    const groupes = grouperProblemes([
      ev("disk", 7, 2, "2026-11-01T10:00:00.000Z"),
      ev("disk", 7, 2, "2026-11-01T11:00:00.000Z"),
      ev("disk", 11, 3, "2026-11-01T09:00:00.000Z"),
    ]);
    expect(groupes).toHaveLength(2);
    expect(groupes[0]).toMatchObject({ provider: "disk", eventId: 7, count: 2 });
    expect(groupes[0].dernierIso).toBe("2026-11-01T11:00:00.000Z");
  });

  it("retient la sévérité la plus grave du groupe", () => {
    const groupes = grouperProblemes([
      ev("whea", 18, 2, "2026-11-01T10:00:00.000Z"),
      ev("whea", 18, 1, "2026-11-01T09:00:00.000Z"),
    ]);
    expect(groupes[0].level).toBe(1);
  });

  it("trie par gravité puis occurrences décroissantes", () => {
    const groupes = grouperProblemes([
      ev("a", 1, 3, "2026-11-01T10:00:00.000Z"),
      ev("b", 2, 1, "2026-11-01T10:00:00.000Z"),
      ev("c", 3, 2, "2026-11-01T10:00:00.000Z"),
      ev("c", 3, 2, "2026-11-01T11:00:00.000Z"),
    ]);
    expect(groupes.map((g) => g.eventId)).toEqual([2, 3, 1]);
  });
});
