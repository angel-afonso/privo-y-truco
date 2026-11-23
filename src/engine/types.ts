export type Suit = "espadas" | "bastos" | "oros" | "copas";

export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 10 | 11 | 12;

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export type GameMode = "1v1" | "2v2";

export type TeamId = "nosotros" | "ellos";

/**
 * Orden antihorario de mesa:
 * - 1v1: ["player", "cpu"]
 * - 2v2: ["player" (Sur/Nosotros), "cpu" (Este/Ellos), "partner" (Norte/Nosotros), "cpu2" (Oeste/Ellos)]
 */
export type PlayerId = "player" | "cpu" | "partner" | "cpu2";

export type TrickWinner = TeamId | "parda";

export interface GameConfig {
  mode: GameMode;
  targetScore: 12 | 24;
  withFlor: boolean;
}

export type TrucoLevel = 0 | 1 | 2 | 3 | 4;

export type EnvidoCallType = "envido" | "envido_cinco" | "falta_envido" | "real_envido";

export function envidoLabel(call: EnvidoCallType, isRaise = false): string {
  switch (call) {
    case "envido": return isRaise ? "Quiero y envido" : "Envido";
    case "envido_cinco": return "Envido 5 piedras";
    case "falta_envido": return isRaise ? "Quiero y la falta" : "Envido la falta";
    case "real_envido": return "Real envido"; // Cantos pendientes de versiones anteriores.
  }
}

export type FlorStage =
  | "none"
  | "flor"
  | "flor_reservada"
  | "contraflor"
  | "contraflor_resto";

export type GamePhase =
  | "MENU"
  | "PLAYING"
  | "AWAITING_ENVIDO"
  | "AWAITING_FLOR"
  | "AWAITING_TRUCO"
  | "HAND_OVER"
  | "MATCH_OVER";

export interface PlayedCard {
  card: Card;
  burned: boolean;
  /** Orden de lanzamiento dentro de la baza (0..seats.length-1) */
  order: number;
}

export interface TrickState {
  lead: PlayerId;
  played: Partial<Record<PlayerId, PlayedCard>>;
  winnerTeam?: TrickWinner;
  winnerPlayer?: PlayerId;
}

export interface EnvidoState {
  resolved: boolean;
  chain: EnvidoCallType[];
  caller?: PlayerId;
  callerTeam?: TeamId;
  responder?: PlayerId;
  responderTeam?: TeamId;
  winnerTeam?: TeamId;
  winnerPlayer?: PlayerId;
  accepted?: boolean;
  /** True mientras el Envido está pactado/resuelto pero pendiente de contarse al final de la mano */
  pendingSettlement?: boolean;
  stakedPoints?: number;
  pointsAwarded: number;
  nosotrosPoints?: number;
  nosotrosBestPlayer?: PlayerId;
  ellosPoints?: number;
  ellosBestPlayer?: PlayerId;
}

export interface FlorState {
  resolved: boolean;
  stage: FlorStage;
  caller?: PlayerId;
  callerTeam?: TeamId;
  responder?: PlayerId;
  responderTeam?: TeamId;
  winnerTeam?: TeamId;
  winnerPlayer?: PlayerId;
  pendingSettlement?: boolean;
  stakedPoints?: number;
  rejectPoints?: number;
  pointsAwarded: number;
  nosotrosPoints?: number;
  nosotrosBestPlayer?: PlayerId;
  ellosPoints?: number;
  ellosBestPlayer?: PlayerId;
  isReservada?: boolean;
  resolutionText?: string;
}

export interface TrucoState {
  level: TrucoLevel;
  /** Equipo que aceptó el último nivel y por tanto tiene la voz para subir */
  ownerTeam?: TeamId;
  pendingLevel?: TrucoLevel;
  caller?: PlayerId;
  callerTeam?: TeamId;
  responder?: PlayerId;
  responderTeam?: TeamId;
}

export interface LeyState {
  /** Jugadores que declararon "A Ley" en la 1.ª baza (pueden guardar Flor hasta su 2.ª carta o hacer paquete) */
  active: boolean;
  declaredBy: PlayerId[];
  hiddenFlorPlayers: PlayerId[];
  forfeitedBy: PlayerId[];
}

export interface PausedTruco {
  pendingLevel: TrucoLevel;
  caller: PlayerId;
  callerTeam: TeamId;
  responder: PlayerId;
  responderTeam: TeamId;
  turnBeforeCall: PlayerId;
}

export interface GameEvent {
  id: number;
  actor: PlayerId | "system";
  type:
    | "deal"
    | "play_card"
    | "burn_card"
    | "call"
    | "response"
    | "trick_win"
    | "envido_result"
    | "flor_result"
    | "hand_end"
    | "match_end";
  text: string;
  bubble?: string;
}

export interface HandSummary {
  trickWinnerTeam: TeamId;
  trucoPoints: number;
  envidoText?: string;
  florText?: string;
  reason: string;
}

export interface GameState {
  config: GameConfig;
  seats: PlayerId[];
  phase: GamePhase;
  handNumber: number;
  scores: Record<TeamId, number>;
  mano: PlayerId;
  turn: PlayerId;
  turnBeforeCall?: PlayerId;
  vira: Card;
  /** Manos iniciales de 3 cartas por jugador (para calcular Envido/Flor al final) */
  initialHands: Partial<Record<PlayerId, Card[]>>;
  /** Cartas restantes en mano por jugador */
  hands: Partial<Record<PlayerId, Card[]>>;
  trickIndex: number;
  tricks: TrickState[];
  envido: EnvidoState;
  flor: FlorState;
  truco: TrucoState;
  ley: LeyState;
  pausedTruco?: PausedTruco;
  handSummary?: HandSummary;
  matchWinner?: TeamId;
  lastEvent?: GameEvent;
  log: GameEvent[];
}

export type PlayerAction =
  | { type: "PLAY_CARD"; cardId: string; burned?: boolean }
  | { type: "CALL_A_LEY" }
  | { type: "CALL_ENVIDO"; call: EnvidoCallType }
  | { type: "RESPOND_ENVIDO"; accept: boolean }
  | { type: "CALL_FLOR" }
  | {
      type: "RESPOND_FLOR";
      choice: "achico" | "contraflor" | "contraflor_resto" | "quiero" | "no_quiero";
    }
  | { type: "CALL_TRUCO" }
  | { type: "RESPOND_TRUCO"; accept: boolean }
  | { type: "IRSE_AL_MAZO" }
  | { type: "NEXT_HAND" };

export const SUITS: Suit[] = ["espadas", "bastos", "oros", "copas"];
export const RANKS: Rank[] = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

export const SUIT_NAMES: Record<Suit, string> = {
  espadas: "Espadas",
  bastos: "Bastos",
  oros: "Oros",
  copas: "Copas",
};

export const TRUCO_LEVEL_NAMES: Record<TrucoLevel, string> = {
  0: "Sin Truco",
  1: "Truco",
  2: "Retruco",
  3: "Vale Nueve",
  4: "Vale Juego",
};

export function getSeatsForMode(mode: GameMode): PlayerId[] {
  return mode === "2v2" ? ["player", "cpu", "partner", "cpu2"] : ["player", "cpu"];
}

export function getPlayerTeam(player: PlayerId): TeamId {
  return player === "player" || player === "partner" ? "nosotros" : "ellos";
}

export function getOppositeTeam(team: TeamId): TeamId {
  return team === "nosotros" ? "ellos" : "nosotros";
}

export function getPlayerLabel(player: PlayerId, mode: GameMode): string {
  if (mode === "1v1") {
    return player === "player" ? "Tú" : "CPU";
  }
  switch (player) {
    case "player":
      return "Tú";
    case "partner":
      return "Compañero";
    case "cpu":
      return "Rival Der";
    case "cpu2":
      return "Rival Izq";
  }
}

export function getTeamLabel(team: TeamId, mode: GameMode): string {
  if (mode === "1v1") {
    return team === "nosotros" ? "Tú" : "CPU";
  }
  return team === "nosotros" ? "Nosotros" : "Ellos";
}
