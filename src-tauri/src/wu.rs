use std::time::Instant;

use crate::powershell::{attendre_avec_timeout, spawn_powershell};
use crate::securite::is_elevated;
use crate::types::*;

// ----- Mises à jour Windows & pilotes (API COM Windows Update) -----

pub const WU_SCAN_TIMEOUT_SECONDES: u64 = 600;
pub const WU_INSTALL_TIMEOUT_SECONDES: u64 = 1800;

// Lecture seule : recherche les mises à jour applicables (logiciels et
// pilotes) via l'agent Windows Update. Chaque ligne : GUID|type|Mo|titre.
pub const PS_WU_SCAN: &str = r#"
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
pub fn id_wu_valide(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-' || c == '{' || c == '}')
}

pub fn parse_wu_scan(stdout: &str) -> Vec<WinUpdate> {
    let mut maj = Vec::new();
    for ligne in stdout.lines() {
        let mut champs = ligne.splitn(4, '|');
        let (Some(id), Some(kind), Some(taille), Some(titre)) =
            (champs.next(), champs.next(), champs.next(), champs.next())
        else {
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

pub fn recenser_mises_a_jour_windows() -> Result<Vec<WinUpdate>, String> {
    let child = spawn_powershell(PS_WU_SCAN, &[])?;
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
pub async fn list_windows_updates() -> Result<Vec<WinUpdate>, String> {
    tauri::async_runtime::spawn_blocking(recenser_mises_a_jour_windows)
        .await
        .map_err(|e| format!("La recherche de mises à jour Windows a échoué : {}", e))?
}

// Télécharge puis installe les mises à jour dont les GUID sont passés en
// arguments ($args). Résultat détaillé par mise à jour + besoin de reboot.
pub const PS_WU_INSTALL: &str = r#"
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

pub fn installer_mises_a_jour_windows(update_ids: Vec<String>) -> Result<CommandResult, String> {
    if update_ids.iter().any(|id| !id_wu_valide(id)) {
        return Err("Identifiant de mise à jour invalide.".into());
    }

    let elevated = is_elevated();
    let start = Instant::now();

    let mut args: Vec<String> = Vec::new();
    args.extend(update_ids);

    let child = spawn_powershell(PS_WU_INSTALL, &args)?;

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
pub async fn install_windows_updates(update_ids: Vec<String>) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || installer_mises_a_jour_windows(update_ids))
        .await
        .map_err(|e| format!("L'installation des mises à jour Windows a échoué : {}", e))?
}
