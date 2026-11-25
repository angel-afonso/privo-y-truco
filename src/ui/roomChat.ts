import { CHAT_MAX_LENGTH, chatText, type ChatMessage } from "../multiplayer/chat";
import { soundFX } from "./sound";
import { FONT_DISPLAY } from "./theme";
import "./roomChat.css";

const QUICK_PHRASES = [
  "¡Buena mano!",
  "¡Qué carta!",
  "Te toca",
  "Jaja",
  "¡Vamos otra!",
  "Pura paja",
] as const;

const SENDER_TONES = ["#e6be6a", "#7cd4a4", "#e39a74", "#7ec8cc"] as const;
const QUIET_STORAGE_KEY = "truco_chat_quiet";
const PEEK_DURATION_MS = 4800;
const MAX_VISIBLE_PEEKS = 2;

const ICON_CHAT = `<svg class="chat-ico" viewBox="0 0 20 20" fill="none" aria-hidden="true">
  <path d="M4.25 4.75h11.5a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H8.6l-3.45 2.55c-.33.24-.8.01-.8-.4v-2.15h-.1a1.5 1.5 0 0 1-1.5-1.5v-7a1.5 1.5 0 0 1 1.5-1.5Z" stroke="currentColor" stroke-width="1.65" stroke-linejoin="round"/>
  <path d="M6.8 8.9h6.4M6.8 11.7h4.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;

const ICON_SEND = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
  <path d="M3.5 10h12.2M11.2 5.2 16 10l-4.8 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const ICON_BELL = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
  <path d="M6.5 8.5a3.5 3.5 0 1 1 7 0c0 3.2 1.4 4.5 1.8 5H4.7c.4-.5 1.8-1.8 1.8-5Z" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round"/>
  <path d="M8.5 15.8a1.7 1.7 0 0 0 3 0" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/>
</svg>`;

const ICON_BELL_OFF = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
  <path d="M7.3 5.7A3.5 3.5 0 0 1 13.5 8.5c0 1.4.3 2.5.7 3.3M5.4 8.5c0 2.9-1.1 4.2-1.5 4.8h9.2M8.5 15.8a1.7 1.7 0 0 0 3 0M3.5 3.5l13 13" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const ICON_CLOSE = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
  <path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
</svg>`;

function toneForClient(clientId: string): string {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0;
  }
  return SENDER_TONES[hash % SENDER_TONES.length];
}

function readQuietPreference(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(QUIET_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export class RoomChat {
  readonly button = document.createElement("button");
  private panel = document.createElement("aside");
  private peeks = document.createElement("div");
  private history: HTMLElement;
  private list: HTMLElement;
  private empty: HTMLElement;
  private jumpBtn: HTMLButtonElement;
  private input: HTMLInputElement;
  private submit: HTMLButtonElement;
  private notice: HTMLElement;
  private counter: HTMLElement;
  private badge: HTMLElement;
  private quietBtn: HTMLButtonElement;
  private quickBtns: HTMLButtonElement[] = [];

  private room: string | null = null;
  private isOpen = false;
  private quietMode = readQuietPreference();
  private messages: ChatMessage[] = [];
  private unread = 0;
  private busy = false;
  private retry: { id: string; text: string; fromInput: boolean } | null = null;
  private generation = 0;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private peekTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  constructor(
    private myId: string,
    private send: (id: string, text: string) => Promise<boolean>,
    private refresh: () => Promise<boolean>,
  ) {
    this.button.className = "room-chat-toggle";
    this.button.type = "button";
    this.button.hidden = true;
    this.button.setAttribute("aria-controls", "room-chat-panel");
    this.button.setAttribute("aria-expanded", "false");
    this.button.innerHTML = `${ICON_CHAT}<span class="chat-toggle-label">Chat</span><small hidden></small>`;
    this.badge = this.button.querySelector("small")!;
    this.button.onclick = () => this.toggle();

    this.peeks.className = "room-chat-peeks";
    this.peeks.setAttribute("aria-live", "polite");
    this.peeks.setAttribute("aria-atomic", "false");

    this.panel.id = "room-chat-panel";
    this.panel.className = "room-chat-panel";
    this.panel.hidden = true;
    this.panel.style.setProperty("--chat-display", FONT_DISPLAY);
    this.panel.setAttribute("role", "region");
    this.panel.setAttribute("aria-labelledby", "room-chat-title");

    const quickChipsHtml = QUICK_PHRASES.map(
      (phrase) => `<button type="button" class="chat-chip" data-phrase="${phrase}">${phrase}</button>`,
    ).join("");

    this.panel.innerHTML = `
      <header class="chat-head">
        <div class="chat-head-title">
          <h2 id="room-chat-title">Chat de mesa</h2>
          <span class="chat-head-hint">Sin pausar la partida</span>
        </div>
        <div class="chat-head-actions">
          <button type="button" class="chat-icon-btn chat-quiet" aria-pressed="false"></button>
          <button type="button" class="chat-icon-btn chat-close" aria-label="Cerrar chat">${ICON_CLOSE}</button>
        </div>
      </header>
      <div class="chat-history-wrap">
        <div class="chat-history">
          <div class="chat-empty">
            <p>La mesa está callada.</p>
            <small>Toca una frase rápida o escribe abajo sin dejar de jugar.</small>
          </div>
          <ol aria-label="Mensajes de la mesa" role="log" aria-relevant="additions"></ol>
        </div>
        <button type="button" class="chat-jump" hidden>Nuevos mensajes ↓</button>
      </div>
      <div class="chat-quick" role="group" aria-label="Frases rápidas">${quickChipsHtml}</div>
      <form class="chat-form">
        <div class="chat-meta-row">
          <p class="chat-notice" role="status"></p>
          <span class="chat-counter" hidden></span>
        </div>
        <div class="chat-compose">
          <label class="sr-only" for="room-chat-draft">Mensaje a la mesa</label>
          <input id="room-chat-draft" placeholder="Escribe a la mesa…" maxlength="${CHAT_MAX_LENGTH}" autocomplete="off">
          <button type="submit" class="chat-send" aria-label="Enviar mensaje" disabled>${ICON_SEND}</button>
        </div>
      </form>`;

    this.history = this.panel.querySelector(".chat-history")!;
    this.list = this.panel.querySelector("ol")!;
    this.empty = this.panel.querySelector(".chat-empty")!;
    this.jumpBtn = this.panel.querySelector(".chat-jump")!;
    this.input = this.panel.querySelector("input")!;
    this.submit = this.panel.querySelector(".chat-send")!;
    this.notice = this.panel.querySelector(".chat-notice")!;
    this.counter = this.panel.querySelector(".chat-counter")!;
    this.quietBtn = this.panel.querySelector(".chat-quiet")!;
    this.quickBtns = Array.from(this.panel.querySelectorAll<HTMLButtonElement>(".chat-chip"));

    this.panel.querySelector<HTMLButtonElement>(".chat-close")!.onclick = () => this.close();
    this.quietBtn.onclick = () => this.toggleQuiet();
    this.jumpBtn.onclick = () => {
      this.scrollToBottom(true);
      this.jumpBtn.hidden = true;
    };
    this.history.onscroll = () => {
      if (this.isNearBottom()) this.jumpBtn.hidden = true;
    };
    for (const chip of this.quickBtns) {
      chip.onclick = () => {
        const phrase = chip.dataset.phrase;
        if (phrase) void this.post(phrase);
      };
    }

    this.input.oninput = () => {
      if (this.retry?.fromInput) this.retry = null;
      this.notice.textContent = "";
      this.updateComposer();
    };
    this.panel.querySelector("form")!.onsubmit = (e) => {
      e.preventDefault();
      void this.post();
    };

    document.addEventListener("keydown", this.handleGlobalKeydown);
    document.body.append(this.button, this.peeks, this.panel);
    this.syncQuietButton();
    this.updateBadge();
    this.updateComposer();
  }

  private handleGlobalKeydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.isOpen) {
      e.preventDefault();
      this.close(true);
    }
  };

  setRoom(room: string | null): void {
    if (this.room === room) return;
    this.room = room;
    this.generation++;
    if (this.isOpen) this.close(false);
    this.clearPeeks();
    this.button.hidden = !room;
    this.unread = 0;
    this.messages = [];
    this.list.replaceChildren();
    this.input.value = "";
    this.notice.textContent = "";
    this.busy = false;
    this.retry = null;
    this.empty.hidden = false;
    this.jumpBtn.hidden = true;
    this.updateBadge();
    this.updateComposer();
  }

  setCompact(compact: boolean): void {
    this.button.classList.toggle("compact", compact);
    this.peeks.classList.toggle("compact", compact);
    this.panel.classList.toggle("compact", compact);
  }

  place(slot?: HTMLElement): void {
    const parent = slot ?? document.body;
    const inLobby = Boolean(slot);
    this.button.classList.toggle("in-lobby", inLobby);
    this.peeks.classList.toggle("in-lobby", inLobby);
    if (this.button.parentElement !== parent) parent.append(this.button);
  }

  receive(room: string, messages: ChatMessage[], initial: boolean): void {
    if (room !== this.room) return;
    const known = new Set(this.messages.map((m) => this.key(m)));
    const incoming = initial
      ? []
      : messages.filter((m) => m.clientId !== this.myId && !known.has(this.key(m)));

    const wasNearBottom = this.isNearBottom();
    this.messages = messages;

    if (incoming.length > 0 && !this.isOpen) {
      this.unread += incoming.length;
      this.pulseButton();
      if (!this.quietMode) {
        soundFX.playChatPop();
        for (const msg of incoming.slice(-MAX_VISIBLE_PEEKS)) {
          this.showPeek(msg);
        }
      }
    }

    this.updateBadge();
    this.renderMessages(wasNearBottom);
    if (this.isOpen && incoming.length > 0 && !wasNearBottom) {
      this.jumpBtn.hidden = false;
    }
  }

  private key(message: ChatMessage): string {
    return JSON.stringify([message.clientId, message.id]);
  }

  private isNearBottom(): boolean {
    return this.history.scrollHeight - this.history.scrollTop - this.history.clientHeight < 44;
  }

  private scrollToBottom(smooth = false): void {
    this.history.scrollTo({
      top: this.history.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  private pulseButton(): void {
    this.button.classList.remove("has-pulse");
    void this.button.offsetWidth;
    this.button.classList.add("has-pulse");
  }

  private toggle(): void {
    if (this.isOpen) this.close(false);
    else this.open();
  }

  private toggleQuiet(): void {
    this.quietMode = !this.quietMode;
    try {
      localStorage.setItem(QUIET_STORAGE_KEY, this.quietMode ? "1" : "0");
    } catch {
      // Ignorar si localStorage no está disponible
    }
    if (this.quietMode) this.clearPeeks();
    this.syncQuietButton();
  }

  private syncQuietButton(): void {
    this.quietBtn.innerHTML = this.quietMode ? ICON_BELL_OFF : ICON_BELL;
    this.quietBtn.setAttribute("aria-pressed", String(this.quietMode));
    const label = this.quietMode
      ? "Avisos en mesa silenciados. Activar avisos"
      : "Silenciar avisos en mesa";
    this.quietBtn.setAttribute("aria-label", label);
    this.quietBtn.title = this.quietMode ? "Activar avisos flotantes" : "Silenciar avisos flotantes";
  }

  private updateBadge(): void {
    this.badge.hidden = this.unread === 0;
    this.badge.textContent = this.unread > 9 ? "9+" : String(this.unread);
    this.button.setAttribute(
      "aria-label",
      this.unread ? `Chat de la mesa, ${this.unread} sin leer` : "Chat de la mesa",
    );
    this.button.setAttribute("aria-expanded", String(this.isOpen));
  }

  private open(): void {
    if (!this.room || this.isOpen) return;
    this.isOpen = true;
    this.panel.hidden = false;
    this.unread = 0;
    this.jumpBtn.hidden = true;
    this.clearPeeks();
    this.updateBadge();
    this.scrollToBottom(false);

    // En desktop enfocamos el campo de texto; en móvil táctil evitamos abrir el teclado
    // automáticamente al solo querer leer el historial.
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      this.input.focus({ preventScroll: true });
    }

    const generation = this.generation;
    const refresh = async () => {
      if (!this.isOpen || document.hidden) return;
      const ok = await this.refresh();
      if (generation !== this.generation || !this.isOpen) return;
      const error = "No se pudo actualizar el chat.";
      if (!ok && !this.notice.textContent) this.notice.textContent = error;
      else if (ok && this.notice.textContent === error) this.notice.textContent = "";
    };
    void refresh();
    this.refreshTimer = setInterval(refresh, 12000);
  }

  private close(returnFocus = false): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.hidden = true;
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    this.updateBadge();
    if (returnFocus && this.room) {
      this.button.focus({ preventScroll: true });
    }
  }

  private showPeek(message: ChatMessage): void {
    while (this.peeks.children.length >= MAX_VISIBLE_PEEKS) {
      const oldest = this.peeks.firstElementChild as HTMLElement | null;
      if (oldest) this.removePeek(oldest);
      else break;
    }

    const card = document.createElement("button");
    card.type = "button";
    card.className = "chat-peek";
    card.style.setProperty("--sender-tone", toneForClient(message.clientId));

    const head = document.createElement("span");
    head.className = "chat-peek-head";
    const dot = document.createElement("i");
    dot.className = "chat-sender-dot";
    const name = document.createElement("strong");
    name.textContent = message.name;
    head.append(dot, name);

    const body = document.createElement("span");
    body.className = "chat-peek-text";
    body.textContent = message.text;

    card.append(head, body);
    card.onclick = () => this.open();

    const scheduleDismiss = () => {
      const prev = this.peekTimers.get(card);
      if (prev) clearTimeout(prev);
      this.peekTimers.set(
        card,
        setTimeout(() => this.dismissPeek(card), PEEK_DURATION_MS),
      );
    };
    const pauseDismiss = () => {
      const prev = this.peekTimers.get(card);
      if (prev) clearTimeout(prev);
      this.peekTimers.delete(card);
    };

    card.onpointerenter = pauseDismiss;
    card.onpointerleave = scheduleDismiss;
    card.onfocus = pauseDismiss;
    card.onblur = scheduleDismiss;

    this.peeks.append(card);
    scheduleDismiss();
  }

  private dismissPeek(card: HTMLElement): void {
    if (!card.isConnected) return;
    card.classList.add("leaving");
    setTimeout(() => this.removePeek(card), 180);
  }

  private removePeek(card: HTMLElement): void {
    const timer = this.peekTimers.get(card);
    if (timer) clearTimeout(timer);
    this.peekTimers.delete(card);
    card.remove();
  }

  private clearPeeks(): void {
    for (const timer of this.peekTimers.values()) clearTimeout(timer);
    this.peekTimers.clear();
    this.peeks.replaceChildren();
  }

  private renderMessages(wasNearBottom = this.isNearBottom()): void {
    const messages = [...this.messages];
    const pendingKey =
      this.busy && this.retry && !messages.some((m) => m.id === this.retry!.id && m.clientId === this.myId)
        ? this.key({ id: this.retry.id, clientId: this.myId, name: "Tú", text: this.retry.text })
        : null;

    if (pendingKey && this.retry) {
      messages.push({ id: this.retry.id, clientId: this.myId, name: "Tú", text: this.retry.text });
    }

    this.empty.hidden = messages.length !== 0;
    const keys = new Set(messages.map((m) => this.key(m)));
    const existing = new Map(
      Array.from(this.list.children, (el) => [(el as HTMLElement).dataset.key!, el as HTMLElement]),
    );
    for (const [key, el] of existing) if (!keys.has(key)) el.remove();

    messages.forEach((message, index) => {
      const key = this.key(message);
      const mine = message.clientId === this.myId;
      const grouped = index > 0 && messages[index - 1].clientId === message.clientId;
      let row = existing.get(key);
      if (!row) {
        row = document.createElement("li");
        row.dataset.key = key;
        row.classList.toggle("mine", mine);
        if (!mine) {
          row.style.setProperty("--sender-tone", toneForClient(message.clientId));
        }

        const name = document.createElement("strong");
        name.textContent = mine ? "Tú" : message.name;

        const bubble = document.createElement("div");
        bubble.className = "chat-bubble";
        const body = document.createElement("p");
        body.textContent = message.text;
        bubble.append(body);

        row.append(name, bubble);
      }
      row.classList.toggle("grouped", grouped);
      row.classList.toggle("sending", key === pendingKey);

      if (this.list.children[index] !== row) {
        this.list.insertBefore(row, this.list.children[index] ?? null);
      }
    });

    if (wasNearBottom || this.busy) {
      this.scrollToBottom(false);
      this.jumpBtn.hidden = true;
    }
  }

  private updateComposer(): void {
    const rawLen = this.input.value.length;
    const canSendInput = Boolean(chatText(this.input.value));
    const canRetryQuick = Boolean(this.retry && !this.retry.fromInput);
    this.input.readOnly = this.busy;
    this.submit.disabled = this.busy || (!canSendInput && !canRetryQuick);
    this.submit.classList.toggle("is-retry", !this.busy && Boolean(this.retry));
    this.submit.setAttribute(
      "aria-label",
      this.busy ? "Enviando mensaje" : this.retry ? "Reintentar envío" : "Enviar mensaje",
    );
    this.submit.title = this.busy ? "Enviando…" : this.retry ? "Reintentar" : "Enviar";

    for (const chip of this.quickBtns) {
      chip.disabled = this.busy;
    }

    const showCounter = rawLen >= CHAT_MAX_LENGTH - 80;
    this.counter.hidden = !showCounter;
    if (showCounter) {
      this.counter.textContent = `${CHAT_MAX_LENGTH - rawLen}`;
      this.counter.classList.toggle("warn", CHAT_MAX_LENGTH - rawLen <= 20);
    }
  }

  private async post(overrideText?: string): Promise<void> {
    const fromInput = overrideText === undefined;
    const text = chatText(
      fromInput
        ? this.input.value || (this.retry && !this.retry.fromInput ? this.retry.text : "")
        : overrideText,
    );
    if (!this.room || !text || this.busy) return;

    const generation = this.generation;
    const reuseId = this.retry && this.retry.text === text ? this.retry.id : undefined;
    const id = reuseId ?? crypto.getRandomValues(new Uint32Array(4)).join("-");
    this.retry = { id, text, fromInput: fromInput && Boolean(chatText(this.input.value)) };
    this.busy = true;
    this.notice.textContent = "";
    this.updateComposer();
    this.renderMessages(true);

    const ok = await this.send(id, text).catch(() => false);
    if (generation !== this.generation) return;

    this.busy = false;
    if (ok) {
      if (this.retry.fromInput) this.input.value = "";
      this.retry = null;
    } else {
      this.notice.textContent = "No se pudo confirmar el envío. Toca enviar para reintentar.";
    }
    this.updateComposer();
    this.renderMessages(true);
    if (this.isOpen && fromInput && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      this.input.focus({ preventScroll: true });
    }
  }
}
