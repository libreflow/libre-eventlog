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
    #[serde(default)]
    pub process_id: Option<u32>,
    #[serde(default)]
    pub thread_id: Option<u32>,
    #[serde(default)]
    pub computer: String,
    #[serde(default)]
    pub record_id: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollecteResult {
    pub events: Vec<CriticalEvent>,
    pub avertissements: Vec<String>,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WingetPackage {
    pub name: String,
    pub id: String,
    pub version: String,
    pub available: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WinUpdate {
    pub update_id: String,
    pub title: String,
    pub kind: String,
    pub size_mb: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub manufacturer: String,
    pub model: String,
    pub bios_version: String,
    pub bios_date: String,
    pub serial: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemDevice {
    pub name: String,
    pub instance_id: String,
    pub problem_code: String,
    pub status: String,
}

fn severity_label(level: u8) -> String {
    match level {
        1 => "Critique".to_string(),
        2 => "Erreur".to_string(),
        3 => "Avertissement".to_string(),
        0 => "Info".to_string(),
        _ => "Inconnu".to_string(),
    }
}

// Les commandes Tauri synchrones s'exécutent sur le thread principal : les
// commandes lourdes ci-dessous sont donc `async` et délèguent le travail
// bloquant à `spawn_blocking` pour ne jamais geler l'interface.

#[tauri::command]
async fn get_critical_events(
    limit: Option<u32>,
    inclure_avertissements: Option<bool>,
) -> Result<CollecteResult, String> {
    let res = tauri::async_runtime::spawn_blocking(move || {
        collecter_evenements(limit.unwrap_or(50).min(2000), inclure_avertissements.unwrap_or(false))
    })
    .await
    .map_err(|e| format!("La collecte des événements a échoué : {}", e))?;
    Ok(res)
}

fn collecter_evenements(limit: u32, avert: bool) -> CollecteResult {
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
            "Canal Security ignoré : relancez l'application en administrateur pour l'inclure.".into(),
        );
    }
    for canal in canaux {
        match query_canal(canal, limit, avert) {
            Ok(mut ev) => resultat.events.append(&mut ev),
            Err(e) => resultat.avertissements.push(e),
        }
    }
    // Tri décroissant garanti côté backend (timestamps RFC3339 normalisés,
    // donc comparables lexicographiquement).
    resultat.events.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    resultat
}

fn query_canal(canal: &str, limit: u32, avert: bool) -> Result<Vec<CriticalEvent>, String> {
    // wevtutil ne supporte que les formats XML, Text et RenderedXml
    // (pas de JSON) : la sortie XML est parsée par parse_wevtutil_xml.
    // Le canal Security a des niveaux atypiques (les échecs d'audit sont de
    // niveau 0) : on y inclut explicitement les échecs de connexion (4625).
    let query = if canal == "Security" {
        "*[System[(Level=1 or Level=2 or EventID=4625)]]"
    } else if avert {
        "*[System[(Level=1 or Level=2 or Level=3)]]"
    } else {
        "*[System[(Level=1 or Level=2)]]"
    };
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
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Canal inaccessible ({}) : {}", canal, err));
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
                        process_id = attr_value(&e, "ProcessID")
                            .and_then(|v| v.parse().ok());
                        thread_id = attr_value(&e, "ThreadID")
                            .and_then(|v| v.parse().ok());
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
                        process_id = attr_value(&e, "ProcessID")
                            .and_then(|v| v.parse().ok());
                        thread_id = attr_value(&e, "ThreadID")
                            .and_then(|v| v.parse().ok());
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

// Relance l'application en administrateur (invite UAC) via ShellExecute.
#[tauri::command]
fn relancer_admin() -> Result<(), String> {
    let exe =
        std::env::current_exe().map_err(|e| format!("Exécutable introuvable : {}", e))?;
    let child = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!("Start-Process -FilePath '{}' -Verb RunAs", exe.display()),
        ])
        .creation_flags_windows_no_window()
        .spawn()
        .map_err(|e| format!("Impossible de relancer l'application : {}", e))?;
    let out = attendre_avec_timeout(child, 30)?;
    if !out.status.success() {
        return Err(
            "La relance en administrateur a été refusée ou a échoué (invite UAC).".into(),
        );
    }
    Ok(())
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

// Attend la fin d'un processus enfant avec un délai maximal ; au-delà,
// le processus est tué (filet de sécurité contre les commandes bloquées).
// Les tubes stdout/stderr sont vidés dans des threads dédiés : sans cela,
// un processus produisant plus que le buffer du pipe (~4 Ko) bloque sur
// l'écriture et n'existe jamais (verrou mortel jusqu'au timeout).
fn attendre_avec_timeout(
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

#[tauri::command]
async fn run_diagnostic_command(
    commande: String,
    timeout_secs: Option<u64>,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        executer_commande_ps(commande, timeout_secs)
    })
    .await
    .map_err(|e| format!("La commande a échoué : {}", e))?
}

// Défaut 120 s ; plafonné pour qu'une commande compromise ne puisse pas
// maintenir un processus PowerShell indéfiniment. Les correctifs longs
// (sfc, DISM RestoreHealth, chkdsk…) demandent explicitement plus.
fn resoudre_timeout(timeout_secs: Option<u64>) -> u64 {
    const DEFAUT: u64 = 120;
    const PLAFOND: u64 = 7200;
    timeout_secs.unwrap_or(DEFAUT).clamp(1, PLAFOND)
}

fn executer_commande_ps(
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
    let child = Command::new("powershell.exe")
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

    let output = attendre_avec_timeout(child, timeout)?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
        duration_ms: start.elapsed().as_millis(),
        elevated,
    })
}

const WINGET_TIMEOUT_SECONDES: u64 = 600;

// winget 1.x n'a pas de sortie JSON pour `upgrade` : on découpe la table
// texte en utilisant les positions (en caractères) des colonnes de l'en-tête.
// winget aligne visuellement les colonnes sur un compte de caractères, d'où
// le découpage par indices de chars plutôt que d'octets.
fn parse_winget_upgrade_table(stdout: &str) -> Vec<WingetPackage> {
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

fn recenser_mises_a_jour() -> Result<Vec<WingetPackage>, String> {
    let child = spawn_winget(&[
        "upgrade",
        "--include-unknown",
        "--accept-source-agreements",
        "--disable-interactivity",
    ])?;
    let out = attendre_avec_timeout(child, 120)?;
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
async fn list_available_updates() -> Result<Vec<WingetPackage>, String> {
    tauri::async_runtime::spawn_blocking(recenser_mises_a_jour)
        .await
        .map_err(|e| format!("Le recensement des mises à jour a échoué : {}", e))?
}

// ----- Mises à jour Windows & pilotes (API COM Windows Update) -----

const WU_SCAN_TIMEOUT_SECONDES: u64 = 600;
const WU_INSTALL_TIMEOUT_SECONDES: u64 = 1800;

// Lecture seule : recherche les mises à jour applicables (logiciels et
// pilotes) via l'agent Windows Update. Chaque ligne : GUID|type|Mo|titre.
const PS_WU_SCAN: &str = r#"
$ErrorActionPreference = 'Stop'
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$result = $searcher.Search("IsInstalled=0 and IsHidden=0")
$result.Updates | ForEach-Object {
  $kind = if ($_.Type -eq 'Driver') { 'Driver' } else { 'Software' }
  "{0}|{1}|{2}|{3}" -f $_.Identity.UpdateID, $kind, [math]::Round($_.MaxDownloadContentBytes/1MB,1), ($_.Title -replace '\|',' ')
}
"#;

// Les identifiants viennent de notre propre scan ; on les revalide avant
// de les passer à PowerShell pour écarter toute injection.
fn id_wu_valide(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-' || c == '{' || c == '}')
}

fn parse_wu_scan(stdout: &str) -> Vec<WinUpdate> {
    let mut maj = Vec::new();
    for ligne in stdout.lines() {
        let mut champs = ligne.splitn(4, '|');
        let (Some(id), Some(kind), Some(taille), Some(titre)) = (
            champs.next(),
            champs.next(),
            champs.next(),
            champs.next(),
        ) else {
            continue;
        };
        if !id_wu_valide(id) {
            continue;
        }
        maj.push(WinUpdate {
            update_id: id.to_string(),
            kind: kind.to_string(),
            // PowerShell formate les décimaux selon la culture du système :
            // en français la virgule est le séparateur (« 12,5 »).
            size_mb: taille.trim().replace(',', ".").parse().unwrap_or(0.0),
            title: titre.to_string(),
        });
    }
    maj
}

fn recenser_mises_a_jour_windows() -> Result<Vec<WinUpdate>, String> {
    let child = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            PS_WU_SCAN,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags_windows_no_window()
        .spawn()
        .map_err(|e| format!("Impossible de lancer PowerShell : {}", e))?;
    let out = attendre_avec_timeout(child, WU_SCAN_TIMEOUT_SECONDES)?;
    if !out.status.success() {
        return Err(format!(
            "La recherche de mises à jour Windows a échoué : {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(parse_wu_scan(&String::from_utf8_lossy(&out.stdout)))
}

#[tauri::command]
async fn list_windows_updates() -> Result<Vec<WinUpdate>, String> {
    tauri::async_runtime::spawn_blocking(recenser_mises_a_jour_windows)
        .await
        .map_err(|e| format!("La recherche de mises à jour Windows a échoué : {}", e))?
}

// Télécharge puis installe les mises à jour dont les GUID sont passés en
// arguments ($args). Résultat détaillé par mise à jour + besoin de reboot.
const PS_WU_INSTALL: &str = r#"
$ErrorActionPreference = 'Stop'
$ids = @($args)
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$result = $searcher.Search("IsInstalled=0 and IsHidden=0")
$coll = New-Object -ComObject Microsoft.Update.UpdateColl
$choisis = @()
foreach ($u in $result.Updates) {
  if ($ids -contains $u.Identity.UpdateID) { [void]$coll.Add($u); $choisis += $u }
}
if ($coll.Count -eq 0) {
  "Aucune mise a jour selectionnee encore applicable (deja installee ?)."
  exit 0
}
"Telechargement de $($coll.Count) mise(s) a jour..."
$dl = $session.CreateUpdateDownloader()
$dl.Updates = $coll
$rd = $dl.Download()
"Telechargement termine (code $($rd.ResultCode))."
"Installation..."
$inst = $session.CreateUpdateInstaller()
$inst.Updates = $coll
$ri = $inst.Install()
for ($i = 0; $i -lt $choisis.Count; $i++) {
  $rc = $ri.GetUpdateResult($i).ResultCode
  $txt = switch ($rc) { 2 {'reussie'} 3 {'reussie avec avertissements'} 4 {'en echec'} 5 {'interrompue'} default {"code $rc"} }
  "  - $($choisis[$i].Title) : $txt"
}
$sys = New-Object -ComObject Microsoft.Update.SystemInfo
if ($sys.RebootRequired) {
  "REDEMARRAGE REQUIS : un redemarrage du systeme est necessaire pour terminer."
} else {
  "Aucun redemarrage requis."
}
"#;

fn installer_mises_a_jour_windows(update_ids: Vec<String>) -> Result<CommandResult, String> {
    if update_ids.iter().any(|id| !id_wu_valide(id)) {
        return Err("Identifiant de mise à jour invalide.".into());
    }

    let elevated = is_elevated();
    let start = Instant::now();

    let mut args: Vec<String> = vec![
        "-NoProfile".into(),
        "-NonInteractive".into(),
        "-ExecutionPolicy".into(),
        "Bypass".into(),
        "-Command".into(),
        PS_WU_INSTALL.into(),
    ];
    args.extend(update_ids);

    let child = Command::new("powershell.exe")
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags_windows_no_window()
        .spawn()
        .map_err(|e| format!("Impossible de lancer PowerShell : {}", e))?;

    let out = attendre_avec_timeout(child, WU_INSTALL_TIMEOUT_SECONDES)?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&out.stdout).to_string(),
        stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        exit_code: out.status.code(),
        duration_ms: start.elapsed().as_millis(),
        elevated,
    })
}

#[tauri::command]
async fn install_windows_updates(update_ids: Vec<String>) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || installer_mises_a_jour_windows(update_ids))
        .await
        .map_err(|e| format!("L'installation des mises à jour Windows a échoué : {}", e))?
}

fn spawn_winget(args: &[&str]) -> Result<std::process::Child, String> {
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
fn taille_entree(path: &std::path::Path) -> u64 {
    if path.is_dir() {
        std::fs::read_dir(path)
            .map(|entries| {
                entries.flatten().map(|e| taille_entree(&e.path())).sum()
            })
            .unwrap_or(0)
    } else {
        std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
    }
}

// Supprime le contenu d'un répertoire (pas le répertoire lui-même).
// Retourne (nombre d'éléments purgés, total d'octets libérés).
fn purge_contenu_repertoire(dir: &std::path::Path) -> (usize, u64) {
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

fn taille_lisible(octets: u64) -> String {
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
const PS_SCAN_RESIDUS: &str = r#"
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
async fn update_applications(ids: Vec<String>) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || mise_a_jour_applications(ids))
        .await
        .map_err(|e| format!("La mise à jour a échoué : {}", e))?
}

// ----- Matériel & BIOS (lecture seule, CIM/PnP) -----

// Fabricant, modèle, version/date de BIOS et numéro de série (utile pour
// le support constructeur : Service Tag Dell, S/N HP/Lenovo). Sur les PC
// assemblés, le fabricant système est générique : on retombe sur la carte
// mère. Chaque ligne : fabricant|modèle|versionBIOS|dateBIOS|série.
const PS_SYSTEM_INFO: &str = r#"
$ErrorActionPreference = 'Stop'
$cs = Get-CimInstance Win32_ComputerSystem
$bb = Get-CimInstance Win32_BaseBoard
$bios = Get-CimInstance Win32_BIOS
$gens = @('system manufacturer','default string','to be filled by o.e.m.','','null','not specified','not available')
$fab = $cs.Manufacturer
$modele = $cs.Model
if ($gens -contains "$fab".ToLower()) { $fab = $bb.Manufacturer; $modele = $bb.Product }
$date = ''
try { $date = $bios.ReleaseDate.ToString('yyyy-MM-dd') } catch {}
"{0}|{1}|{2}|{3}|{4}" -f ($fab -replace '\|',' '), ($modele -replace '\|',' '), ($bios.SMBIOSBIOSVersion -replace '\|',' '), $date, ($bios.SerialNumber -replace '\|',' ')
"#;

// Périphériques présents dont le pilote pose problème (pilote absent,
// périphérique désactivé, échec de démarrage...). Chaque ligne :
// nom|instanceId|codeProblème|statut.
const PS_PROBLEM_DEVICES: &str = r#"
Get-PnpDevice -PresentOnly | Where-Object { $_.Status -ne 'OK' } | ForEach-Object {
  $code = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data
  "{0}|{1}|{2}|{3}" -f ($_.Name -replace '\|',' '), ($_.InstanceId -replace '\|',' '), "$code", $_.Status
}
"#;

fn lire_systeme_info() -> Result<SystemInfo, String> {
    let child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS_SYSTEM_INFO])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags_windows_no_window()
        .spawn()
        .map_err(|e| format!("Impossible de lancer PowerShell : {}", e))?;
    let out = attendre_avec_timeout(child, 60)?;
    if !out.status.success() {
        return Err(format!(
            "Lecture des informations système impossible : {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut champs = stdout.trim().splitn(5, '|');
    Ok(SystemInfo {
        manufacturer: champs.next().unwrap_or("").trim().to_string(),
        model: champs.next().unwrap_or("").trim().to_string(),
        bios_version: champs.next().unwrap_or("").trim().to_string(),
        bios_date: champs.next().unwrap_or("").trim().to_string(),
        serial: champs.next().unwrap_or("").trim().to_string(),
    })
}

fn lister_peripheriques_problemes() -> Result<Vec<ProblemDevice>, String> {
    let child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS_PROBLEM_DEVICES])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags_windows_no_window()
        .spawn()
        .map_err(|e| format!("Impossible de lancer PowerShell : {}", e))?;
    let out = attendre_avec_timeout(child, 120)?;
    if !out.status.success() {
        return Err(format!(
            "Énumération des périphériques impossible : {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut peripheriques = Vec::new();
    for ligne in stdout.lines() {
        let mut champs = ligne.splitn(4, '|');
        let (Some(nom), Some(instance), Some(code), Some(statut)) = (
            champs.next(),
            champs.next(),
            champs.next(),
            champs.next(),
        ) else {
            continue;
        };
        peripheriques.push(ProblemDevice {
            name: nom.to_string(),
            instance_id: instance.to_string(),
            problem_code: code.trim().to_string(),
            status: statut.to_string(),
        });
    }
    Ok(peripheriques)
}

#[tauri::command]
async fn get_system_info() -> Result<SystemInfo, String> {
    tauri::async_runtime::spawn_blocking(lire_systeme_info)
        .await
        .map_err(|e| format!("La lecture des informations système a échoué : {}", e))?
}

#[tauri::command]
async fn list_problem_devices() -> Result<Vec<ProblemDevice>, String> {
    tauri::async_runtime::spawn_blocking(lister_peripheriques_problemes)
        .await
        .map_err(|e| format!("L'énumération des périphériques a échoué : {}", e))?
}

// winget signale qu'une mise à jour est installée mais ne sera finalisée
// qu'après fermeture/relance de l'application (paquets MSIX/appx exécutés
// pendant l'installation : Terminal, Photos, etc.) ou qu'un redémarrage du
// système est requis (MSI). Ces paquets restent listés comme « à mettre à
// jour » tant que la finalisation n'a pas eu lieu : il faut prévenir
// l'utilisateur pour éviter la confusion au prochain scan.
fn finalisation_requise(sortie: &str) -> bool {
    let lower = sortie.to_lowercase();
    lower.contains("redémar")
        || lower.contains("redemar")
        || lower.contains("restart the app")
        || lower.contains("restart the computer")
        || lower.contains("restart the system")
        || lower.contains("system restart")
}

fn mise_a_jour_applications(ids: Vec<String>) -> Result<CommandResult, String> {
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
        match attendre_avec_timeout(child, WINGET_TIMEOUT_SECONDES) {
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
    let child = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            PS_SCAN_RESIDUS,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags_windows_no_window()
        .spawn()
        .map_err(|e| format!("Impossible de lancer PowerShell : {}", e))?;
    match attendre_avec_timeout(child, 60) {
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

#[tauri::command]
fn get_diagnostic(event: CriticalEvent) -> Result<Diagnostic, String> {
    let fix = lookup_fix(&event.provider, event.event_id);
    Ok(Diagnostic { event, fix })
}

// La base de connaissances est embarquée à la compilation : on la parse
// une seule fois (OnceLock) au lieu de le refaire à chaque diagnostic.
fn load_knowledge_base() -> &'static Vec<FixEntryMatch> {
    static BASE: std::sync::OnceLock<Vec<FixEntryMatch>> = std::sync::OnceLock::new();
    BASE.get_or_init(charger_base)
}

fn charger_base() -> Vec<FixEntryMatch> {
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
        .iter()
        .find(|m| {
            (m.provider.is_empty()
                || provider_lower.contains(&m.provider)
                || m.provider.contains(&provider_lower))
                && m.event_id == event_id
        })
        .map(|m| m.entry.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_critical_events,
            get_diagnostic,
            run_diagnostic_command,
            list_available_updates,
            update_applications,
            list_windows_updates,
            install_windows_updates,
            get_system_info,
            list_problem_devices,
            relancer_admin,
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
        // champs enrichis
        assert_eq!(e.computer, "FSOCIETY");
        assert_eq!(e.record_id, 14312);
        assert_eq!(e.process_id, Some(4));
        assert_eq!(e.thread_id, Some(7028));
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
        let events =
            query_canal("System", 50, false).expect("la requête wevtutil doit réussir");
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

    // Intégration : les nouveaux canaux doivent être lisibles (ou signaler
    // une erreur propre, jamais faire paniquer le parser).
    #[test]
    fn wevtutil_reel_canaux_etendus() {
        for canal in [
            "System",
            "Application",
            "Microsoft-Windows-WHEA-Logger/Operational",
            "Microsoft-Windows-Diagnostics-Performance/Operational",
        ] {
            let resultat = query_canal(canal, 20, true);
            assert!(
                resultat.is_ok() || resultat.unwrap_err().contains("inaccessible"),
                "canal {canal} : erreur inattendue"
            );
        }
    }

    #[test]
    fn purge_contenu_repertoire_fonctionne() {
        let base = std::env::temp_dir().join("libre-eventlog-test-purge");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("sous-dossier")).unwrap();
        std::fs::write(base.join("a.tmp"), b"12345678").unwrap();
        std::fs::write(base.join("sous-dossier").join("b.tmp"), b"1234").unwrap();

        let (nb, octets) = purge_contenu_repertoire(&base);
        assert_eq!(nb, 2); // a.tmp + sous-dossier
        assert_eq!(octets, 12); // 8 octets du fichier + 4 dans le sous-dossier
        // le répertoire lui-même est conservé, mais vidé
        assert!(base.is_dir());
        assert!(std::fs::read_dir(&base).unwrap().next().is_none());

        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn purge_repertoire_inexistant_sans_erreur() {
        let (nb, octets) =
            purge_contenu_repertoire(std::path::Path::new("Z:/introuvable/libre-eventlog"));
        assert_eq!((nb, octets), (0, 0));
    }

    #[test]
    fn taille_lisible_formats() {
        assert_eq!(taille_lisible(512), "512 o");
        assert_eq!(taille_lisible(2048), "2.0 Ko");
        assert_eq!(taille_lisible(5 * 1024 * 1024), "5.0 Mo");
    }

    // Régression : une commande produisant plus que le buffer du pipe (~4 Ko)
    // ne doit pas bloquer jusqu'au timeout — les tubes doivent être vidés
    // en parallèle de l'attente du processus.
    #[test]
    fn gros_volume_de_sortie_ne_bloque_pas() {
        let child = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "0..8000 | ForEach-Object { \"ligne de sortie volontairement longue numero $_\" }",
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .creation_flags_windows_no_window()
            .spawn()
            .expect("powershell doit se lancer");

        let start = Instant::now();
        let out = attendre_avec_timeout(child, 15).expect("la commande doit aboutir");
        // ~46 octets x 8000 lignes ~ 370 Ko >> buffer du pipe
        assert!(out.stdout.len() > 100_000, "sortie trop courte : {}", out.stdout.len());
        assert!(start.elapsed().as_secs() < 10, "la commande a bloque : {:?}", start.elapsed());
    }
}

#[cfg(test)]
mod tests_winget {
    use super::*;

    // Sortie réelle de `winget upgrade --include-unknown` (locale FR).
    const SORTIE_WINGET: &str = "Nom                               ID                            Version              Disponible               Source\r\n------------------------------------------------------------------------------------------------------------\r\nEpic Online Services              EpicGames.EpicOnlineServices  4.2.1                4.3.1                    winget\r\nOpenAL                            CreativeTechnology.OpenAL     Unknown              1.1                      winget\r\nSpotify                           Spotify.Spotify               1.2.76.298.g2316a870 1.3.6.1921.g7086c071a617 winget\r\nTerminal Windows                  Microsoft.WindowsTerminal     1.24.12741.0         1.25.2733.0              winget\r\nTmUnitedForever Update 2010-03-15 Nadeo.TrackManiaUnitedForever Unknown              2.11.26                  winget\r\n5 mises à niveau disponibles.\r\n";

    #[test]
    fn parse_table_winget() {
        let paquets = parse_winget_upgrade_table(SORTIE_WINGET);
        assert_eq!(paquets.len(), 5, "la ligne de résumé doit être écartée");
        assert_eq!(paquets[0].name, "Epic Online Services");
        assert_eq!(paquets[0].id, "EpicGames.EpicOnlineServices");
        assert_eq!(paquets[0].version, "4.2.1");
        assert_eq!(paquets[0].available, "4.3.1");
        // nom avec espaces + version Unknown
        assert_eq!(paquets[4].name, "TmUnitedForever Update 2010-03-15");
        assert_eq!(paquets[4].id, "Nadeo.TrackManiaUnitedForever");
        assert_eq!(paquets[4].version, "Unknown");
        assert_eq!(paquets[4].available, "2.11.26");
    }

    #[test]
    fn parse_table_winget_aucune_mise_a_jour() {
        // Pas d'en-tête/séparateur -> liste vide sans erreur
        assert!(parse_winget_upgrade_table("Aucune mise à jour disponible.\r\n").is_empty());
        assert!(parse_winget_upgrade_table("").is_empty());
    }

    // Intégration : `winget upgrade` réel est une lecture seule, on vérifie
    // que le recensement parse bien la sortie de production.
    #[test]
    fn winget_reel_liste_mises_a_jour() {
        let paquets = recenser_mises_a_jour().expect("winget upgrade doit réussir");
        for p in &paquets {
            assert!(!p.id.is_empty(), "ID vide pour {:?}", p);
            assert!(!p.name.is_empty(), "nom vide pour {:?}", p);
            assert!(!p.available.is_empty(), "version disponible vide pour {:?}", p);
        }
    }

    #[test]
    fn detection_finalisation_requise() {
        // Sortie réelle de winget pour un paquet MSIX exécuté (Terminal).
        assert!(finalisation_requise(
            "Le code de hachage de l'installation a été vérifié avec succès\r\n\
             Démarrage du package d'installation... Merci de patienter.\r\n\
             Installation réussie. Redémarrez l'application pour terminer la mise à niveau.\r\n"
        ));
        // Redémarrage système requis (MSI)
        assert!(finalisation_requise(
            "Installation réussie. Un redémarrage du système est requis pour terminer l'installation."
        ));
        // Anglais
        assert!(finalisation_requise(
            "Successfully installed. Restart the application to complete the upgrade."
        ));
        // Sortie normale : pas de finalisation en attente
        assert!(!finalisation_requise(
            "Le code de hachage de l'installation a été vérifié avec succès\r\n\
             Installation réussie.\r\n"
        ));
        assert!(!finalisation_requise(""));
    }

    #[test]
    fn parse_scan_wu() {
        let sortie = "12345678-90ab-cdef-1234-567890abcdef|Driver|12.5|Intel - Display 1.2.3\r\n\
                     fedcba09-8765-4321-DCBA-0987654321aa|Software|250,25|Mise à jour cumulative Windows 11 (KB5031234)\r\n\
                     ligne-pourrie-sans-pipe\r\n";
        let maj = parse_wu_scan(sortie);
        assert_eq!(maj.len(), 2);
        assert_eq!(maj[0].update_id, "12345678-90ab-cdef-1234-567890abcdef");
        assert_eq!(maj[0].kind, "Driver");
        assert_eq!(maj[0].size_mb, 12.5);
        assert_eq!(maj[0].title, "Intel - Display 1.2.3");
        // séparateur décimal FR (virgule) -> converti correctement
        assert_eq!(maj[1].size_mb, 250.25);
        assert_eq!(maj[1].title, "Mise à jour cumulative Windows 11 (KB5031234)");
    }

    #[test]
    fn timeout_par_commande_borne() {
        assert_eq!(resoudre_timeout(None), 120);
        assert_eq!(resoudre_timeout(Some(60)), 60);
        assert_eq!(resoudre_timeout(Some(3600)), 3600);
        assert_eq!(resoudre_timeout(Some(0)), 1); // minimum
        assert_eq!(resoudre_timeout(Some(999_999)), 7200); // plafond
    }

    // Intégrations CIM/PnP en lecture seule sur la machine réelle.
    #[test]
    fn systeme_info_reel() {
        let info = lire_systeme_info().expect("la lecture CIM doit réussir");
        assert!(!info.manufacturer.is_empty(), "fabricant vide : {:?}", info);
        assert!(!info.bios_version.is_empty(), "version BIOS vide : {:?}", info);
        // date BIOS au format yyyy-MM-dd si présente
        if !info.bios_date.is_empty() {
            chrono::NaiveDate::parse_from_str(&info.bios_date, "%Y-%m-%d")
                .unwrap_or_else(|_| panic!("date BIOS illisible : {}", info.bios_date));
        }
    }

    #[test]
    fn peripheriques_problemes_reel() {
        let peripheriques =
            lister_peripheriques_problemes().expect("l'énumération PnP doit réussir");
        for p in &peripheriques {
            assert!(!p.name.is_empty());
            assert!(!p.instance_id.is_empty());
        }
    }

    #[test]
    fn id_wu_rejete_injection() {
        assert!(id_wu_valide("12345678-90ab-CDEF-1234-567890ABCDEF"));
        assert!(id_wu_valide("{12345678-90ab-cdef-1234-567890abcdef}"));
        assert!(!id_wu_valide(""));
        assert!(!id_wu_valide("exit 1; rm -rf"));
        assert!(!id_wu_valide("$(calc)"));
        assert!(!id_wu_valide("id avec espace"));
    }

    #[test]
    fn parse_table_winget_nom_avec_accent() {
        // Les noms accentés décalent les octets mais pas les caractères :
        // le découpage par indices de chars doit rester correct.
        let entete = format!("{:<13}{:<16}{:<8}{}", "Nom", "ID", "Version", "Disponible");
        let ligne = format!("{:<13}{:<16}{:<8}{}", "Café du Thé", "Cafe.Theiere", "1.0", "2.0");
        let sortie = format!(
            "{entete}\r\n{}\r\n{ligne}\r\n1 mise à niveau disponible.\r\n",
            "-".repeat(entete.chars().count())
        );
        let paquets = parse_winget_upgrade_table(&sortie);
        assert_eq!(paquets.len(), 1);
        assert_eq!(paquets[0].name, "Café du Thé");
        assert_eq!(paquets[0].id, "Cafe.Theiere");
        assert_eq!(paquets[0].version, "1.0");
        assert_eq!(paquets[0].available, "2.0");
    }
}
