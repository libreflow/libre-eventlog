//! Libre EventLog — point d'entrée Tauri.
//!
//! Le backend est organisé en modules : [`types`] (contrats de
//! sérialisation), [`securite`] (liste blanche PowerShell),
//! [`powershell`] (exécution durcie), [`collecte`] (wevtutil),
//! [`winget`]/[`wu`]/[`materiel`] (maintenance), [`audit`] (score de
//! santé), [`kb`] (base de connaissances). Tout est re-exporté ici
//! pour les commandes Tauri et les tests.

mod audit;
mod collecte;
mod journal;
mod kb;
mod materiel;
mod messages;
mod powershell;
mod securite;
mod types;
mod winget;
mod wu;

pub use audit::*;
pub use collecte::*;
pub use journal::*;
pub use kb::*;
pub use materiel::*;
pub use messages::*;
pub use powershell::*;
pub use securite::*;
pub use types::*;
pub use winget::*;
pub use wu::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Journal local des commandes exécutées (traçabilité de l'outil
        // qui modifie le système) : rotation à 512 Ko, un seul historique.
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("libre-eventlog".into()),
                    },
                )])
                .level(log::LevelFilter::Info)
                .max_file_size(512_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
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
            get_health_audit,
            relancer_admin,
            check_elevation,
            annuler_commande,
            lire_journal,
            purger_journal,
            lire_message_evenement
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Libre EventLog");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use std::time::Instant;

    // Contrat de sérialisation Rust -> TypeScript : le frontend (src/types.ts)
    // attend exactement ces clés camelCase. Ce test verrouille le contrat :
    // tout renommage de champ doit passer par ici ET par une mise à jour du
    // frontend, sinon le champ devient `undefined` au runtime sans erreur tsc.
    #[test]
    fn contrat_serialisation_frontend() {
        fn cles(v: serde_json::Value) -> Vec<String> {
            // Ordre sans importance en JSON : comparaison en ensemble trié.
            let mut k: Vec<String> = v
                .as_object()
                .unwrap()
                .keys()
                .map(|k| k.to_string())
                .collect();
            k.sort();
            k
        }

        let event = serde_json::to_value(CriticalEvent {
            timestamp: "t".into(),
            canal: "c".into(),
            provider: "p".into(),
            event_id: 7,
            level: 2,
            severity: "Erreur".into(),
            message_raw: "m".into(),
            parametres: vec![],
            process_id: None,
            thread_id: None,
            computer: "PC".into(),
            record_id: 42,
        })
        .unwrap();
        assert_eq!(
            cles(event),
            vec![
                "canal",
                "computer",
                "eventId",
                "level",
                "messageRaw",
                "parametres",
                "processId",
                "provider",
                "recordId",
                "severity",
                "threadId",
                "timestamp",
            ]
        );

        assert_eq!(
            cles(
                serde_json::to_value(CommandResult {
                    stdout: String::new(),
                    stderr: String::new(),
                    exit_code: Some(0),
                    duration_ms: 5,
                    elevated: false,
                })
                .unwrap()
            ),
            vec!["durationMs", "elevated", "exitCode", "stderr", "stdout"]
        );

        assert_eq!(
            cles(
                serde_json::to_value(WingetPackage {
                    name: "n".into(),
                    id: "i".into(),
                    version: "1".into(),
                    available: "2".into(),
                })
                .unwrap()
            ),
            vec!["available", "id", "name", "version"]
        );

        assert_eq!(
            cles(
                serde_json::to_value(WinUpdate {
                    update_id: "u".into(),
                    title: "t".into(),
                    kind: "Driver".into(),
                    size_mb: 1.5,
                })
                .unwrap()
            ),
            vec!["kind", "sizeMb", "title", "updateId"]
        );

        assert_eq!(
            cles(
                serde_json::to_value(SystemInfo {
                    manufacturer: "m".into(),
                    model: "m".into(),
                    bios_version: "b".into(),
                    bios_date: "d".into(),
                    serial: "s".into(),
                })
                .unwrap()
            ),
            vec!["biosDate", "biosVersion", "manufacturer", "model", "serial"]
        );

        assert_eq!(
            cles(
                serde_json::to_value(ProblemDevice {
                    name: "n".into(),
                    instance_id: "i".into(),
                    problem_code: "28".into(),
                    status: "Error".into(),
                })
                .unwrap()
            ),
            vec!["instanceId", "name", "problemCode", "status"]
        );

        assert_eq!(
            cles(
                serde_json::to_value(AuditSante {
                    global: 50,
                    categories: vec![],
                    problemes: vec![],
                    total_evenements: 0,
                    genere_le: "d".into(),
                })
                .unwrap()
            ),
            vec![
                "categories",
                "genereLe",
                "global",
                "problemes",
                "totalEvenements"
            ]
        );

        assert_eq!(
            cles(
                serde_json::to_value(ProblemAgrege {
                    provider: "p".into(),
                    event_id: 7,
                    level: 2,
                    count: 3,
                    titre: "t".into(),
                    categorie: "c".into(),
                    etapes: vec![],
                })
                .unwrap()
            ),
            vec![
                "categorie",
                "count",
                "etapes",
                "eventId",
                "level",
                "provider",
                "titre"
            ]
        );

        // CommandeFix : timeoutSecs transporté (ou omis si None)
        let cmd = CommandeFix {
            label: "l".into(),
            description: String::new(),
            commande: "c".into(),
            r#type: "action".into(),
            elevation: false,
            confirme: false,
            timeout_secs: Some(900),
            annulable: true,
        };
        let cmd_v = serde_json::to_value(cmd.clone()).unwrap();
        assert_eq!(cmd_v["timeoutSecs"], serde_json::json!(900));
        // champ annulable (défaut true) transporté au frontend
        assert_eq!(cmd_v["annulable"], serde_json::json!(true));
        let sans_timeout = serde_json::to_value(CommandeFix {
            timeout_secs: None,
            ..cmd
        })
        .unwrap();
        assert!(sans_timeout
            .as_object()
            .unwrap()
            .get("timeoutSecs")
            .is_none());
    }

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
        // exécutables autorisés, variantes destructives interdites :
        // effacement d'un canal d'événements, coupure du pare-feu
        assert!(commande_autorisee("wevtutil cl System").is_err());
        assert!(commande_autorisee("wevtutil clear-log System").is_err());
        assert!(commande_autorisee("netsh advfirewall set allprofiles state off").is_err());
        // …mais leurs usages lecture/réparation de la base restent permis
        assert!(commande_autorisee("netsh winsock reset").is_ok());
    }

    // Liste blanche : deny-by-default pour tout exécutable/cmdlet inconnu.
    #[test]
    fn liste_blanche_bloque_l_inconnu() {
        // exécutables et cmdlets autorisés
        assert!(commande_autorisee("sfc /scannow").is_ok());
        assert!(commande_autorisee("DISM /Online /Cleanup-Image /CheckHealth").is_ok());
        assert!(commande_autorisee("netsh winsock reset; arp -d *").is_ok());
        assert!(commande_autorisee(
            "Get-ChildItem 'HKLM:\\SOFTWARE' -Recurse | Get-ItemProperty | Format-List"
        )
        .is_ok());
        // hashtable avec ';' : les séparateurs internes ne coupent pas
        assert!(commande_autorisee(
            "Get-WinEvent -FilterHashtable @{LogName='System'; Id=41} -MaxEvents 5 | Format-Table"
        )
        .is_ok());
        // tout le reste est refusé
        assert!(commande_autorisee("Start-Process calc.exe").is_err());
        assert!(commande_autorisee("cmd /c dir").is_err());
        assert!(commande_autorisee("powershell -enc AAAA").is_err());
        assert!(commande_autorisee("Invoke-WebRequest http://x").is_err());
        assert!(commande_autorisee("curl http://x").is_err());
        assert!(commande_autorisee("Set-MpPreference -DisableRealtime 1").is_err());
        // y compris dans un segment de pipeline
        assert!(commande_autorisee("Get-Process | Out-File x; Start-Process calc").is_err());
    }

    // Intégration : exécute le vrai wevtutil avec les arguments de
    // production et vérifie que le parsing aboutit.
    #[test]
    fn wevtutil_reel_system() {
        let events =
            query_canal("System", 50, false, None).expect("la requête wevtutil doit réussir");
        for e in &events {
            assert_eq!(e.canal, "System");
            assert!(
                e.level == 1 || e.level == 2,
                "level inattendu : {}",
                e.level
            );
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
            let resultat = query_canal(canal, 20, true, None);
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

    // Régression : redirigé, PowerShell émet en code page OEM (CP850) —
    // les accents deviendraient des U+FFFD après from_utf8_lossy. Le
    // préfixe UTF-8 de spawn_powershell doit les préserver.
    #[test]
    fn sortie_powershell_utf8_preserve_les_accents() {
        let child = spawn_powershell("Write-Output 'Téléchargement à é'", &[])
            .expect("powershell doit se lancer");
        let out = attendre_avec_timeout(child, 30, None).expect("la commande doit aboutir");
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        assert!(
            stdout.contains("Téléchargement à é"),
            "accents corrompus : {:?}",
            stdout
        );
    }

    // Les erreurs wevtutil arrivent en Windows-1252 ( « Accès refusé » en
    // 0xE8/0xE9 bruts), son XML en UTF-8 : decoder_console gère les deux.
    #[test]
    fn decoder_console_utf8_et_cp1252() {
        // UTF-8 valide : passage direct
        assert_eq!(decoder_console("Déjà".as_bytes()), "Déjà");
        // Windows-1252 : é = 0xE9, è = 0xE8, ’ = 0x92
        assert_eq!(
            decoder_console(&[
                b'A', b'c', b'c', 0xE8, b's', 0x20, b'r', 0xE9, b'f', b'u', b's', 0xE9
            ]),
            "Accès réfusé"
        );
        assert_eq!(decoder_console(&[0x92]), "\u{2019}");
        // octet non défini en cp1252 : U+FFFD
        assert_eq!(decoder_console(&[0x81]), "\u{FFFD}");
    }

    // Régression : une commande produisant plus que le buffer du pipe (~4 Ko)
    // ne doit pas bloquer jusqu'au timeout — les tubes doivent être vidés
    // en parallèle de l'attente du processus.
    // Le streaming diffuse les lignes une à une mais doit aussi les
    // accumuler intégralement (normalisées avec LF) dans le CommandResult.
    #[test]
    fn sortie_multiligne_accumulee_par_le_lecteur_ligne_a_ligne() {
        let child = spawn_powershell(
            "Write-Output 'ligne 1'; Write-Output 'ligne 2'; Write-Output 'ligne 3'",
            &[],
        )
        .expect("powershell doit se lancer");
        let out = attendre_avec_timeout(child, 30, None).expect("la commande doit aboutir");
        let texte = String::from_utf8_lossy(&out.stdout).to_string();
        assert_eq!(texte, "ligne 1\nligne 2\nligne 3\n");
    }

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
        // 60 s de marge : un runner CI lent exécute ce pipeline en plus de
        // 15 s à froid (PowerShell + 8000 interpolations) ; un verrou de
        // pipe, lui, consommerait tout le délai et provoquerait l'Err de
        // l'expect — la régression reste détectée.
        let out = attendre_avec_timeout(child, 60, None).expect("la commande doit aboutir");
        // ~46 octets x 8000 lignes ~ 370 Ko >> buffer du pipe
        assert!(
            out.stdout.len() > 100_000,
            "sortie trop courte : {}",
            out.stdout.len()
        );
        assert!(
            start.elapsed().as_secs() < 50,
            "la commande a bloque : {:?}",
            start.elapsed()
        );
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
        // Certains environnements CI (Windows Server sans App Installer) n'ont
        // pas winget : le test se borne alors à le signaler au lieu d'échouer.
        let paquets = match recenser_mises_a_jour() {
            Ok(p) => p,
            Err(e) if e.contains("winget est introuvable") => {
                eprintln!("winget absent de cette machine — test réel ignoré");
                return;
            }
            Err(e) => panic!("winget upgrade doit réussir : {e}"),
        };
        for p in &paquets {
            assert!(!p.id.is_empty(), "ID vide pour {:?}", p);
            assert!(!p.name.is_empty(), "nom vide pour {:?}", p);
            assert!(
                !p.available.is_empty(),
                "version disponible vide pour {:?}",
                p
            );
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
        assert_eq!(
            maj[1].title,
            "Mise à jour cumulative Windows 11 (KB5031234)"
        );
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
        assert!(
            !info.bios_version.is_empty(),
            "version BIOS vide : {:?}",
            info
        );
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
            // Le nom convivial peut être vide en environnement réel (VM de CI
            // sans driver friendly-name) : l'UI affiche alors l'instance.
            assert!(!p.instance_id.is_empty());
        }
    }

    // Validation de la base de connaissances embarquée : chaque entrée doit
    // être chargeable, et toutes ses commandes passer la denylist.
    #[test]
    fn base_de_connaissances_valide() {
        let base = load_knowledge_base();
        assert!(base.len() >= 35, "base trop pauvre : {}", base.len());
        // Invariant : les catégories forment un ensemble fermé connu —
        // une coquille (Stockage vs stockage) créerait une catégorie
        // fantôme dans les scores d'audit.
        const CATEGORIES_CONNUES: &[&str] = &[
            "materiel",
            "stockage",
            "systeme",
            "bsod",
            "reseau",
            "application",
            "demarrage",
            "securite",
        ];
        for m in base {
            assert!(
                CATEGORIES_CONNUES.contains(&m.entry.categorie.as_str()),
                "catégorie inconnue {:?} (entrée : {})",
                m.entry.categorie,
                m.entry.titre
            );
            assert!(
                !(m.provider.is_empty() && m.event_id == 0),
                "entrée sans critère de correspondance : {:?}",
                m.entry.titre
            );
            assert!(!m.entry.titre.is_empty());
            for c in &m.entry.commandes {
                assert!(
                    commande_autorisee(&c.commande).is_ok(),
                    "commande de la base refusée par la denylist : {}",
                    c.commande
                );
            }
        }

        // Les commandes longues doivent déclarer un timeout adapté, sinon
        // run_diagnostic_command les tue à 120 s (défaut).
        let energy = base
            .iter()
            .flat_map(|m| m.entry.commandes.iter())
            .find(|c| c.commande.contains("/energy"));
        if let Some(c) = energy {
            assert!(
                c.timeout_secs.unwrap_or(0) >= 900,
                "powercfg /energy sans timeout suffisant : {:?}",
                c.timeout_secs
            );
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
        let ligne = format!(
            "{:<13}{:<16}{:<8}{}",
            "Café du Thé", "Cafe.Theiere", "1.0", "2.0"
        );
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
