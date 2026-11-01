export interface CriticalEvent {
  timestamp: string;
  canal: string;
  provider: string;
  eventId: number;
  level: number;
  severity: string;
  messageRaw: string;
}

export interface CommandeFix {
  label: string;
  description: string;
  commande: string;
  type: string;
  elevation: boolean;
  confirme: boolean;
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
