import type { ReactNode } from "react";
import { ouvrirExterne } from "../lib/pressepapiers";

// Ancre externe : href conservé (clavier, statut hover), ouverture via le
// plugin opener dans le navigateur par défaut.
export function LienExterne({
  href,
  className,
  title,
  children,
}: {
  href: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        ouvrirExterne(href);
      }}
    >
      {children}
    </a>
  );
}
