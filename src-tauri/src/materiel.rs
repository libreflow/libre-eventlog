use crate::powershell::{attendre_avec_timeout, spawn_powershell};
use crate::types::*;

// Fabricant, modèle, version/date de BIOS et numéro de série (utile pour
// le support constructeur : Service Tag Dell, S/N HP/Lenovo). Sur les PC
// assemblés, le fabricant système est générique : on retombe sur la carte
// mère. Chaque ligne : fabricant|modèle|versionBIOS|dateBIOS|série.
pub const PS_SYSTEM_INFO: &str = r#"
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
pub const PS_PROBLEM_DEVICES: &str = r#"
Get-PnpDevice -PresentOnly | Where-Object { $_.Status -ne 'OK' } | ForEach-Object {
  $code = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data
  "{0}|{1}|{2}|{3}" -f ($_.Name -replace '\|',' '), ($_.InstanceId -replace '\|',' '), "$code", $_.Status
}
"#;

// ----- Audit de santé -----

pub fn lire_systeme_info() -> Result<SystemInfo, String> {
    let child = spawn_powershell(PS_SYSTEM_INFO, &[])?;
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

pub fn lister_peripheriques_problemes() -> Result<Vec<ProblemDevice>, String> {
    let child = spawn_powershell(PS_PROBLEM_DEVICES, &[])?;
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
        let (Some(nom), Some(instance), Some(code), Some(statut)) =
            (champs.next(), champs.next(), champs.next(), champs.next())
        else {
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
pub async fn get_system_info() -> Result<SystemInfo, String> {
    tauri::async_runtime::spawn_blocking(lire_systeme_info)
        .await
        .map_err(|e| format!("La lecture des informations système a échoué : {}", e))?
}

#[tauri::command]
pub async fn list_problem_devices() -> Result<Vec<ProblemDevice>, String> {
    tauri::async_runtime::spawn_blocking(lister_peripheriques_problemes)
        .await
        .map_err(|e| format!("L'énumération des périphériques a échoué : {}", e))?
}
