import { invoke } from "@tauri-apps/api/core";

// Copie dans le presse-papiers avec repli (execCommand) si l'API Clipboard
// n'est pas disponible dans la webview.
export async function copierTexte(texte: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texte);
  } catch {
    const zone = document.createElement("textarea");
    zone.value = texte;
    document.body.appendChild(zone);
    zone.select();
    document.execCommand("copy");
    zone.remove();
  }
}

// Ouvre un lien externe dans le navigateur par défaut du système. Une
// webview Tauri n'ouvre pas les target="_blank" d'elle-même : on passe
// par le plugin opener (capacité « opener:default »).
export function ouvrirExterne(url: string) {
  invoke("plugin:opener|open_url", { url }).catch(() => {
    /* plugin indisponible : laisser la webview tenter le repli */
  });
}
