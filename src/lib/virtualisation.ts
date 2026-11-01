// Fenêtre visible pour la virtualisation de la table d'événements :
// indices [debut, fin) des lignes à rendre pour un décalage de scroll et
// une hauteur de viewport donnés, avec un surdimensionnement de part et
// d'autre pour éviter les clignotements pendant le défilement.
export function fenetreVisible(
  scrollTop: number,
  hauteurViewport: number,
  nbLignes: number,
  hauteurLigne: number,
  surdimension = 10,
): [number, number] {
  const debut = Math.max(0, Math.floor(scrollTop / hauteurLigne) - surdimension);
  const fin = Math.min(
    nbLignes,
    Math.ceil((scrollTop + hauteurViewport) / hauteurLigne) + surdimension,
  );
  return [debut, Math.max(debut, fin)];
}
