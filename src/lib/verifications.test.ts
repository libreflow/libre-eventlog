import { describe, expect, it } from "vitest";
import {
  cleVerification,
  enregistrerVerification,
  fenetreDepuisVerification,
  lireVerifications,
  type VerificationCorrectif,
} from "./verifications";

const memoire = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => memoire.get(k) ?? null,
  setItem: (k: string, v: string) => void memoire.set(k, v),
};

const probleme = { canal: "System", provider: "disk", eventId: 7 };

describe("verifications post-correctif", () => {
  it("clé stable par canal/source/ID", () => {
    expect(cleVerification(probleme)).toBe("System/disk/7");
  });

  it("enregistre puis relit une vérification", () => {
    memoire.clear();
    const map = enregistrerVerification(probleme, 1234);
    expect(map["System/disk/7"]).toEqual({ date: 1234 });
    expect(lireVerifications()["System/disk/7"]).toEqual({ date: 1234 });
  });

  it("écrase la date si un nouveau correctif réussit", () => {
    memoire.clear();
    enregistrerVerification(probleme, 1000);
    enregistrerVerification(probleme, 2000);
    expect(lireVerifications()["System/disk/7"]).toEqual({ date: 2000 });
  });

  it("fenêtre nulle sans vérification, positive sinon", () => {
    const sans: Record<string, VerificationCorrectif> = {};
    expect(fenetreDepuisVerification(sans, probleme)).toBeNull();
    const avec: Record<string, VerificationCorrectif> = {
      "System/disk/7": { date: Date.now() - 5000 },
    };
    const fenetre = fenetreDepuisVerification(avec, probleme);
    expect(fenetre).not.toBeNull();
    expect(fenetre!).toBeGreaterThanOrEqual(4900);
    expect(fenetre!).toBeLessThanOrEqual(5200);
  });
});
