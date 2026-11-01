import { describe, expect, it } from "vitest";
import { fenetreVisible } from "./virtualisation";

const H = 40;

describe("fenetreVisible", () => {
  it("affiche le début de la liste au sommet, avec surdimension", () => {
    const [d, f] = fenetreVisible(0, 800, 1000, H, 10);
    expect(d).toBe(0);
    expect(f).toBe(30); // 800/40 = 20 visibles + 10
  });

  it("suit le défilement et borne les extrêmes", () => {
    const [d, f] = fenetreVisible(4000, 800, 1000, H, 10);
    expect(d).toBe(90); // 100 - 10
    expect(f).toBe(130); // 120 visibles + 10
  });

  it("ne dépasse jamais la fin de la liste", () => {
    const [d, f] = fenetreVisible(39_000, 800, 1000, H, 10);
    expect(f).toBe(1000);
    expect(d).toBe(965); // 975 - 10
  });

  it("liste entière plus petite que le viewport : tout est rendu", () => {
    const [d, f] = fenetreVisible(0, 800, 15, H, 10);
    expect(d).toBe(0);
    expect(f).toBe(15);
  });

  it("hauteur de viewport nulle : seulement le surdimension", () => {
    const [d, f] = fenetreVisible(0, 0, 1000, H, 10);
    expect(d).toBe(0);
    expect(f).toBe(10);
  });
});
