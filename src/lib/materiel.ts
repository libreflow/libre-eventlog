// Liens officiels des principaux fabricants (support + pilotes/BIOS).
// Il n'existe pas d'API universelle de mise à jour BIOS : le support du
// fabricant reste le canal officiel.
export const LIENS_FABRICANTS: { motif: string; nom: string; url: string; outil?: string }[] = [
  { motif: "dell", nom: "Support Dell", url: "https://www.dell.com/support", outil: "Dell Command Update (winget : Dell.CommandUpdate)" },
  { motif: "hewlett", nom: "Support HP", url: "https://support.hp.com", outil: "HP Support Assistant (winget : HP.SupportAssistant)" },
  { motif: "hp ", nom: "Support HP", url: "https://support.hp.com", outil: "HP Support Assistant (winget : HP.SupportAssistant)" },
  { motif: "lenovo", nom: "Support Lenovo", url: "https://pcsupport.lenovo.com", outil: "Lenovo System Update (winget : Lenovo.SystemUpdate)" },
  { motif: "asus", nom: "Support ASUS", url: "https://www.asus.com/support/", outil: "MyASUS" },
  { motif: "msi", nom: "Support MSI", url: "https://www.msi.com/support", outil: "MSI Center" },
  { motif: "micro-star", nom: "Support MSI", url: "https://www.msi.com/support", outil: "MSI Center" },
  { motif: "gigabyte", nom: "Support Gigabyte", url: "https://www.gigabyte.com/support", outil: "Gigabyte Control Center" },
  { motif: "asrock", nom: "Support ASRock", url: "https://www.asrock.com/support/" },
  { motif: "acer", nom: "Support Acer", url: "https://www.acer.com/support/", outil: "Care Center" },
  { motif: "predator", nom: "Support Acer Predator", url: "https://www.acer.com/support/" },
  { motif: "samsung", nom: "Support Samsung", url: "https://www.samsung.com/support/" },
  { motif: "microsoft", nom: "Support Microsoft", url: "https://support.microsoft.com" },
  { motif: "toshiba", nom: "Support Dynabook/Toshiba", url: "https://support.dynabook.com" },
  { motif: "dynabook", nom: "Support Dynabook/Toshiba", url: "https://support.dynabook.com" },
];

export function fabricantTrouve(manufacturer: string) {
  const m = manufacturer.toLowerCase();
  return LIENS_FABRICANTS.find((f) => m.includes(f.motif));
}

// Signification des codes de problème Gestionnaire de périphériques
// (CM_PROBLEM) les plus fréquents.
export const CODES_PROBLEME: Record<string, string> = {
  "1": "Périphérique mal configuré",
  "10": "Le périphérique ne peut pas démarrer",
  "18": "Pilotes à réinstaller",
  "22": "Périphérique désactivé",
  "24": "Périphérique absent ou en panne — débranchez/rebranchez",
  "28": "Pilotes non installés",
  "31": "Ne fonctionne pas correctement avec cette version de Windows",
  "37": "Échec d'initialisation du pilote — réinstallation recommandée",
  "39": "Pilote corrompu ou manquant",
  "43": "Windows a arrêté ce périphérique (problème matériel signalé)",
  "45": "Périphérique non connecté",
  "52": "Windows ne peut pas vérifier la signature numérique du pilote",
};
