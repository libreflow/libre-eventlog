use std::collections::HashMap;
use std::io::BufRead;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::{AppHandle, Emitter};

use crate::securite::{commande_autorisee, is_elevated};
use crate::types::{CommandResult, LigneTerminal};

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
    let out = attendre_avec_timeout(child, 30, None)?;
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

// ----- Processus actifs et annulation -----

// Identifiant d'entrée du terminal -> PID du processus en cours. Sert au
// bouton Annuler : tuer l'arbre complet (processus direct + enfants, ex.
// installateur lancé par winget ou sfc lancé par powershell).
fn processus_actifs() -> &'static Mutex<HashMap<u64, u32>> {
    static REGISTRE: OnceLock<Mutex<HashMap<u64, u32>>> = OnceLock::new();
    REGISTRE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn enregistrer_processus(entree_id: u64, pid: u32) {
    processus_actifs().lock().unwrap().insert(entree_id, pid);
}

fn desenregistrer_processus(entree_id: u64) {
    processus_actifs().lock().unwrap().remove(&entree_id);
}

// taskkill /T /F : tue l'arbre de processus complet. Un kill du seul
// processus direct laisserait les petits-fils (sfc, installateurs)
// tourner en écrivant dans des tubes désormais orphelins.
fn tuer_arbre(pid: u32) -> bool {
    Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags_windows_no_window()
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// Annule la commande associée à une entrée du terminal. Retourne false
// si l'entrée n'a plus de processus en cours (déjà terminée ou inconnue).
#[tauri::command]
pub async fn annuler_commande(entree_id: u64) -> Result<bool, String> {
    let pid = {
        let registre = processus_actifs().lock().unwrap();
        registre.get(&entree_id).copied()
    };
    match pid {
        Some(pid) => {
            let tue = tuer_arbre(pid);
            desenregistrer_processus(entree_id);
            if tue {
                Ok(true)
            } else {
                // Le processus a pu se terminer entre-temps : l'entrée
                // recevra son résultat normal, ce n'est pas une erreur.
                Ok(false)
            }
        }
        None => Ok(false),
    }
}

// Attend la fin d'un processus enfant avec un délai maximal ; au-delà,
// l'arbre de processus est tué (filet de sécurité contre les commandes
// bloquées). Les tubes stdout/stderr sont lus ligne par ligne dans des
// threads dédiés — sans eux, un processus produisant plus que le buffer
// du pipe (~4 Ko) bloque sur l'écriture et ne finit jamais (verrou
// mortel jusqu'au timeout).
//
// `flux` : quand il est fourni (handle Tauri + id d'entrée du terminal),
// chaque ligne est diffusée en temps réel via l'événement
// « terminal://ligne » — l'utilisateur voit la sortie d'un sfc /scannow
// ou d'un DISM s'afficher au fil de l'eau au lieu d'un silence de dizaines
// de minutes.
pub fn attendre_avec_timeout(
    mut child: std::process::Child,
    timeout_secondes: u64,
    flux: Option<(AppHandle, u64)>,
) -> Result<std::process::Output, String> {
    use std::sync::mpsc;

    const GRACE_SORTIE: std::time::Duration = std::time::Duration::from_secs(30);

    let (tx_out, rx_out) = mpsc::channel::<Vec<u8>>();
    let (tx_err, rx_err) = mpsc::channel::<Vec<u8>>();

    // Lecteur ligne à ligne : émet chaque ligne en temps réel si un canal
    // de flux est fourni, accumule le texte complet pour le CommandResult.
    fn lire_tube(
        pipe: impl std::io::Read,
        tx: mpsc::Sender<Vec<u8>>,
        flux: Option<(AppHandle, u64, &'static str)>,
    ) {
        let lecteur = std::io::BufReader::new(pipe);
        let mut accumule = String::new();
        for ligne in lecteur.lines() {
            match ligne {
                Ok(texte) => {
                    if let Some((app, id, canal)) = &flux {
                        let _ = app.emit(
                            "terminal://ligne",
                            LigneTerminal {
                                id: *id,
                                flux: (*canal).to_string(),
                                texte: texte.clone(),
                            },
                        );
                    }
                    accumule.push_str(&texte);
                    accumule.push('\n');
                }
                Err(_) => break,
            }
        }
        let _ = tx.send(accumule.into_bytes());
    }

    if let Some(mut pipe) = child.stdout.take() {
        let flux_thread = flux.as_ref().map(|(app, id)| (app.clone(), *id, "out"));
        std::thread::spawn(move || {
            lire_tube(&mut pipe, tx_out, flux_thread);
        });
    } else {
        let _ = tx_out.send(Vec::new());
    }
    if let Some(mut pipe) = child.stderr.take() {
        let flux_thread = flux.as_ref().map(|(app, id)| (app.clone(), *id, "err"));
        std::thread::spawn(move || {
            lire_tube(&mut pipe, tx_err, flux_thread);
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
                    // Tue l'arbre complet, pas seulement le processus direct :
                    // sfc/DISM/installateurs survivraient à un kill simple.
                    let _ = tuer_arbre(child.id());
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
    entree_id: u64,
    app: AppHandle,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        executer_commande_ps(commande, timeout_secs, Some((app, entree_id)))
    })
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
    flux: Option<(AppHandle, u64)>,
) -> Result<CommandResult, String> {
    let timeout = resoudre_timeout(timeout_secs);

    commande_autorisee(&commande)?;

    let elevated = is_elevated();
    let start = Instant::now();

    // PowerShell : -NoProfile évite les scripts de profil, -NonInteractive
    // empêche toute invite bloquante, et CREATE_NO_WINDOW garantit qu'aucune
    // fenêtre console n'apparaît : tout est capturé et renvoyé à l'UI.
    let child = spawn_powershell(&commande, &[])?;
    // Enregistre le PID pour le bouton Annuler (si un canal de flux existe,
    // c'est-à-dire si l'exécution est pilotée par une entrée du terminal).
    if let Some((_, entree_id)) = &flux {
        enregistrer_processus(*entree_id, child.id());
    }

    let output = attendre_avec_timeout(child, timeout, flux.clone());

    if let Some((_, entree_id)) = &flux {
        desenregistrer_processus(*entree_id);
    }

    let output = output?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
        duration_ms: start.elapsed().as_millis(),
        elevated,
    })
}
