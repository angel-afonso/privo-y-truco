// Supabase Edge Function (Deno): Motor Autoritativo, Persistencia en Postgres y Anti-Trampa
// Desplegar con: supabase functions deploy truco-game --no-verify-jwt

import { createClient } from "@supabase/supabase-js";
import { decideBotAction } from "../../../src/engine/ai.ts";
import { getPartnerSignal } from "../../../src/engine/evaluator.ts";
import { TrucoEngine } from "../../../src/engine/gameEngine.ts";
import {
  GameConfig,
  GameState,
  getActiveActor,
  getSeatsForMode,
  PlayerAction,
  PlayerId,
} from "../../../src/engine/types.ts";
import {
  buildSafeViewerState,
  mapSeatToViewer,
  projectSeatRecordForViewer,
} from "../../../src/multiplayer/perspective.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DISCONNECT_BOT_TAKEOVER_MS = 14_000;

interface RoomRow {
  invite_code: string;
  code: string;
  visibility: "public" | "private";
  status: "lobby" | "playing" | "finished";
  config: GameConfig;
  version: number;
  canonical_state: GameState | null;
}

interface PlayerRow {
  room_code: string;
  client_id: string;
  player_secret: string;
  name: string;
  seat: PlayerId | null;
  is_host: boolean;
  joined_at: string;
  last_seen: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function buildClientPayload(room: RoomRow, players: PlayerRow[], caller: PlayerRow | null) {
  const safeMembers = players.map((p) => ({
    clientId: p.client_id,
    name: p.name,
    seat: p.seat,
    isHost: p.is_host,
    joinedAt: new Date(p.joined_at).getTime(),
    lastSeen: new Date(p.last_seen).getTime(),
  }));

  let safeView: GameState | null = null;
  let projectedSeatNames: Partial<Record<PlayerId, string>> = {};
  let projectedHumanSeats: PlayerId[] = [];
  let botPartnerSignal: string | null = null;

  if (room.canonical_state && caller?.seat) {
    const seats = room.canonical_state.seats;
    const canonicalNames: Partial<Record<PlayerId, string>> = {};
    const canonicalHumans: PlayerId[] = [];
    for (const p of players) {
      if (p.seat) {
        canonicalNames[p.seat] = p.name;
        canonicalHumans.push(p.seat);
      }
    }

    safeView = buildSafeViewerState(room.canonical_state, caller.seat);
    projectedSeatNames = projectSeatRecordForViewer(canonicalNames, caller.seat, seats);
    projectedHumanSeats = canonicalHumans.map((s) => mapSeatToViewer(s, caller.seat!, seats));

    // Si en 2v2 el compañero del viewer es un Bot, incluir solo su seña sin revelar sus cartas
    if (seats.length === 4 && !projectedHumanSeats.includes("partner")) {
      const partnerCanonical = seats[(seats.indexOf(caller.seat) + 2) % 4];
      const pHand = room.canonical_state.initialHands[partnerCanonical] ?? [];
      botPartnerSignal = getPartnerSignal(
        pHand,
        room.canonical_state.vira,
        room.canonical_state.config.withFlor,
      );
    }
  }

  return {
    ok: true,
    roomCode: room.code,
    ...(caller?.is_host && room.status === "lobby" ? { inviteCode: room.invite_code } : {}),
    visibility: room.visibility,
    status: room.status,
    config: room.config,
    version: room.version,
    members: safeMembers,
    mySeat: caller?.seat ?? null,
    isHost: caller?.is_host ?? false,
    viewState: safeView,
    seatNames: projectedSeatNames,
    humanSeats: projectedHumanSeats,
    botPartnerSignal,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ ok: false, error: "Missing Supabase env on server" }, 500);
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const body = await req.json();
    const op = String(body.op ?? "");

    if (op === "health") {
      return jsonResponse({ ok: true, mode: "server" });
    }

    if (op === "list_public_rooms") {
      const { data, error } = await db.from("truco_open_rooms")
        .select("code,host,config,occupied").order("created_at", { ascending: false }).limit(100);
      if (error) return jsonResponse({ ok: false, error: "No se pudieron consultar las salas." }, 503);
      return jsonResponse({ ok: true, rooms: data });
    }

    const clientId = String(body.clientId ?? "").trim();
    const playerSecret = String(body.playerSecret ?? "").trim();
    let roomCode = String(body.roomCode ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);

    if (!clientId || !playerSecret) {
      return jsonResponse({ ok: false, error: "Credenciales de jugador requeridas" }, 400);
    }

    // 1) CREAR SALA
    if (op === "create_room" || op === "create_public_room") {
      const name = String(body.name ?? "Anfitrión").trim().slice(0, 16) || "Anfitrión";
      const config: GameConfig = {
        mode: body.config?.mode === "2v2" ? "2v2" : "1v1",
        targetScore: body.config?.targetScore === 12 ? 12 : 24,
        withFlor: body.config?.withFlor !== false,
      };
      const code = generateRoomCode();

      const { data: room, error: roomErr } = await db
        .from("truco_rooms")
        .insert({ code, visibility: op === "create_public_room" ? "public" : "private", status: "lobby", config, version: 1, canonical_state: null })
        .select()
        .single<RoomRow>();
      if (roomErr || !room) {
        return jsonResponse({ ok: false, error: roomErr?.message ?? "No se pudo crear la sala" }, 500);
      }

      const { data: player, error: plErr } = await db
        .from("truco_room_players")
        .insert({
          room_code: code,
          client_id: clientId,
          player_secret: playerSecret,
          name,
          seat: "player",
          is_host: true,
        })
        .select()
        .single<PlayerRow>();
      if (plErr || !player) {
        return jsonResponse({ ok: false, error: plErr?.message ?? "No se pudo registrar jugador" }, 500);
      }

      return jsonResponse(buildClientPayload(room, [player], player));
    }

    if (!roomCode) {
      return jsonResponse({ ok: false, error: "Código de sala requerido" }, 400);
    }

    if (op === "leave_room") {
      const { data, error } = await db.rpc("truco_leave_room", {
        p_code: roomCode, p_client: clientId, p_secret: playerSecret,
      });
      if (error) return jsonResponse({ ok: false, error: "No se pudo salir de la sala." }, 503);
      if (!data) return jsonResponse({ ok: false, error: "No autorizado en esta sala." }, 403);
      return jsonResponse({ ok: true });
    }

    if (op === "get_chat" || op === "send_chat") {
      const sending = op === "send_chat";
      const message = typeof body.text === "string" ? body.text.trim() : "";
      if (sending && (!message || message.length > 400 || typeof body.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(body.id))) {
        return jsonResponse({ ok: false, error: "El mensaje debe tener entre 1 y 400 caracteres." }, 400);
      }
      const { data, error } = await db.rpc("truco_chat", {
        p_code: roomCode, p_client: clientId, p_secret: playerSecret,
        p_id: sending ? body.id : null, p_text: sending ? message : null,
      });
      if (error) {
        const forbidden = error.code === "42501";
        return jsonResponse({ ok: false, error: forbidden ? "Solo los jugadores de la sala pueden entrar al chat." :
          "No se pudo conectar con el chat." }, forbidden ? 403 : 503);
      }
      return jsonResponse({ ok: true, chat: data });
    }

    if (op === "join_room") {
      const name = String(body.name ?? "Invitado").trim().slice(0, 16) || "Invitado";
      const { data, error } = await db.rpc("truco_redeem_invite", {
        p_invite: roomCode, p_client_id: clientId, p_secret: playerSecret, p_name: name,
      });
      if (error) return jsonResponse({ ok: false, error: "No se pudo confirmar la invitación." }, 503);
      if (!data) return jsonResponse({ ok: false, error: "Invitación usada o sin puesto disponible." }, 404);
      roomCode = data;
    }

    // Cargar sala + jugadores existentes
    const [{ data: room, error: rErr }, { data: playersList, error: pErr }] = await Promise.all([
      db.from("truco_rooms").select("*").eq("code", roomCode).maybeSingle<RoomRow>(),
      db.from("truco_room_players").select("*").eq("room_code", roomCode)
        .order("joined_at", { ascending: true }).returns<PlayerRow[]>(),
    ]);
    if (rErr || !room) {
      return jsonResponse({ ok: false, error: `La sala ${roomCode} no existe.` }, 404);
    }
    if (pErr) {
      return jsonResponse({ ok: false, error: pErr.message }, 500);
    }
    let players = playersList ?? [];
    let caller = players.find((p) => p.client_id === clientId) ?? null;

    // 2) UNIRSE O RECONECTAR
    if (op === "join_room" || op === "join_public_room" || op === "reconnect") {
      if (op === "join_public_room" && room.visibility !== "public") {
        return jsonResponse({ ok: false, error: "La sala ya no está disponible." }, 404);
      }
      const name = String(body.name ?? "Invitado").trim().slice(0, 16) || "Invitado";

      if (caller) {
        // Reconexión autenticada con `playerSecret`
        if (caller.player_secret !== playerSecret) {
          return jsonResponse({ ok: false, error: "Token de sesión inválido para reconectar." }, 403);
        }
        await db
          .from("truco_room_players")
          .update({ last_seen: new Date().toISOString(), name: name || caller.name })
          .eq("room_code", roomCode)
          .eq("client_id", clientId);
        caller = { ...caller, last_seen: new Date().toISOString(), name: name || caller.name };
        players = players.map((p) => (p.client_id === clientId ? caller! : p));
        return jsonResponse(buildClientPayload(room, players, caller));
      }

      if (op === "reconnect") {
        return jsonResponse({ ok: false, error: "Sesión anterior no encontrada en esta sala." }, 404);
      }

      if (op === "join_public_room") {
        const { data: admitted, error } = await db.rpc("truco_join_open_room", {
          p_code: roomCode, p_client_id: clientId, p_secret: playerSecret, p_name: name,
        });
        if (error) return jsonResponse({ ok: false, error: "No se pudo reservar el puesto." }, 503);
        if (!admitted) return jsonResponse({ ok: false, error: "Esta mesa ya no tiene puestos disponibles." }, 409);
        const { data: members, error: membersErr } = await db.from("truco_room_players")
          .select("*").eq("room_code", roomCode).order("joined_at").returns<PlayerRow[]>();
        if (membersErr || !members) return jsonResponse({ ok: false, error: "No se pudo cargar la mesa." }, 503);
        return jsonResponse(buildClientPayload(room, members, members.find(p => p.client_id === clientId) ?? null));
      }

      return jsonResponse({ ok: false, error: "La invitación ya no está disponible." }, 409);
    }

    // Todas las operaciones siguientes requieren estar autenticado en la sala
    if (!caller || caller.player_secret !== playerSecret) {
      return jsonResponse({ ok: false, error: "No autorizado en esta sala." }, 403);
    }

    // Actualizar heartbeat `last_seen`
    await db
      .from("truco_room_players")
      .update({ last_seen: new Date().toISOString() })
      .eq("room_code", roomCode)
      .eq("client_id", clientId);

    // 3) OBTENER VISTA SANITIZADA (ANTI-TRAMPA)
    if (op === "get_view") {
      return jsonResponse(buildClientPayload(room, players, caller));
    }

    // 4) CAMBIAR ASIENTO EN LOBBY
    if (op === "claim_seat") {
      if (room.status !== "lobby") {
        return jsonResponse({ ok: false, error: "La partida ya comenzó." }, 409);
      }
      const seat = body.seat as PlayerId;
      const validSeats = getSeatsForMode(room.config.mode);
      if (!validSeats.includes(seat)) {
        return jsonResponse({ ok: false, error: "Asiento inválido." }, 400);
      }
      if (players.some((p) => p.seat === seat && p.client_id !== clientId)) {
        return jsonResponse({ ok: false, error: "Ese asiento ya está ocupado." }, 409);
      }
      const { error: uErr } = await db
        .from("truco_room_players")
        .update({ seat })
        .eq("room_code", roomCode)
        .eq("client_id", clientId);
      if (uErr) return jsonResponse({ ok: false, error: uErr.message }, 409);

      caller = { ...caller, seat };
      players = players.map((p) => (p.client_id === clientId ? caller! : p));
      await db.from("truco_rooms").update({ version: room.version + 1 }).eq("code", roomCode);
      room.version += 1;
      return jsonResponse(buildClientPayload(room, players, caller));
    }

    // 5) ACTUALIZAR CONFIGURACIÓN (SOLO HOST EN LOBBY)
    if (op === "update_config") {
      if (!caller.is_host) {
        return jsonResponse({ ok: false, error: "Solo el anfitrión cambia las reglas." }, 403);
      }
      const config: GameConfig = {
        mode: body.config?.mode === "2v2" ? "2v2" : "1v1",
        targetScore: body.config?.targetScore === 12 ? 12 : 24,
        withFlor: body.config?.withFlor !== false,
      };
      const validSeats = getSeatsForMode(config.mode);
      // Limpiar asientos inválidos si pasó de 2v2 a 1v1
      for (const p of players) {
        if (p.seat && !validSeats.includes(p.seat)) {
          await db
            .from("truco_room_players")
            .update({ seat: null })
            .eq("room_code", roomCode)
            .eq("client_id", p.client_id);
          p.seat = null;
        }
      }
      room.config = config;
      room.version += 1;
      await db
        .from("truco_rooms")
        .update({ config, version: room.version })
        .eq("code", roomCode);
      return jsonResponse(buildClientPayload(room, players, caller));
    }

    // 6) INICIAR PARTIDA (SOLO HOST)
    if (op === "start_match") {
      if (!caller.is_host) {
        return jsonResponse({ ok: false, error: "Solo el anfitrión inicia la partida." }, 403);
      }
      const engine = new TrucoEngine(room.config);
      engine.startNewMatch(room.config, "player");
      room.canonical_state = engine.getState();
      room.status = "playing";
      room.version += 1;

      await db
        .from("truco_rooms")
        .update({
          status: room.status,
          canonical_state: room.canonical_state,
          version: room.version,
        })
        .eq("code", roomCode);

      return jsonResponse(buildClientPayload(room, players, caller));
    }

    if ((op === "action" || op === "bot_step") && body.expectedVersion !== undefined &&
        body.expectedVersion !== room.version) {
      if (op === "bot_step") return jsonResponse(buildClientPayload(room, players, caller));
      return jsonResponse({ ok: false, error: "La partida ya avanzó." }, 409);
    }

    async function saveMove(current: RoomRow, state: GameState) {
      const changes: Pick<RoomRow, "status" | "version" | "canonical_state"> = {
        status: state.phase === "MATCH_OVER" ? "finished" : "playing",
        version: current.version + 1,
        canonical_state: state,
      };
      const { data, error } = await db.from("truco_rooms").update(changes)
        .eq("code", current.code).eq("version", current.version).select("version").maybeSingle();
      if (error) return jsonResponse({ ok: false, error: error.message }, 500);
      if (!data) return jsonResponse({ ok: false, error: "La partida ya avanzó." }, 409);
      return jsonResponse(buildClientPayload({ ...current, ...changes }, players, caller));
    }

    // 7) ACCIÓN DE JUGADOR (VALIDADA EN SERVIDOR)
    if (op === "action") {
      if (!room.canonical_state || !caller.seat) {
        return jsonResponse({ ok: false, error: "No hay partida activa." }, 409);
      }
      const action = body.action as PlayerAction;
      const engine = new TrucoEngine(room.config);
      engine.loadExternalState(room.canonical_state);

      const previousEvent = room.canonical_state.lastEvent?.id;
      if (action.type === "NEXT_HAND" && engine.getState().phase === "HAND_OVER") {
        engine.dispatch("player", action);
      } else {
        engine.dispatch(caller.seat, action);
      }

      if (engine.getState().lastEvent?.id === previousEvent) {
        return jsonResponse({ ok: false, error: "Jugada inválida." }, 409);
      }
      return await saveMove(room, engine.getState());
    }

    // 8) PASO DE BOT (ASIENTO VACÍO O JUGADOR DESCONECTADO >14s)
    if (op === "bot_step") {
      if (!room.canonical_state) {
        return jsonResponse(buildClientPayload(room, players, caller));
      }
      const engine = new TrucoEngine(room.config);
      engine.loadExternalState(room.canonical_state);
      const state = engine.getState();
      const active = getActiveActor(state);
      if (!active) {
        return jsonResponse(buildClientPayload(room, players, caller));
      }

      const occupant = players.find((p) => p.seat === active);
      const occupantOffline =
        occupant &&
        Date.now() - new Date(occupant.last_seen).getTime() >= DISCONNECT_BOT_TAKEOVER_MS;

      // Solo ejecutar bot si el asiento no tiene humano o si el humano lleva >14s caído
      if (occupant && !occupantOffline) {
        return jsonResponse(buildClientPayload(room, players, caller));
      }

      const botAction = decideBotAction(engine, active);
      if (botAction) {
        engine.dispatch(active, botAction);
        return await saveMove(room, engine.getState());
      }
      return jsonResponse(buildClientPayload(room, players, caller));
    }

    return jsonResponse({ ok: false, error: `Operación desconocida: ${op}` }, 400);
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "Error interno del servidor" },
      500,
    );
  }
});
