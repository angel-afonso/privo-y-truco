/**
 * Deriva un token determinístico e impredecible para el canal privado de notificaciones
 * del jugador (`truco-inbox:<roomCode>:<token>`), usando Web Crypto SHA-256.
 * Nunca expone `playerSecret` en la red ni permite a otros jugadores suscribirse al canal ajeno.
 */
export async function computeInboxToken(
  roomCode: string,
  clientId: string,
  playerSecret: string,
): Promise<string> {
  const input = `${roomCode}:${clientId}:${playerSecret}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function buildInboxTopic(roomCode: string, inboxToken: string): string {
  return `truco-inbox:${roomCode}:${inboxToken}`;
}
