use std::process::Command;
use std::time::Instant;

use crate::securite::{commande_autorisee, is_elevated};
use crate::types::CommandResult;

// Relance l'application en administrateur (invite UAC) via ShellExecute.
// async + spawn_blocking : la commande attend jusqu'à 30 s que
// l'utilisateur réponde à l'invite UAC — en synchrone, elle gèlerait le
// thread principal et toute l'interface.
#[tauri::command]
pub async fn relancer_admin() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(relancer_admin_bloquant)
        .await
        .map_err(|e| format!("La relance en administrateur a échoué : {}", e))?
}

pub fn relancer_admin_bloquant() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("Exécutable introuvable : {}", e))?;
    // Échappement PowerShell des guillemets simples ('' dans une chaîne
    // '…') : un chemin contenant une apostrophe ne doit pas casser la commande.
    let exe_escaped = exe.display().to_string().replace('\'', "''");
    let child = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!("Start-Process -FilePath '{exe_escaped}' -Verb RunAs"),
        ])
        .creation_flags_windows_no_window()
        .spawn()
        .map_err(|e| format!("Impossible de relancer l'application : {}", e))?;
    let out = attendre_avec_timeout(child, 30)?;
    if !out.status.success() {
        return Err("La relance en administrateur a été refusée ou a échoué (invite UAC).".into());
    }
    Ok(())
}

pub trait NoWindow {
    fn creation_flags_windows_no_window(&mut self) -> &mut Self;
}

#[cfg(windows)]
impl NoWindow for Command {
    fn creation_flags_windows_no_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        self.creation_flags(CREATE_NO_WINDOW);
        self
    }
}

#[cfg(not(windows))]
impl NoWindow for Command {
    fn creation_flags_windows_no_window(&mut self) -> &mut Self {
        self
    }
}

// whoami /groups est un processus externe (~100 ms) : async pour ne pas
// bloquer le thread principal au démarrage de l'interface.
#[tauri::command]
pub async fn check_elevation() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(is_elevated)
        .await
        .map_err(|e| format!("La vérification des droits a échoué : {}", e))
}

// Attend la fin d'un processus enfant avec un délai maximal ; au-delà,
// le processus est tué (filet de sécurité contre les commandes bloquées).
// Les tubes stdout/stderr sont vidés dans des threads dédiés : sans cela,
// un processus produisant plus que le buffer du pipe (~4 Ko) bloque sur
// l'écriture et n'existe jamais (verrou mortel jusqu'au timeout).
pub fn attendre_avec_timeout(
    mut child: std::process::Child,
    timeout_secondes: u64,
) -> Result<std::process::Output, String> {
    use std::io::Read;
    use std::sync::mpsc;

    const GRACE_SORTIE: std::time::Duration = std::time::Duration::from_secs(30);

    let (tx_out, rx_out) = mpsc::channel::<Vec<u8>>();
    let (tx_err, rx_err) = mpsc::channel::<Vec<u8>>();

    if let Some(mut pipe) = child.stdout.take() {
        std::thread::spawn(move || {
            let mut tampon = Vec::new();
            let _ = pipe.read_to_end(&mut tampon);
            let _ = tx_out.send(tampon);
        });
    } else {
        let _ = tx_out.send(Vec::new());
    }
    if let Some(mut pipe) = child.stderr.take() {
        std::thread::spawn(move || {
            let mut tampon = Vec::new();
            let _ = pipe.read_to_end(&mut tampon);
            let _ = tx_err.send(tampon);
        });
    } else {
        let _ = tx_err.send(Vec::new());
    }

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed().as_secs() >= timeout_secondes {
                    let _ = child.kill();
                    return Err(format!(
                        "Commande annulée : délai de {} s dépassé.",
                        timeout_secondes
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(format!("Erreur pendant l'exécution : {}", e)),
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Impossible d'obtenir le statut de sortie : {}", e))?;

    // Délai de grâce : un processus petit-fils (ex. installateur lancé par
    // winget) peut garder le tube ouvert après la sortie du processus direct.
    let stdout = rx_out.recv_timeout(GRACE_SORTIE).unwrap_or_default();
    let stderr = rx_err.recv_timeout(GRACE_SORTIE).unwrap_or_default();

    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

// Force la sortie de powershell.exe en UTF-8 : redirigé (sans console),
// PowerShell encode son texte dans le code page OEM (CP850 en français).
// Les accents (« Mise à jour », « Réussi »…) devenaient alors des
// caractères de remplacement après String::from_utf8_lossy.
pub const PS_UTF8: &str = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;";

// Lance PowerShell avec les options durcies (-NoProfile, -NonInteractive,
// CREATE_NO_WINDOW, stdin fermé) et la sortie forcée en UTF-8.
// `extra_args` est passé au script via $args (installation WU).
pub fn spawn_powershell(
    script: &str,
    extra_args: &[String],
) -> Result<std::process::Child, String> {
    let commande = format!("{PS_UTF8}{script}");
    let mut args: Vec<String> = vec![
        "-NoProfile".into(),
        "-NonInteractive".into(),
        "-ExecutionPolicy".into(),
        "Bypass".into(),
        "-Command".into(),
        commande,
    ];
    args.extend(extra_args.iter().cloned());
    Command::new("powershell.exe")
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags_windows_no_window()
        .spawn()
        .map_err(|e| format!("Impossible de lancer PowerShell : {}", e))
}

#[tauri::command]
pub async fn run_diagnostic_command(
    commande: String,
    timeout_secs: Option<u64>,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || executer_commande_ps(commande, timeout_secs))
        .await
        .map_err(|e| format!("La commande a échoué : {}", e))?
}

// Défaut 120 s ; plafonné pour qu'une commande compromise ne puisse pas
// maintenir un processus PowerShell indéfiniment. Les correctifs longs
// (sfc, DISM RestoreHealth, chkdsk…) demandent explicitement plus.
pub fn resoudre_timeout(timeout_secs: Option<u64>) -> u64 {
    const DEFAUT: u64 = 120;
    const PLAFOND: u64 = 7200;
    timeout_secs.unwrap_or(DEFAUT).clamp(1, PLAFOND)
}

pub fn executer_commande_ps(
    commande: String,
    timeout_secs: Option<u64>,
) -> Result<CommandResult, String> {
    let timeout = resoudre_timeout(timeout_secs);

    commande_autorisee(&commande)?;

    let elevated = is_elevated();
    let start = Instant::now();

    // PowerShell : -NoProfile évite les scripts de profil, -NonInteractive
    // empêche toute invite bloquante, et CREATE_NO_WINDOW garantit qu'aucune
    // fenêtre console n'apparaît : tout est capturé et renvoyé à l'UI.
    let child = spawn_powershell(&commande, &[])?;

    let output = attendre_avec_timeout(child, timeout)?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
        duration_ms: start.elapsed().as_millis(),
        elevated,
    })
}
