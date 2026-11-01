use std::process::Command;

use crate::powershell::NoWindow;
use crate::securite::is_elevated;
use crate::types::*;

// Les commandes Tauri synchrones s'exécutent sur le thread principal : les
// commandes lourdes ci-dessous sont donc `async` et délèguent le travail
// bloquant à `spawn_blocking` pour ne jamais geler l'interface.

#[tauri::command]
pub async fn get_critical_events(
    limit: Option<u32>,
    inclure_avertissements: Option<bool>,
    depuis_ms: Option<u64>,
) -> Result<CollecteResult, String> {
    let res = tauri::async_runtime::spawn_blocking(move || {
        collecter_evenements(
            limit.unwrap_or(50).min(2000),
            inclure_avertissements.unwrap_or(false),
            depuis_ms,
        )
    })
    .await
    .map_err(|e| format!("La collecte des événements a échoué : {}", e))?;
    Ok(res)
}

pub fn collecter_evenements(limit: u32, avert: bool, depuis_ms: Option<u64>) -> CollecteResult {
    let elevated = is_elevated();
    let mut canaux: Vec<&str> = vec![
        "System",
        "Application",
        "Microsoft-Windows-WHEA-Logger/Operational",
        "Microsoft-Windows-Diagnostics-Performance/Operational",
    ];
    // Le canal Security n'est lisible qu'en administrateur ; il est ignoré
    // avec un avertissement explicite sinon.
    if elevated {
        canaux.push("Security");
    }

    let mut resultat = CollecteResult {
        events: Vec::new(),
        avertissements: Vec::new(),
    };
    if !elevated {
        resultat.avertissements.push(
            "Canal Security ignoré : relancez l'application en administrateur pour l'inclure."
                .into(),
        );
    }
    for canal in canaux {
        match query_canal(canal, limit, avert, depuis_ms) {
            Ok(mut ev) => resultat.events.append(&mut ev),
            Err(e) => resultat.avertissements.push(e),
        }
    }
    // Tri décroissant garanti côté backend (timestamps RFC3339 normalisés,
    // donc comparables lexicographiquement).
    resultat
        .events
        .sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    resultat
}

// wevtutil émet son XML en UTF-8 mais ses messages d'erreur dans le code
// page ANSI (Windows-1252 en français : « Accès refusé », « Le canal
// n'existe pas »…). UTF-8 strict d'abord, repli Windows-1252 sinon :
// identique à Latin-1 pour 0xA0-0xFF, table dédiée pour 0x80-0x9F.
pub fn decoder_console(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    const CP1252_HAUT: [char; 32] = [
        '\u{20AC}', '\u{FFFD}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}',
        '\u{2021}', '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{FFFD}',
        '\u{017D}', '\u{FFFD}', '\u{FFFD}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}',
        '\u{2022}', '\u{2013}', '\u{2014}', '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}',
        '\u{0153}', '\u{FFFD}', '\u{017E}', '\u{0178}',
    ];
    bytes
        .iter()
        .map(|&b| match b {
            0x80..=0x9F => CP1252_HAUT[(b - 0x80) as usize],
            _ => b as char,
        })
        .collect()
}

pub fn query_canal(
    canal: &str,
    limit: u32,
    avert: bool,
    depuis_ms: Option<u64>,
) -> Result<Vec<CriticalEvent>, String> {
    // wevtutil ne supporte que les formats XML, Text et RenderedXml
    // (pas de JSON) : la sortie XML est parsée par parse_wevtutil_xml.
    // Le canal Security a des niveaux atypiques (les échecs d'audit sont de
    // niveau 0) : on y inclut explicitement les échecs de connexion (4625).
    // `depuis_ms` filtre COTE WEVTUTIL (timediff) : avec une limite par
    // canal, un filtrage post-hoc côté frontend ratait des événements
    // récents noyés sous des plus anciens.
    let niveaux = if canal == "Security" {
        "(Level=1 or Level=2 or EventID=4625)"
    } else if avert {
        "(Level=1 or Level=2 or Level=3)"
    } else {
        "(Level=1 or Level=2)"
    };
    let filtre = match depuis_ms {
        Some(ms) => format!("*[System[{niveaux} and timediff(@SystemTime) <= {ms}]]"),
        None => format!("*[System[{niveaux}]]"),
    };
    let query = &filtre;
    let output = Command::new("wevtutil")
        .args([
            "qe",
            canal,
            &format!("/q:{}", query),
            &format!("/c:{}", limit),
            "/rd:true",
            "/f:XML",
        ])
        .creation_flags_windows_no_window()
        .output()
        .map_err(|e| format!("Impossible d'exécuter wevtutil : {}", e))?;

    if !output.status.success() {
        let err = decoder_console(&output.stderr).trim().to_string();
        return Err(format!("Canal inaccessible ({}) : {}", canal, err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(parse_wevtutil_xml(&stdout, canal))
}

// wevtutil émet des timestamps avec jusqu'à 9 chiffres de fraction
// (ex. 2026-10-31T23:41:02.1836450Z) ; on normalise en RFC3339
// millisecondes pour que new Date() côté frontend les parse toujours.
pub fn normalize_timestamp(raw: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(raw) {
        Ok(dt) => dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        Err(_) => raw.to_string(),
    }
}

pub fn parse_wevtutil_xml(stdout: &str, canal: &str) -> Vec<CriticalEvent> {
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
    let mut process_id: Option<u32> = None;
    let mut thread_id: Option<u32> = None;
    let mut computer = String::new();
    let mut record_id: u64 = 0;
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
                    "Execution" => {
                        process_id = attr_value(&e, "ProcessID").and_then(|v| v.parse().ok());
                        thread_id = attr_value(&e, "ThreadID").and_then(|v| v.parse().ok());
                    }
                    "EventData" => {
                        event_data = Some(serde_json::Map::new());
                    }
                    "Data" => {
                        let idx = event_data.as_ref().map(|m| m.len()).unwrap_or(0);
                        let name =
                            attr_value(&e, "Name").unwrap_or_else(|| format!("Data {}", idx));
                        pending_data_name = Some(name);
                    }
                    _ => {}
                }
                cur_elem = name;
            }
            Ok(Event::Empty(e)) => {
                // Éléments auto-fermants : <Provider/>, <TimeCreated/>,
                // <Execution/>, <Data Name='X'/> sans valeur (chaîne vide)
                match e.name().as_ref() {
                    "Provider" => {
                        provider = attr_value(&e, "Name").unwrap_or_default();
                    }
                    "TimeCreated" => {
                        if let Some(t) = attr_value(&e, "SystemTime") {
                            timestamp = normalize_timestamp(&t);
                        }
                    }
                    "Execution" => {
                        process_id = attr_value(&e, "ProcessID").and_then(|v| v.parse().ok());
                        thread_id = attr_value(&e, "ThreadID").and_then(|v| v.parse().ok());
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
                    "Computer" => computer = txt,
                    "EventRecordID" => record_id = txt.parse().unwrap_or(0),
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
                    if level <= 3 {
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
                            process_id,
                            thread_id,
                            computer: computer.clone(),
                            record_id,
                        });
                    }
                    provider.clear();
                    event_id = 0;
                    level = 0;
                    timestamp.clear();
                    process_id = None;
                    thread_id = None;
                    computer.clear();
                    record_id = 0;
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
