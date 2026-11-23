export interface ChatMessage {
  id: string;
  clientId: string;
  name: string;
  text: string;
}

export interface ChatSnapshot {
  revision: number;
  messages: ChatMessage[];
}

export const CHAT_LIMIT = 50;
export const CHAT_MAX_LENGTH = 400;

export function chatText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= CHAT_MAX_LENGTH ? text : null;
}
