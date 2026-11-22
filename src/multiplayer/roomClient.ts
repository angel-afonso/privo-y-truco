import { RealtimeChannel } from "@supabase/supabase-js";
import { getPartnerSignal } from "../engine/evaluator";
import { PartnerMessage } from "../engine/partnerComms";
import {
  GameConfig,
  GameState,
  getPlayerTeam,
  getSeatsForMode,
  PlayerAction,
  PlayerId,
  TeamId,
} from "../engine/types";
import { isSupabaseConfigured, supabase } from "../utils/supabase";
import {
  buildSafeViewerState,
  mapSeatToViewer,
  projectSeatRecordForViewer,
} from "./perspective";
import {
  clearActiveRoomSession,
  clearHostMatchSnapshot,
  getOrCreateTabIdentity,
  loadActiveRoomSession,
  loadHostMatchSnapshot,
  PersistedHostSnapshot,
  PersistedRoomSession,
  saveActiveRoomSession,
  saveHostMatchSnapshot,
} from "./sessionStore";

export type BackendMode = "server" | "realtime";

export interface RoomMember {
  clientId: string;
  name: string;
  seat: PlayerId | null;
  isHost: boolean;
  joinedAt: number;
  online?: boolean;
}

/**
 * Payload SIEMPRE sanitizado y proyectado a la perspectiva del destinatario (Anti-trampa).
 * Nunca contiene cartas ocultas de otros jugadores.
 */
export interface SafeViewerSyncPayload {
  version: number;
  viewState: GameState;
  seatNames: Partial<Record<PlayerId, string>>;
  humanSeats: PlayerId[];
  offlineSeats: PlayerId[];
  botPartnerSignal: string | null;
}

export interface TeamWhisperPayload {
  fromSeat: PlayerId;
  fromName: string;
  team: TeamId;
  message: PartnerMessage;
}

export interface RoomClientCallbacks {
  onStatusChange: (
    status: "idle" | "connecting" | "reconnecting" | "connected" | "error",
    detail?: string,
  ) => void;
  onMembersChange: (members: RoomMember[]) => void;
  onConfigChange: (config: GameConfig) => void;
  onSafeViewSync: (payload: SafeViewerSyncPayload) => void;
  onRemoteAction: (seat: PlayerId, action: PlayerAction) => boolean;
  onActionRejected: (actionId: string) => void;
  onTeamWhisper: (payload: TeamWhisperPayload) => void;
  onRequestSync: (targetClientId?: string) => void;
  onHostRecovered?: (snapshot: PersistedHostSnapshot) => void;
}

interface ServerResponse {
  ok: boolean;
  error?: string;
  roomCode?: string;
  status?: "lobby" | "playing" | "finished";
  config?: GameConfig;
  version?: number;
  members?: RoomMember[];
  mySeat?: PlayerId | null;
  isHost?: boolean;
  viewState?: GameState | null;
  seatNames?: Partial<Record<PlayerId, string>>;
  humanSeats?: PlayerId[];
  botPartnerSignal?: string | null;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export function normalizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

/**
 * Cliente multijugador con soporte dual automático:
 * 1) Modo `server` (Supabase Edge Function `truco-game` + Postgres + RLS):
 *    Persistencia real en BD, anti-trampa total en servidor y reconexión garantizada.
 * 2) Modo `realtime` endurecido (fallback automático si la Edge Function aún no se despliega):
 *    Reconexión por `sessionStorage`, envíos sanitizados por asiento (`state_sync:<clientId>`),
 *    recuperación de Host por snapshot y detección de jugadores desconectados para Bot suplente.
 */
export class TrucoRoomClient {
  public readonly clientId: string;
  public readonly playerSecret: string;

  public backendMode: BackendMode = "realtime";
  public roomCode: string | null = null;
  public isHost = false;
  public mySeat: PlayerId | null = null;
  public myName = "Jugador";
  public config: GameConfig = { mode: "1v1", targetScore: 24, withFlor: true };
  public members: RoomMember[] = [];
  public stateVersion = 0;

  private channel: RealtimeChannel | null = null;
  private callbacks: RoomClientCallbacks;
  private joinedAt = Date.now();
  private inMatch = false;
  private serverAvailableCache: boolean | null = null;
  private onlineClientIds = new Set<string>();
  private serverPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: RoomClientCallbacks) {
    const id = getOrCreateTabIdentity();
    this.clientId = id.clientId;
    this.playerSecret = id.playerSecret;
    this.callbacks = callbacks;
  }

  public isConnected(): boolean {
    return this.channel !== null && this.roomCode !== null;
  }

  public isSeatOnline(seat: PlayerId, seatClientIds: Partial<Record<PlayerId, string>>): boolean {
    const cid = seatClientIds[seat];
    if (!cid) return false;
    if (cid === this.clientId) return true;
    return this.onlineClientIds.has(cid);
  }

  public getSavedSession(): PersistedRoomSession | null {
    return loadActiveRoomSession();
  }

  public getSecurityLabel(): string {
    return this.backendMode === "server"
      ? "Servidor Postgres · Anti-trampa activo"
      : "Realtime protegido · Reconexión y Bot suplente activos";
  }

  private async invokeServer(body: Record<string, unknown>): Promise<ServerResponse | null> {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.functions.invoke<ServerResponse>("truco-game", {
        body: {
          clientId: this.clientId,
          playerSecret: this.playerSecret,
          ...body,
        },
      });
      if (error || !data) return null;
      return data;
    } catch {
      return null;
    }
  }

  private async probeServerBackend(): Promise<boolean> {
    if (this.serverAvailableCache !== null) return this.serverAvailableCache;
    const res = await this.invokeServer({ op: "health" });
    this.serverAvailableCache = Boolean(res?.ok);
    return this.serverAvailableCache;
  }

  public async createRoom(playerName: string, config: GameConfig): Promise<string> {
    if (!isSupabaseConfigured || !supabase) {
      this.callbacks.onStatusChange("error", "Supabase no está configurado en .env");
      throw new Error("Supabase no configurado.");
    }

    await this.leaveRoom(true);
    this.myName = playerName.trim().slice(0, 16) || "Anfitrión";
    this.config = { ...config };
    this.callbacks.onStatusChange("connecting", "Creando sala...");

    const useServer = await this.probeServerBackend();
    if (useServer) {
      const res = await this.invokeServer({
        op: "create_room",
        name: this.myName,
        config: this.config,
      });
      if (res?.ok && res.roomCode) {
        this.backendMode = "server";
        await this.attachToServerRoom(res);
        return res.roomCode;
      }
    }

    this.backendMode = "realtime";
    const code = generateRoomCode(6);
    await this.connectRealtimeChannel(code, true, "player", false);
    this.persistSession(false);
    return code;
  }

  public async joinRoom(roomCode: string, playerName: string): Promise<string> {
    const clean = normalizeRoomCode(roomCode);
    if (clean.length < 4) {
      throw new Error("Ingresa un código de sala válido (mínimo 4 caracteres).");
    }
    if (!isSupabaseConfigured || !supabase) {
      this.callbacks.onStatusChange("error", "Supabase no está configurado en .env");
      throw new Error("Supabase no configurado.");
    }

    await this.leaveRoom(true);
    this.myName = playerName.trim().slice(0, 16) || "Invitado";
    this.callbacks.onStatusChange("connecting", `Conectando a sala ${clean}...`);

    const useServer = await this.probeServerBackend();
    if (useServer) {
      const res = await this.invokeServer({
        op: "join_room",
        roomCode: clean,
        name: this.myName,
      });
      if (res?.ok && res.roomCode) {
        this.backendMode = "server";
        await this.attachToServerRoom(res);
        return res.roomCode;
      }
      if (res && !res.ok && res.error) {
        this.callbacks.onStatusChange("error", res.error);
        throw new Error(res.error);
      }
    }

    this.backendMode = "realtime";
    await this.connectRealtimeChannel(clean, false, null, false);
    this.persistSession(false);
    return clean;
  }

  /**
   * Intenta reconectar automáticamente tras una recarga de pestaña o caída temporal de red.
   */
  public async tryAutoReconnect(): Promise<boolean> {
    const saved = loadActiveRoomSession();
    if (!saved || !isSupabaseConfigured || !supabase) return false;

    this.myName = saved.name;
    this.config = { ...saved.config };
    this.callbacks.onStatusChange("reconnecting", `Reconectando a sala ${saved.roomCode}...`);

    try {
      const useServer = await this.probeServerBackend();
      if (useServer) {
        const res = await this.invokeServer({
          op: "reconnect",
          roomCode: saved.roomCode,
          name: saved.name,
        });
        if (res?.ok && res.roomCode) {
          this.backendMode = "server";
          await this.attachToServerRoom(res);
          return true;
        }
      }

      this.backendMode = "realtime";
      await this.connectRealtimeChannel(saved.roomCode, saved.isHost, saved.seat, true);

      // Si era el Anfitrión y tiene snapshot guardado en localStorage, recuperar la partida en vivo
      if (saved.isHost) {
        const hostSnap = loadHostMatchSnapshot(saved.roomCode);
        if (hostSnap && this.callbacks.onHostRecovered) {
          this.stateVersion = hostSnap.version;
          this.inMatch = true;
          this.callbacks.onHostRecovered(hostSnap);
        }
      }
      return true;
    } catch {
      clearActiveRoomSession();
      this.callbacks.onStatusChange("idle");
      return false;
    }
  }

  private async attachToServerRoom(res: ServerResponse): Promise<void> {
    this.roomCode = res.roomCode ?? null;
    this.isHost = Boolean(res.isHost);
    this.mySeat = res.mySeat ?? null;
    if (res.config) this.config = { ...res.config };
    if (res.members) this.members = res.members;
    this.stateVersion = res.version ?? 0;
    this.inMatch = res.status === "playing" || res.status === "finished";

    if (this.roomCode) {
      await this.connectRealtimeChannel(this.roomCode, this.isHost, this.mySeat, false);
    }
    this.applyServerResponse(res);
    this.persistSession(this.inMatch);

    // Heartbeat discreto para mantener `last_seen` vivo y detectar cambios perdidos
    this.clearServerPoll();
    this.serverPollTimer = setInterval(() => {
      if (this.backendMode === "server" && this.roomCode) {
        void this.refreshServerView();
      }
    }, 6000);
  }

  private applyServerResponse(res: ServerResponse): void {
    if (res.roomCode !== this.roomCode || (res.version !== undefined && res.version < this.stateVersion)) return;
    if (res.config) {
      this.config = { ...res.config };
      this.callbacks.onConfigChange(this.config);
    }
    if (res.mySeat !== undefined) {
      this.mySeat = res.mySeat;
    }
    if (res.isHost !== undefined) {
      this.isHost = res.isHost;
    }
    if (res.members) {
      this.members = res.members.map((m) => ({
        ...m,
        online: m.clientId === this.clientId || this.onlineClientIds.has(m.clientId),
      }));
      this.callbacks.onMembersChange(this.members);
    }
    if (res.version !== undefined) {
      this.stateVersion = res.version;
    }
    if (res.viewState) {
      this.inMatch = true;
      this.persistSession(true);
      const offlineSeats: PlayerId[] = [];
      for (const m of this.members) {
        if (m.seat && m.clientId !== this.clientId && !this.onlineClientIds.has(m.clientId)) {
          const seats = res.viewState.seats;
          const viewerSeat = this.mySeat ?? "player";
          offlineSeats.push(mapSeatToViewer(m.seat, viewerSeat, seats));
        }
      }
      this.callbacks.onSafeViewSync({
        version: this.stateVersion,
        viewState: res.viewState,
        seatNames: res.seatNames ?? {},
        humanSeats: res.humanSeats ?? [],
        offlineSeats,
        botPartnerSignal: res.botPartnerSignal ?? null,
      });
    }
  }

  public async refreshServerView(): Promise<void> {
    if (this.backendMode !== "server" || !this.roomCode) return;
    const channel = this.channel;
    const res = await this.invokeServer({ op: "get_view", roomCode: this.roomCode });
    if (res?.ok && channel === this.channel) {
      this.applyServerResponse(res);
    }
  }

  public async triggerServerBotStep(): Promise<void> {
    if (this.backendMode !== "server" || !this.roomCode) return;
    const channel = this.channel;
    const expectedVersion = this.stateVersion;
    const res = await this.invokeServer({ op: "bot_step", roomCode: this.roomCode, expectedVersion });
    if (res?.ok && channel === this.channel) {
      this.applyServerResponse(res);
      if (res.version !== expectedVersion) await this.sendBroadcast("server_ping", { version: res.version });
    }
  }

  private async connectRealtimeChannel(
    roomCode: string,
    asHost: boolean,
    preferredSeat: PlayerId | null,
    isReconnect: boolean,
  ): Promise<void> {
    if (!supabase) return;

    this.roomCode = roomCode;
    this.isHost = asHost;
    this.mySeat = preferredSeat;
    this.joinedAt = Date.now();

    const channel = supabase.channel(`truco-room:${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence: { key: this.clientId },
      },
    });
    this.channel = channel;

    channel.on("presence", { event: "sync" }, () => {
      this.syncPresenceState();
    });

    // Ping ligero en modo `server`: cero cartas en el WebSocket, cada cliente pide su vista sanitizada
    channel.on("broadcast", { event: "server_ping" }, () => {
      if (this.backendMode === "server") {
        void this.refreshServerView();
      }
    });

    // Eventos en modo `realtime` endurecido
    channel.on("broadcast", { event: "room_config" }, ({ payload }) => {
      if (this.backendMode !== "realtime" || !payload?.config) return;
      this.config = { ...payload.config };
      this.callbacks.onConfigChange(this.config);
      this.ensureValidSeat();
      this.persistSession(this.inMatch);
    });

    // Canal dirigido SOLO a este `clientId` con estado sanitizado (anti-trampa)
    channel.on("broadcast", { event: `safe_view:${this.clientId}` }, ({ payload }) => {
      if (channel !== this.channel || this.backendMode !== "realtime" || !payload?.viewState) return;
      const p = payload as SafeViewerSyncPayload;
      if (p.version < this.stateVersion) return;
      this.stateVersion = p.version;
      this.inMatch = true;
      this.persistSession(true);
      this.callbacks.onSafeViewSync(p);
    });

    channel.on("broadcast", { event: "player_action" }, ({ payload }) => {
      if (this.backendMode !== "realtime" || !this.isHost || !payload?.seat || !payload?.action) {
        return;
      }
      // Validar que quien envía la acción corresponde al asiento reclamado
      const sender = this.members.find((m) => m.clientId === payload.clientId);
      if (channel !== this.channel || !sender || sender.seat !== payload.seat) return;
      const stale = payload.expectedVersion !== undefined && payload.expectedVersion !== this.stateVersion;
      if (stale ||
          !this.callbacks.onRemoteAction(payload.seat as PlayerId, payload.action as PlayerAction)) {
        void this.sendBroadcast(`action_rejected:${sender.clientId}`, { actionId: payload.actionId });
      }
    });

    channel.on("broadcast", { event: `action_rejected:${this.clientId}` }, ({ payload }) => {
      if (channel === this.channel && this.backendMode === "realtime" && payload?.actionId) {
        this.callbacks.onActionRejected(payload.actionId);
      }
    });

    channel.on("broadcast", { event: "team_whisper" }, ({ payload }) => {
      if (!payload?.message || !this.mySeat) return;
      const p = payload as TeamWhisperPayload;
      if (p.team === getPlayerTeam(this.mySeat) && p.fromSeat !== this.mySeat) {
        this.callbacks.onTeamWhisper(p);
      }
    });

    channel.on("broadcast", { event: "request_sync" }, ({ payload }) => {
      if (this.backendMode !== "realtime" || !this.isHost) return;
      void this.broadcastConfig(this.config);
      this.callbacks.onRequestSync(payload?.clientId as string | undefined);
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.callbacks.onStatusChange("error", "Tiempo de espera agotado al conectar.");
          reject(new Error("Timeout al conectar con Supabase Realtime."));
        }
      }, 10000);

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          await this.trackSelf();
          if (this.backendMode === "realtime") {
            if (this.isHost) {
              await this.broadcastConfig(this.config);
            } else {
              await this.sendBroadcast("request_sync", { clientId: this.clientId });
            }
          }
          if (!settled) {
            settled = true;
            const modeTag =
              this.backendMode === "server" ? "Postgres · Anti-trampa" : "Protegido";
            this.callbacks.onStatusChange(
              "connected",
              `${isReconnect ? "Reconectado" : "Conectado"} · Sala ${roomCode} (${modeTag})`,
            );
            resolve();
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          this.callbacks.onStatusChange("error", "Se perdió la conexión con Supabase Realtime.");
          if (!settled) {
            settled = true;
            reject(new Error(`Error de canal Supabase: ${status}`));
          }
        }
      });
    });
  }

  private async trackSelf(): Promise<void> {
    if (!this.channel) return;
    await this.channel.track({
      clientId: this.clientId,
      name: this.myName,
      seat: this.mySeat,
      isHost: this.isHost,
      joinedAt: this.joinedAt,
      online: true,
    } satisfies RoomMember);
  }

  private syncPresenceState(): void {
    if (!this.channel) return;
    const rawState = this.channel.presenceState<RoomMember>();
    const list: RoomMember[] = [];
    const onlineSet = new Set<string>();
    for (const [key, entries] of Object.entries(rawState)) {
      onlineSet.add(key);
      if (entries.length > 0) {
        list.push({ ...entries[0], online: true });
      }
    }
    this.onlineClientIds = onlineSet;
    list.sort((a, b) => a.joinedAt - b.joinedAt);

    if (this.backendMode === "server") {
      // Actualizar estado online de miembros conocidos del servidor
      this.members = this.members.map((m) => ({
        ...m,
        online: m.clientId === this.clientId || onlineSet.has(m.clientId),
      }));
      this.callbacks.onMembersChange(this.members);
      return;
    }

    this.members = list;
    this.ensureValidSeat();
    this.callbacks.onMembersChange(this.members);
  }

  private ensureValidSeat(): void {
    const validSeats = getSeatsForMode(this.config.mode);
    const takenByOthers = new Set(
      this.members
        .filter((m) => m.clientId !== this.clientId && m.seat !== null)
        .map((m) => m.seat as PlayerId),
    );

    if (this.mySeat && validSeats.includes(this.mySeat) && !takenByOthers.has(this.mySeat)) {
      return;
    }

    const firstFree = validSeats.find((s) => !takenByOthers.has(s)) ?? null;
    if (firstFree !== this.mySeat) {
      this.mySeat = firstFree;
      this.persistSession(this.inMatch);
      void this.trackSelf();
    }
  }

  private persistSession(inMatch: boolean): void {
    this.inMatch = inMatch;
    if (!this.roomCode) return;
    saveActiveRoomSession({
      roomCode: this.roomCode,
      name: this.myName,
      seat: this.mySeat,
      isHost: this.isHost,
      config: this.config,
      inMatch,
    });
  }

  public async claimSeat(seat: PlayerId): Promise<boolean> {
    if (this.backendMode === "server" && this.roomCode) {
      const res = await this.invokeServer({
        op: "claim_seat",
        roomCode: this.roomCode,
        seat,
      });
      if (res?.ok) {
        this.applyServerResponse(res);
        await this.trackSelf();
        await this.sendBroadcast("server_ping", { version: res.version });
        this.persistSession(this.inMatch);
        return true;
      }
      return false;
    }

    const validSeats = getSeatsForMode(this.config.mode);
    if (!validSeats.includes(seat)) return false;
    const takenByOther = this.members.some(
      (m) => m.clientId !== this.clientId && m.seat === seat,
    );
    if (takenByOther) return false;
    this.mySeat = seat;
    this.persistSession(this.inMatch);
    await this.trackSelf();
    return true;
  }

  public async updateHostConfig(config: GameConfig): Promise<void> {
    if (!this.isHost) return;
    this.config = { ...config };
    if (this.backendMode === "server" && this.roomCode) {
      const res = await this.invokeServer({
        op: "update_config",
        roomCode: this.roomCode,
        config,
      });
      if (res?.ok) {
        this.applyServerResponse(res);
        await this.sendBroadcast("server_ping", { version: res.version });
      }
      return;
    }
    await this.broadcastConfig(this.config);
    this.persistSession(this.inMatch);
    this.callbacks.onConfigChange(this.config);
  }

  public async startServerMatch(): Promise<boolean> {
    if (this.backendMode !== "server" || !this.roomCode) return false;
    const res = await this.invokeServer({ op: "start_match", roomCode: this.roomCode });
    if (res?.ok) {
      this.applyServerResponse(res);
      await this.sendBroadcast("server_ping", { version: res.version });
      return true;
    }
    return false;
  }

  public getSeatAssignments(): {
    seatNames: Partial<Record<PlayerId, string>>;
    seatClientIds: Partial<Record<PlayerId, string>>;
    humanSeats: PlayerId[];
  } {
    const seats = getSeatsForMode(this.config.mode);
    const seatNames: Partial<Record<PlayerId, string>> = {};
    const seatClientIds: Partial<Record<PlayerId, string>> = {};
    const humanSeats: PlayerId[] = [];

    for (const seat of seats) {
      const member = this.members.find((m) => m.seat === seat);
      if (member) {
        seatNames[seat] = member.name;
        seatClientIds[seat] = member.clientId;
        humanSeats.push(seat);
      }
    }
    return { seatNames, seatClientIds, humanSeats };
  }

  public async broadcastConfig(config: GameConfig): Promise<void> {
    await this.sendBroadcast("room_config", { config });
  }

  /**
   * En modo `realtime` endurecido, el Anfitrión sanitiza y proyecta una vista individual
   * para cada invitado conectado (`safe_view:<clientId>`) — ningún invitado recibe cartas ajenas.
   * También persiste el snapshot del Host en `localStorage` para sobrevivir recargas.
   */
  public broadcastSanitizedHostState(params: {
    canonicalState: GameState;
    seatNames: Partial<Record<PlayerId, string>>;
    seatClientIds: Partial<Record<PlayerId, string>>;
    humanSeats: PlayerId[];
    targetClientId?: string;
    stateChanged: boolean;
  }): SafeViewerSyncPayload {
    const { canonicalState, seatNames, seatClientIds, humanSeats, targetClientId } = params;
    if (params.stateChanged) this.stateVersion += 1;
    this.inMatch = true;
    this.persistSession(true);

    if (this.roomCode) {
      saveHostMatchSnapshot({
        roomCode: this.roomCode,
        version: this.stateVersion,
        state: canonicalState,
        seatNames,
        seatClientIds,
        humanSeats,
      });
    }

    const seats = canonicalState.seats;
    const offlineCanonicalSeats = humanSeats.filter((s) => !this.isSeatOnline(s, seatClientIds));

    const buildForSeat = (viewerSeat: PlayerId): SafeViewerSyncPayload => {
      const viewState = buildSafeViewerState(canonicalState, viewerSeat);
      const projectedNames = projectSeatRecordForViewer(seatNames, viewerSeat, seats);
      const projectedHumans = humanSeats.map((s) => mapSeatToViewer(s, viewerSeat, seats));
      const projectedOffline = offlineCanonicalSeats.map((s) =>
        mapSeatToViewer(s, viewerSeat, seats),
      );

      let botPartnerSignal: string | null = null;
      if (seats.length === 4 && !projectedHumans.includes("partner")) {
        const partnerCanonical = seats[(seats.indexOf(viewerSeat) + 2) % 4];
        const pHand = canonicalState.initialHands[partnerCanonical] ?? [];
        botPartnerSignal = getPartnerSignal(
          pHand,
          canonicalState.vira,
          canonicalState.config.withFlor,
        );
      }

      return {
        version: this.stateVersion,
        viewState,
        seatNames: projectedNames,
        humanSeats: projectedHumans,
        offlineSeats: projectedOffline,
        botPartnerSignal,
      };
    };

    // Enviar a cada invitado conectado su propia vista sanitizada (anti-trampa)
    for (const [seatKey, cid] of Object.entries(seatClientIds)) {
      if (!cid || cid === this.clientId) continue;
      if (targetClientId && cid !== targetClientId) continue;
      const seat = seatKey as PlayerId;
      const safePayload = buildForSeat(seat);
      void this.sendBroadcast(`safe_view:${cid}`, safePayload);
    }

    // Devolver la vista segura del propio Host
    return buildForSeat(this.mySeat ?? "player");
  }

  public requestCurrentView(): void {
    if (this.backendMode === "server") void this.refreshServerView();
    else void this.sendBroadcast("request_sync", { clientId: this.clientId });
  }

  public async sendPlayerAction(action: PlayerAction, actionId: string, expectedVersion: number): Promise<boolean> {
    if (!this.mySeat || !this.channel) return false;
    if (this.backendMode === "server") {
      const channel = this.channel;
      const res = await this.invokeServer({ op: "action", roomCode: this.roomCode, action, expectedVersion });
      if (channel !== this.channel || !res?.ok || !res.viewState) return false;
      this.applyServerResponse(res);
      void this.sendBroadcast("server_ping", { version: res.version });
      return true;
    }

    return this.sendBroadcast("player_action", { clientId: this.clientId, seat: this.mySeat, action, actionId, expectedVersion });
  }

  public async sendTeamWhisper(message: PartnerMessage): Promise<void> {
    if (!this.mySeat) return;
    const payload: TeamWhisperPayload = {
      fromSeat: this.mySeat,
      fromName: this.myName,
      team: getPlayerTeam(this.mySeat),
      message,
    };
    await this.sendBroadcast("team_whisper", payload);
  }

  private async sendBroadcast(event: string, payload: object): Promise<boolean> {
    if (!this.channel) return false;
    try {
      return await this.channel.send({ type: "broadcast", event, payload }) === "ok";
    } catch {
      return false;
    }
  }

  private clearServerPoll(): void {
    if (this.serverPollTimer !== null) {
      clearInterval(this.serverPollTimer);
      this.serverPollTimer = null;
    }
  }

  public async leaveRoom(clearSaved = true): Promise<void> {
    this.clearServerPoll();
    const prevCode = this.roomCode;
    if (this.backendMode === "server" && prevCode && clearSaved) {
      void this.invokeServer({ op: "leave_room", roomCode: prevCode });
    }
    const channel = this.channel;
    this.channel = null;
    this.roomCode = null;
    if (channel && supabase) {
      try {
        await channel.untrack();
        await supabase.removeChannel(channel);
      } catch {
        // Ignorar errores de cierre en desconexión
      }
    }
    if (clearSaved) {
      clearActiveRoomSession();
      if (prevCode) clearHostMatchSnapshot(prevCode);
    }
    this.channel = null;
    this.roomCode = null;
    this.isHost = false;
    this.mySeat = null;
    this.members = [];
    this.inMatch = false;
    this.stateVersion = 0;
    this.onlineClientIds.clear();
    this.callbacks.onStatusChange("idle");
  }
}
