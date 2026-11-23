import type { GameEvent } from "../engine/types";

// Britorefrito, español venezolano, en la biblioteca de ElevenLabs.
export const cantoVoiceId = "Ud8JVUqNEFAqAzTpzfoy";
export const cantoAudioPath = "audio/cantos/britorefrito-v4";

export const cantos = {
  truco: "¡Truco!",
  "retruco-solo": "¡Retruco!",
  "quiero-y-retruco": "¡Quiero y retruco!",
  "vale-nueve": "¡Vale nueve!",
  "quiero-y-vale-nueve": "¡Quiero y vale nueve!",
  "vale-juego": "¡Vale juego!",
  "quiero-y-vale-juego": "¡Quiero y vale juego!",
  envido: "¡Envido!",
  "envido-cinco": "¡Envido cinco piedras!",
  "envido-la-falta": "¡Envido la falta!",
  "quiero-y-envido": "¡Quiero y envido!",
  "quiero-y-la-falta": "¡Quiero y la falta!",
  flor: "¡Flor!",
  "con-flor-envido": "¡Con flor envido!",
  "con-flor-envido-la-falta": "¡Con flor envido la falta!",
  "con-flor-quiero": "¡Con flor quiero!",
  "con-flor-no-quiero": "¡Con flor no quiero!",
  "a-ley": "¡A ley!",
  "a-ley-envido": "¡A ley, envido!",
  "a-ley-envido-cinco": "¡A ley, envido cinco piedras!",
  "a-ley-envido-la-falta": "¡A ley, envido la falta!",
  "sin-ley-quiero-v2": "¡Sin ley, quiero!",
  "sin-ley-no-quiero": "¡Sin ley, no quiero!",
  quiero: "¡Quiero!",
  "no-quiero": "¡No quiero!",
  "me-voy": "¡Me voy!",
} as const;

export type Canto = keyof typeof cantos;
export const cantoTakes = ["mesa", "firme", "directa"] as const;
export type CantoTake = typeof cantoTakes[number];

export function nextCantoTake(previous?: CantoTake): CantoTake {
  const choices = cantoTakes.filter(take => take !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[¡!,]/g, "").replace(/\b5\b/g, "cinco").trim();
}

const byPhrase = new Map(Object.entries(cantos).map(([key, phrase]) => [normalize(phrase), key as Canto]));

export function eventCanto(event: GameEvent): Canto | undefined {
  if (!event.bubble || !["call", "response", "flor_result"].includes(event.type)) return;
  return byPhrase.get(normalize(event.bubble));
}
