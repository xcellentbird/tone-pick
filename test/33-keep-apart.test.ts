/**
 * 슬라이스 33 — 떨어뜨려 앉히기 (ADR-90)
 *
 * 운영자가 고른 두 사람은 **같은 테이블에 앉지 않는다.** 참가자는 이 기능이 있는지 모른다 —
 * 그래서 이 파일의 절반은 자리 배정이, 나머지 절반은 **새지 않는 것**이 차지한다.
 *
 * 자리 배정은 확률적이라 **씨앗 하나로 재지 않는다** (ADR-57).
 * 서버 쪽 재료는 `helpers/party.ts`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { buildSeating, tableCaps } from "../src/server/seating.ts";
import * as COPY from "../src/shared/copy.ts";
import type { HostState, ParticipantState, Player, Seat, SeatingRound } from "../src/shared/types.ts";
import { MEET_GAP } from "../src/shared/constants.ts";
import { signInMaster, api, freshEvent, join, master, setPhase } from "./helpers/party.ts";

beforeAll(signInMaster);

// ─────────────────────────────────────────── 자리 배정 (순수 함수)

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function makePlayers(men: number, women: number, seed = 42): Player[] {
  const rand = rng(seed);
  return Array.from({ length: men + women }, (_, i) => ({
    id: `p${i}`,
    nickname: `n${i}`,
    realName: `r${i}`,
    instagram: `g${i}`,
    age: 24 + Math.floor(rand() * 13),
    gender: i < men ? ("M" as const) : ("F" as const),
    phone: `010${String(i).padStart(8, "0")}`,
    pin: "set" as const,
    mbti: "ENFP",
    charms: ["a", "b", "c"] as [string, string, string],
    createdAt: i,
  }));
}

type Pair = [string, string];

function run(
  players: Player[],
  tableCount: number,
  rounds: number,
  seed: number,
  opts: { apart?: Pair[]; pokes?: Record<string, number> } = {},
) {
  const history: Seat[][] = [];
  for (let r = 1; r <= rounds; r++) {
    history.push(
      buildSeating({
        players, tableCount, round: r, history: [...history],
        votes: {}, pokes: opts.pokes ?? {}, maxVote: 3, maxPoke: 3,
        seed: seed * 1000 + r,
        apart: opts.apart,
      }),
    );
  }
  return history;
}

/** 한 라운드에서 같은 테이블에 앉은 떼어 놓을 쌍의 수 */
function together(seats: Seat[], pairs: Pair[]): number {
  const table = new Map(seats.map((s) => [s.playerId, s.table]));
  return pairs.filter(([a, b]) => table.has(a) && table.get(a) === table.get(b)).length;
}

/** 나이대 이성 중 끝내 못 만난 쌍. **떼어 놓을 쌍은 세지 않는다** — 못 만나는 게 맞다 */
function missing(history: Seat[][], players: Player[], skip: Pair[] = []): number {
  const met = new Set<string>();
  for (const seats of history) {
    const byTable = new Map<number, string[]>();
    for (const s of seats) byTable.set(s.table, [...(byTable.get(s.table) ?? []), s.playerId]);
    for (const ids of byTable.values()) {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) met.add([ids[i], ids[j]].sort().join("|"));
    }
  }
  const skipped = new Set(skip.map((p) => [...p].sort().join("|")));
  let miss = 0;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      if (a.gender === b.gender || Math.abs(a.age - b.age) > MEET_GAP) continue;
      const key = [a.id, b.id].sort().join("|");
      if (!skipped.has(key) && !met.has(key)) miss++;
    }
  }
  return miss;
}

const SEEDS = [11, 22, 33, 44, 55, 66, 77, 88];
/** 남20·여16. 이성 쌍 셋, 동성 쌍 하나, 한 사람이 둘에 걸린 경우 하나 */
const PAIRS: Pair[] = [["p0", "p20"], ["p1", "p21"], ["p0", "p22"], ["p2", "p3"], ["p30", "p35"]];

describe("떼어 놓을 쌍은 같은 테이블에 앉지 않는다", () => {
  it("★ 모든 라운드에서 동석 0 — 씨앗 여러 개", () => {
    const players = makePlayers(20, 16);
    for (const seed of SEEDS) {
      const history = run(players, 6, 5, seed, { apart: PAIRS });
      expect({ seed, together: history.map((seats) => together(seats, PAIRS)) }).toEqual({
        seed,
        together: [0, 0, 0, 0, 0],
      });
    }
  });

  it("★ 성비와 미배정은 그대로다", () => {
    const players = makePlayers(20, 16);
    const caps = tableCaps(6, 20, 16);
    const male = new Set(players.filter((p) => p.gender === "M").map((p) => p.id));
    for (const seats of run(players, 6, 5, 11, { apart: PAIRS })) {
      expect(seats).toHaveLength(players.length);
      for (let t = 1; t <= 6; t++) {
        const here = seats.filter((s) => s.table === t);
        expect(here.filter((s) => male.has(s.playerId)).length).toBe(caps[t - 1].m);
        expect(here.length - here.filter((s) => male.has(s.playerId)).length).toBe(caps[t - 1].w);
      }
    }
  });

  it("★ 나이대 이성을 두루 만나는 일이 거의 그대로다 — 씨앗 평균", () => {
    const players = makePlayers(20, 16);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const without = mean(SEEDS.map((seed) => missing(run(players, 6, 5, seed), players, PAIRS)));
    const withApart = mean(SEEDS.map((seed) => missing(run(players, 6, 5, seed, { apart: PAIRS }), players, PAIRS)));
    // 다섯 쌍을 막아도 나머지 사람의 만남이 한 쌍 넘게 줄지 않는다
    expect(withApart).toBeLessThanOrEqual(without + 1);
  });

  it("★ 서로 콕 찌른 쌍이어도 떼어 놓기가 이긴다", () => {
    const players = makePlayers(20, 16);
    const pokes = { "p0>p20": 2, "p20>p0": 2 };
    for (const seed of SEEDS) {
      const history = run(players, 6, 4, seed, { apart: [["p20", "p0"]], pokes });
      expect({ seed, together: history.map((s) => together(s, [["p0", "p20"]])) }).toEqual({
        seed,
        together: [0, 0, 0, 0],
      });
    }
  });

  it("★ 다 지킬 수 없는 판에서도 배정은 나오고, 어기는 쌍은 최소다", () => {
    // 2테이블 · 남4·여4 → 테이블마다 여자 둘. p0 가 여자 셋과 떨어져야 하니 적어도 한 쌍은 같이 앉는다
    const players = makePlayers(4, 4);
    const pairs: Pair[] = [["p0", "p4"], ["p0", "p5"], ["p0", "p6"]];
    for (const seed of SEEDS) {
      const [seats] = run(players, 2, 1, seed, { apart: pairs });
      expect(seats).toHaveLength(8);
      expect({ seed, together: together(seats, pairs) }).toEqual({ seed, together: 1 });
    }
  });
});

// ─────────────────────────────────────────── 서버

const apartOf = async (eventId: string) =>
  (await api<HostState>(`/api/host/events/${eventId}/state`, { cookie: master })).body.apart;
const addApart = (eventId: string, a: string, b: string, cookie: string | null = master) =>
  api<{ apart: Pair[] }>(`/api/host/events/${eventId}/apart`, { method: "POST", cookie, body: { a, b } });
const removeApart = (eventId: string, a: string, b: string, cookie: string | null = master) =>
  api<{ apart: Pair[] }>(`/api/host/events/${eventId}/apart/${a}/${b}`, { method: "DELETE", cookie });

const draftSeats = async (eventId: string) =>
  (await api<HostState>(`/api/host/events/${eventId}/state`, { cookie: master })).body.seatings.find(
    (s: SeatingRound) => s.status === "draft",
  )!.seats;

async function party(men = 2, women = 2) {
  const ev = await freshEvent();
  const m = [];
  const w = [];
  for (let i = 0; i < men; i++) m.push(await join(ev, { gender: "M" }));
  for (let i = 0; i < women; i++) w.push(await join(ev, { gender: "F" }));
  return { ev, m, w };
}

describe("지정은 운영자만 한다", () => {
  it("★ 참가자 세션도, 세션 없이도 401 — 넣기도 빼기도", async () => {
    const { ev, m, w } = await party(1, 1);
    expect((await addApart(ev.id, m[0].id, w[0].id, m[0].cookie)).status).toBe(401);
    expect((await addApart(ev.id, m[0].id, w[0].id, null)).status).toBe(401);
    expect((await addApart(ev.id, m[0].id, w[0].id)).status).toBe(200);
    expect((await removeApart(ev.id, m[0].id, w[0].id, w[0].cookie)).status).toBe(401);
    expect(await apartOf(ev.id)).toHaveLength(1);
  });

  it("★ 방향이 없다 — A–B 와 B–A 는 한 쌍이다. 자기 자신은 거절, 없는 사람은 404", async () => {
    const { ev, m, w } = await party(1, 1);
    expect((await addApart(ev.id, m[0].id, w[0].id)).status).toBe(200);
    expect((await addApart(ev.id, w[0].id, m[0].id)).status).toBe(200);
    expect(await apartOf(ev.id)).toHaveLength(1);

    expect((await addApart(ev.id, m[0].id, m[0].id)).status).toBe(400);
    expect((await addApart(ev.id, m[0].id, "nobody")).status).toBe(404);

    // 뺄 때도 순서를 가리지 않는다
    expect((await removeApart(ev.id, w[0].id, m[0].id)).status).toBe(200);
    expect(await apartOf(ev.id)).toHaveLength(0);
  });

  it("★ 파티 중에 넣어도 발행된 자리는 그대로다", async () => {
    const { ev, m, w } = await party(2, 2);
    await setPhase(ev.id, "party");
    await api(`/api/host/events/${ev.id}/seating`, { method: "POST", cookie: master, body: { tableCount: 1 } });
    await api(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });
    const before = (await api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master })).body.seatings;

    expect((await addApart(ev.id, m[0].id, w[0].id)).status).toBe(200);
    const after = (await api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master })).body.seatings;
    expect(after).toEqual(before);
  });

  it("★ 발표 뒤에는 넣지 못한다 — 빼기는 된다", async () => {
    const { ev, m, w } = await party(2, 2);
    await addApart(ev.id, m[0].id, w[0].id);
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");
    expect((await addApart(ev.id, m[1].id, w[1].id)).status).toBe(409);
    expect((await removeApart(ev.id, m[0].id, w[0].id)).status).toBe(200);
  });

  it("★ 참가자를 내보내면 그 사람이 든 쌍도 사라진다", async () => {
    const { ev, m, w } = await party(1, 2);
    await addApart(ev.id, m[0].id, w[0].id);
    await addApart(ev.id, w[1].id, w[0].id);
    await addApart(ev.id, m[0].id, w[1].id);
    expect((await api(`/api/host/events/${ev.id}/players/${w[0].id}`, { method: "DELETE", cookie: master })).status).toBe(200);
    expect(await apartOf(ev.id)).toEqual([[m[0].id, w[1].id].sort()]);
  });
});

describe("자리 배정 · AI 섞기 · 섞기가 지킨다", () => {
  it("★ 배정·재배정·섞기 어느 것도 떼어 놓을 쌍을 같은 테이블에 앉히지 않는다", async () => {
    const { ev, m, w } = await party(4, 4);
    await setPhase(ev.id, "party");
    const pairs: Pair[] = [[m[0].id, w[0].id], [m[1].id, w[1].id]];
    for (const [a, b] of pairs) await addApart(ev.id, a, b);

    const draftSeats = async () =>
      (await api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master })).body.seatings.find(
        (s: SeatingRound) => s.status === "draft",
      )!.seats;

    expect((await api(`/api/host/events/${ev.id}/seating`, { method: "POST", cookie: master, body: { tableCount: 2 } })).status).toBe(200);
    expect(together(await draftSeats(), pairs)).toBe(0);

    for (let i = 0; i < 6; i++) {
      expect((await api(`/api/host/events/${ev.id}/seating/reseat`, { method: "POST", cookie: master })).status).toBe(200);
      expect(together(await draftSeats(), pairs), "AI 섞기가 같이 앉혔다").toBe(0);
      expect((await api(`/api/host/events/${ev.id}/seating/shuffle`, { method: "POST", cookie: master })).status).toBe(200);
      expect(together(await draftSeats(), pairs), "섞기가 같이 앉혔다").toBe(0);
    }
  });

  /**
   * **섞기는 붙어 앉은 상호 쌍을 제자리에 둔다** (ADR-49). 그 쌍이 떼어 놓을 쌍이기도 하면
   * 붙잡아 두는 것이 곧 같이 앉히는 것이다 — 떼어 놓기가 이긴다.
   */
  it("★ 서로 찌른 쌍이 떼어 놓을 쌍이면 섞기가 붙잡아 두지 않는다", async () => {
    const { ev, m, w } = await party(2, 2);
    await setPhase(ev.id, "party");
    await api("/api/poke", { method: "POST", cookie: m[0].cookie, body: { toId: w[0].id } });
    await api("/api/poke", { method: "POST", cookie: w[0].cookie, body: { toId: m[0].id } });
    await api(`/api/host/events/${ev.id}/seating`, { method: "POST", cookie: master, body: { tableCount: 2 } });
    const pair: Pair[] = [[m[0].id, w[0].id]];

    // 떼어 놓기 전에 둘을 같은 테이블로 옮겨 둔다 — 섞기가 이 둘을 붙어 앉은 쌍으로 본다
    const seats = await draftSeats(ev.id);
    const tableOf = new Map(seats.map((s) => [s.playerId, s.table]));
    if (tableOf.get(m[0].id) !== tableOf.get(w[0].id)) {
      const mate = [w[1].id].find((id) => tableOf.get(id) === tableOf.get(m[0].id))!;
      await api(`/api/host/events/${ev.id}/seating/swap`, { method: "POST", cookie: master, body: { a: mate, b: w[0].id } });
    }
    expect(together(await draftSeats(ev.id), pair)).toBe(1);

    await addApart(ev.id, m[0].id, w[0].id);
    for (let i = 0; i < 4; i++) {
      await api(`/api/host/events/${ev.id}/seating/shuffle`, { method: "POST", cookie: master });
      expect(together(await draftSeats(ev.id), pair), "섞기가 붙어 앉은 쌍으로 붙잡아 뒀다").toBe(0);
    }
  });

  /**
   * 늦게 온 사람을 **자동으로** 앉히는 규칙(`autoTable`)은 성비와 인원만 봤다. 떼어 놓을 상대가
   * 있는 테이블을 먼저 피한다 — 운영자가 `N번에 앉혀요` 를 누르는 순간 규칙이 깨지면 안 된다.
   */
  it("★ 늦게 온 사람을 자동으로 앉힐 때 떼어 놓을 상대의 테이블을 피한다", async () => {
    const { ev, m } = await party(2, 2);
    await setPhase(ev.id, "party");
    await api(`/api/host/events/${ev.id}/seating`, { method: "POST", cookie: master, body: { tableCount: 2 } });
    // m0 을 1번에 둔다. 두 테이블이 동률이면 낮은 번호를 고르므로, 피하지 않으면 1번에 앉는다
    const tableOf = new Map((await draftSeats(ev.id)).map((s) => [s.playerId, s.table]));
    if (tableOf.get(m[0].id) !== 1) {
      await api(`/api/host/events/${ev.id}/seating/swap`, { method: "POST", cookie: master, body: { a: m[0].id, b: m[1].id } });
    }
    const late = await join(ev, { gender: "F" });
    await addApart(ev.id, late.id, m[0].id);

    const res = await api(`/api/host/events/${ev.id}/seating/seat`, { method: "POST", cookie: master, body: { playerId: late.id } });
    expect(res.status).toBe(200);
    const after = new Map((await draftSeats(ev.id)).map((s) => [s.playerId, s.table]));
    expect(after.get(m[0].id)).toBe(1);
    expect(after.get(late.id), "떼어 놓을 상대의 테이블에 앉혔다").toBe(2);
  });

  it("운영자의 손 맞교환은 막지 않는다", async () => {
    const { ev, m, w } = await party(2, 2);
    await setPhase(ev.id, "party");
    await addApart(ev.id, m[0].id, w[0].id);
    await api(`/api/host/events/${ev.id}/seating`, { method: "POST", cookie: master, body: { tableCount: 2 } });
    const seats = (await api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master })).body.seatings[0].seats;
    const tableOf = new Map(seats.map((s) => [s.playerId, s.table]));
    // m0 과 같은 테이블의 여자를 w0 과 맞바꾼다 — 결과로 m0·w0 이 같이 앉는다
    const mate = [w[0].id, w[1].id].find((id) => tableOf.get(id) === tableOf.get(m[0].id))!;
    expect(mate).toBe(w[1].id);
    const res = await api(`/api/host/events/${ev.id}/seating/swap`, { method: "POST", cookie: master, body: { a: mate, b: w[0].id } });
    expect(res.status).toBe(200);
  });
});

describe("참가자에게는 새지 않는다", () => {
  it("★ 지정 전후로 참가자 응답이 한 글자도 다르지 않다", async () => {
    const { ev, m, w } = await party(2, 2);
    await setPhase(ev.id, "party");
    await api(`/api/host/events/${ev.id}/seating`, { method: "POST", cookie: master, body: { tableCount: 2 } });
    await api(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });

    const snapshot = async () => {
      const res = await api<ParticipantState>("/api/me", { cookie: m[0].cookie });
      return JSON.stringify(res.body);
    };
    const before = await snapshot();
    await addApart(ev.id, m[0].id, w[0].id);
    const after = await snapshot();
    expect(after).toBe(before);
    expect(after).not.toMatch(/apart/i);
  });

  it("★ 참가자 문구에 이 기능을 가리키는 말이 없다 — 운영자 문구에만 있다", () => {
    const leaks: string[] = [];
    const scan = (value: unknown, path: string) => {
      if (typeof value === "string") {
        if (/떨어뜨|⛔/.test(value)) leaks.push(path);
      } else if (typeof value === "function") {
        // 인자를 받는 문구는 흔한 값을 넣어 본다
        try {
          scan((value as (...a: unknown[]) => unknown)("가", "나"), `${path}()`);
        } catch {
          /* 문구가 아닌 함수 */
        }
      } else if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) scan(v, `${path}.${k}`);
      }
    };
    for (const [name, value] of Object.entries(COPY)) {
      if (name === "HOST_UI") continue;
      scan(value, name);
    }
    expect(leaks).toEqual([]);
  });
});
