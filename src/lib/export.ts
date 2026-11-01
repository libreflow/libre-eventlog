import type { CriticalEvent } from "../types";

// Échappement CSV : guillemets doublés, champ toujours quoté (les
// messageRaw contiennent sauts de ligne, points-virgules et guillemets).
function echapper(valeur: string): string {
  return `"${String(valeur).replace(/"/g, '""')}"`;
}

// Export CSV des événements filtrés : séparateur « ; » + BOM UTF-8 pour
// un double-clic propre dans Excel FR. Génération côté frontend — aucune
// commande Rust nécessaire, même mécanique Blob/ancre que le rapport
// d'audit (WebView2 exige une ancre attachée au document).
export function telechargerCsv(evenements: CriticalEvent[]) {
  if (evenements.length === 0) return;
  const entetes = [
    "horodatage",
    "canal",
    "source",
    "id",
    "niveau",
    "severite",
    "machine",
    "pid",
    "tid",
    "enregistrement",
    "message_brut",
  ];
  const lignes = [entetes.map(echapper).join(";")];
  for (const e of evenements) {
    lignes.push(
      [
        e.timestamp,
        e.canal,
        e.provider,
        String(e.eventId),
        String(e.level),
        e.severity,
        e.computer ?? "",
        e.processId != null ? String(e.processId) : "",
        e.threadId != null ? String(e.threadId) : "",
        e.recordId != null ? String(e.recordId) : "",
        e.messageRaw ?? "",
      ]
        .map(echapper)
        .join(";"),
    );
  }
  const blob = new Blob(["\uFEFF" + lignes.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  a.download = `evenements-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
