/**
 * 매력 투표 1위 보너스 콕 · 매력 투표는 파티 시작에 닫힌다 (슬라이스 38, ADR-100).
 *
 * 지키는 것은 넷이다 —
 *   · 1위는 **성별마다**, 공동이면 모두, 가장 많은 표가 **2표 이상**일 때만
 *   · **파티가 시작되는 순간 한 번** 정하고 바꾸지 않는다
 *   · 1위라는 사실은 **본인에게만** 가고, 표 수는 본인에게도 가지 않는다
 *   · 매력 투표는 **파티 시작에 닫힌다** — 마감 시각은 받지 않는다
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { EventConfig, EventMeta, HostState, ParticipantState } from "../src/shared/types.ts";
import { api, freshEvent, join, master, setPhase, signInMaster } from "./helpers/party.ts";

const MIN = 60_000;

beforeAll(signInMaster);

type Who = Awaited<ReturnType<typeof join>>;

const me = (p: Who) => api<ParticipantState>("/api/me", { cookie: p.cookie });
const poke = (from: Who, to: Who) => api("/api/poke", { method: "POST", cookie: from.cookie, body: { toId: to.id } });
const hostState = (ev: EventMeta) => api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master });
const partyMax = async (p: Who) => (await me(p)).body.poke.budget.party.max;
const travelTo = async (at: number) => {
  expect((await api("/api/__test__/now", { method: "POST", body: { at } })).status).toBe(200);
};

async function vote(pairs: [Who, Who][]) {
  for (const [from, to] of pairs) expect((await poke(from, to)).status).toBe(200);
}

/**
 * 남 A·B·M, 여 C·D·W. 매력 투표 3회, 파티 콕 2회.
 * 표를 넣는 쪽은 테스트가 정한다 — 여기서는 사람만 세운다.
 */
async function room(config: Partial<EventConfig> = {}) {
  const ev = await freshEvent({ maxPre: 3, maxParty: 2, topVoteBonus: 1, ...config });
  const A = await join(ev, { gender: "M", nickname: "에이" });
  const B = await join(ev, { gender: "M", nickname: "비" });
  const M = await join(ev, { gender: "M", nickname: "엠" });
  const C = await join(ev, { gender: "F", nickname: "씨" });
  const D = await join(ev, { gender: "F", nickname: "디" });
  const W = await join(ev, { gender: "F", nickname: "더블유" });
  await setPhase(ev.id, "prevote");
  return { ev, A, B, M, C, D, W };
}

describe("A. 1위 정하기", () => {
  it("S-A1 ★ 성별마다 가장 많은 표를 받은 사람의 파티 콕이 한 번 는다", async () => {
    const { ev, A, B, M, C, D, W } = await room();
    // A 3표 · B 2표 / C 2표 · D 1표
    await vote([[C, A], [D, A], [W, A], [C, B], [D, B], [A, C], [B, C], [M, D]]);
    await setPhase(ev.id, "party");

    expect(await partyMax(A)).toBe(3);
    expect(await partyMax(C)).toBe(3);
    for (const p of [B, M, D, W]) expect(await partyMax(p)).toBe(2);

    // 늘어난 한도는 실제로 쓸 수 있다
    await vote([[A, C], [A, D], [A, W]]);
    expect((await poke(A, B)).status).toBe(409);

    const host = await hostState(ev);
    expect([...(host.body.meta.topVoters ?? [])].sort()).toEqual([A.id, C.id].sort());
  });

  it("S-A2 ★ 공동 1위는 모두 받는다", async () => {
    const { ev, A, B, M, C, D } = await room();
    await vote([[A, C], [B, C], [A, D], [M, D], [C, A], [D, A]]);
    await setPhase(ev.id, "party");
    expect(await partyMax(C)).toBe(3);
    expect(await partyMax(D)).toBe(3);
    expect(await partyMax(A)).toBe(3);
    expect(await partyMax(B)).toBe(2);
  });

  it("S-A3 ★ 가장 많은 표가 1표뿐이면 그 성별에서는 아무도 받지 않는다", async () => {
    const { ev, A, B, M, C, D } = await room();
    // 남자는 A 가 2표, 여자는 C · D 가 1표씩
    await vote([[C, A], [D, A], [A, C], [B, D]]);
    await setPhase(ev.id, "party");
    expect(await partyMax(A)).toBe(3);
    for (const p of [B, M, C, D]) expect(await partyMax(p)).toBe(2);
  });

  it("S-A4 ★ 파티가 시작되는 순간 정해지고, 1위가 빠져도 이어받지 않는다", async () => {
    const { ev, A, B, C, D, W } = await room();
    await vote([[C, A], [D, A], [W, A], [C, B], [D, B]]);
    await setPhase(ev.id, "party");
    expect(await partyMax(A)).toBe(3);

    // 매력 투표로 되돌아가 B 가 더 받아도 1위는 그대로다
    await setPhase(ev.id, "prevote");
    const E = await join(ev, { gender: "F", nickname: "이" });
    const F = await join(ev, { gender: "F", nickname: "에프" });
    await vote([[E, B], [F, B], [W, B]]);
    await setPhase(ev.id, "party");
    expect(await partyMax(A)).toBe(3);
    expect(await partyMax(B)).toBe(2);

    // 1위를 내보내도 이어받는 사람이 없다
    expect((await api(`/api/host/events/${ev.id}/players/${A.id}`, { method: "DELETE", cookie: master })).status).toBe(200);
    expect(await partyMax(B)).toBe(2);
  });

  it("S-A4 ★ 매력 투표를 건너뛴 회차에는 1위가 없다", async () => {
    const ev = await freshEvent({ maxPre: 3, maxParty: 2, topVoteBonus: 1 });
    const A = await join(ev, { gender: "M" });
    await setPhase(ev.id, "party");
    expect(await partyMax(A)).toBe(2);
    // 정하긴 정했다 — 빈 채로 굳는다. 비어 있지 않은 것과 **아직 안 정한 것**은 다르다
    expect((await hostState(ev)).body.meta.topVoters).toEqual([]);
  });

  it("S-A5 ★ 보너스를 끈 회차에서는 아무도 받지 않는다", async () => {
    const { ev, A, C, D, W } = await room({ topVoteBonus: undefined });
    await vote([[C, A], [D, A], [W, A]]);
    await setPhase(ev.id, "party");
    expect(await partyMax(A)).toBe(2);
    expect((await me(A)).body.poke.topVote).toBeUndefined();
  });

  it("S-A6 ★ 예약으로 열린 파티도 같은 1위를 정한다", async () => {
    const { ev, A, C, D, W } = await room();
    await vote([[C, A], [D, A], [W, A]]);
    try {
      await travelTo(ev.schedule.partyAt! + MIN);
      expect((await me(A)).body.event.phase).toBe("party");
      expect(await partyMax(A)).toBe(3);
    } finally {
      await travelTo(Date.now());
    }
  });
});

describe("A-2. 나간 사람의 표", () => {
  it("S-A7 ★ 나간 사람의 표는 세지 않는다 — 운영자 확인창이 말한 사람이 받는다", async () => {
    /*
     * 나간 사람이 보낸 콕은 남는다 (ADR-29 — 받은 쪽 숫자가 줄면 발신자가 드러난다). 그런데 1위를 셀 때
     * 그 표까지 세면, 운영자 화면(**지금 있는 사람만** 센다)이 `이 사람이 받아요` 라고 말한 사람과
     * 다른 사람이 보너스를 받는다. 확인창과 결과가 같은 수에서 나와야 한다.
     */
    const { ev, A, B, C, D, W } = await room();
    const X = await join(ev, { gender: "F", nickname: "엑스" });
    const Y = await join(ev, { gender: "F", nickname: "와이" });
    // A 2표(C·D) · B 3표(W·X·Y) — 그런데 X·Y 는 파티 전에 빠진다
    await vote([[C, A], [D, A], [W, B], [X, B], [Y, B]]);
    for (const p of [X, Y]) {
      const out = await api(`/api/host/events/${ev.id}/players/${p.id}`, { method: "DELETE", cookie: master });
      expect(out.status).toBe(200);
    }
    // 운영자 화면이 세는 수 — 확인창은 이걸로 A 를 1위라고 말한다
    const before = await hostState(ev);
    expect(before.body.received.pre[A.id]).toBe(2);
    expect(before.body.received.pre[B.id] ?? 0).toBe(1);

    await setPhase(ev.id, "party");
    expect(await partyMax(A)).toBe(3);
    expect(await partyMax(B)).toBe(2);
    expect((await hostState(ev)).body.meta.topVoters).toEqual([A.id]);
  });
});

describe("B. 보이는 것", () => {
  it("S-B1 ★ 다른 참가자의 응답에는 1위가 누구인지 없다", async () => {
    const { ev, A, B, C, D, W } = await room();
    await vote([[C, A], [D, A], [W, A]]);
    await setPhase(ev.id, "party");

    expect(await partyMax(A)).toBe(3);
    const other = (await me(B)).body;
    expect(JSON.stringify(other.event)).not.toContain(A.id);
    expect(other.poke.topVote).toBeUndefined();
    expect(other.poke.budget.party.max).toBe(2);
    // 명단에서 1위의 줄은 다른 사람의 줄과 같은 모양이다
    const keys = (id: string) => Object.keys(other.roster.find((p) => p.id === id)!).sort();
    expect(keys(A.id)).toEqual(keys(C.id));
  });

  it("S-B2 ★ 1위 본인에게는 표시 하나가 가고, 표 수는 알림을 끈 회차에서 여전히 0 이다", async () => {
    const { ev, A, C, D, W } = await room({ preNotify: false });
    await vote([[C, A], [D, A], [W, A]]);
    await setPhase(ev.id, "party");

    const mine = (await me(A)).body;
    expect(mine.poke.topVote).toBe(true);
    expect(mine.poke.budget.party.max).toBe(3);
    expect(mine.poke.received.pre).toBe(0);
  });
});

describe("C. 설정", () => {
  const put = (ev: EventMeta, config: Partial<EventConfig>) =>
    api(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { config: { maxPre: ev.config.maxPre, maxParty: ev.config.maxParty, ...config } },
    });

  it("S-C1 ★ 파티가 시작되면 굳는다 — 매력 투표 동안에는 켜고 끌 수 있다", async () => {
    const { ev } = await room();
    expect((await put(ev, { topVoteBonus: 0 })).status).toBe(200);
    expect((await put(ev, { topVoteBonus: 1 })).status).toBe(200);
    await setPhase(ev.id, "party");
    expect((await put(ev, { topVoteBonus: 0 })).status).toBe(409);
    // 같은 값은 통과한다 — 설정 탭은 저장할 때마다 통째로 보낸다
    expect((await put(ev, { topVoteBonus: 1 })).status).toBe(200);
  });

  it("S-C2 ★ 다른 설정만 고쳐도 사라지지 않는다", async () => {
    const { ev } = await room();
    expect((await put(ev, { maxParty: 4 })).status).toBe(200);
    expect((await hostState(ev)).body.meta.config.topVoteBonus).toBe(1);
  });

  it("S-C3 ★ 파티 콕 한도의 바닥에 1위의 보너스를 넣지 않는다", async () => {
    const { ev, A, B, C, D, W } = await room();
    await vote([[C, A], [D, A], [W, A]]);
    await setPhase(ev.id, "party");
    await vote([[A, C], [A, D], [A, W]]);
    const state = (await hostState(ev)).body;
    // 설정 화면의 스테퍼가 멈추는 곳도 같다 — 보너스를 넣어 세면 서버가 받는 2 를 화면이 막는다
    expect(state.pokeUsedMax.party).toBe(2);
    const live = state.meta;
    expect((await put(live, { maxParty: 2 })).status).toBe(200);
    expect((await put(live, { maxParty: 1 })).status).toBe(409);
    expect(await partyMax(B)).toBe(2);
  });
});

describe("D. 매력 투표는 파티 시작에 닫힌다", () => {
  it("S-D1 ★ 파티 일시 직전까지 투표할 수 있고, 파티가 시작되면 파티 콕이 열린다", async () => {
    const { ev, A, C } = await room();
    try {
      // 옛 기본 마감(파티 1시간 전)은 지났다
      await travelTo(ev.schedule.partyAt! - MIN);
      expect((await poke(C, A)).status).toBe(200);
    } finally {
      await travelTo(Date.now());
    }
    await setPhase(ev.id, "party");
    const state = (await me(C)).body;
    expect(state.poke.budget.party.used).toBe(0);
    expect((await poke(C, A)).status).toBe(200);
  });

  it("S-D2 ★ 마감 시각은 받지 않고, 마감 버튼도 없다", async () => {
    const ev = await freshEvent();
    expect(ev.schedule).not.toHaveProperty("voteEndAt");

    const res = await api<EventMeta>(`/api/host/events/${ev.id}/schedule`, {
      method: "PUT",
      cookie: master,
      body: { ...ev.schedule, voteEndAt: ev.schedule.partyAt! - 2 * 60 * MIN },
    });
    expect(res.status).toBe(200);
    expect(res.body.schedule).not.toHaveProperty("voteEndAt");

    await setPhase(ev.id, "prevote");
    expect((await api(`/api/host/events/${ev.id}/vote-end`, { method: "POST", cookie: master })).status).toBe(404);
  });
});
