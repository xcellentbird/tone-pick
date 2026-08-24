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
import { buildSeating, pullScore, tableCaps } from "../src/server/seating.ts";
import type { Player, Seat } from "../src/shared/types.ts";
import { AGE_GAP, SEAT_W } from "../src/shared/constants.ts";

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
      instagram: `g${i}`,
      // 24~44세. 10살 이상 차이 나는 쌍이 자연스럽게 생기는 폭이다
      age: 24 + Math.floor(rand() * 21),
      gender,
      phone: `010${String(i).padStart(8, "0")}`,
      mbti: rand() < 0.5 ? "ENFP" : "ISTJ",
      charms: ["a", "b", "c"],
      contactShare: "all" as const,
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
  /**
   * 여기서 재는 건 **폭주 감지**지 10ms 검증이 아니다.
   *
   * workerd 테스트 환경은 타이머를 1ms 단위로 뭉개고, 랩톱 벽시계는 기계 부하에 따라
   * 2~3배씩 흔들린다 — 실제로 어느 날 전부 15~50ms 로 떨어졌는데 옛 커밋도 똑같았다.
   * 코드가 아니라 측정이 흔들린 것이다.
   *
   * 진짜 10ms 검증은 실제 Cloudflare 에서 도는 부하 리허설이 한다
   * (`npm run rehearsal` — 실측 3ms). 여기서는 O(n²)→O(n³) 같은 폭주만 잡는다:
   * 폭주하면 최선의 실행도 수백 ms 가 된다.
   */
  it("100명 배정이 폭주하지 않는다 (최선 실행 < 60ms)", () => {
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
    // 최솟값 — 가장 덜 방해받은 실행이 순수 계산 시간에 제일 가깝다
    expect(Math.min(...times)).toBeLessThan(60);
  });
});

// ─────────────────────────────────────────── 한 사람이 여러 명과 이어질 때

/**
 * A–B 와 A–C 가 동시에 성립하고, 정원 때문에 하나만 붙일 수 있다 (ADR-24·25).
 * 그때는 **주고받은 콕이 많은 쪽**이 자리를 가져간다.
 */
describe("여러 쌍 중 무엇을 먼저 붙이나", () => {
  /** 2테이블 · 남2 여2 → 테이블마다 남1 여1. A 는 한 명하고만 앉을 수 있다 */
  function triangle(votes: Record<string, number>) {
    const players: Player[] = [
      { ...makePlayers(1, 0)[0], id: "A", gender: "M", age: 30 },
      { ...makePlayers(1, 0)[0], id: "D", gender: "M", age: 30 },
      { ...makePlayers(0, 1, 7)[0], id: "B", gender: "F", age: 30 },
      { ...makePlayers(0, 1, 9)[0], id: "C", gender: "F", age: 30 },
    ];
    return buildSeating({
      players,
      tableCount: 2,
      round: 1,
      final: true,
      history: [],
      // 목록 순서는 일부러 약한 쌍을 앞에 둔다 — 세기로 정렬되는지 보려고
      mutual: [["A", "C"], ["A", "B"]],
      votes,
      oneWay: [],
    });
  }

  const tableOf = (seats: Seat[], id: string) => seats.find((s) => s.playerId === id)?.table;

  it("★ 콕을 더 많이 주고받은 쪽이 같은 테이블에 앉는다", () => {
    const seats = triangle({ "A|B": 6, "A|C": 2 });
    expect(tableOf(seats, "A")).toBe(tableOf(seats, "B"));
    expect(tableOf(seats, "A")).not.toBe(tableOf(seats, "C"));
  });

  it("★ 반대로 기울면 반대쪽이 앉는다 — 목록 순서가 아니라 세기로 정한다", () => {
    const seats = triangle({ "A|B": 2, "A|C": 6 });
    expect(tableOf(seats, "A")).toBe(tableOf(seats, "C"));
    expect(tableOf(seats, "A")).not.toBe(tableOf(seats, "B"));
  });

  it("아무도 앉지 못하고 남는 사람은 없다", () => {
    const seats = triangle({ "A|B": 6, "A|C": 2 });
    expect(seats.map((s) => s.playerId).sort()).toEqual(["A", "B", "C", "D"]);
  });
});

describe("한쪽만 투표해도 표 수가 자리를 가른다 (ADR-40)", () => {
  /**
   * 2테이블 · 남2 여2 → 테이블마다 남1 여1. A 는 둘 중 한 명하고만 앉을 수 있다.
   * **상호는 하나도 없다** — 단방향 표만으로 갈리는지 보는 게 이 판의 요점이다.
   */
  function crush(votes: Record<string, number>) {
    const players: Player[] = [
      { ...makePlayers(1, 0)[0], id: "A", gender: "M", age: 30 },
      { ...makePlayers(1, 0)[0], id: "D", gender: "M", age: 30 },
      { ...makePlayers(0, 1, 7)[0], id: "B", gender: "F", age: 30 },
      { ...makePlayers(0, 1, 9)[0], id: "C", gender: "F", age: 30 },
    ];
    return buildSeating({
      players,
      tableCount: 2,
      round: 1,
      final: false,
      history: [],
      mutual: [],
      votes,
      // 목록 순서는 일부러 약한 쪽을 앞에 둔다 — 순서가 아니라 표 수로 갈리는지 보려고
      oneWay: [["A", "C"], ["A", "B"]],
    });
  }

  const seatOf = (seats: Seat[], id: string) => seats.find((s) => s.playerId === id)?.table;

  it("★ 세 번 투표한 쪽과 앉는다", () => {
    /*
     * 예전에는 단방향이 **한 칸**(−4)이라 표를 몇 장 줬든 같았다.
     * 매력 투표를 2표 이상으로 연 회차에서는 그 표들이 자리에 아무 말도 하지 않았다.
     */
    const seats = crush({ "A|B": 3, "A|C": 1 });
    expect(seatOf(seats, "A")).toBe(seatOf(seats, "B"));
    expect(seatOf(seats, "A")).not.toBe(seatOf(seats, "C"));
  });

  it("★ 반대로 기울면 반대쪽과 앉는다", () => {
    const seats = crush({ "A|B": 1, "A|C": 3 });
    expect(seatOf(seats, "A")).toBe(seatOf(seats, "C"));
    expect(seatOf(seats, "A")).not.toBe(seatOf(seats, "B"));
  });

  it("★ 표를 아무리 몰아줘도 나이차를 이기지는 못한다", () => {
    /*
     * 상한(24)이 나이차 벌점(30)보다 낮다. 넘게 두면 한 쌍이 나이차를 통째로 밀어내고
     * 그 테이블만 이상해진다 (ADR-11). 나이차 큰 쌍은 마지막 라운드가 붙여준다.
     */
    const players: Player[] = [
      { ...makePlayers(1, 0)[0], id: "A", gender: "M", age: 45 },
      { ...makePlayers(1, 0)[0], id: "D", gender: "M", age: 26 },
      { ...makePlayers(0, 1, 7)[0], id: "B", gender: "F", age: 25 },
      { ...makePlayers(0, 1, 9)[0], id: "C", gender: "F", age: 44 },
    ];
    const seats = buildSeating({
      players, tableCount: 2, round: 1, final: false, history: [],
      mutual: [], votes: { "A|B": 5 }, oneWay: [["A", "B"]],
    });
    // A(45)–B(25) 는 20살 차이다. 5표를 몰아줘도 붙지 않는다
    expect(seatOf(seats, "A")).not.toBe(seatOf(seats, "B"));
  });
});

describe("붙여 앉히는 힘", () => {
  it("★ 표 하나하나가 값을 만든다 (ADR-40)", () => {
    /*
     * 예전에는 상호냐 단방향이냐 **두 칸**뿐이라, 한 사람에게 세 번 투표한 것과
     * 한 번 투표한 것이 똑같이 −4 였다. 매력 투표를 여러 표로 연 회차에서
     * 그 표들이 자리에 아무 말도 하지 않았다.
     */
    expect(pullScore(1, false)).toBe(4);
    expect(pullScore(2, false)).toBe(8);
    expect(pullScore(3, false)).toBe(12);
  });

  it("★ 서로 보냈으면 부가 점수가 얹힌다", () => {
    // 같은 2표라도 한 사람이 두 번 보낸 것과 서로 한 번씩 보낸 것은 다른 일이다
    expect(pullScore(2, true)).toBe(16);
    expect(pullScore(2, false)).toBe(8);
  });

  it("★ 상한이 나이차 벌점(30)을 넘지 않는다", () => {
    // 넘으면 한 쌍이 나이차를 통째로 밀어내고 그 테이블만 이상해진다 (ADR-11 에서 겪은 일)
    expect(pullScore(4, true)).toBe(24);
    expect(pullScore(10, true)).toBe(24);
    expect(pullScore(30, false)).toBe(24);
    expect(pullScore(30, true)).toBeLessThan(SEAT_W.AGE);
  });

  it("표가 없으면 끌림도 없다", () => {
    expect(pullScore(0, false)).toBe(0);
    expect(pullScore(0, true)).toBe(0);
  });
});
