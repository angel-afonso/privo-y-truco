import { CHAT_MAX_LENGTH, chatText, type ChatMessage } from "../multiplayer/chat";
import { FONT_DISPLAY } from "./theme";
import "./roomChat.css";

export class RoomChat {
  readonly button = document.createElement("button");
  private panel = document.createElement("dialog");
  private list: HTMLElement;
  private empty: HTMLElement;
  private input: HTMLInputElement;
  private submit: HTMLButtonElement;
  private notice: HTMLElement;
  private badge: HTMLElement;
  private room: string | null = null;
  private messages: ChatMessage[] = [];
  private unread = 0;
  private busy = false;
  private retry: { id: string; text: string } | null = null;
  private generation = 0;
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(private myId: string, private send: (id: string, text: string) => Promise<boolean>,
    private refresh: () => Promise<boolean>) {
    this.button.className = "room-chat-toggle";
    this.button.type = "button";
    this.button.hidden = true;
    this.button.setAttribute("aria-haspopup", "dialog");
    this.button.setAttribute("aria-controls", "room-chat-panel");
    this.button.innerHTML = '<span>Chat</span><small hidden></small>';
    this.badge = this.button.querySelector("small")!;
    this.button.onclick = () => this.open();
    this.panel.id = "room-chat-panel";
    this.panel.className = "room-chat-panel";
    this.panel.style.setProperty("--chat-display", FONT_DISPLAY);
    this.panel.setAttribute("aria-labelledby", "room-chat-title");
    this.panel.innerHTML = `
      <header><h2 id="room-chat-title">Chat de la mesa</h2>
        <button type="button" class="chat-close" aria-label="Cerrar chat">×</button></header>
      <div class="chat-history">
        <p class="chat-empty">Todavía no hay mensajes en esta mesa.</p>
        <ol aria-label="Mensajes de la mesa" role="log" aria-relevant="additions"></ol>
      </div>
      <form><p class="chat-notice" role="status"></p>
        <label for="room-chat-draft">Mensaje a la mesa</label>
        <div class="chat-compose"><input id="room-chat-draft" maxlength="${CHAT_MAX_LENGTH}" autocomplete="off">
        <button type="submit" disabled>Enviar</button></div></form>`;
    this.list = this.panel.querySelector("ol")!;
    this.empty = this.panel.querySelector(".chat-empty")!;
    this.input = this.panel.querySelector("input")!;
    this.submit = this.panel.querySelector('[type="submit"]')!;
    this.notice = this.panel.querySelector(".chat-notice")!;
    this.panel.querySelector<HTMLButtonElement>(".chat-close")!.onclick = () => this.panel.close();
    this.panel.onclick = e => {
      if (e.target !== this.panel) return;
      const r = this.panel.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.panel.close();
    };
    this.panel.onclose = () => {
      clearInterval(this.refreshTimer);
      this.button.setAttribute("aria-expanded", "false");
      if (this.room) this.button.focus({ preventScroll: true });
    };
    this.input.oninput = () => {
      this.retry = null;
      this.notice.textContent = "";
      this.updateComposer();
    };
    this.panel.querySelector("form")!.onsubmit = e => {
      e.preventDefault();
      void this.post();
    };
    document.body.append(this.button, this.panel);
    this.updateBadge();
  }

  setRoom(room: string | null): void {
    if (this.room === room) return;
    this.room = room;
    this.generation++;
    if (this.panel.open) this.panel.close();
    this.button.hidden = !room;
    this.unread = 0;
    this.messages = [];
    this.list.replaceChildren();
    this.input.value = "";
    this.notice.textContent = "";
    this.busy = false;
    this.retry = null;
    this.empty.hidden = false;
    this.updateBadge();
    this.updateComposer();
  }

  place(slot?: HTMLElement): void {
    const parent = slot ?? document.body;
    if (this.button.parentElement !== parent) parent.append(this.button);
  }

  receive(room: string, messages: ChatMessage[], initial: boolean): void {
    if (room !== this.room) return;
    const known = new Set(this.messages.map(m => this.key(m)));
    if (!initial && !this.panel.open) {
      this.unread += messages.filter(m => m.clientId !== this.myId && !known.has(this.key(m))).length;
    }
    this.messages = messages;
    this.updateBadge();
    this.renderMessages();
  }

  private key(message: ChatMessage): string {
    return JSON.stringify([message.clientId, message.id]);
  }

  private updateBadge(): void {
    this.badge.hidden = this.unread === 0;
    this.badge.textContent = this.unread > 9 ? "9+" : String(this.unread);
    this.button.setAttribute("aria-label", this.unread ? `Chat de la mesa, ${this.unread} sin leer` : "Chat de la mesa");
    this.button.setAttribute("aria-expanded", String(this.panel.open));
  }

  private open(): void {
    if (!this.room || this.panel.open) return;
    this.panel.showModal();
    this.unread = 0;
    this.updateBadge();
    this.list.parentElement!.scrollTop = this.list.parentElement!.scrollHeight;
    this.input.focus();
    const generation = this.generation;
    const refresh = async () => {
      if (!this.panel.open || document.hidden) return;
      const ok = await this.refresh();
      if (generation !== this.generation || !this.panel.open) return;
      const error = "No se pudo actualizar el chat.";
      if (!ok && !this.notice.textContent) this.notice.textContent = error;
      else if (ok && this.notice.textContent === error) this.notice.textContent = "";
    };
    void refresh();
    this.refreshTimer = setInterval(refresh, 12000);
  }

  private renderMessages(): void {
    const history = this.list.parentElement!;
    const nearEnd = history.scrollHeight - history.scrollTop - history.clientHeight < 36;
    const messages = [...this.messages];
    if (this.busy && this.retry && !messages.some(m => m.id === this.retry!.id && m.clientId === this.myId)) {
      messages.push({ ...this.retry, clientId: this.myId, name: "Tú" });
    }
    this.empty.hidden = messages.length !== 0;
    const keys = new Set(messages.map(m => this.key(m)));
    const existing = new Map(Array.from(this.list.children, el => [(el as HTMLElement).dataset.key!, el]));
    for (const [key, el] of existing) if (!keys.has(key)) el.remove();
    messages.forEach((message, index) => {
      const key = this.key(message);
      let row = existing.get(key);
      if (!row) {
        row = document.createElement("li");
        (row as HTMLElement).dataset.key = key;
        const mine = message.clientId === this.myId;
        row.classList.toggle("mine", mine);
        const name = document.createElement("strong");
        name.textContent = mine ? "Tú" : message.name;
        const body = document.createElement("p");
        body.textContent = message.text;
        row.append(name, body);
      }
      if (this.list.children[index] !== row) this.list.insertBefore(row, this.list.children[index] ?? null);
    });
    if (nearEnd || this.busy) history.scrollTop = history.scrollHeight;
  }

  private updateComposer(): void {
    this.input.readOnly = this.busy;
    this.submit.disabled = this.busy || !chatText(this.input.value);
    this.submit.textContent = this.busy ? "Enviando…" : this.retry ? "Reintentar" : "Enviar";
  }

  private async post(): Promise<void> {
    const text = chatText(this.input.value);
    if (!this.room || !text || this.busy) return;
    const generation = this.generation;
    const id = this.retry?.id ?? crypto.getRandomValues(new Uint32Array(4)).join("-");
    this.retry = { id, text };
    this.busy = true;
    this.notice.textContent = "";
    this.updateComposer();
    this.renderMessages();
    const ok = await this.send(id, text).catch(() => false);
    if (generation !== this.generation) return;
    this.busy = false;
    if (ok) {
      this.retry = null;
      this.input.value = "";
    } else {
      this.notice.textContent = "No se pudo confirmar el envío.";
    }
    this.updateComposer();
    this.renderMessages();
    if (this.panel.open) this.input.focus();
  }
}
