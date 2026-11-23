import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),
    byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export class RealtimeInvites {
  private channel: RealtimeChannel | null = null;
  code: string | null = null;

  constructor(private db: SupabaseClient, private onChange: () => void) {}

  open(roomCode: string, canInvite: () => boolean): void {
    this.close();
    const code = "R" + randomHex(4).slice(0, 7);
    const channel = this.db.channel(`truco-invite:${code}`, { config: { broadcast: { ack: true } } });
    this.channel = channel;
    let claimed = false;
    channel.on("broadcast", { event: "redeem" }, async ({ payload }) => {
      if (this.channel !== channel || claimed || !canInvite() || typeof payload?.request !== "string") return;
      claimed = true;
      this.code = null;
      this.onChange();
      await channel.send({ type: "broadcast", event: `accepted:${payload.request}`, payload: { roomCode } });
      if (this.channel === channel) this.open(roomCode, canInvite);
    });
    channel.subscribe(status => {
      if (this.channel !== channel) return;
      this.code = status === "SUBSCRIBED" && !claimed ? code : null;
      this.onChange();
    });
  }

  close(): void {
    const channel = this.channel;
    this.channel = null;
    this.code = null;
    if (channel) void this.db.removeChannel(channel);
  }
}

export async function redeemRealtimeInvite(db: SupabaseClient, code: string): Promise<string | null> {
  const channel = db.channel(`truco-invite:${code}`);
  const request = randomHex(16);
  try {
    return await new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), 5000);
      channel.on("broadcast", { event: `accepted:${request}` }, ({ payload }) => {
        if (typeof payload?.roomCode !== "string") return;
        clearTimeout(timer);
        resolve(payload.roomCode);
      }).subscribe(status => {
        if (status === "SUBSCRIBED") void channel.send({ type: "broadcast", event: "redeem", payload: { request } });
        if (status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          clearTimeout(timer);
          resolve(null);
        }
      });
    });
  } finally {
    await db.removeChannel(channel);
  }
}
