import { useEffect } from "react";

// Piège de focus dans une modale : Tab ne s'échappe pas vers l'arrière-plan.
// Place le focus au premier élément interactif à l'ouverture et le rend à
// l'élément qui avait ouvert la modale à la fermeture.
export function usePiegeFocus(ref: React.RefObject<HTMLElement | null>, actif: boolean) {
  useEffect(() => {
    if (!actif || !ref.current) return;
    const racine = ref.current;
    const focusables = () =>
      Array.from(
        racine.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
    const focusAvant = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    focusables()[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;
      const premier = els[0];
      const dernier = els[els.length - 1];
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    };
    racine.addEventListener("keydown", onKeyDown);
    return () => {
      racine.removeEventListener("keydown", onKeyDown);
      // Rend le focus à l'élément qui a ouvert la modale, s'il existe encore.
      if (focusAvant && document.contains(focusAvant)) focusAvant.focus();
    };
  }, [ref, actif]);
}
