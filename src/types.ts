export interface CriticalEvent {
  timestamp: string;
  canal: string;
  provider: string;
  eventId: number;
  level: number;
  severity: string;
  messageRaw: string;
  processId?: number | null;
  threadId?: number | null;
  computer?: string;
  recordId?: number;
}

export interface CollecteResult {
  events: CriticalEvent[];
  avertissements: string[];
}

export interface CommandeFix {
  label: string;
  description: string;
  commande: string;
  type: string;
  elevation: boolean;
  confirme: boolean;
  /** Délai d'exécution max en secondes (défaut backend : 120, plafond : 7200). */
  timeoutSecs?: number;
}

export interface FixEntry {
  titre: string;
  cause: string;
  etapes: string[];
  categorie: string;
  commandes: CommandeFix[];
}

export interface Diagnostic {
  event: CriticalEvent;
  fix: FixEntry | null;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  elevated: boolean;
}

export interface WingetPackage {
  name: string;
  id: string;
  version: string;
  available: string;
}

export interface WinUpdate {
  updateId: string;
  title: string;
  kind: string;
  sizeMb: number;
}

export interface SystemInfo {
  manufacturer: string;
  model: string;
  biosVersion: string;
  biosDate: string;
  serial: string;
}

export interface ProblemDevice {
  name: string;
  instanceId: string;
  problemCode: string;
  status: string;
}

export interface CategorieScore {
  categorie: string;
  score: number;
  problemes: number;
}

export interface ProblemAgrege {
  provider: string;
  eventId: number;
  level: number;
  count: number;
  titre: string;
  categorie: string;
  etapes: string[];
}

export interface AuditSante {
  global: number;
  categories: CategorieScore[];
  problemes: ProblemAgrege[];
  totalEvenements: number;
  genereLe: string;
}
