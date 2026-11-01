import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  Package,
  Play,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import type { CommandeFix, ProblemDevice, SystemInfo, WinUpdate, WingetPackage } from "../types";
import { LienExterne } from "./LienExterne";
import { usePiegeFocus } from "../hooks/usePiegeFocus";
import { CODES_PROBLEME, fabricantTrouve } from "../lib/materiel";
import { CORRECTIFS_SYSTEME, MAJ_APPS } from "../lib/catalogue";

type OngletMaj = "apps" | "windows" | "bios" | "correctifs";

// Modale Maintenance : 4 onglets (applications winget, Windows Update,
// matériel/BIOS, correctifs système). L'état de l'onglet actif est local ;
// tout le reste vient des props (états et actions restent dans App).
export function ModaleMaintenance({
  elevated,
  runningCmd,
  onFermer,
  onOngletChange,
  // Applications
  chargementApps,
  paquetsApps,
  selectionApps,
  onTogglePaquet,
  onToggleTout,
  onMajApps,
  // Windows Update
  chargementWu,
  scanFaitWu,
  erreurWu,
  paquetsWu,
  selectionWu,
  onToggleWu,
  onToggleToutWu,
  onRechercherWu,
  onInstallerWu,
  // Matériel
  chargementHw,
  erreurHw,
  infoHw,
  chargeHw,
  problemesHw,
  onActualiserHw,
  // Correctifs
  onExecuterCorrectif,
}: {
  elevated: boolean | null;
  runningCmd: string | null;
  onFermer: () => void;
  onOngletChange: (onglet: OngletMaj) => void;
  chargementApps: boolean;
  paquetsApps: WingetPackage[];
  selectionApps: Set<string>;
  onTogglePaquet: (id: string) => void;
  onToggleTout: () => void;
  onMajApps: (ids: string[]) => void;
  chargementWu: boolean;
  scanFaitWu: boolean;
  erreurWu: string | null;
  paquetsWu: WinUpdate[];
  selectionWu: Set<string>;
  onToggleWu: (id: string) => void;
  onToggleToutWu: () => void;
  onRechercherWu: () => void;
  onInstallerWu: (ids: string[]) => void;
  chargementHw: boolean;
  erreurHw: string | null;
  infoHw: SystemInfo | null;
  chargeHw: boolean;
  problemesHw: ProblemDevice[];
  onActualiserHw: () => void;
  onExecuterCorrectif: (cmd: CommandeFix) => void;
}) {
  const [onglet, setOnglet] = useState<OngletMaj>("apps");
  const modalRef = useRef<HTMLDivElement>(null);
  usePiegeFocus(modalRef, true);

  const changerOnglet = (cle: OngletMaj) => {
    setOnglet(cle);
    onOngletChange(cle);
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="maj-title"
      onClick={() =>
        !chargementApps && !chargementWu && !chargementHw && onFermer()
      }
    >
      <div className="modal modal-maj" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <h3 id="maj-title"><Wrench className="icon" aria-hidden="true" /> Maintenance</h3>

        <div className="maj-onglets" role="tablist" aria-label="Sections de maintenance">
          {(
            [
              ["apps", "Applications"],
              ["windows", "Windows & pilotes"],
              ["bios", "Matériel & BIOS"],
              ["correctifs", "Correctifs système"],
            ] as const
          ).map(([cle, libelle]) => (
            <button
              key={cle}
              role="tab"
              aria-selected={onglet === cle}
              className={`maj-onglet ${onglet === cle ? "actif" : ""}`}
              onClick={() => changerOnglet(cle)}
            >
              {libelle}
            </button>
          ))}
        </div>

        {onglet === "apps" && (
          <>
            <p className="cmd-desc">{MAJ_APPS.description}</p>
            <p className="cmd-desc">
              <AlertTriangle className="icon warn" aria-hidden="true" /> Fermez vos applications avant de les mettre à jour : une app en
              cours d'exécution peut voir sa mise à jour figée (cas Terminal/MSIX)
              ou faire échouer l'installateur.
            </p>

            {chargementApps && (
              <p className="maj-status"><Loader2 className="icon spin" aria-hidden="true" /> Recherche des mises à jour disponibles…</p>
            )}

            {!chargementApps && paquetsApps.length === 0 && (
              <p className="maj-status"><CheckCircle2 className="icon ok" aria-hidden="true" /> Aucune mise à jour d'application disponible. Tout est à jour !</p>
            )}

            {!chargementApps && paquetsApps.length > 0 && (
              <div className="maj-liste" role="group" aria-label="Applications à mettre à jour">
                <label className="maj-item maj-tous">
                  <input
                    type="checkbox"
                    checked={selectionApps.size === paquetsApps.length}
                    onChange={onToggleTout}
                  />
                  <strong>
                    Tout sélectionner ({selectionApps.size}/{paquetsApps.length})
                  </strong>
                </label>
                {paquetsApps.map((p) => (
                  <label key={p.id} className="maj-item">
                    <input
                      type="checkbox"
                      checked={selectionApps.has(p.id)}
                      onChange={() => onTogglePaquet(p.id)}
                    />
                    <span className="maj-nom" title={p.id}>
                      {p.name}
                    </span>
                    <span className="maj-versions mono">
                      {p.version} → {p.available}
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={onFermer} disabled={chargementApps}>
                Fermer
              </button>
              <button
                className="btn primary"
                disabled={chargementApps || selectionApps.size === 0 || runningCmd !== null}
                onClick={() => onMajApps([...selectionApps])}
              >
                <Package className="icon" aria-hidden="true" /> Mettre à jour ({selectionApps.size})
              </button>
            </div>
          </>
        )}

        {onglet === "windows" && (
          <>
            <p className="cmd-desc">
              Mises à jour Windows et pilotes via l'agent Windows Update (WSUS/Windows Update
              configuré sur la machine). Le scan peut prendre plusieurs minutes ; les pilotes
              sont marqués d'une clé.
            </p>

            {chargementWu && (
              <p className="maj-status"><Loader2 className="icon spin" aria-hidden="true" /> Recherche des mises à jour Windows et pilotes…</p>
            )}

            {!chargementWu && !scanFaitWu && !erreurWu && (
              <p className="maj-status">
                Lancez une recherche pour afficher les mises à jour Windows et pilotes disponibles.
              </p>
            )}

            {!chargementWu && erreurWu && (
              <p className="modal-warn" role="alert">
                <AlertTriangle className="icon warn" aria-hidden="true" /> La recherche a échoué : {erreurWu}
              </p>
            )}

            {!chargementWu && scanFaitWu && paquetsWu.length === 0 && (
              <p className="maj-status"><CheckCircle2 className="icon ok" aria-hidden="true" /> Aucune mise à jour Windows ni pilote en attente.</p>
            )}

            {!chargementWu && paquetsWu.length > 0 && (
              <div className="maj-liste" role="group" aria-label="Mises à jour Windows à installer">
                <label className="maj-item maj-tous">
                  <input
                    type="checkbox"
                    checked={selectionWu.size === paquetsWu.length}
                    onChange={onToggleToutWu}
                  />
                  <strong>
                    Tout sélectionner ({selectionWu.size}/{paquetsWu.length})
                  </strong>
                </label>
                {paquetsWu.map((u) => (
                  <label key={u.updateId} className="maj-item">
                    <input
                      type="checkbox"
                      checked={selectionWu.has(u.updateId)}
                      onChange={() => onToggleWu(u.updateId)}
                    />
                    <span className="maj-nom" title={u.title}>
                      {u.kind === "Driver" ? <Wrench className="icon" size={12} aria-hidden="true" /> : null}
                      {u.title}
                    </span>
                    <span className="maj-versions mono">{u.sizeMb.toFixed(1)} Mo</span>
                  </label>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={onFermer}>
                Fermer
              </button>
              <button className="btn" onClick={onRechercherWu} disabled={chargementWu || runningCmd !== null}>
                <RefreshCw className="icon" aria-hidden="true" /> Rechercher
              </button>
              <button
                className="btn primary"
                disabled={chargementWu || selectionWu.size === 0 || runningCmd !== null}
                onClick={() => onInstallerWu([...selectionWu])}
              >
                <Download className="icon" aria-hidden="true" /> Installer ({selectionWu.size})
              </button>
            </div>
          </>
        )}

        {onglet === "bios" && (
          <>
            <p className="cmd-desc">
              <Cpu className="icon" aria-hidden="true" />
              Informations matériel de cette machine et liens vers le support officiel du
              fabricant. Il n'existe pas d'API universelle de mise à jour BIOS : les mises à
              jour de firmware passent par Windows Update (onglet « Windows &amp; pilotes »)
              sur les machines récentes, sinon par le site ou l'outil officiel du fabricant.
            </p>

            {chargementHw && <p className="maj-status"><Loader2 className="icon spin" aria-hidden="true" /> Lecture des informations matériel…</p>}

            {!chargementHw && erreurHw && (
              <p className="modal-warn" role="alert">
                <AlertTriangle className="icon warn" aria-hidden="true" /> La lecture des informations matériel a échoué : {erreurHw}
              </p>
            )}

            {!chargementHw && infoHw && (
              <div className="hw-grille">
                <div className="hw-item">
                  <span className="hw-label">Fabricant</span>
                  <strong>{infoHw.manufacturer}</strong>
                </div>
                <div className="hw-item">
                  <span className="hw-label">Modèle</span>
                  <strong>{infoHw.model}</strong>
                </div>
                <div className="hw-item">
                  <span className="hw-label">Version BIOS</span>
                  <strong className="mono">{infoHw.biosVersion || "—"}</strong>
                </div>
                <div className="hw-item">
                  <span className="hw-label">Date BIOS</span>
                  <strong>{infoHw.biosDate || "—"}</strong>
                </div>
                {infoHw.serial && (
                  <div className="hw-item hw-item-large">
                    <span className="hw-label">Numéro de série / Service Tag</span>
                    <strong className="mono">{infoHw.serial}</strong>
                  </div>
                )}
              </div>
            )}

            {!chargementHw && infoHw && (
              <div className="hw-actions">
                {fabricantTrouve(infoHw.manufacturer) ? (
                  <LienExterne
                    className="btn"
                    href={fabricantTrouve(infoHw.manufacturer)!.url}
                  >
                    <ExternalLink className="icon" aria-hidden="true" /> {fabricantTrouve(infoHw.manufacturer)!.nom}
                    <span className="sr-only"> (ouvre un nouvel onglet)</span>
                  </LienExterne>
                ) : (
                  <span className="maj-status">Fabricant non reconnu — utilisez la recherche ci-dessous.</span>
                )}
                <LienExterne
                  className="btn"
                  href={`https://www.google.com/search?q=${encodeURIComponent(
                    `${infoHw.manufacturer} ${infoHw.model} BIOS update drivers`,
                  )}`}
                >
                  <Search className="icon" aria-hidden="true" /> Rechercher mises à jour BIOS/pilotes
                  <span className="sr-only"> (ouvre un nouvel onglet)</span>
                </LienExterne>
                <button className="btn" onClick={onActualiserHw} disabled={chargementHw}>
                  <RefreshCw className="icon" aria-hidden="true" /> Actualiser
                </button>
              </div>
            )}

            {!chargementHw && infoHw && fabricantTrouve(infoHw.manufacturer)?.outil && (
              <p className="cmd-desc">
                Outil officiel du fabricant (mises à jour pilotes + BIOS) :{" "}
                {fabricantTrouve(infoHw.manufacturer)!.outil}. Il est installable depuis
                l'onglet Applications s'il est disponible via winget.
              </p>
            )}

            {!chargementHw && chargeHw && (
              <div className="maj-liste" role="group" aria-label="Périphériques en erreur">
                <div className="maj-item maj-tous">
                  <strong>
                    Périphériques avec un problème de pilote ({problemesHw.length})
                  </strong>
                </div>
                {problemesHw.length === 0 && (
                  <p className="maj-status"><CheckCircle2 className="icon ok" aria-hidden="true" /> Tous les périphériques ont un pilote en état de marche.</p>
                )}
                {problemesHw.map((p) => (
                  <div key={p.instanceId} className="maj-item hw-probleme">
                    <span className="maj-nom" title={p.instanceId}>
                      {p.name || p.instanceId || "Périphérique inconnu"}
                    </span>
                    <span className="hw-code">
                      code {p.problemCode || "?"}
                      {CODES_PROBLEME[p.problemCode] ? ` — ${CODES_PROBLEME[p.problemCode]}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn" onClick={onFermer}>
                Fermer
              </button>
            </div>
          </>
        )}

        {onglet === "correctifs" && (
          <>
            <p className="cmd-desc">
              Correctifs prédéfinis pour les problèmes Windows courants : fichiers système
              corrompus, magasin de composants, disque, réseau. Chaque exécution demande
              confirmation (quand nécessaire) et s'affiche dans le terminal intégré.
            </p>

            <div className="maj-liste" role="group" aria-label="Correctifs système">
              {CORRECTIFS_SYSTEME.map((cmd) => {
                const blocked = cmd.elevation && elevated === false;
                return (
                  <div key={cmd.commande} className="maj-correctif">
                    <div className="maj-correctif-corps">
                      <strong>{cmd.label}</strong>
                      <p className="cmd-desc">{cmd.description}</p>
                      <code className="cmd-line">{cmd.commande}</code>
                    </div>
                    <button
                      className="btn small"
                      onClick={() => onExecuterCorrectif(cmd)}
                      disabled={blocked || runningCmd !== null}
                      title={
                        blocked
                          ? "Nécessite de relancer l'application en administrateur"
                          : cmd.confirme
                            ? "Une confirmation sera demandée"
                            : "Exécuter dans la fenêtre principale"
                      }
                    >
                      {blocked ? (
                        <Lock className="icon" aria-hidden="true" />
                      ) : (
                        <>
                          <Play className="icon" aria-hidden="true" /> Exécuter
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={onFermer}>
                Fermer
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
