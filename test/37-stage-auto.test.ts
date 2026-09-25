/**
 * 슬라이스 37 — 한 탭 무대의 배역과 자동 콕 (ADR-99 후기).
 *
 *   나이   남녀를 따로 평균과 범위 — 평균이 맞고, 모두 앱이 받는 범위 안이다
 *   자동   실제 파티처럼. 운영자가 본 것 (2026-09-25):
 *          남자는 거의 모두 다 쓰고 몇몇에게 몰린다. 여자는 절반쯤이 안 쓰거나 덜 쓰고, 두 배 넓게 흩어진다.
 *          뒤 자리일수록 많이 찌르고 마지막 자리에서 가장 많다
 *
 * 확률로 정한 모양은 **씨앗 하나로 재지 않는다** (ADR-57 과 같은 까닭) — 씨앗 여러 개의 평균으로 본다.
 * 계획(`planPokes`)은 앱을 부르지 않는 순수 함수라 그렇게 돌리고, 앱과 붙인 것은 `SELF.fetch` 로 따로 본다.
 * 한 탭 무대의 나머지(틀 · 쿠키 · 하루 상한)는 `37-stage-wall.test.ts` 다.
 */
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { AGE_LIMIT, BULK_MAX, STAGE_AGES, ageRange, beginStage, buildStage, createLog, planPokes, seeded, spreadAges } from "../scripts/qa/core.mjs";
import { AGE_RANGE } from "../src/shared/constants.ts";
import type { HostState, ParticipantState } from "../src/shared/types.ts";
import { api, master, signInMaster } from "./helpers/party.ts";

beforeAll(signInMaster);

const BASE = "https://tone-pick.test";

/** 무대 워커와 같은 모양으로 core 를 부른다. `calls` 가 QA 를 부른 횟수를 센다 */
function env() {
  const counter = { calls: 0 };
  return {
    counter,
    fetch: (url: string, init?: RequestInit) => {
      counter.calls++;
      return SELF.fetch(url, init);
    },
    base: BASE,
    publicBase: "https://tone-pick-qa.example.workers.dev",
    log: createLog(),
    platform: {},
    timeTravel: false,
  };
}
const want = (over: Record<string, unknown> = {}) => ({ men: 3, women: 3, phase: "party", tables: 2, config: {}, pin: "1234", practiceOnly: false, ...over });
const hostState = async (id: string) => (await api<HostState>(`/api/host/events/${id}/state`, { cookie: master })).body;
type Persona = { n: number; id: string; gender: "M" | "F"; session: { call: (p: string) => Promise<{ status: number; body: unknown }> } };

describe("나이 — 남녀를 따로, 평균과 범위", () => {
  it("★ 성별마다 평균이 맞고 모두 범위 안이다 — 사람이 적어도", () => {
    const ranges = [STAGE_AGES.M, STAGE_AGES.F, { avg: 40, min: 20, max: 44 }, { avg: 19, min: 18, max: 30 }, { avg: 30, min: 30, max: 30 }];
    for (const r of ranges) {
      for (const n of [2, 3, 6, 17, 50]) {
        const ages: number[] = spreadAges(n, r, seeded(n));
        const at = `${JSON.stringify(r)} × ${n}`;
        expect(ages, at).toHaveLength(n);
        for (const a of ages) {
          expect(Number.isInteger(a), at).toBe(true);
          expect(a, at).toBeGreaterThanOrEqual(r.min);
          expect(a, at).toBeLessThanOrEqual(r.max);
        }
        expect(ages.reduce((x, y) => x + y, 0), at).toBe(r.avg * n);
      }
    }
  });

  it("★ 나이 칸은 앱이 받는 범위 안으로 — 거꾸로 온 범위는 바꾸고, 평균은 범위 안으로", () => {
    expect(AGE_LIMIT).toEqual(AGE_RANGE);
    expect(ageRange({ avg: "50", min: "40", max: "20" }, STAGE_AGES.M)).toEqual({ avg: 40, min: 20, max: 40 });
    expect(ageRange({ avg: "", min: "10", max: "99" }, STAGE_AGES.F)).toEqual({ avg: STAGE_AGES.F.avg, min: AGE_RANGE.min, max: AGE_RANGE.max });
    expect(ageRange(undefined, STAGE_AGES.M)).toEqual(STAGE_AGES.M);
  });

  it("★ 배역이 고른 나이로 등록된다 — 등록을 묶음으로 나눠도 성별마다 평균이 맞는다", async () => {
    const ages = { M: { avg: 35, min: 30, max: 44 }, F: { avg: 26, min: 22, max: 31 } };
    const stage = await beginStage(env(), want({ men: 5, women: 4, ages }));
    while (stage.pending.length) await stage.enrollSome(3);
    const st = await hostState(stage.event.id);
    for (const g of ["M", "F"] as const) {
      const got = st.players.filter((p) => p.gender === g).map((p) => p.age);
      expect(got.reduce((a, b) => a + b, 0), g).toBe(ages[g].avg * got.length);
      for (const a of got) {
        expect(a, g).toBeGreaterThanOrEqual(ages[g].min);
        expect(a, g).toBeLessThanOrEqual(ages[g].max);
      }
    }
    await stage.close();
  });
});

type Sex = "M" | "F";
/**
 * 파티 한 판을 끝까지 — 자리 몇 라운드 뒤 마지막 자리(기본 1~3라운드 + 마지막). **씨앗마다 다른 무대**다
 * (인기 · 성향이 씨앗에서 나온다). 앱을 부르지 않는다 — 계획만 세어 본다. 앱과 붙인 것은 아래 `자동 콕 — 진짜 앱에서` 가 본다.
 */
function party(seed: number, size = 20, max = 2, seatings = 4) {
  const cast = [...Array(size * 2)].map((_, i) => ({ n: i + 1, gender: (i < size ? "M" : "F") as Sex }));
  const used: Record<number, number> = {};
  const history: Record<number, number[]> = {};
  const got = { M: new Map<number, number>(), F: new Map<number, number>() };
  const pokes: number[] = [];
  const pokers: number[] = [];
  const rng = seeded(`run:${seed}`);
  for (let k = 1; k <= seatings; k++) {
    const plan: [number, number][] = planPokes({ cast, used, max, round: "party", k, last: k === seatings, seed, rng, history });
    pokes.push(plan.length);
    pokers.push(new Set(plan.map(([a]) => a)).size);
    for (const [a, b] of plan) {
      used[a] = (used[a] ?? 0) + 1;
      (history[a] ??= []).push(b);
      const by = got[cast[a - 1].gender];
      by.set(b, (by.get(b) ?? 0) + 1);
    }
  }
  const share = (g: Sex, pred: (u: number) => boolean) => cast.filter((p) => p.gender === g && pred(used[p.n] ?? 0)).length / size;
  return { used, pokes, pokers, got, share };
}
const SEEDS = 200;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** 받은 콕이 이성 몇 명에게 고르게 간 것과 같은가 (1/Σp², 표본에 치우치지 않게 n(n−1) 로) — 이성 수의 몫 */
const spread = (got: Map<number, number>, size: number) => {
  const c = [...got.values()];
  const n = c.reduce((a, b) => a + b, 0);
  return (n * (n - 1)) / c.reduce((a, b) => a + b * (b - 1), 0) / size;
};

describe("자동 콕 — 실제 파티처럼 (씨앗 여러 개의 평균으로)", () => {
  const runs = Array.from({ length: SEEDS }, (_, i) => party(i + 1));

  it("★ 남자는 거의 모두 다 쓰고, 여자는 절반쯤이 안 쓰거나 덜 쓴다", () => {
    expect(mean(runs.map((r) => r.share("M", (u) => u === 2)))).toBeGreaterThan(0.85);
    const notAll = mean(runs.map((r) => r.share("F", (u) => u < 2)));
    expect(notAll).toBeGreaterThan(0.4);
    expect(notAll).toBeLessThan(0.6);
    // 덜 쓴 사람만이 아니다 — 아예 안 쓰는 사람도 있다
    expect(mean(runs.map((r) => r.share("F", (u) => u === 0)))).toBeGreaterThan(0.15);
  });

  it("★ 몇몇에게 몰리고, 여자의 콕은 남자보다 두 배 넓게 흩어진다", () => {
    const men = mean(runs.map((r) => spread(r.got.M, 20)));
    const women = mean(runs.map((r) => spread(r.got.F, 20)));
    // 남자의 콕은 여자의 절반도 안 되는 사람에게 고르게 간 것과 같다 — 몰려 있다
    expect(men).toBeLessThan(0.45);
    expect(women / men).toBeGreaterThan(1.7);
    expect(women / men).toBeLessThan(2.4);
  });

  it("★ 뒤 자리일수록 많이 찌르고, 마지막 자리에서 가장 많다 — 콕 수도 찌른 사람 수도", () => {
    for (const key of ["pokes", "pokers"] as const) {
      const [r1, r2, r3, last] = [0, 1, 2, 3].map((k) => mean(runs.map((r) => r[key][k])));
      expect(r1, key).toBeLessThan(r2);
      expect(r2, key).toBeLessThan(r3);
      expect(last, key).toBeGreaterThan(r3 * 2);
    }
    // 자리가 몇 라운드일지 무대는 모른다 — 20분마다 돌리는 열 라운드 파티에서도 마지막이 가장 많다
    const long = Array.from({ length: 100 }, (_, i) => party(i + 1, 20, 2, 10));
    const per = [...Array(10)].map((_, k) => mean(long.map((r) => r.pokes[k])));
    expect(per[9]).toBeGreaterThan(Math.max(...per.slice(0, 9)));
  });

  it("★ 앱의 규칙 안이다 — 상한에서 이미 쓴 것을 빼고, 이성에게만, 자기 자신은 없다", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rng = seeded(`rules:${seed}`);
      const cast = [...Array(9)].map((_, i) => ({ n: i + 1, gender: (i % 3 ? "F" : "M") as Sex }));
      const max = 1 + (seed % 4);
      // 손으로 이미 찌른 사람도 있다 — 앱이 센 수를 그대로 받는다
      const used = Object.fromEntries(cast.map((p) => [p.n, Math.floor(rng() * (max + 1))]));
      for (const round of ["pre", "party"] as const) {
        const plan: [number, number][] = planPokes({ cast, used, max, round, k: 1 + (seed % 5), last: seed % 2 === 0, seed, rng });
        const sent = new Map<number, number>();
        for (const [a, b] of plan) {
          expect(a).not.toBe(b);
          expect(cast[a - 1].gender).not.toBe(cast[b - 1].gender);
          sent.set(a, (sent.get(a) ?? 0) + 1);
        }
        for (const [a, n] of sent) expect(n).toBeLessThanOrEqual(max - used[a]);
      }
    }
  });
});

describe("자동 콕 — 진짜 앱에서", () => {
  const me = async (p: Persona) => ((await p.session.call("/me")).body as ParticipantState).poke;

  it("★ 한 요청의 몫을 넘으면 줄에 남겨 나눠 보낸다 — 줄마다 QA 호출이 묶음 상한 안이다", async () => {
    const e = env();
    // 콕이 많아야 줄이 남는다 — 상한을 앱이 받는 끝(10)까지 올린다
    const stage = await buildStage(e, want({ men: 6, women: 6, config: { maxParty: 10 } }));
    e.counter.calls = 0;
    await stage.run("auto last");
    expect(e.counter.calls).toBeLessThanOrEqual(BULK_MAX);
    expect(stage.backlog.length).toBeGreaterThan(0);
    while (stage.backlog.length) {
      e.counter.calls = 0;
      await stage.drain(BULK_MAX);
      expect(e.counter.calls).toBeLessThanOrEqual(BULK_MAX);
    }
    expect(e.log.lines.at(-1)).toContain("✓ 자동 콕 · 마지막 자리");

    const gender = new Map((stage.cast as Persona[]).map((p) => [p.id, p.gender]));
    let total = 0;
    for (const p of stage.cast as Persona[]) {
      const poke = await me(p);
      expect(poke.budget.party.used).toBeLessThanOrEqual(10);
      for (const to of Object.keys(poke.sentTo)) expect(gender.get(to)).not.toBe(p.gender);
      total += poke.budget.party.used;
    }
    expect((await hostState(stage.event.id)).pokeCount.party).toBe(total);
    await stage.close();
  });

  it("★ 매력 투표에서는 한 번에 — 쓰려던 표를 다 내고, 표는 한 사람에 하나다", async () => {
    const e = env();
    const stage = await buildStage(e, want({ men: 4, women: 4, phase: "prevote" }));
    await stage.run("auto");
    expect(stage.backlog).toHaveLength(0);
    expect(e.log.lines.at(-1)).toMatch(/자동 콕 · 매력 투표|찌를 사람이 없어요/);
    for (const p of stage.cast as Persona[]) expect((await me(p)).budget.pre.used).toBeLessThanOrEqual(1);
    // 다시 눌러도 더 내지 않는다 — 쓰려던 만큼은 이미 냈다
    const before = (await hostState(stage.event.id)).pokeCount.pre;
    await stage.run("auto");
    expect((await hostState(stage.event.id)).pokeCount.pre).toBe(before);
    await stage.close();
  });
});
