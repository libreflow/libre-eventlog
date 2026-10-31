use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticalEvent {
    pub timestamp: String,
    pub canal: String,
    pub provider: String,
    pub event_id: u32,
    pub level: u8,
    pub severity: String,
    pub message_raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixEntry {
    pub titre: String,
    pub cause: String,
    pub etapes: Vec<String>,
    pub categorie: String,
    #[serde(default)]
    pub commandes: Vec<CommandeFix>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixLookup {
    pub version: u32,
    pub entries: Vec<FixEntryMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixEntryMatch {
    pub provider: String,
    pub event_id: u32,
    pub entry: FixEntry,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub event: CriticalEvent,
    pub fix: Option<FixEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandeFix {
    pub label: String,
    #[serde(default)]
    pub description: String,
    pub commande: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub elevation: bool,
    #[serde(default)]
    pub confirme: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub elevated: bool,
}

fn severity_label(level: u8) -> String {
    match level {
        1 => "Critique".to_string(),
        2 => "Erreur".to_string(),
        _ => "Inconnu".to_string(),
    }
}

#[tauri::command]
pub fn get_critical_events() -> Result<Vec<CriticalEvent>, String> {
    let canaux = ["System", "Application"];
    let mut events: Vec<CriticalEvent> = Vec::new();

    for canal in canaux {
        let query = "*[System[(Level=1 or Level=2)]]";
        let output = Command::new("wevtutil")
            .args([
                "qe",
                canal,
                &format!("/q:{}", query),
                "/c:50",
                "/rd:true",
                "/f:json",
            ])
            .output()
            .map_err(|e| format!("Impossible d'exécuter wevtutil : {}", e))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!(
                "Accès refusé ou canal inaccessible ({}) : {}",
                canal, err
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        events.extend(parse_wevtutil_json(&stdout, canal));
    }

    Ok(events)
}

fn parse_wevtutil_json(stdout: &str, canal: &str) -> Vec<CriticalEvent> {
    let mut events = Vec::new();

    // wevtutil /f:json renvoie soit un tableau, soit un objet unique
    let trimmed = stdout.trim();

    let json_value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return events,
    };

    let items: Vec<serde_json::Value> = match json_value {
        serde_json::Value::Array(arr) => arr,
        obj @ serde_json::Value::Object(_) => vec![obj],
        _ => return events,
    };

    for item in items {
        let system = match item.get("System") {
            Some(s) => s,
            None => continue,
        };

        let event_id = system
            .get("EventID")
            .and_then(|v| {
                v.as_u64()
                    .or_else(|| v.get("#text").and_then(|t| t.as_u64()))
            })
            .unwrap_or(0) as u32;

        let level = system
            .get("Level")
            .and_then(|v| {
                v.as_u64()
                    .or_else(|| v.get("#text").and_then(|t| t.as_u64()))
            })
            .unwrap_or(0) as u8;

        if level > 2 {
            continue;
        }

        let provider = system
            .get("Provider")
            .and_then(|p| p.get("Name"))
            .and_then(|n| n.as_str())
            .unwrap_or("Inconnu")
            .to_string();

        let timestamp = system
            .get("TimeCreated")
            .and_then(|t| t.get("SystemTime"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();

        let message_raw = item
            .get("EventData") // pas toujours présent
            .map(|d| serde_json::to_string_pretty(d).unwrap_or_default())
            .unwrap_or_default();

        events.push(CriticalEvent {
            timestamp,
            canal: canal.to_string(),
            provider,
            event_id,
            level,
            severity: severity_label(level),
            message_raw,
        });
    }

    events
}

const PS_DENYLIST: &[&str] = &[
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
    "format",
    "rd /s",
    "del /",
    "diskpart",
    "cipher /w",
    "sdelete",
    "reg delete",
];

fn commande_autorisee(cmd: &str) -> Result<(), String> {
    let lower = cmd.to_lowercase();
    for mot in PS_DENYLIST {
        if lower.contains(mot) {
            return Err(format!(
                "Commande refusée (opération potentiellement destructive détectée : {}).",
                mot
            ));
        }
    }
    Ok(())
}

fn is_elevated() -> bool {
    Command::new("net")
        .args(["session"])
        .creation_flags_windows_no_window()
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

trait NoWindow {
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

#[tauri::command]
pub fn check_elevation() -> bool {
    is_elevated()
}

#[tauri::command]
pub fn run_diagnostic_command(commande: String) -> Result<CommandResult, String> {
    commande_autorisee(&commande)?;

    let elevated = is_elevated();
    let start = Instant::now();

    // PowerShell : -NoProfile évite les scripts de profil, -NonInteractive
    // empêche toute invite bloquante, et CREATE_NO_WINDOW garantit qu'aucune
    // fenêtre console n'apparaît : tout est capturé et renvoyé à l'UI.
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &commande,
        ])
        .creation_flags_windows_no_window()
        .output()
        .map_err(|e| format!("Impossible de lancer PowerShell : {}", e))?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
        duration_ms: start.elapsed().as_millis(),
        elevated,
    })
}

#[tauri::command]
pub fn get_diagnostic(event: CriticalEvent) -> Result<Diagnostic, String> {
    let fix = lookup_fix(&event.provider, event.event_id);
    Ok(Diagnostic { event, fix })
}

fn load_knowledge_base() -> Vec<FixEntryMatch> {
    let raw = include_str!("../knowledge_base.json");
    let parsed: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let mut entries = Vec::new();

    if let Some(sources) = parsed.get("sources").and_then(|s| s.as_object()) {
        for (_canal, list) in sources {
            if let Some(arr) = list.as_array() {
                for entry in arr {
                    let provider = entry
                        .get("match")
                        .and_then(|m| m.get("provider"))
                        .and_then(|p| p.as_str())
                        .unwrap_or("")
                        .to_lowercase();
                    let event_id = entry
                        .get("match")
                        .and_then(|m| m.get("event_id"))
                        .and_then(|i| i.as_u64())
                        .unwrap_or(0) as u32;

                    let fix = FixEntry {
                        titre: entry
                            .get("titre")
                            .or_else(|| entry.get("title"))
                            .and_then(|t| t.as_str())
                            .unwrap_or("Diagnostic inconnu")
                            .to_string(),
                        cause: entry
                            .get("cause")
                            .and_then(|c| c.as_str())
                            .unwrap_or("")
                            .to_string(),
                        etapes: entry
                            .get("etapes")
                            .and_then(|e| e.as_array())
                            .map(|a| {
                                a.iter()
                                    .filter_map(|s| s.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        categorie: entry
                            .get("categorie")
                            .and_then(|c| c.as_str())
                            .unwrap_or("inconnu")
                            .to_string(),
                        commandes: entry
                            .get("commandes")
                            .and_then(|c| c.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|c| serde_json::from_value::<CommandeFix>(c.clone()).ok())
                                    .collect()
                            })
                            .unwrap_or_default(),
                    };

                    entries.push(FixEntryMatch {
                        provider,
                        event_id,
                        entry: fix,
                    });
                }
            }
        }
    }

    entries
}

fn lookup_fix(provider: &str, event_id: u32) -> Option<FixEntry> {
    let provider_lower = provider.to_lowercase();
    load_knowledge_base()
        .into_iter()
        .find(|m| {
            (m.provider.is_empty()
                || provider_lower.contains(&m.provider)
                || m.provider.contains(&provider_lower))
                && m.event_id == event_id
        })
        .map(|m| m.entry)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_critical_events,
            get_diagnostic,
            run_diagnostic_command,
            check_elevation
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Libre EventLog");
}
