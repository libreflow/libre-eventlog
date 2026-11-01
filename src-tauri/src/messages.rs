//! Messages d'événements rendus dans la langue de l'OS.
//!
//! wevtutil /f:RenderedXml inclut un bloc `<RenderingInfo>` avec le message
//! complet (provider + paramètres interpolés) — la version humaine que
//! l'Observateur d'événements affiche. La requête ne porte que sur
//! l'événement sélectionné (par EventRecordID) : le rendu est coûteux
//! (DLL de messages du provider), on ne l'exécute jamais pour toute la
//! liste. Un cache LRU (256 entrées) évite de re-rendre un événement
//! déjà consulté.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::collecte::decoder_console;
use crate::powershell::NoWindow;
use std::process::Command;

const TAILLE_CACHE: usize = 256;

// (compteur global, map clé -> (position LRU, message)).
type CacheMessages = (u64, HashMap<String, (u64, String)>);

fn cache_messages() -> &'static Mutex<CacheMessages> {
    static CACHE: OnceLock<Mutex<CacheMessages>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new((0, HashMap::new())))
}

fn cle_cache(canal: &str, record_id: u64) -> String {
    format!("{canal}:{record_id}")
}

fn cacher(cle: String, message: String) {
    let mut garde = cache_messages().lock().unwrap();
    let (compteur, map) = &mut *garde;
    *compteur += 1;
    map.insert(cle, (*compteur, message));
    // Éviction du moins récemment utilisé quand le cache déborde.
    if map.len() > TAILLE_CACHE {
        if let Some(ancienne) = map
            .iter()
            .min_by_key(|(_, (c, _))| *c)
            .map(|(k, _)| k.clone())
        {
            map.remove(&ancienne);
        }
    }
}

fn depuis_cache(cle: &str) -> Option<String> {
    let mut garde = cache_messages().lock().unwrap();
    let (compteur, map) = &mut *garde;
    map.get_mut(cle).map(|(horodatage, message)| {
        // Touche : rafraîchit la position LRU.
        *compteur += 1;
        *horodatage = *compteur;
        message.clone()
    })
}

// Extrait le texte de <Message> du bloc RenderingInfo en dé-échappant
// les entités XML (&#13;&#10; pour les retours à la ligne, &amp;…).
fn extraire_message_rendu(xml: &str) -> Option<String> {
    const OUVERTURE: &str = "<Message>";
    const FERMETURE: &str = "</Message>";
    let debut = xml.find(OUVERTURE)? + OUVERTURE.len();
    let fin = xml[debut..].find(FERMETURE)? + debut;
    let brut = &xml[debut..fin];
    let dechappe = quick_xml::escape::unescape(brut).ok()?;
    let texte = dechappe.into_owned();
    let propre = texte.trim();
    if propre.is_empty() {
        None
    } else {
        Some(propre.to_string())
    }
}

// Message rendu d'un événement précis (EventRecordID) dans la langue de
// l'OS. Vide si l'enregistrement a tourné, si le provider n'a pas de DLL
// de messages, ou si l'événement n'a pas d'identifiant exploitable —
// l'UI affiche alors les paramètres structurés.
#[tauri::command]
pub async fn lire_message_evenement(canal: String, record_id: u64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let message = rendre_message(&canal, record_id)?;
        Ok(message)
    })
    .await
    .map_err(|e| format!("La lecture du message a échoué : {}", e))?
}

fn rendre_message(canal: &str, record_id: u64) -> Result<String, String> {
    if record_id == 0 {
        return Ok(String::new());
    }
    let cle = cle_cache(canal, record_id);
    if let Some(message) = depuis_cache(&cle) {
        return Ok(message);
    }

    // Sortie de wevtutil en code page ANSI (CP1252) : decoder_console
    // gère l'UTF-8 strict puis le repli Windows-1252.
    let sortie = Command::new("wevtutil")
        .args([
            "qe",
            canal,
            &format!("/q:*[System[EventRecordID={record_id}]]"),
            "/c:1",
            "/rd:true",
            "/f:RenderedXml",
        ])
        .creation_flags_windows_no_window()
        .output()
        .map_err(|e| format!("Impossible d'exécuter wevtutil : {e}"))?;
    if !sortie.status.success() {
        // L'événement a pu tourner hors du journal : pas une erreur bloquante.
        return Ok(String::new());
    }
    let xml = decoder_console(&sortie.stdout);
    let message = extraire_message_rendu(&xml).unwrap_or_default();
    if !message.is_empty() {
        cacher(cle, message.clone());
    }
    Ok(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extrait_et_dechappe_le_message_rendu() {
        let xml = "<RenderingInfo Culture='fr-FR'><Message>\u{c9}chec de lecture.&#13;&#10;&#13;&#10;D\u{e9}tail\u{a0}: &amp; suite</Message></RenderingInfo>";
        let message = extraire_message_rendu(xml).expect("message attendu");
        assert!(message.starts_with("\u{c9}chec de lecture.\r\n"));
        assert!(message.contains("& suite"));
    }

    #[test]
    fn message_absent_retourne_none() {
        assert!(extraire_message_rendu("<Event></Event>").is_none());
        assert!(extraire_message_rendu("<Message>   </Message>").is_none());
    }

    #[test]
    fn cache_lru_evicte_le_moins_utilise() {
        for i in 0..(TAILLE_CACHE + 8) {
            cacher(format!("System:{i}"), format!("msg {i}"));
        }
        let (_, map) = &mut *cache_messages().lock().unwrap();
        assert_eq!(map.len(), TAILLE_CACHE);
        // Les plus anciens (petits identifiants) ont été évincés.
        assert!(!map.contains_key("System:0"));
        assert!(!map.contains_key("System:7"));
        assert!(map.contains_key(&format!("System:{}", TAILLE_CACHE + 7)));
    }
}

#[cfg(test)]
mod tests_integration {
    use super::*;

    // Intégration réelle : le message rendu d'un vrai événement doit être
    // décodé proprement (pas de caractère de remplacement) ou vide si le
    // provider n'a pas de DLL de messages — jamais de mojibake.
    #[test]
    fn message_rendu_reel_sans_mojibake() {
        let sortie = std::process::Command::new("wevtutil")
            .args([
                "qe",
                "System",
                "/q:*[System[(Level=1 or Level=2)]]",
                "/c:1",
                "/rd:true",
                "/f:XML",
            ])
            .creation_flags_windows_no_window()
            .output()
            .expect("wevtutil doit se lancer");
        let xml = decoder_console(&sortie.stdout);
        // Premier EventRecordID du flux.
        let record = xml
            .split("<EventRecordID>")
            .nth(1)
            .and_then(|s| s.split('<').next())
            .and_then(|s| s.trim().parse::<u64>().ok());
        let Some(record) = record else {
            return; // journal sans erreur : rien à tester
        };
        let message = rendre_message("System", record).expect("le rendu ne doit pas échouer");
        assert!(
            !message.contains('\u{fffd}'),
            "mojibake dans le message rendu : {message}"
        );
    }
}
