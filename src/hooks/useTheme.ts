import { useEffect, useState } from "react";

// Thème clair/sombre persistant (localStorage) et synchronisé avec le
// chrome de la fenêtre Tauri (barre de titre Windows).
export function useTheme() {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem("libre-eventlog-theme") ?? "sombre";
    } catch {
      return "sombre";
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().setTheme(theme === "sombre" ? "dark" : "light"),
      )
      .catch(() => {
        /* hors webview Tauri (navigateur) : pas de chrome à synchroniser */
      });
    try {
      localStorage.setItem("libre-eventlog-theme", theme);
    } catch {
      /* persistance indisponible */
    }
  }, [theme]);

  return {
    theme,
    basculerTheme: () => setTheme((t) => (t === "sombre" ? "clair" : "sombre")),
  };
}
