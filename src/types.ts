export interface CriticalEvent {
  timestamp: string;
  canal: string;
  provider: string;
  eventId: number;
  level: number;
  severity: string;
  messageRaw: string;
}

export interface FixEntry {
  titre: string;
  cause: string;
  etapes: string[];
  categorie: string;
}

export interface Diagnostic {
  event: CriticalEvent;
  fix: FixEntry | null;
}
