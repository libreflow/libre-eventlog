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
fn get_critical_events() -> Result<Vec<CriticalEvent>, String> {
    let mut events: Vec<CriticalEvent> = Vec::new();
    for canal in ["System", "Application"] {
        events.extend(query_canal(canal)?);
    }
    Ok(events)
}

fn query_canal(canal: &str) -> Result<Vec<CriticalEvent>, String> {
    // wevtutil ne supporte que les formats XML, Text et RenderedXml
    // (pas de JSON) : la sortie XML est parsée par parse_wevtutil_xml.
    let query = "*[System[(Level=1 or Level=2)]]";
    let output = Command::new("wevtutil")
        .args([
            "qe",
            canal,
            &format!("/q:{}", query),
            "/c:50",
            "/rd:true",
            "/f:XML",
        ])
        .creation_flags_windows_no_window()
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
    Ok(parse_wevtutil_xml(&stdout, canal))
}

// wevtutil émet des timestamps avec jusqu'à 9 chiffres de fraction
// (ex. 2026-10-31T23:41:02.1836450Z) ; on normalise en RFC3339
// millisecondes pour que new Date() côté frontend les parse toujours.
fn normalize_timestamp(raw: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(raw) {
        Ok(dt) => dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        Err(_) => raw.to_string(),
    }
}

fn parse_wevtutil_xml(stdout: &str, canal: &str) -> Vec<CriticalEvent> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(stdout);
    reader.config_mut().trim_text(true);

    let mut events = Vec::new();
    let mut buf = Vec::new();

    // Champs de l'événement en cours de lecture
    let mut provider = String::new();
    let mut event_id: u32 = 0;
    let mut level: u8 = 0;
    let mut timestamp = String::new();
    let mut event_data: Option<serde_json::Map<String, serde_json::Value>> = None;
    let mut pending_data_name: Option<String> = None;
    let mut cur_elem = String::new();

    fn attr_value(e: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<String> {
        e.attributes()
            .flatten()
            .find(|a| a.key.as_ref() == key)
            .and_then(|a| {
                a.normalized_value(quick_xml::XmlVersion::Explicit1_0)
                    .ok()
                    .map(|s| s.into_owned())
            })
    }

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = e.name().as_ref().to_string();
                match name.as_str() {
                    "Provider" => {
                        provider = attr_value(&e, "Name").unwrap_or_default();
                    }
                    "TimeCreated" => {
                        if let Some(t) = attr_value(&e, "SystemTime") {
                            timestamp = normalize_timestamp(&t);
                        }
                    }
                    "EventData" => {
                        event_data = Some(serde_json::Map::new());
                    }
                    "Data" => {
                        let idx = event_data.as_ref().map(|m| m.len()).unwrap_or(0);
                        let name = attr_value(&e, "Name")
                            .unwrap_or_else(|| format!("Data {}", idx));
                        pending_data_name = Some(name);
                    }
                    _ => {}
                }
                cur_elem = name;
            }
            Ok(Event::Empty(e)) => {
                // Éléments auto-fermants : <Provider/>, <TimeCreated/>,
                // <Data Name='X'/> sans valeur (chaîne vide insérée)
                match e.name().as_ref() {
                    "Provider" => {
                        provider = attr_value(&e, "Name").unwrap_or_default();
                    }
                    "TimeCreated" => {
                        if let Some(t) = attr_value(&e, "SystemTime") {
                            timestamp = normalize_timestamp(&t);
                        }
                    }
                    "Data" => {
                        if let Some(map) = event_data.as_mut() {
                            let key = attr_value(&e, "Name")
                                .unwrap_or_else(|| format!("Data {}", map.len()));
                            map.insert(key, serde_json::Value::String(String::new()));
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(t)) => {
                let txt = t.xml10_content().into_owned();
                match cur_elem.as_str() {
                    "EventID" => event_id = txt.parse().unwrap_or(0),
                    "Level" => level = txt.parse().unwrap_or(0),
                    "Data" => {
                        if let (Some(map), Some(name)) =
                            (event_data.as_mut(), pending_data_name.take())
                        {
                            map.insert(name, serde_json::Value::String(txt));
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                if e.name().as_ref() == "Event" {
                    if level <= 2 {
                        let message_raw = event_data
                            .as_ref()
                            .map(|m| serde_json::to_string_pretty(m).unwrap_or_default())
                            .unwrap_or_default();
                        events.push(CriticalEvent {
                            timestamp: timestamp.clone(),
                            canal: canal.to_string(),
                            provider: provider.clone(),
                            event_id,
                            level,
                            severity: severity_label(level),
                            message_raw,
                        });
                    }
                    provider.clear();
                    event_id = 0;
                    level = 0;
                    timestamp.clear();
                    event_data = None;
                    pending_data_name = None;
                }
                cur_elem.clear();
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
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
fn check_elevation() -> bool {
    is_elevated()
}

#[tauri::command]
fn run_diagnostic_command(commande: String) -> Result<CommandResult, String> {
    const TIMEOUT_SECONDES: u64 = 120;

    commande_autorisee(&commande)?;

    let elevated = is_elevated();
    let start = Instant::now();

    // PowerShell : -NoProfile évite les scripts de profil, -NonInteractive
    // empêche toute invite bloquante, et CREATE_NO_WINDOW garantit qu'aucune
    // fenêtre console n'apparaît : tout est capturé et renvoyé à l'UI.
    let mut child = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &commande,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags_windows_no_window()
        .spawn()
        .map_err(|e| format!("Impossible de lancer PowerShell : {}", e))?;

    // Filet de sécurité : une commande bloquée trop longtemps (ex. scan long
    // ou cmdlet interactive malgré -NonInteractive) est tuée après 120 s.
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed().as_secs() >= TIMEOUT_SECONDES {
                    let _ = child.kill();
                    return Err(format!(
                        "Commande annulée : délai de {} s dépassé.",
                        TIMEOUT_SECONDES
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(format!("Erreur pendant l'exécution : {}", e)),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Impossible de lire la sortie : {}", e))?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
        duration_ms: start.elapsed().as_millis(),
        elevated,
    })
}

#[tauri::command]
fn get_diagnostic(event: CriticalEvent) -> Result<Diagnostic, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    // Sortie réelle de : wevtutil qe System /q:... /c:1 /rd:true /f:XML
    const SAMPLE_XML: &str = r#"<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Volsnap' Guid='{cb017cd2-1f37-4e65-82bc-3e91f6a37559}' EventSourceName='volsnap'/><EventID Qualifiers='49158'>25</EventID><Version>0</Version><Level>2</Level><Task>0</Task><Opcode>0</Opcode><Keywords>0x80000000000000</Keywords><TimeCreated SystemTime='2026-10-31T23:41:02.1836450Z'/><EventRecordID>14312</EventRecordID><Correlation/><Execution ProcessID='4' ThreadID='7028'/><Channel>System</Channel><Computer>FSOCIETY</Computer><Security/></System><EventData><Data Name='DeviceName'>\Device\HarddiskVolumeShadowCopy5</Data><Data Name='VolumeName'>C:</Data><Data Name='NTSTATUS'>00000000</Data></EventData></Event>"#;

    #[test]
    fn parse_xml_evenement_unique() {
        let events = parse_wevtutil_xml(SAMPLE_XML, "System");
        assert_eq!(events.len(), 1);
        let e = &events[0];
        assert_eq!(e.provider, "Volsnap");
        assert_eq!(e.event_id, 25);
        assert_eq!(e.level, 2);
        assert_eq!(e.severity, "Erreur");
        assert_eq!(e.canal, "System");
        // fraction 7 chiffres normalisée en millisecondes
        assert_eq!(e.timestamp, "2026-10-31T23:41:02.183Z");
        assert!(e.message_raw.contains("DeviceName"));
        assert!(e.message_raw.contains("HarddiskVolumeShadowCopy5"));
    }

    #[test]
    fn parse_xml_plusieurs_evenements() {
        // wevtutil émet les événements les uns à la suite (un par ligne)
        let stdout = format!("{}\n{}", SAMPLE_XML, SAMPLE_XML);
        let events = parse_wevtutil_xml(&stdout, "System");
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn parse_xml_filtre_niveaux_superieurs() {
        let level4 = SAMPLE_XML.replace("<Level>2</Level>", "<Level>4</Level>");
        assert!(parse_wevtutil_xml(&level4, "System").is_empty());
    }

    #[test]
    fn parse_xml_champs_manquants() {
        let mute = r#"<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='X'/><EventID>1</EventID><Level>1</Level></System></Event>"#;
        let events = parse_wevtutil_xml(mute, "Application");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].provider, "X");
        assert_eq!(events[0].event_id, 1);
        assert_eq!(events[0].severity, "Critique");
        assert_eq!(events[0].message_raw, "");
    }

    #[test]
    fn denylist_bloque_destructif_autorise_lecture() {
        // cmdlets de mise en forme (lecture seule) utilisées par la base
        assert!(commande_autorisee(
            "Get-PhysicalDisk | Select-Object FriendlyName | Format-Table -AutoSize"
        )
        .is_ok());
        assert!(commande_autorisee("Get-WinEvent -MaxEvents 1 | Format-List").is_ok());
        // opérations destructives
        assert!(commande_autorisee("Format-Volume -DriveLetter C").is_err());
        assert!(commande_autorisee(r"Remove-Item C:\Windows\Temp\x").is_err());
        assert!(commande_autorisee(r"REG DELETE HKLM\Software\X /f").is_err());
        assert!(commande_autorisee(r"cipher /w:C:\").is_err());
    }

    // Intégration : exécute le vrai wevtutil avec les arguments de
    // production et vérifie que le parsing aboutit.
    #[test]
    fn wevtutil_reel_system() {
        let events = query_canal("System").expect("la requête wevtutil doit réussir");
        for e in &events {
            assert_eq!(e.canal, "System");
            assert!(e.level == 1 || e.level == 2, "level inattendu : {}", e.level);
            assert!(!e.provider.is_empty());
            // timestamp normalisé, parsable par new Date()
            assert!(
                chrono::DateTime::parse_from_rfc3339(&e.timestamp).is_ok(),
                "timestamp non RFC3339 : {}",
                e.timestamp
            );
        }
    }
}
