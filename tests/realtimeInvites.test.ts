import { expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RealtimeInvites } from "../src/multiplayer/realtimeInvites";

test("Una invitación Realtime admite a una sola persona y se invalida al cerrar la mesa", async () => {
  const opened: Array<{
    redeem: (request: string) => Promise<void>;
    events: string[];
  }> = [];
  const db = {
    channel() {
      const events: string[] = [];
      let receive!: (event: { payload: { request: string } }) => Promise<void>;
      const channel = {
        on(_type: string, _filter: unknown, handler: typeof receive) {
          receive = handler;
          return channel;
        },
        subscribe(handler: (status: string) => void) {
          handler("SUBSCRIBED");
        },
        async send(message: { event: string }) {
          events.push(message.event);
          return "ok";
        },
      };
      opened.push({ redeem: request => receive({ payload: { request } }), events });
      return channel;
    },
    async removeChannel() {},
  };
  const invitations = new RealtimeInvites(db as unknown as SupabaseClient, () => {});
  let available = false;
  invitations.open("MESA01", () => available);
  expect(invitations.code).toMatch(/^R[0-9A-F]{7}$/);
  const first = opened[0];
  await first.redeem("sin-puesto");
  expect(first.events).toEqual([]);

  available = true;
  await Promise.all([first.redeem("primero"), first.redeem("segundo")]);
  expect(first.events).toEqual(["accepted:primero"]);
  expect(opened).toHaveLength(2);
  await first.redeem("reutilizado");
  expect(first.events).toHaveLength(1);

  invitations.close();
  await opened[1].redeem("después-de-salir");
  expect(invitations.code).toBeNull();
  expect(opened[1].events).toEqual([]);
});
