//! Journal local des exécutions (tauri-plugin-log) : consultation et
//! purge depuis l'onglet Journal de la modale Maintenance.

use std::io::Read;
use std::io::Seek;
use std::io::SeekFrom;

use tauri::AppHandle;
use tauri::Manager;

fn chemin_journal(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Répertoire de journal introuvable : {e}"))?;
    Ok(dir.join("libre-eventlog.log"))
}

// Dernières lignes du journal, les plus récentes EN PREMIER. Si le fichier
// est très gros, on ne lit que la fin (le plugin le fait tourner à 512 Ko,
// mais restons robustes).
#[tauri::command]
pub async fn lire_journal(
    app: AppHandle,
    max_lignes: Option<usize>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let chemin = chemin_journal(&app)?;
        if !chemin.exists() {
            return Ok(Vec::new());
        }
        let taille = std::fs::metadata(&chemin).map(|m| m.len()).unwrap_or(0);
        let mut fichier =
            std::fs::File::open(&chemin).map_err(|e| format!("Journal illisible : {e}"))?;
        // Se limiter aux 128 derniers Ko.
        let debut_lecture = taille.saturating_sub(128 * 1024);
        fichier
            .seek(SeekFrom::Start(debut_lecture))
            .map_err(|e| format!("Journal illisible : {e}"))?;
        let mut tampon = Vec::new();
        fichier
            .read_to_end(&mut tampon)
            .map_err(|e| format!("Journal illisible : {e}"))?;
        let texte = String::from_utf8_lossy(&tampon);
        let mut lignes: Vec<String> = texte.lines().map(String::from).collect();
        // La première ligne lue peut être tronquée au milieu : l'écarter
        // sauf si on a tout lu depuis le début.
        if debut_lecture > 0 && !lignes.is_empty() {
            lignes.remove(0);
        }
        lignes.reverse();
        Ok(lignes.into_iter().take(max_lignes.unwrap_or(500)).collect())
    })
    .await
    .map_err(|e| format!("La lecture du journal a échoué : {e}"))?
}

// Vide le fichier de journal (le garde ouvert par le plugin).
#[tauri::command]
pub async fn purger_journal(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let chemin = chemin_journal(&app)?;
        if chemin.exists() {
            std::fs::write(&chemin, b"")
                .map_err(|e| format!("Journal impossible à purger : {e}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("La purge du journal a échoué : {e}"))?
}
