import { GameConfig, GameState, PlayerId } from "../engine/types";

export interface PersistedIdentity {
  clientId: string;
  playerSecret: string;
}

export interface PersistedRoomSession {
  roomCode: string;
  name: string;
  seat: PlayerId | null;
  isHost: boolean;
  config: GameConfig;
  inMatch: boolean;
  savedAt: number;
}

export interface PersistedHostSnapshot {
  roomCode: string;
  version: number;
  state: GameState;
  seatNames: Partial<Record<PlayerId, string>>;
  seatClientIds: Partial<Record<PlayerId, string>>;
  humanSeats: PlayerId[];
  savedAt: number;
}

const IDENTITY_KEY = "truco_mp_identity_v1";
const SESSION_KEY = "truco_mp_active_session_v1";
const HOST_SNAP_PREFIX = "truco_mp_host_snap_v1_";
const SESSION_TTL_MS = 1000 * 60 * 90; // 90 minutos

function randomToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tk_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

/**
 * Identidad persistente por pestaña (`sessionStorage`) para que recargar la página
 * recupere exactamente el mismo `clientId` y `playerSecret` sin chocar con otras pestañas.
 */
export function getOrCreateTabIdentity(): PersistedIdentity {
  if (typeof sessionStorage === "undefined") {
    return { clientId: randomToken(), playerSecret: randomToken() };
  }
  try {
    const raw = sessionStorage.getItem(IDENTITY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedIdentity>;
      if (parsed.clientId && parsed.playerSecret) {
        return { clientId: parsed.clientId, playerSecret: parsed.playerSecret };
      }
    }
    const created: PersistedIdentity = {
      clientId: randomToken(),
      playerSecret: `${randomToken()}-${randomToken()}`,
    };
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(created));
    return created;
  } catch {
    return { clientId: randomToken(), playerSecret: randomToken() };
  }
}

export function saveActiveRoomSession(session: Omit<PersistedRoomSession, "savedAt">): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const payload: PersistedRoomSession = { ...session, savedAt: Date.now() };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage quota errors
  }
}

export function loadActiveRoomSession(): PersistedRoomSession | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedRoomSession;
    if (!parsed.roomCode || Date.now() - parsed.savedAt > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearActiveRoomSession(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function saveHostMatchSnapshot(snap: Omit<PersistedHostSnapshot, "savedAt">): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: PersistedHostSnapshot = { ...snap, savedAt: Date.now() };
    localStorage.setItem(`${HOST_SNAP_PREFIX}${snap.roomCode}`, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function loadHostMatchSnapshot(roomCode: string): PersistedHostSnapshot | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${HOST_SNAP_PREFIX}${roomCode}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedHostSnapshot;
    if (Date.now() - parsed.savedAt > SESSION_TTL_MS) {
      localStorage.removeItem(`${HOST_SNAP_PREFIX}${roomCode}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearHostMatchSnapshot(roomCode: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(`${HOST_SNAP_PREFIX}${roomCode}`);
  } catch {
    // ignore
  }
}
