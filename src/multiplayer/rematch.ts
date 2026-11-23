import { TrucoEngine } from "../engine/gameEngine.ts";
import type { GameState, PlayerAction, PlayerId } from "../engine/types.ts";

export type RoomAction = PlayerAction | { type: "CONFIRM_REMATCH"; matchId: number };

export function startRoomMatch(engine: TrucoEngine, players: PlayerId[], matchId: number): GameState {
  const state = engine.startNewMatch();
  state.rematch = { matchId, players: [...players], confirmed: [] };
  return state;
}

export function confirmRematch(engine: TrucoEngine, actor: PlayerId, matchId: number, players: PlayerId[], online: PlayerId[]): boolean {
  const state = engine.getState();
  if (state.phase !== "MATCH_OVER") return false;
  // Las partidas guardadas antes de incorporar la revancha no llevan identificador.
  const vote = state.rematch ?? { matchId: 0, players: [...players], confirmed: [] };
  if (vote.matchId !== matchId || !vote.players.includes(actor) || vote.confirmed.includes(actor)) return false;
  if (!online.includes(actor)) return false;
  const confirmed = [...vote.confirmed, actor];
  if (confirmed.length === vote.players.length) {
    if (!vote.players.every(seat => online.includes(seat))) return false;
    startRoomMatch(engine, vote.players, matchId + 1);
  } else {
    state.rematch = { ...vote, confirmed };
  }
  return true;
}
