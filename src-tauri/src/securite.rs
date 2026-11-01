use std::process::Command;

use crate::powershell::NoWindow;

pub const PS_DENYLIST: &[&str] = &[
    "format-volume",
    "remove-partition",
    "clear-disk",
    "initialize-disk",
    "remove-item",
    "remove-windowsdriver",
    "clear-content",
    "remove-eventlog",
    "limit-eventlog",
    "clear-eventlog",
    "reset-machinepassword",
    "rd /s",
    "del /",
    "diskpart",
    "cipher /w",
    "sdelete",
    "reg delete",
    // wevtutil et netsh sont des exécutables autorisés (lecture de journaux,
    // réinitialisation réseau) : leurs variantes destructives restent
    // interdites — effacement de canal (wevtutil cl) et pare-feu (netsh
    // advfirewall set/del).
    "wevtutil cl",
    "wevtutil clear-log",
    "advfirewall set",
    "advfirewall del",
    "advfirewall add",
];

// Liste blanche (deny-by-default) : chaque segment d'une commande (séparé
// par |, ; ou retour ligne) doit commencer par un exécutable autorisé ou
// un cmdlet dont le verbe est autorisé. La denylist reste en second filet.
pub const EXE_AUTORISES: &[&str] = &[
    "sfc", "dism", "chkdsk", "ipconfig", "netsh", "powercfg", "winget", "wevtutil", "whoami",
    "nslookup", "arp", "mdsched", "cleanmgr",
];
pub const VERBES_CMDLETS: &[&str] = &[
    "get", "show", "test", "measure", "repair", "resolve", "select", "where", "sort", "group",
    "format", "compare", "find", "read",
];

pub fn segment_autorise(segment: &str) -> bool {
    let premier = segment
        .trim_start()
        .split(|c: char| c.is_whitespace())
        .next()
        .unwrap_or("");
    if premier.is_empty() {
        return true; // segment vide (;;; consécutifs)
    }
    let lower = premier.to_lowercase();
    if EXE_AUTORISES.contains(&lower.as_str()) {
        return true;
    }
    if let Some((verbe, _)) = lower.split_once('-') {
        return VERBES_CMDLETS.contains(&verbe);
    }
    false
}

// Découpe une ligne PowerShell en segments de commande (séparateurs | ; et
// retours ligne) en respectant la syntaxe : les séparateurs situés dans des
// guillemets, des parenthèses ou des accolades (hashtable @{...}, bloc
// {...}) ne comptent pas.
pub fn segments_powershell(cmd: &str) -> Vec<String> {
    let mut segments = vec![String::new()];
    let mut profondeur = 0i32;
    let mut guillemet: Option<char> = None;
    for c in cmd.chars() {
        if let Some(q) = guillemet {
            segments.last_mut().unwrap().push(c);
            if c == q {
                guillemet = None;
            }
            continue;
        }
        match c {
            '\'' | '"' => {
                guillemet = Some(c);
                segments.last_mut().unwrap().push(c);
            }
            '(' | '{' => {
                profondeur += 1;
                segments.last_mut().unwrap().push(c);
            }
            ')' | '}' => {
                profondeur -= 1;
                segments.last_mut().unwrap().push(c);
            }
            ';' | '|' | '\n' if profondeur <= 0 => segments.push(String::new()),
            _ => segments.last_mut().unwrap().push(c),
        }
    }
    segments
}

pub fn commande_autorisee(cmd: &str) -> Result<(), String> {
    let lower = cmd.to_lowercase();
    for mot in PS_DENYLIST {
        if lower.contains(mot) {
            return Err(format!(
                "Commande refusée (opération potentiellement destructive détectée : {}).",
                mot
            ));
        }
    }
    for segment in segments_powershell(cmd) {
        if !segment_autorise(&segment) {
            return Err(format!(
                "Commande refusée : « {} » ne commence pas par un exécutable ou cmdlet autorisé (liste blanche).",
                segment.trim()
            ));
        }
    }
    Ok(())
}

pub fn is_elevated() -> bool {
    // Le niveau d'intégrité du token (S-1-16-12288 = élevé) est fiable même
    // quand le service Serveur est désactivé, contrairement à « net session »
    // qui reste en second recours pour les cas exotiques.
    let output = Command::new("whoami")
        .args(["/groups"])
        .creation_flags_windows_no_window()
        .output();
    if let Ok(o) = output {
        let groupes = String::from_utf8_lossy(&o.stdout);
        if groupes.contains("S-1-16-12288") {
            return true;
        }
        if groupes.contains("S-1-16-8192") {
            return false; // intégrité moyenne : non élevé, sans ambiguïté
        }
    }
    Command::new("net")
        .args(["session"])
        .creation_flags_windows_no_window()
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
