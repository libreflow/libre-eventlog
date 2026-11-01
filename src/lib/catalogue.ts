import type { CommandeFix } from "../types";

// Maintenance intégrée : sélection des applications à mettre à jour via
// winget, purge des installateurs résiduels et détection des anciennes
// versions. `commande` est purement indicative : l'exécution passe par la
// commande Tauri dédiée `update_applications`.
export const MAJ_APPS: CommandeFix = {
  label: "Mettre à jour les applications",
  description:
    "winget upgrade (paquets sélectionnés), purge des installateurs résiduels et détection des anciennes versions",
  commande: "winget upgrade --silent --exact --id <paquet> (maintenance intégrée)",
  type: "action",
  elevation: true,
  confirme: true,
};

// Catalogue de correctifs système prédéfinis (aucune commande arbitraire).
// Exécutés via run_diagnostic_command : confirmation, denylist et terminal
// intégrés. Durées indicatives pour les opérations longues.
export const CORRECTIFS_SYSTEME: CommandeFix[] = [
  {
    label: "Vérifier les fichiers système (sfc)",
    description: "sfc /scannow — inspecte et répare les fichiers Windows corrompus (10 à 20 min)",
    commande: "sfc /scannow",
    type: "action",
    elevation: true,
    confirme: true,
    timeoutSecs: 3600,
  },
  {
    label: "Contrôle rapide du magasin de composants",
    description: "DISM CheckHealth — détection rapide d'une corruption du magasin Windows",
    commande: "DISM /Online /Cleanup-Image /CheckHealth",
    type: "action",
    elevation: true,
    confirme: false,
    timeoutSecs: 300,
  },
  {
    label: "Analyser le magasin de composants",
    description: "DISM ScanHealth — analyse approfondie du magasin de composants (long)",
    commande: "DISM /Online /Cleanup-Image /ScanHealth",
    type: "action",
    elevation: true,
    confirme: true,
    timeoutSecs: 3600,
  },
  {
    label: "Réparer le magasin de composants",
    description: "DISM RestoreHealth — répare le magasin via Windows Update (très long, à faire avant sfc)",
    commande: "DISM /Online /Cleanup-Image /RestoreHealth",
    type: "action",
    elevation: true,
    confirme: true,
    timeoutSecs: 7200,
  },
  {
    label: "Analyser le disque système",
    description: "chkdsk C: /scan — vérification en ligne du disque système, sans démontage",
    commande: "chkdsk C: /scan",
    type: "action",
    elevation: true,
    confirme: false,
    timeoutSecs: 3600,
  },
  {
    label: "Vider le cache DNS",
    description: "ipconfig /flushdns — résout les problèmes de résolution de noms",
    commande: "ipconfig /flushdns",
    type: "action",
    elevation: false,
    confirme: false,
    timeoutSecs: 60,
  },
  {
    label: "Réinitialiser la pile réseau",
    description:
      "réinitialise Winsock et le cache ARP — utile après une infection ou des soucis réseau. Attention : redémarrage requis pour Winsock ; la connexion peut être brièvement coupée pendant l'opération",
    commande:
      "netsh winsock reset; netsh int ip reset; arp -d *; ipconfig /release; ipconfig /renew; ipconfig /flushdns",
    type: "action",
    elevation: true,
    confirme: true,
    timeoutSecs: 300,
  },
  {
    label: "Vérifier et réparer les fichiers système en une passe",
    description: "DISM RestoreHealth puis sfc /scannow — le combo recommandé par Microsoft (très long)",
    commande: "DISM /Online /Cleanup-Image /RestoreHealth; sfc /scannow",
    type: "action",
    elevation: true,
    confirme: true,
    timeoutSecs: 7200,
  },
];

export type SortKey = "timestamp" | "canal" | "provider" | "eventId" | "severity";
export type SortDir = "asc" | "desc";

export const COLONNES: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "timestamp", label: "Date" },
  { key: "canal", label: "Canal" },
  { key: "provider", label: "Source" },
  { key: "eventId", label: "ID", align: "right" },
  { key: "severity", label: "Sévérité" },
];
