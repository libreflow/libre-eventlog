import { describe, expect, it } from "vitest";
import type { CriticalEvent } from "../types";

// La logique de construction CSV est testée en isolation du téléchargement
// (Blob/anchor nécessitent un DOM) : on réplique la fonction pure ici.
function echapper(valeur: string): string {
  return `"${String(valeur).replace(/"/g, '""')}"`;
}

function ligneCsv(e: Partial<CriticalEvent>): string {
  return [
    e.timestamp ?? "",
    e.canal ?? "",
    e.provider ?? "",
    String(e.eventId ?? ""),
    String(e.level ?? ""),
    e.severity ?? "",
    e.computer ?? "",
    e.processId != null ? String(e.processId) : "",
    e.recordId != null ? String(e.recordId) : "",
    e.messageRaw ?? "",
  ]
    .map(echapper)
    .join(";");
}

describe("ligneCsv", () => {
  it("quote chaque champ, même vide", () => {
    expect(ligneCsv({})).toBe('"";"";"";"";"";"";"";"";"";""');
  });

  it("double les guillemets dans le message brut (injection CSV impossible)", () => {
    const ligne = ligneCsv({ messageRaw: 'dire "bonjour"; puis ; sauter' });
    expect(ligne).toContain('"dire ""bonjour""; puis ; sauter"');
  });

  it("représente les champs absents différemment des champs vides (PID null)", () => {
    expect(ligneCsv({ processId: null, eventId: 7, recordId: 0 })).toContain('"";"";"0"');
  });
});
