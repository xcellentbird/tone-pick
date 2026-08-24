/**
 * 슬라이스 05·11·12 — 자리가 보이는 때 · 매칭 내역(운영자) · 앉힌 자리 고치기
 *
 * **자리는 발행해야 참가자 응답에 나온다** (ADR-37). 초안은 응답에 없어야 한다 —
 * 화면에서 감추는 것으로는 개발자 도구를 못 막는다.
 *
 * 그리고 고치는 길은 **맞교환과 앉히기·비우기뿐이다.** 단일 이동 API 를 만들면
 * 테이블 인원이 어긋난다 — `앉힐 테이블은 서버가 고른다` 가 그 방어다.
 *
 * 재료는 `helpers/party.ts`. 파일이 커지면 나눈다 (그 파일 머리말).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type {
  ParticipantState,
} from "../src/shared/types.ts";
import { signInMaster, api, freshEvent, join, master, setPhase } from "./helpers/party.ts";

beforeAll(signInMaster);

// ─────────────────────────────────────────── 자리가 보이는 때 (슬라이스 12)

/**
 * 운영자가 자리를 **미리 짜서 미리 보낼 수 있어야** 한다 (ADR-37).
 *
 * 슬라이스 12 에서는 파티가 시작돼야 보이게 막았다. 그 방어가 필요했던 건
 * 짜는 동안 새지 않게 하려던 것인데, 지금은 **초안**이 그 일을 맡는다 —
 * 초안은 발행 전까지 응답에 없다. 게이트를 푼 이유는 **일찍 온 사람을 앉히기** 위해서다.
 */
describe("자리는 발행해야 보인다", () => {
  async function withSeats() {
    const ev = await freshEvent();
    const me = await join(ev, { gender: "M" });
    for (let i = 0; i < 3; i++) await join(ev, { gender: i % 2 === 0 ? "F" : "M" });
    await setPhase(ev.id, "prevote");
    // 사전 투표 중에 미리 짜둔다
    await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2, final: false },
    });
    const pub = await api(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });
    expect(pub.status).toBe(200);
    return { ev, me };
  }

  it("★ 초안은 참가자 응답에 없다", async () => {
    /*
     * **화면에서 감추는 것으로는 부족하다** — 개발자 도구를 여는 참가자가 있다.
     * 짜는 중인 자리가 새면 남의 테이블까지 파티 전에 다 드러난다.
     */
    const ev = await freshEvent();
    const me = await join(ev, { gender: "M" });
    for (let i = 0; i < 3; i++) await join(ev, { gender: i % 2 === 0 ? "F" : "M" });
    await setPhase(ev.id, "prevote");
    await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2, final: false },
    });

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.seat).toBeUndefined();
    expect(JSON.stringify(state.body)).not.toContain("\"table\"");
  });

  it("★ 파티 시작 전에 발행하면 그 자리에서 보인다 (ADR-37)", async () => {
    /*
     * **일찍 온 사람이 자기 테이블을 보고 앉아 기다리는 것**이 이 게이트를 푼 이유다.
     * 매력 투표 단계인 채로 자리가 보인다 — 단계와 자리는 이제 서로를 막지 않는다.
     */
    const { me } = await withSeats();
    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.event.phase).toBe("prevote");
    expect(state.body.seat?.table).toBeGreaterThan(0);
    // 아직 확인 전이라야 전체 화면이 뜬다
    expect(state.body.seat?.acked).toBe(false);
  });

  it("★ 발표 후에도 자리는 남는다", async () => {
    // 매칭 상대와 같은 테이블이었는지를 발표 화면이 쓴다 (MatchInfo.sameTable)
    const { ev, me } = await withSeats();
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");
    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.seat?.table).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────── 앉힌 자리 고치기 (슬라이스 11)

/**
 * 발행한 라운드는 손댈 수 없는 것이었다. 유일한 수단이 새 라운드 발행이라,
 * 한 명이 늦게 왔다고 **전원이 자리를 옮기고 전원이 확인 화면을 다시 받았다.**
 *
 * 이제 초안이든 발행된 것이든 같은 조작 셋을 받는다 — 맞교환 · 앉히기 · 자리 비우기.
 */

// ─────────────────────────────────────────── 앉힌 자리 고치기 (슬라이스 11)

/**
 * 발행한 라운드는 손댈 수 없는 것이었다. 유일한 수단이 새 라운드 발행이라,
 * 한 명이 늦게 왔다고 **전원이 자리를 옮기고 전원이 확인 화면을 다시 받았다.**
 *
 * 이제 초안이든 발행된 것이든 같은 조작 셋을 받는다 — 맞교환 · 앉히기 · 자리 비우기.
 */
describe("무엇이 매칭인가 (ADR-34)", () => {
  /**
   * **매칭은 파티 콕만 센다.** 매력 투표는 프로필만 보고 고른 것이라
   * 첫 자리 배정의 재료일 뿐이고, 만나보고 찌른 것과 같은 무게로 세면 안 된다 —
   * 첫 회차에서 매칭 5쌍 중 4쌍이 사전 콕에서 출발했다.
   *
   * 사전·파티·엇갈림으로 쪼개던 `MatchKind` 는 이 규칙과 함께 걷어냈다.
   * 나올 수 없는 갈래이고, 매력 투표를 서로 했다는 건 붙일 의미가 없는 사실이다.
   */
  const mutualOf = async (id: string) =>
    (await api<{ mutual: Array<[string, string]> }>(`/api/host/events/${id}/state`, { cookie: master }))
      .body.mutual;

  const poke = (cookie: string | null, toId: string) =>
    api("/api/poke", { method: "POST", cookie, body: { toId } });

  it("★ 매력 투표만 서로 해서는 매칭이 아니다", async () => {
    const ev = await freshEvent();
    const [a, b, c, d] = [
      await join(ev, { gender: "M" }), await join(ev, { gender: "F" }),
      await join(ev, { gender: "M" }), await join(ev, { gender: "F" }),
    ];
    await setPhase(ev.id, "prevote");
    await poke(a.cookie, b.id);            // a·b 는 매력 투표만 서로
    await poke(b.cookie, a.id);
    await poke(c.cookie, d.id);            // c 는 매력 투표에만
    await setPhase(ev.id, "party");
    await poke(d.cookie, c.id);            // d 는 파티에서 → 엇갈림

    expect(await mutualOf(ev.id)).toEqual([]);
  });

  it("★ 파티에서 서로 찌른 쌍만 매칭이다", async () => {
    const ev = await freshEvent();
    const [a, b] = [await join(ev, { gender: "M" }), await join(ev, { gender: "F" })];
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");
    await poke(a.cookie, b.id);
    await poke(b.cookie, a.id);

    const mutual = await mutualOf(ev.id);
    expect(mutual).toHaveLength(1);
    expect(mutual[0].slice().sort()).toEqual([a.id, b.id].sort());
  });

  it("★ 매력 투표를 서로 했어도 매칭 목록은 달라지지 않는다", async () => {
    // 붙일 의미가 없는 사실이라 어디에도 표시하지 않는다
    const ev = await freshEvent();
    const [a, b] = [await join(ev, { gender: "M" }), await join(ev, { gender: "F" })];
    await setPhase(ev.id, "prevote");
    await poke(a.cookie, b.id);
    await poke(b.cookie, a.id);
    await setPhase(ev.id, "party");
    await poke(a.cookie, b.id);
    await poke(b.cookie, a.id);

    expect(await mutualOf(ev.id)).toHaveLength(1);
  });
});
describe("앉힌 자리 고치기", () => {
  type Round = { round: number; seats: Array<{ playerId: string; table: number }>; acks: string[] };
  const seatOp = (id: string, op: string, body: Record<string, unknown>) =>
    api<Round>(`/api/host/events/${id}/seating/${op}`, { method: "POST", cookie: master, body });
  const rounds = async (id: string) =>
    (await api<{ seatings: Round[] }>(`/api/host/events/${id}/state`, { cookie: master })).body.seatings;

  /**
   * 남녀 셋씩 여섯 명을 두 테이블에 앉히고 발행까지 한다.
   * **파티까지 보낸다** — 자리는 파티가 시작돼야 참가자 응답에 나온다 (슬라이스 12).
   */
  async function seated(final = false) {
    const ev = await freshEvent();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await join(ev, { gender: i % 2 === 0 ? "M" : "F" })).id);
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "party");
    await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2, final },
    });
    const pub = await api<Round>(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });
    return { ev, ids, round: pub.body };
  }

  it("★ 이번 라운드에서 뺀 사람은 자리가 없다", async () => {
    /*
     * 노쇼가 나오면 배정하고 나서 한 명씩 빼는 길(`unseat`)도 있지만,
     * 그때 자리 배치는 **안 온 사람 기준으로 이미 짜여 있다.**
     * 처음부터 온 사람만으로 짜라고 있는 값이다.
     */
    const ev = await freshEvent();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await join(ev, { gender: i % 2 === 0 ? "M" : "F" })).id);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    // 남녀 한 명씩 뺀다 — 성비가 어긋나면 배정 자체가 이상해진다
    const out = [ids[0], ids[1]];
    const made = await api<Round>(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2, final: false, exclude: out },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect(made.body.seats).toHaveLength(4);
    expect(made.body.seats.some((x) => out.includes(x.playerId))).toBe(false);
  });

  it("★ 뺀 사람은 참가자 상태로 남는다 — 지우는 것과 다른 일이다", async () => {
    // 지우면 받은 콕과 매칭이 함께 날아간다 (ADR-29). 자리만 없는 것이어야 한다
    const ev = await freshEvent();
    const people: Array<{ id: string; cookie: string | null }> = [];
    for (let i = 0; i < 6; i++) people.push(await join(ev, { gender: i % 2 === 0 ? "M" : "F" }));
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");
    await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2, final: false, exclude: [people[0].id] },
    });
    await api(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });

    const seen = await api<ParticipantState>(`/api/me?event=${ev.id}`, { cookie: people[0].cookie });
    expect(seen.status).toBe(200);
    expect(seen.body.seat).toBeUndefined();
    expect(seen.body.me.id).toBe(people[0].id);
  });

  it("빼고 나서 사람이 모자라면 배정하지 않는다", async () => {
    // 테이블 하나에 최소 두 명이다. 빼는 바람에 모자라면 그 자리에서 막는다
    const ev = await freshEvent();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await join(ev, { gender: i % 2 === 0 ? "M" : "F" })).id);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");
    const res = await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2, final: false, exclude: [ids[0], ids[1]] },
    });
    expect(res.status).toBe(400);
  });

  it("★ 앉힐 테이블은 서버가 고른다 — 그 성별이 가장 덜 찬 곳으로", async () => {
    /*
     * 운영자가 테이블을 고르게 하면 그게 곧 **한 명만 옮기는 API** 다 (SEATING.md).
     * 성비는 지키려고 노력하는 게 아니라 깨질 방법이 없어야 한다.
     */
    const { ev, round } = await seated();
    const man = round.seats.find((s) => s.table === 1)!;
    // 1번에서 한 명을 빼면 그 테이블이 그 성별로 가장 비게 된다 → 도로 1번에 앉아야 한다
    await seatOp(ev.id, "unseat", { playerId: man.playerId, round: round.round });
    const back = await seatOp(ev.id, "seat", { playerId: man.playerId, round: round.round });
    expect(back.body.seats.find((s) => s.playerId === man.playerId)?.table).toBe(1);

    // 테이블을 받는 통로는 없다 — 보내도 서버가 무시한다
    await seatOp(ev.id, "unseat", { playerId: man.playerId, round: round.round });
    const forced = await seatOp(ev.id, "seat", { playerId: man.playerId, round: round.round, table: 2 });
    expect(forced.body.seats.find((s) => s.playerId === man.playerId)?.table).toBe(1);
  });

  it("★ 같은 사람이 두 자리에 있지 않다", async () => {
    const { ev, round } = await seated();
    const one = round.seats[0].playerId;
    const again = await seatOp(ev.id, "seat", { playerId: one, round: round.round });
    expect(again.body.seats.filter((s) => s.playerId === one).length).toBe(1);
    expect(again.body.seats.length).toBe(6);
  });

  it("★ 자리 비우기는 참가자를 지우는 것이 아니다", async () => {
    /*
     * 지우면 그가 만든 매칭이 **상대에게서도 사라진다** (FLOWS.md).
     * 집에 간 사람도 서로 찔렀으면 연락처가 오가는 게 이 앱의 목적이다.
     */
    const ev = await freshEvent();
    const a = await join(ev, { gender: "M" });
    const b = await join(ev, { gender: "F" });
    await setPhase(ev.id, "party");
    await api("/api/poke", { method: "POST", cookie: a.cookie, body: { toId: b.id } });
    await api("/api/poke", { method: "POST", cookie: b.cookie, body: { toId: a.id } });
    await setPhase(ev.id, "party");
    await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 1, final: false },
    });
    const pub = await api<Round>(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });

    await seatOp(ev.id, "unseat", { playerId: a.id, round: pub.body.round });

    // 명단에 그대로 있고
    const state = await api<{ players: Array<{ id: string }>; mutual: Array<[string, string]> }>(
      `/api/host/events/${ev.id}/state`, { cookie: master },
    );
    expect(state.body.players.map((p) => p.id)).toContain(a.id);
    // 서로 찌른 쌍도 그대로다
    expect(state.body.mutual.length).toBe(1);
    // 발표 때 상대에게 매칭이 보인다
    await setPhase(ev.id, "done");
    const mine = await api<ParticipantState>("/api/me", { cookie: b.cookie });
    expect(mine.body.poke.matches.map((m) => m.player.id)).toEqual([a.id]);
  });

  it("★ 발행된 라운드를 고쳐도 자리 이동 확인이 뜨지 않는다", async () => {
    /*
     * 전원이 한꺼번에 움직이는 건 **발행**뿐이고, 그때만 확인 화면이 뜬다.
     * `acks` 의 뜻이 "이 자리를 안다" 로 넓어진다 — 운영자가 손으로 앉힌 것도 아는 것이다.
     */
    const { ev, ids, round } = await seated();
    // 발행 뒤에 등록한 사람 — 이 라운드에 자리가 없다
    const late = await join(ev, { gender: "M" });
    const before = (await rounds(ev.id))[0];
    expect(before.seats.some((s) => s.playerId === late.id)).toBe(false);

    const after = (await seatOp(ev.id, "seat", { playerId: late.id, round: round.round })).body;
    expect(after.seats.some((s) => s.playerId === late.id)).toBe(true);
    // 확인 화면은 `acked` 가 아닐 때만 뜬다 — 함께 넣어서 뜨지 않게 한다
    expect(after.acks).toContain(late.id);
    const seen = await api<ParticipantState>("/api/me", { cookie: late.cookie });
    expect(seen.body.seat?.acked).toBe(true);

    // 맞교환은 `acks` 를 건드리지 않는다. 자리를 비우면 거기서도 빠진다
    const swapped = (await seatOp(ev.id, "swap", { a: ids[0], b: ids[1], round: round.round })).body;
    expect(swapped.acks).toContain(late.id);
    const emptied = (await seatOp(ev.id, "unseat", { playerId: late.id, round: round.round })).body;
    expect(emptied.acks).not.toContain(late.id);
  });

  it("★ 발표 후에는 고치는 길이 다 막힌다", async () => {
    // 발표만이 자리를 끝낸다. 확정도 발행도 끝내지 않는다 (ADR-28)
    const { ev, ids, round } = await seated();
    await setPhase(ev.id, "done");
    for (const [op, body] of [
      ["swap", { a: ids[0], b: ids[1], round: round.round }],
      ["seat", { playerId: ids[0], round: round.round }],
      ["unseat", { playerId: ids[0], round: round.round }],
      ["shuffle", {}],
      ["publish", {}],
    ] as const) {
      const res = await api(`/api/host/events/${ev.id}/seating/${op}`, { method: "POST", cookie: master, body });
      expect(res.status, op).toBe(409);
    }
  });

  it("★ 발표 후에도 지난 자리는 그대로 읽힌다", async () => {
    /*
     * 잠기는 건 **고치는 길**뿐이다. 운영자는 끝난 뒤에도 누가 어디 앉았는지를 본다 —
     * 다음 회차 자리를 짤 때, 사진을 정리할 때.
     */
    const { ev, round } = await seated();
    await setPhase(ev.id, "done");
    const after = (await rounds(ev.id)).find((r) => r.round === round.round)!;
    expect(after.seats.length).toBe(6);
    expect(after.seats.map((s) => s.playerId).sort()).toEqual(round.seats.map((s) => s.playerId).sort());
  });
});
