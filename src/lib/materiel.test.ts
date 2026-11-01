import { describe, expect, it } from "vitest";
import { CODES_PROBLEME, fabricantTrouve, LIENS_FABRICANTS } from "./materiel";

describe("fabricantTrouve", () => {
  it("reconnaît les fabricants par motif insensible à la casse", () => {
    expect(fabricantTrouve("Dell Inc.")!.nom).toBe("Support Dell");
    expect(fabricantTrouve("Hewlett-Packard")!.nom).toBe("Support HP");
    expect(fabricantTrouve("LENOVO")!.nom).toBe("Support Lenovo");
  });

  it("retourne undefined pour un fabricant inconnu", () => {
    expect(fabricantTrouve("Ordinateur du coin")).toBeUndefined();
  });

  it("chaque entrée a une URL https valide", () => {
    for (const f of LIENS_FABRICANTS) {
      expect(f.url).toMatch(/^https:\/\//);
      expect(f.motif.length).toBeGreaterThan(0);
    }
  });
});

describe("CODES_PROBLEME", () => {
  it("couvre les codes CM_PROB les plus fréquents", () => {
    expect(CODES_PROBLEME["28"]).toContain("installés");
    expect(CODES_PROBLEME["43"]).toContain("arrêté");
    expect(CODES_PROBLEME["52"]).toContain("signature");
  });
});
