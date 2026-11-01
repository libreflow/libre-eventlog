use crate::collecte::collecter_evenements;
use crate::kb::lookup_fix;
use crate::types::*;

// ----- Audit de santé -----
// Agrège les événements collectés par problème (provider + eventId) et
// calcule un score de santé par catégorie. Pénalités : critique -15,
// erreur -8, avertissement -4, info -3 par problème unique, plus -2 par
// occurrence supplémentaire (plafonné à 5 occurrences). Score plancher 0.

// Score global : moyenne des catégories IDENTIFIÉES — « non identifie »
// (événements sans entrée de base) reste affiché dans la liste mais ne
// pèse pas sur le global : sinon il tire le score vers le bas sans
// dire quoi que ce soit d'actionnable. Si aucune catégorie n'est
// identifiée, repli sur la moyenne de toutes (jamais un 100 mensonger
// sur une machine pleine d'erreurs inconnues).
pub fn score_global(categories: &[CategorieScore]) -> u8 {
    if categories.is_empty() {
        return 100;
    }
    let identifiees: Vec<&CategorieScore> = categories
        .iter()
        .filter(|c| c.categorie != "non identifie")
        .collect();
    let retenues: Vec<&CategorieScore> = if identifiees.is_empty() {
        categories.iter().collect()
    } else {
        identifiees
    };
    let somme: u32 = retenues.iter().map(|c| c.score as u32).sum();
    (somme / retenues.len() as u32) as u8
}

fn calculer_audit() -> AuditSante {
    use std::collections::BTreeMap;

    let collecte = collecter_evenements(200, true, None);

    // (provider, event_id) -> (niveau le plus grave, occurrences, fix)
    let mut agreges: BTreeMap<(String, u32), (u8, u32, Option<FixEntry>)> = BTreeMap::new();
    for e in &collecte.events {
        let fix = lookup_fix(&e.provider, e.event_id);
        let cle = (e.provider.clone(), e.event_id);
        match agreges.get_mut(&cle) {
            Some(a) => {
                a.1 += 1;
                if e.level < a.0 {
                    a.0 = e.level; // niveau le plus grave au sens métier (1 < 2 < 3)
                }
            }
            None => {
                agreges.insert(cle, (e.level, 1, fix));
            }
        }
    }

    let penalite_niveau = |level: u8| -> u32 {
        match level {
            1 => 15,
            2 => 8,
            3 => 4,
            _ => 3,
        }
    };

    let mut problemes: Vec<ProblemAgrege> = Vec::new();
    let mut scores: BTreeMap<String, (u32, u32)> = BTreeMap::new(); // categorie -> (pénalités, nb problèmes)
    for ((provider, event_id), (level, count, fix)) in &agreges {
        let categorie = fix
            .as_ref()
            .map(|f| f.categorie.clone())
            .unwrap_or_else(|| "non identifie".to_string());
        let titre = fix
            .as_ref()
            .map(|f| f.titre.clone())
            .unwrap_or_else(|| format!("{provider} — événement {event_id}"));
        let etapes = fix.as_ref().map(|f| f.etapes.clone()).unwrap_or_default();

        let penalite = penalite_niveau(*level) + (count.saturating_sub(1).min(5)) * 2;
        let s = scores.entry(categorie.clone()).or_insert((0, 0));
        s.0 += penalite;
        s.1 += 1;

        problemes.push(ProblemAgrege {
            provider: provider.clone(),
            event_id: *event_id,
            level: *level,
            count: *count,
            titre,
            categorie,
            etapes,
        });
    }

    // Tri : niveau le plus grave d'abord, puis occurrences décroissantes.
    problemes.sort_by(|a, b| a.level.cmp(&b.level).then(b.count.cmp(&a.count)));

    let categories: Vec<CategorieScore> = scores
        .into_iter()
        .map(|(categorie, (penalites, nb))| CategorieScore {
            score: (100u32.saturating_sub(penalites)).min(100) as u8,
            categorie,
            problemes: nb,
        })
        .collect();

    let global = score_global(&categories);

    AuditSante {
        global,
        categories,
        problemes,
        total_evenements: collecte.events.len() as u32,
        genere_le: chrono::Local::now().format("%Y-%m-%d %H:%M").to_string(),
    }
}

#[tauri::command]
pub async fn get_health_audit() -> Result<AuditSante, String> {
    let audit = tauri::async_runtime::spawn_blocking(calculer_audit)
        .await
        .map_err(|e| format!("L'audit a échoué : {}", e))?;
    Ok(audit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cat(nom: &str, score: u8) -> CategorieScore {
        CategorieScore {
            categorie: nom.to_string(),
            score,
            problemes: 1,
        }
    }

    // 4.4 — « non identifie » ne pèse pas sur le score global.
    #[test]
    fn score_global_ignore_non_identifie() {
        let cats = vec![cat("stockage", 80), cat("non identifie", 0)];
        // Moyenne brute = 40 ; pondérée sur les catégories identifiées = 80.
        assert_eq!(score_global(&cats), 80);
    }

    #[test]
    fn score_global_vide_est_100() {
        assert_eq!(score_global(&[]), 100);
    }

    #[test]
    fn score_global_toutes_inconnues_replie_sur_la_moyenne() {
        // Une machine pleine d'erreurs inconnues ne doit pas afficher 100.
        let cats = vec![cat("non identifie", 0)];
        assert_eq!(score_global(&cats), 0);
    }

    #[test]
    fn score_global_moyenne_simple_sans_inconnues() {
        let cats = vec![cat("stockage", 40), cat("systeme", 84)];
        assert_eq!(score_global(&cats), 62);
    }
}
