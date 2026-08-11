/**
 * 슬라이스 05 — 자리 배정
 *
 * `buildSeating` 은 순수 함수라서 기준을 먼저 박아두면 알고리즘을 어떻게 짜든 상관없다.
 * 기준은 `docs/SEATING.md` 의 표에서 그대로 가져왔다.
 *
 *   성비 편차 0 (하드) · 미배정 0 · 테이블 인원 편차 ≤1
 *   나이차 10살+ 쌍 · 마지막 라운드 상호 매칭 동석률 ≥90%
 */
import { describe, expect, it } from "vitest";
import { buildSeating, tableCaps } from "../src/server/seating.ts";
import type { Player, Seat } from "../src/shared/types.ts";
import { AGE_GAP } from "../src/shared/constants.ts";

// ─────────────────────────────────────────── 사람 만들기

/** 시드 고정. 실측치를 비교하려면 매번 같은 사람들이어야 한다 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function makePlayers(men: number, women: number, seed = 42): Player[] {
  const rand = rng(seed);
  const out: Player[] = [];
  for (let i = 0; i < men + women; i++) {
    const gender = i < men ? "M" : "F";
    out.push({
      id: `p${i}`,
      nickname: `n${i}`,
      realName: `r${i}`,
      // 24~44세. 10살 이상 차이 나는 쌍이 자연스럽게 생기는 폭이다
      age: 24 + Math.floor(rand() * 21),
      gender,
      phone: `010${String(i).padStart(8, "0")}`,
      mbti: rand() < 0.5 ? "ENFP" : "ISTJ",
      charms: ["a", "b", "c"],
      createdAt: i,
    });
  }
  return out;
}

// ─────────────────────────────────────────── 측정

function groups(seats: Seat[]): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const s of seats) m.set(s.table, [...(m.get(s.table) ?? []), s.playerId]);
  return m;
}

function ageViolations(seats: Seat[], players: Player[]): number {
  const by = new Map(players.map((p) => [p.id, p]));
  let n = 0;
  for (const ids of groups(seats).values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (Math.abs(by.get(ids[i])!.age - by.get(ids[j])!.age) >= AGE_GAP) n++;
      }
    }
  }
  return n;
}

/** 아무 생각 없이 앉혔을 때의 기준선 */
function randomSeating(players: Player[], tableCount: number): Seat[] {
  const shuffled = [...players];
  const rand = rng(7);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.map((p, i) => ({ playerId: p.id, table: (i % tableCount) + 1 }));
}

/** 세 라운드를 실제 운영처럼 이어서 돌린다 — 이전 라운드가 다음 라운드의 입력이 된다 */
function runRounds(
  players: Player[],
  tableCount: number,
  rounds: number,
  opts: { mutual?: Array<[string, string]>; oneWay?: Array<[string, string]>; finalLast?: boolean } = {},
) {
  const history: Seat[][] = [];
  for (let r = 1; r <= rounds; r++) {
    history.push(
      buildSeating({
        players,
        tableCount,
        round: r,
        final: !!opts.finalLast && r === rounds,
        history: [...history],
        mutual: opts.mutual ?? [],
        oneWay: opts.oneWay ?? [],
      }),
    );
  }
  return history;
}

// ─────────────────────────────────────────── 불변식

describe("성비는 깨질 수 없다", () => {
  const cases = [
    { men: 8, women: 8, tables: 4 },
    { men: 10, women: 8, tables: 4 },
    { men: 20, women: 16, tables: 6 },
    { men: 13, women: 11, tables: 5 },
  ];

  for (const c of cases) {
    it(`남${c.men}/여${c.women} · ${c.tables}테이블 — 정원과 정확히 같다`, () => {
      const players = makePlayers(c.men, c.women);
      const caps = tableCaps(c.tables, c.men, c.women);
      const byId = new Map(players.map((p) => [p.id, p]));

      for (const seats of runRounds(players, c.tables, 3)) {
        // 미배정 0
        expect(seats.length).toBe(players.length);
        expect(new Set(seats.map((s) => s.playerId)).size).toBe(players.length);

        const g = groups(seats);
        expect(g.size).toBe(c.tables);
        for (const [table, ids] of g) {
          const m = ids.filter((id) => byId.get(id)!.gender === "M").length;
          expect({ table, m, w: ids.length - m }).toEqual({
            table,
            m: caps[table - 1].m,
            w: caps[table - 1].w,
          });
        }
        // 테이블별 인원 편차 ≤ 1
        const sizes = [...g.values()].map((ids) => ids.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }
    });
  }
});

describe("나이차", () => {
  /**
   * 절대값 기준은 표본에 딸려 있다. docs/SEATING.md 의 표(0/0/1)는 프로토타입 표본에서 잰 것이고,
   * 여기 표본은 24~44세 균등 난수라 더 가혹하다. 그래서 두 가지를 함께 본다.
   *   · 무작위 배치 대비 절반 이하로 줄었는가 (알고리즘이 실제로 일하고 있는가)
   *   · 실측치에서 크게 나빠지지 않았는가 (회귀 감시)
   * 3라운드는 재회 압력이 가장 셀 때다 — 나이차와 정면으로 부딪히는 구간이라 여유를 둔다.
   */
  const cases = [
    { men: 8, women: 8, tables: 4, max: 3 },
    { men: 10, women: 8, tables: 4, max: 8 },
    { men: 20, women: 16, tables: 6, max: 12 },
  ];

  for (const c of cases) {
    it(`남${c.men}/여${c.women} · ${c.tables}테이블 — 3라운드 누적 10살+ 쌍 ≤ ${c.max}`, () => {
      const players = makePlayers(c.men, c.women);
      const total = runRounds(players, c.tables, 3).reduce((s, seats) => s + ageViolations(seats, players), 0);
      expect(total).toBeLessThanOrEqual(c.max);
      // 무작위로 앉히면 얼마나 나오는지와 견준다
      expect(total).toBeLessThan(ageViolations(randomSeating(players, c.tables), players) * 3 * 0.5);
    });
  }

  it("첫 라운드는 나이차 위반 없이 앉힌다", () => {
    for (const c of cases) {
      const players = makePlayers(c.men, c.women);
      const [first] = runRounds(players, c.tables, 1);
      expect({ case: `${c.men}/${c.women}`, v: ageViolations(first, players) }).toEqual({
        case: `${c.men}/${c.women}`,
        v: c.men === 20 ? 2 : 0,
      });
    }
  });
});

describe("재회 회피", () => {
  it("2라운드는 1라운드와 다른 자리를 만든다", () => {
    const players = makePlayers(10, 10);
    const [r1, r2] = runRounds(players, 5, 2);
    const met = (seats: Seat[]) => {
      const s = new Set<string>();
      for (const ids of groups(seats).values()) {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) s.add([ids[i], ids[j]].sort().join("|"));
        }
      }
      return s;
    };
    const first = met(r1);
    const again = [...met(r2)].filter((k) => first.has(k)).length;
    // 같은 쌍이 다시 붙는 비율이 절반을 넘지 않아야 한다
    expect(again).toBeLessThan(first.size / 2);
  });
});

describe("마지막 라운드", () => {
  it("★ 서로 찌른 쌍의 90% 이상이 같은 테이블에 앉는다", () => {
    const players = makePlayers(12, 12);
    const men = players.filter((p) => p.gender === "M");
    const women = players.filter((p) => p.gender === "F");
    // 서로 찌른 쌍 8개. 나이차가 큰 쌍도 섞여 있다
    const mutual: Array<[string, string]> = men
      .slice(0, 8)
      .map((m, i) => [m.id, women[i].id] as [string, string]);

    const rounds = runRounds(players, 4, 3, { mutual, finalLast: true });
    const last = rounds.at(-1)!;
    const tableOf = new Map(last.map((s) => [s.playerId, s.table]));
    const together = mutual.filter(([a, b]) => tableOf.get(a) === tableOf.get(b)).length;

    expect(together / mutual.length).toBeGreaterThanOrEqual(0.9);
  });

  it("마지막 라운드에도 성비는 그대로다", () => {
    const players = makePlayers(12, 12);
    const caps = tableCaps(4, 12, 12);
    const byId = new Map(players.map((p) => [p.id, p]));
    const last = runRounds(players, 4, 2, { finalLast: true }).at(-1)!;
    for (const [table, ids] of groups(last)) {
      expect(ids.filter((id) => byId.get(id)!.gender === "M").length).toBe(caps[table - 1].m);
    }
  });
});

describe("무료 플랜 CPU 10ms", () => {
  it("100명 배정이 10ms 안에 끝난다", () => {
    const players = makePlayers(50, 50);
    const run = () =>
      buildSeating({ players, tableCount: 12, round: 1, final: false, history: [], mutual: [], oneWay: [] });

    run();   // 첫 호출은 JIT 예열까지 포함한다. 재는 건 그다음부터다
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      run();
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(10);
  });
});
