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

// Les commandes Tauri synchrones s'exécutent sur le thread principal : les
// commandes lourdes ci-dessous sont donc `async` et délèguent le travail
// bloquant à `spawn_blocking` pour ne jamais geler l'interface.

#[tauri::command]
async fn get_critical_events() -> Result<Vec<CriticalEvent>, String> {
    tauri::async_runtime::spawn_blocking(collecter_evenements)
        .await
        .map_err(|e| format!("La collecte des événements a échoué : {}", e))?
}

fn collecter_evenements() -> Result<Vec<CriticalEvent>, String> {
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
async fn run_diagnostic_command(commande: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || executer_commande_ps(commande))
        .await
        .map_err(|e| format!("La commande a échoué : {}", e))?
}

fn executer_commande_ps(commande: String) -> Result<CommandResult, String> {
    const TIMEOUT_SECONDES: u64 = 120;

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

    let output = attendre_avec_timeout(child, TIMEOUT_SECONDES)?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code(),
        duration_ms: start.elapsed().as_millis(),
        elevated,
    })
}

const WINGET_TIMEOUT_SECONDES: u64 = 600;

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
async fn update_applications() -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(mise_a_jour_applications)
        .await
        .map_err(|e| format!("La mise à jour a échoué : {}", e))?
}

fn mise_a_jour_applications() -> Result<CommandResult, String> {
    let elevated = is_elevated();
    let start = Instant::now();
    let mut rapport = String::new();
    let mut stderr_all = String::new();
    let exit_code: Option<i32>;

    // 1) Mise à jour de toutes les applications installées via winget.
    let child = spawn_winget(&[
        "upgrade",
        "--all",
        "--silent",
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--disable-interactivity",
    ])?;
    match attendre_avec_timeout(child, WINGET_TIMEOUT_SECONDES) {
        Ok(out) => {
            exit_code = out.status.code();
            rapport.push_str(&String::from_utf8_lossy(&out.stdout));
            stderr_all.push_str(&String::from_utf8_lossy(&out.stderr));
        }
        Err(e) => {
            // Sans cela, le code de sortie du scan de résidus (0) serait
            // adopté plus bas et l'UI afficherait un faux « succès ».
            exit_code = Some(1);
            stderr_all.push_str(&e);
            rapport.push_str(
                "\r\nLa mise à jour a été interrompue (délai dépassé). \
                 Les étapes de nettoyage continuent ci-dessous.\r\n",
            );
        }
    }

    if let Some(code) = exit_code {
        if code != 0 {
            rapport.push_str(&format!(
                "\r\nNote : winget a retourné le code {code} — souvent \
                 « aucune mise à jour applicable » ou des échecs ponctuels \
                 sur certains paquets ; le détail est dans la sortie/stderr.\r\n"
            ));
        }
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
        exit_code,
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
            update_applications,
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
