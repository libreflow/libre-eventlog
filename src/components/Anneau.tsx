import { useEffect, useState } from "react";

// Anneau de score (SVG) : la progression s'anime au montage.
export function Anneau({
  score,
  taille,
  gros = false,
}: {
  score: number;
  taille: number;
  gros?: boolean;
}) {
  const [anime, setAnime] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setAnime(true));
    return () => cancelAnimationFrame(t);
  }, [score]);
  const epaisseur = gros ? 9 : 7;
  const rayon = (taille - epaisseur * 2) / 2;
  const circonference = 2 * Math.PI * rayon;
  const cible = circonference * (1 - score / 100);
  const classe = score >= 80 ? "ok" : score >= 50 ? "moyen" : "mauvais";
  return (
    <svg
      width={taille}
      height={taille}
      className={`anneau ${classe}`}
      role="img"
      aria-label={`Score ${score} sur 100`}
    >
      <circle
        cx={taille / 2}
        cy={taille / 2}
        r={rayon}
        fill="none"
        className="anneau-fond"
        strokeWidth={epaisseur}
      />
      <circle
        cx={taille / 2}
        cy={taille / 2}
        r={rayon}
        fill="none"
        className="anneau-valeur"
        strokeWidth={epaisseur}
        strokeLinecap="round"
        strokeDasharray={circonference}
        strokeDashoffset={anime ? cible : circonference}
        transform={`rotate(-90 ${taille / 2} ${taille / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className={`anneau-texte ${gros ? "gros" : ""}`}
      >
        {score}
      </text>
    </svg>
  );
}
