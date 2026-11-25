import type { RoomAction } from "./rematch";
import { envidoLabel, envidoResponseLabel, GameState, PlayerAction, trucoCallLabel, TrucoLevel } from "../engine/types";

// La vista puede mover la carta propia antes de que el servidor o anfitrión resuelva la baza.
export function previewPlayerAction(state: GameState, action: PlayerAction): GameState {
  if (action.type !== "PLAY_CARD") return state;
  const hand = state.hands.player ?? [];
  const card = hand.find((item) => item.id === action.cardId);
  const trick = state.tricks[state.trickIndex];
  if (!card || !trick || trick.played.player || state.turn !== "player" || state.phase !== "PLAYING") {
    return state;
  }
  const played = {
    ...trick.played,
    player: { card, burned: Boolean(action.burned), order: Object.keys(trick.played).length },
  };
  return {
    ...state,
    hands: { ...state.hands, player: hand.filter((item) => item.id !== card.id) },
    tricks: state.tricks.map((entry, i) => i === state.trickIndex ? { ...trick, played } : entry),
  };
}

export interface OptimisticFeedback {
  bubble?: string;
  accent?: "truco" | "flor" | "default";
  sound?: "card" | "call" | "response";
}

export function optimisticFeedback(
  action: RoomAction,
  state: GameState,
  nextLevel?: TrucoLevel,
): OptimisticFeedback {
  switch (action.type) {
    case "PLAY_CARD":
      return { sound: "card" };
    case "CALL_TRUCO":
      return {
        bubble: trucoCallLabel(nextLevel ?? 1, state.phase === "AWAITING_TRUCO"),
        accent: "truco",
        sound: "call",
      };
    case "CALL_ENVIDO":
      return {
        bubble: envidoLabel(action.call, state.envido.chain.length > 0),
        accent: "default",
        sound: "call",
      };
    case "CALL_FLOR":
      return { bubble: "¡FLOR!", accent: "flor", sound: "call" };
    case "CALL_A_LEY":
      return { bubble: "¡A LEY!", accent: "default", sound: "call" };
    case "ASK_PRIVE":
      return { bubble: "¿Cuánto privas?", accent: "default", sound: "call" };
    case "DECLARE_PRIVE":
      return { bubble: "¡Privo!", accent: "default", sound: "response" };
    case "ANSWER_PRIVE":
      return { sound: "response" };
    case "RESPOND_ENVIDO":
      return {
        bubble: envidoResponseLabel(action.accept, state.ley.active),
        accent: "default",
        sound: "response",
      };
    case "RESPOND_TRUCO":
      return {
        bubble: action.accept ? "¡Quiero!" : "No quiero",
        accent: "default",
        sound: "response",
      };
    case "RESPOND_FLOR":
      return {
        bubble: {
          quiero: "¡Con flor quiero!",
          no_quiero: "No quiero",
          achico: "Con flor no quiero",
          contraflor: "¡Con flor envido!",
          contraflor_resto: "¡Con flor envido la falta!",
        }[action.choice],
        accent: "flor",
        sound: "response",
      };
    case "IRSE_AL_MAZO":
      return { bubble: "Me voy", accent: "default", sound: "response" };
    case "CONFIRM_REMATCH":
    case "NEXT_HAND":
      return {};
  }
}

export function pendingActionLabel(action: RoomAction, state: GameState, nextLevel?: TrucoLevel): string {
  switch (action.type) {
    case "PLAY_CARD": return action.burned ? "Quemando carta…" : "Jugando carta…";
    case "CALL_TRUCO": return trucoCallLabel(nextLevel ?? 1, state.phase === "AWAITING_TRUCO") + "…";
    case "CALL_ENVIDO": return envidoLabel(action.call, state.envido.chain.length > 0) + "…";
    case "CALL_FLOR": return "Flor…";
    case "ASK_PRIVE": return "Preguntando el prive…";
    case "DECLARE_PRIVE": return "Cantando el prive…";
    case "ANSWER_PRIVE": return "Respondiendo al prive…";
    case "CALL_A_LEY": return "A ley…";
    case "RESPOND_ENVIDO": return envidoResponseLabel(action.accept, state.ley.active) + "…";
    case "RESPOND_TRUCO": return action.accept ? "Quiero…" : "No quiero…";
    case "RESPOND_FLOR": return {
      quiero: "Quiero…", no_quiero: "No quiero…", achico: "Con flor no quiero…",
      contraflor: "Con flor envido…", contraflor_resto: "Con flor envido la falta…",
    }[action.choice];
    case "IRSE_AL_MAZO": return "Me voy…";
    case "CONFIRM_REMATCH": return "Confirmando…";
    case "NEXT_HAND": return "Repartiendo…";
  }
}
