use std::process::Command;
use std::time::Instant;

use crate::powershell::{
    attendre_avec_timeout, desenregistrer_processus, enregistrer_processus, spawn_powershell,
    NoWindow,
};
use crate::securite::is_elevated;
use crate::types::*;

pub const WINGET_TIMEOUT_SECONDES: u64 = 600;

// winget 1.x n'a pas de sortie JSON pour `upgrade` : on découpe la table
// texte en utilisant les positions (en caractères) des colonnes de l'en-tête.
// winget aligne visuellement les colonnes sur un compte de caractères, d'où
// le découpage par indices de chars plutôt que d'octets.
pub fn parse_winget_upgrade_table(stdout: &str) -> Vec<WingetPackage> {
    let lignes: Vec<Vec<char>> = stdout.lines().map(|l| l.chars().collect()).collect();

    // L'en-tête précède la ligne de tirets de séparation.
    let mut idx_entete = None;
    for (i, ligne) in lignes.iter().enumerate().skip(1) {
        if ligne.len() > 10 && ligne.iter().take(4).all(|c| *c == '-') {
            idx_entete = Some(i - 1);
            break;
        }
    }
    let Some(h) = idx_entete else {
        return Vec::new();
    };

    // Positions de début des colonnes Nom, ID, Version, Disponible.
    let entete: String = lignes[h].iter().collect();
    let mut positions = Vec::new();
    let mut dans_mot = false;
    for (i, c) in entete.chars().enumerate() {
        if c.is_whitespace() {
            dans_mot = false;
        } else if !dans_mot {
            dans_mot = true;
            positions.push(i);
        }
    }
    if positions.len() < 4 {
        return Vec::new();
    }
    let (nom_p, id_p, ver_p, disp_p) = (positions[0], positions[1], positions[2], positions[3]);

    let mut paquets = Vec::new();
    for ligne in lignes.iter().skip(h + 2) {
        // Les lignes de résumé (« N mises à niveau disponibles. ») sont plus
        // courtes que la colonne « Disponible » : elles sont écartées ici.
        if ligne.len() <= disp_p {
            continue;
        }
        let tranche = |debut: usize, fin: usize| -> String {
            let fin = fin.min(ligne.len());
            if debut >= fin {
                return String::new();
            }
            ligne[debut..fin]
                .iter()
                .collect::<String>()
                .trim()
                .to_string()
        };

        let id = tranche(id_p, ver_p);
        // La tranche « Disponible » va jusqu'au bout de ligne et inclut
        // parfois la colonne « Source » collée : on ne garde que le 1er mot.
        let available = tranche(disp_p, usize::MAX)
            .split_whitespace()
            .next()
            .unwrap_or("")
            .to_string();
        if id.is_empty() || available.is_empty() {
            continue;
        }
        paquets.push(WingetPackage {
            name: tranche(nom_p, id_p),
            id,
            version: tranche(ver_p, disp_p),
            available,
        });
    }
    paquets
}

pub fn recenser_mises_a_jour() -> Result<Vec<WingetPackage>, String> {
    let child = spawn_winget(&[
        "upgrade",
        "--include-unknown",
        "--accept-source-agreements",
        "--disable-interactivity",
    ])?;
    let out = attendre_avec_timeout(child, 120, None)?;
    let paquets = parse_winget_upgrade_table(&String::from_utf8_lossy(&out.stdout));
    if paquets.is_empty() && !out.status.success() {
        return Err(format!(
            "Impossible de lister les mises à jour : {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(paquets)
}

#[tauri::command]
pub async fn list_available_updates() -> Result<Vec<WingetPackage>, String> {
    tauri::async_runtime::spawn_blocking(recenser_mises_a_jour)
        .await
        .map_err(|e| format!("Le recensement des mises à jour a échoué : {}", e))?
}

pub fn spawn_winget(args: &[&str]) -> Result<std::process::Child, String> {
    let essai = |exe: &str| -> Result<std::process::Child, String> {
        Command::new(exe)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags_windows_no_window()
            .spawn()
            .map_err(|e| format!("Impossible de lancer {} : {}", exe, e))
    };

    // winget est un alias d'exécution d'app : en cas d'échec via le PATH,
    // on retente l'alias explicite dans %LOCALAPPDATA%.
    if let Ok(child) = essai("winget") {
        return Ok(child);
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let exe = std::path::Path::new(&local).join(r"Microsoft\WindowsApps\winget.exe");
        if exe.exists() {
            return essai(&exe.to_string_lossy());
        }
    }
    Err(
        "winget est introuvable. Installez « App Installer » depuis le Microsoft Store \
         puis réessayez."
            .into(),
    )
}

// Taille récursive d'un fichier ou d'un répertoire.
pub fn taille_entree(path: &std::path::Path) -> u64 {
    if path.is_dir() {
        std::fs::read_dir(path)
            .map(|entries| entries.flatten().map(|e| taille_entree(&e.path())).sum())
            .unwrap_or(0)
    } else {
        std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
    }
}

// Supprime le contenu d'un répertoire (pas le répertoire lui-même).
// Retourne (nombre d'éléments purgés, total d'octets libérés).
pub fn purge_contenu_repertoire(dir: &std::path::Path) -> (usize, u64) {
    let mut nb = 0;
    let mut octets = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            let taille = taille_entree(&p);
            let ok = if p.is_dir() {
                std::fs::remove_dir_all(&p).is_ok()
            } else {
                std::fs::remove_file(&p).is_ok()
            };
            if ok {
                nb += 1;
                octets += taille;
            }
        }
    }
    (nb, octets)
}

pub fn taille_lisible(octets: u64) -> String {
    if octets >= 1024 * 1024 {
        format!("{:.1} Mo", octets as f64 / (1024.0 * 1024.0))
    } else if octets >= 1024 {
        format!("{:.1} Ko", octets as f64 / 1024.0)
    } else {
        format!("{} o", octets)
    }
}

// Lecture seule : recense les entrées de désinstallation orphelines (l'
// emplacement a disparu : ancienne version désinstallée dont il reste une
// trace) et les applications présentes en plusieurs versions, sources
// classiques de conflits. Rien n'est supprimé automatiquement ici.
pub const PS_SCAN_RESIDUS: &str = r#"
$paths = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
$apps = foreach ($p in $paths) { Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object DisplayName }
$orph = $apps | Where-Object { $_.InstallLocation -and -not (Test-Path ($_.InstallLocation.Trim('"'))) }
if ($orph) {
  'Anciennes versions orphelines (emplacement supprime, entree de registre restante) :'
  $orph | ForEach-Object { "  - {0} {1} -> {2}" -f $_.DisplayName, $_.DisplayVersion, $_.InstallLocation }
} else {
  'Aucune entree orpheline detectee.'
}
$dups = $apps | Group-Object DisplayName | Where-Object Count -gt 1
if ($dups) {
  ''
  'Applications presentes en plusieurs versions (risque de conflit) :'
  $dups | ForEach-Object { "  - {0} : {1}" -f $_.Name, ($_.Group.DisplayVersion -join ', ') }
} else {
  ''
  'Aucune application en double version.'
}
"#;

#[tauri::command]
pub async fn update_applications(
    ids: Vec<String>,
    entree_id: u64,
    app: tauri::AppHandle,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        mise_a_jour_applications(ids, Some((app, entree_id)))
    })
    .await
    .map_err(|e| format!("La mise à jour a échoué : {}", e))?
}

// winget signale qu'une mise à jour est installée mais ne sera finalisée
// qu'après fermeture/relance de l'application (paquets MSIX/appx exécutés
// pendant l'installation : Terminal, Photos, etc.) ou qu'un redémarrage du
// système est requis (MSI). Ces paquets restent listés comme « à mettre à
// jour » tant que la finalisation n'a pas eu lieu : il faut prévenir
// l'utilisateur pour éviter la confusion au prochain scan.
pub fn finalisation_requise(sortie: &str) -> bool {
    let lower = sortie.to_lowercase();
    lower.contains("redémar")
        || lower.contains("redemar")
        || lower.contains("restart the app")
        || lower.contains("restart the computer")
        || lower.contains("restart the system")
        || lower.contains("system restart")
}

pub fn mise_a_jour_applications(
    ids: Vec<String>,
    flux: Option<(tauri::AppHandle, u64)>,
) -> Result<CommandResult, String> {
    let elevated = is_elevated();
    let start = Instant::now();
    let mut rapport = String::new();
    let mut stderr_all = String::new();
    let mut echecs = 0usize;
    let mut a_finaliser: Vec<String> = Vec::new();

    // 1) Mise à jour de chaque application sélectionnée (par ID exact).
    if !ids.is_empty() {
        rapport.push_str("=== Mises à jour des applications ===\r\n");
    }
    for id in &ids {
        rapport.push_str(&format!("\r\n— {id} —\r\n"));
        let child = match spawn_winget(&[
            "upgrade",
            "--id",
            id,
            "--exact",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
            "--disable-interactivity",
        ]) {
            Ok(c) => c,
            Err(e) => {
                echecs += 1;
                stderr_all.push_str(&format!("{id} : {e}\r\n"));
                continue;
            }
        };
        if let Some((_, entree_id)) = &flux {
            enregistrer_processus(*entree_id, child.id());
        }
        log::info!("[maj-app] winget upgrade --id {id}");
        match attendre_avec_timeout(child, WINGET_TIMEOUT_SECONDES, flux.clone()) {
            Ok(out) => {
                let stdout_pkg = String::from_utf8_lossy(&out.stdout);
                rapport.push_str(&stdout_pkg);
                stderr_all.push_str(&String::from_utf8_lossy(&out.stderr));
                if finalisation_requise(&stdout_pkg) {
                    a_finaliser.push(id.clone());
                    rapport.push_str(&format!(
                        "\r\n⚠ La mise à jour de {id} est installée mais \
                         finalisée seulement à la fermeture/relance de \
                         l'application (ou au redémarrage du système). Elle \
                         continuera d'apparaître dans les scans d'ici là.\r\n"
                    ));
                }
                if let Some(code) = out.status.code() {
                    if code != 0 {
                        echecs += 1;
                        rapport.push_str(&format!("\r\n(code de sortie {code})\r\n"));
                    }
                }
            }
            Err(e) => {
                echecs += 1;
                stderr_all.push_str(&format!("{id} : {e}\r\n"));
                rapport.push_str(&format!("\r\n{e}\r\n"));
            }
        }
    }

    if !a_finaliser.is_empty() {
        rapport.push_str(&format!(
            "\r\n⚠ {nb} mise(s) à jour en attente de finalisation : {liste}.\r\n\
             Fermez puis rouvrez ces applications (ou redémarrez le PC) pour \
             terminer l'installation — d'ici là, elles resteront proposées par \
             le scan des mises à jour.\r\n",
            nb = a_finaliser.len(),
            liste = a_finaliser.join(", ")
        ));
    }

    if echecs > 0 {
        rapport.push_str(&format!(
            "\r\nNote : {echecs} mise(s) à jour en échec — le détail \
             est dans la sortie / stderr ci-dessus.\r\n"
        ));
    }

    // 2) Purge des installateurs temporaires laissés par winget
    //    (résidus d'anciennes versions téléchargées).
    rapport.push_str("\r\n\r\n=== Nettoyage des installateurs residuels ===\r\n");
    let mut caches: Vec<(&str, std::path::PathBuf)> =
        vec![("Cache utilisateur", std::env::temp_dir().join("WinGet"))];
    if let Some(windir) = std::env::var_os("SystemRoot") {
        caches.push((
            "Cache systeme",
            std::path::Path::new(&windir)
                .join("SystemTemp")
                .join("WinGet"),
        ));
    }
    for (label, dir) in caches {
        if dir.is_dir() {
            let (nb, octets) = purge_contenu_repertoire(&dir);
            rapport.push_str(&format!(
                "{} : {} element(s) purge(s), {} liberes — {}\r\n",
                label,
                nb,
                taille_lisible(octets),
                dir.display()
            ));
        } else {
            rapport.push_str(&format!("{} : rien a purger.\r\n", label));
        }
    }

    // 3) Détection des résidus d'anciennes versions (lecture seule).
    rapport.push_str("\r\n=== Residus d'anciennes versions ===\r\n");
    let child = spawn_powershell(PS_SCAN_RESIDUS, &[])?;
    match attendre_avec_timeout(child, 60, None) {
        Ok(out) => {
            rapport.push_str(&String::from_utf8_lossy(&out.stdout));
            stderr_all.push_str(&String::from_utf8_lossy(&out.stderr));
        }
        Err(e) => stderr_all.push_str(&e),
    }
    rapport.push_str(
        "\r\nAstuce : les entrees orphelines peuvent etre nettoyees via \
         « Parametres > Applications » ou en desinstallant l'ancienne version listee.\r\n",
    );

    Ok(CommandResult {
        stdout: rapport,
        stderr: stderr_all,
        exit_code: if echecs == 0 { Some(0) } else { Some(1) },
        duration_ms: start.elapsed().as_millis(),
        elevated,
    })
}

// Désinstalle une application par son identifiant winget exact. L'ID vient
// de notre propre scan ; on le revalide avant de le passer à winget (aucun
// séparateur de commande, pas d'espace) pour écarter toute injection. La
// sortie est diffusée en temps réel dans le terminal et journalisée.
#[tauri::command]
pub async fn desinstaller_application(
    id: String,
    entree_id: u64,
    app: tauri::AppHandle,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = id.trim();
        if id.is_empty()
            || id
                .chars()
                .any(|c| c.is_whitespace() || matches!(c, ';' | '|' | '&' | '<' | '>'))
        {
            return Err("Identifiant d'application invalide.".to_string());
        }
        let elevated = is_elevated();
        let start = Instant::now();
        log::info!("[desinstall] winget uninstall --id {id}");
        let child = spawn_winget(&[
            "uninstall",
            "--id",
            id,
            "--exact",
            "--silent",
            "--accept-source-agreements",
            "--disable-interactivity",
        ])?;
        enregistrer_processus(entree_id, child.id());
        let out = attendre_avec_timeout(child, WINGET_TIMEOUT_SECONDES, Some((app, entree_id)))?;
        desenregistrer_processus(entree_id);
        log::info!("[desinstall] {id} -> code {:?}", out.status.code());
        Ok(CommandResult {
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
            exit_code: out.status.code(),
            duration_ms: start.elapsed().as_millis(),
            elevated,
        })
    })
    .await
    .map_err(|e| format!("La désinstallation a échoué : {}", e))?
}
