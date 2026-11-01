// Vérification post-correctif : l'instant où un correctif a été appliqué
// avec succès sur un problème, persisté en localStorage. Sert à compter
// les occurrences depuis (« le correctif a-t-il arrêté le problème ? »).
export interface VerificationCorrectif {
  /** Date du correctif réussi (epoch ms). */
  date: number;
}

const CLE = "libre-eventlog-verifications";

export function cleVerification(e: {
  provider: string;
  eventId: number;
  canal: string;
}): string {
  return `${e.canal}/${e.provider}/${e.eventId}`;
}

export function lireVerifications(): Record<string, VerificationCorrectif> {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return {};
    const map = JSON.parse(brut) as Record<string, VerificationCorrectif>;
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

export function enregistrerVerification(
  e: { provider: string; eventId: number; canal: string },
  date = Date.now(),
): Record<string, VerificationCorrectif> {
  const map = lireVerifications();
  map[cleVerification(e)] = { date };
  try {
    localStorage.setItem(CLE, JSON.stringify(map));
  } catch {
    /* persistance indisponible */
  }
  return map;
}

// Fenêtre de temps écoulée depuis le correctif (ms), null si aucune
// vérification enregistrée pour ce problème.
export function fenetreDepuisVerification(
  verifications: Record<string, VerificationCorrectif>,
  e: { provider: string; eventId: number; canal: string },
): number | null {
  const v = verifications[cleVerification(e)];
  if (!v) return null;
  return Math.max(0, Date.now() - v.date);
}
