import type { AuditSante } from "../types";

// Clé de persistance d'une étape du plan d'action (par problème, par index).
export function clePlanAction(p: {
  provider: string;
  eventId: number;
  index: number;
}): string {
  return `${p.provider}/${p.eventId}/${p.index}`;
}

// Rapport Markdown de l'audit : scores, catégories, problèmes et étapes
// cochées du plan d'action.
export function rapportMarkdown(a: AuditSante, plan: Record<string, boolean>): string {
  const lignes: string[] = [
    `# Rapport d'audit — Libre EventLog`,
    ``,
    `Généré le ${a.genereLe} — ${a.totalEvenements} événement(s) analysé(s)`,
    ``,
    `## Score global : ${a.global}/100`,
    ``,
  ];
  if (a.categories.length > 0) {
    lignes.push(`## Santé par catégorie`, ``);
    for (const c of a.categories) {
      lignes.push(`- **${c.categorie}** : ${c.score}/100 (${c.problemes} problème(s))`);
    }
    lignes.push(``);
  }
  if (a.problemes.length > 0) {
    lignes.push(`## Problèmes détectés`, ``);
    for (const p of a.problemes) {
      lignes.push(
        `### ${p.titre}`,
        ``,
        `- Provider : \`${p.provider}\` — événement ${p.eventId}`,
        `- Gravité : ${p.level === 1 ? "Critique" : p.level === 2 ? "Erreur" : p.level === 3 ? "Avertissement" : "Info"} — ${p.count} occurrence(s)`,
        `- Catégorie : ${p.categorie}`,
        ``,
      );
      if (p.etapes.length > 0) {
        lignes.push(`Étapes recommandées :`);
        for (let i = 0; i < p.etapes.length; i++) {
          const faite = !!plan[clePlanAction({ provider: p.provider, eventId: p.eventId, index: i })];
          lignes.push(`- [${faite ? "x" : " "}] ${p.etapes[i]}`);
        }
        lignes.push(``);
      }
    }
  } else {
    lignes.push(`Aucun problème détecté. Système sain ! 🎉`);
  }
  return lignes.join("\n");
}
