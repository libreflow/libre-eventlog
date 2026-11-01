import type { CriticalEvent } from "../types";

// Sévérités proposées dans le filtre (dérivées des niveaux collectés).
export const SEVERITES = ["Toutes", "Critique", "Erreur", "Avertissement", "Info"] as const;

export function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Pas de secondes : inutiles pour un journal, elles ajoutent du bruit.
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function lienRecherche(e: CriticalEvent): string {
  const q = `${e.provider} ${e.eventId}`;
  return `https://support.microsoft.com/results?q=${encodeURIComponent(q)}`;
}

export function severityClass(e: { level: number }): string {
  if (e.level === 1) return "critique";
  if (e.level === 2) return "erreur";
  if (e.level === 3) return "avertissement";
  return "info";
}

// Libellé humain du jour de regroupement : « Aujourd'hui », « Hier », date.
// `dateCle` est de la forme « 2026-10-31 » (YYYY-MM-DD, jour **local** de
// l'événement) : sans composante temps ni fuseau, new Date() la parse comme
// une date locale et le regroupement suit le calendrier de l'utilisateur.
export function libelleJour(dateCle: string): string {
  const d = new Date(`${dateCle}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateCle;
  const ref = new Date();
  ref.setHours(12, 0, 0, 0);
  const hier = new Date(ref);
  hier.setDate(hier.getDate() - 1);
  const memeJour = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (memeJour(d, ref)) return "Aujourd'hui";
  if (memeJour(d, hier)) return "Hier";
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// Clé de regroupement par jour : « 2026-10-31 » en date **locale** de
// l'événement (cohérente avec formatDate, qui affiche l'heure locale).
export function cleJourLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
