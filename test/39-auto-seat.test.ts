/**
 * 슬라이스 39 — 파티가 시작될 때 자리가 없으면 자동으로 배정해 보낸다 (ADR-106)
 *
 * 파티는 예약이 연다 (ADR-93). 그런데 자리는 운영자가 짜서 보내야만 나갔다 —
 * 파티 일시에 폰을 꺼내지 않아도 되게 만들어 놓고, 자리 때문에 결국 폰을 꺼내야 했다.
 *
 * **운영자가 먼저 보낸 자리는 건드리지 않는다.** 자동은 아무것도 안 나갔을 때의 바닥이다.
 * 짜둔 초안이 있으면 그 초안을 보낸다 — 손으로 맞바꾼 것이 버려지면 안 된다.
 *
 * 재료는 `helpers/party.ts`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { EventMeta, HostState, ParticipantState } from "../src/shared/types.ts";
import { autoTableCount } from "../src/shared/seats.ts";
import { signInMaster, api, freshEvent, join, master, setPhase } from "./helpers/party.ts";

beforeAll(signInMaster);

const putSchedule = (id: string, patch: Record<string, number>) =>
  api<EventMeta>(`/api/host/events/${id}/schedule`, { method: "PUT", cookie: master, body: patch });

const hostState = async (id: string) => (await api<HostState>(`/api/host/events/${id}/state`, { cookie: master })).body;

async function withPlayers(n: number) {
  const ev = await freshEvent();
  const all = [];
  for (let i = 0; i < n; i++) all.push(await join(ev, { gender: i % 2 === 0 ? "M" : "F" }));
  await setPhase(ev.id, "prevote");
  return { ev, all };
}

describe("파티가 시작될 때 자리가 없으면 자동으로 보낸다", () => {
  it("★ 예약으로 열린 파티는 자리를 짜서 보내고, 참가자는 자리 확인을 받는다", async () => {
    const { ev, all } = await withPlayers(6);
    expect((await putSchedule(ev.id, { partyAt: Date.now() - 1000 })).status).toBe(200);

    const st = await hostState(ev.id);
    expect(st.meta.phase).toBe("party");
    expect(st.seatings, "파티가 열렸는데 자리가 없다").toHaveLength(1);
    const [r] = st.seatings;
    expect(r.status).toBe("published");
    expect(r.seats.map((s) => s.playerId).sort(), "등록한 사람이 모두 앉지 않았다").toEqual(all.map((p) => p.id).sort());
    expect(r.acks, "아무도 확인하지 않았는데 확인한 것으로 적혔다").toEqual([]);

    // 참가자에게는 자리 확인이 뜬다 — 확인하지 않은 자리다
    const me = await api<ParticipantState>("/api/me", { cookie: all[0].cookie });
    expect(me.body.seat?.round).toBe(1);
    expect(me.body.seat?.acked).toBe(false);
  });

  it("★ 버튼으로 앞당겨 열어도 같다", async () => {
    const { ev } = await withPlayers(4);
    await setPhase(ev.id, "party");
    const st = await hostState(ev.id);
    expect(st.seatings.filter((s) => s.status === "published")).toHaveLength(1);
  });

  it("★ 테이블 수는 자리 화면의 기본값과 같다 — 여섯 명에 한 테이블꼴", async () => {
    const { ev } = await withPlayers(12);
    await setPhase(ev.id, "party");
    const st = await hostState(ev.id);
    expect(st.seatings[0].tableCount).toBe(autoTableCount(12));
    expect(autoTableCount(12)).toBe(2);
  });

  it("★ 운영자가 이미 보낸 자리가 있으면 새로 짜지 않는다", async () => {
    const { ev } = await withPlayers(6);
    await api(`/api/host/events/${ev.id}/seating`, { method: "POST", cookie: master, body: { tableCount: 3 } });
    await api(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });

    await setPhase(ev.id, "party");
    const st = await hostState(ev.id);
    expect(st.seatings, "보낸 자리 위에 한 라운드를 더 얹었다").toHaveLength(1);
    expect(st.seatings[0].tableCount).toBe(3);
  });

  it("★ 짜두고 안 보낸 초안이 있으면 그 초안을 그대로 보낸다", async () => {
    /*
     * 초안에는 운영자가 손댄 것이 있을 수 있다 (맞교환, 뺀 사람). 새로 짜면 그 손이 말없이 풀린다 —
     * ADR-49 가 AI 섞기에서 가장 나쁜 종류의 놀람이라고 부른 그 일이다.
     */
    const { ev } = await withPlayers(6);
    const draft = await api<{ seats: { playerId: string; table: number }[] }>(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 3 },
    });

    await setPhase(ev.id, "party");
    const st = await hostState(ev.id);
    expect(st.seatings).toHaveLength(1);
    expect(st.seatings[0].status).toBe("published");
    expect(st.seatings[0].seats, "초안을 버리고 새로 짰다").toEqual(draft.body.seats);
  });

  it("★ 두 명이 안 되면 짜지 않는다", async () => {
    const { ev } = await withPlayers(1);
    await setPhase(ev.id, "party");
    expect((await hostState(ev.id)).seatings).toEqual([]);
  });
});
