/**
 * 슬라이스 05 — 자리 배정
 *
 * `buildSeating` 은 순수 함수라서 기준을 먼저 박아두면 알고리즘을 어떻게 짜든 상관없다.
 * 기준은 `docs/SEATING.md` 의 표에서 그대로 가져왔다.
 *
 *   성비 편차 0 (하드) · 미배정 0 · 테이블 인원 편차 ≤1
 *   나이차 10살+ 쌍 · 서로 찌른 쌍의 동석률 (ADR-51 로 마지막 라운드가 없어졌다)
 */
import { describe, expect, it } from "vitest";
import { buildSeating, pull, tableCaps } from "../src/server/seating.ts";
import type { Player, Seat } from "../src/shared/types.ts";
import { AGE_GAP, MEET_GAP } from "../src/shared/constants.ts";

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
      pin: "set",
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

/**
 * 나이차 10살+ **이성** 쌍. 벌점이 걸리는 쌍만 센다 — 동성 쌍에는 벌점이 없으므로(ADR-80)
 * 지표에서도 뺀다. `AGE_GAP` 의 주석이 말하는 "벌점이 상한에 걸린 쌍의 수와 정확히 같은 것" 이
 * 계속 성립하려면 세는 범위도 벌점의 범위와 같아야 한다.
 */
function ageViolations(seats: Seat[], players: Player[]): number {
  const by = new Map(players.map((p) => [p.id, p]));
  let n = 0;
  for (const ids of groups(seats).values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = by.get(ids[i])!;
        const b = by.get(ids[j])!;
        if (a.gender !== b.gender && Math.abs(a.age - b.age) >= AGE_GAP) n++;
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
  opts: { votes?: Sent; pokes?: Sent; maxVote?: number; maxPoke?: number } = {},
) {
  const history: Seat[][] = [];
  for (let r = 1; r <= rounds; r++) {
    history.push(
      buildSeating({
        players,
        tableCount,
        round: r,
        history: [...history],
        votes: opts.votes ?? {},
        pokes: opts.pokes ?? {},
        maxVote: opts.maxVote ?? 3,
        maxPoke: opts.maxPoke ?? 3,
        seed: 20260826 + r,
      }),
    );
  }
  return history;
}

type Sent = Record<string, number>;
/** `A → B` 를 n 번. 상호는 양쪽을 다 적는다 */
const sent = (...rows: Array<[string, string, number]>): Sent =>
  Object.fromEntries(rows.map(([a, b, n]) => [`${a}>${b}`, n]));

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
   *
   * ⚠️ **세제곱으로 바꾸면서(ADR-57) 이 숫자가 커졌다.** 절벽(10살에 +30)은 9살을 공짜로 보고
   * 10살을 절대 못 넘게 했는데, 세제곱은 10살이 1.0 이라 12살짜리 하나가 6살짜리 넷보다 싸다.
   * **그 대신 20살짜리를 훨씬 무겁게 벌한다** — 사람이 실제로 느끼는 불편에 가깝다.
   */
  const cases = [
    { men: 8, women: 8, tables: 4, max: 6 },
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

  it("첫 라운드는 나이차 위반이 거의 없다", () => {
    // 시작점이 나이순 블록이라 첫 라운드는 거의 0 이다. 정확값 대신 상한으로 둔다 —
    // 지터와 재시작 때문에 표본마다 0~2 사이에서 흔들리고, 그 흔들림은 의도한 것이다
    for (const c of cases) {
      const players = makePlayers(c.men, c.women);
      const [first] = runRounds(players, c.tables, 1);
      expect({ case: `${c.men}/${c.women}`, ok: ageViolations(first, players) <= 2 }).toEqual({
        case: `${c.men}/${c.women}`,
        ok: true,
      });
    }
  });
});

describe("나이차 벌점은 10살에서 멈춘다 (ADR-78)", () => {
  /**
   * **8~9살은 아직 이어질 자리가 있지만, 10살을 넘으면 그 다음은 다 같다.**
   *
   * 세제곱에는 문턱이 없어서 66살 차이의 벌점이 **287.5** 였다 — 가장 강한 긍정 신호인
   * 상호 콕(2.5)의 115배다. 등록 나이는 18~99 라 장난으로 91 을 적을 수 있고, 그러면
   * 목적함수가 통째로 그 한 사람에게 끌려간다. 상한을 `AGE_GAP`(10살) 에 둔다 (ADR-78).
   */

  /**
   * ★ **상한 위에서는 서로 구별되지 않는다.**
   *
   * 24~31세 파티에 **모두와 10살 넘게 떨어진 사람**을 하나 넣고 그 나이만 41 → 91 로 바꾼다.
   * 둘 다 나이순 초기 배치에서 맨 끝이고, 나이대 이성(±6)도 둘 다 없다.
   * 남는 차이는 벌점뿐이라 — 상한에 걸려 있으면 **자리가 글자 그대로 같아야 한다.**
   */
  it("★ 41세와 91세가 같은 자리를 만든다 — 10살 위는 다 같다", () => {
    const ages = [26, 27, 25, 28, 29, 26, 27, 30, 24, 31, 28, 26, 29, 27, 25, 30];
    const seatFor = (odd: number) => {
      const players = makePlayers(8, 8).map((p, i) => ({ ...p, age: i === 0 ? odd : ages[i] }));
      return buildSeating({
        players, tableCount: 4, round: 1, history: [],
        votes: {}, pokes: {}, maxVote: 2, maxPoke: 3, seed: 77,
      });
    };
    expect(seatFor(91)).toEqual(seatFor(41));
  });

  /**
   * ★ **10살과 20살이 같으므로, 그 둘은 표가 가른다.**
   *
   * 앞 테스트가 "구별하지 않는다" 를 잡고 이 테스트는 **그래서 무엇이 달라지는가**를 잡는다.
   * 문턱이 없던 때는 20살(8.0)과 10살(1.0)의 차이가 7.0 이라 표(최대 0.4)가 낄 자리가
   * 아예 없었다. 상한 뒤로는 둘 다 1.0 이고, 그 위에서 표가 자리를 정한다.
   *
   * ⚠️ 이 판은 **10살 미만을 공짜로 만들지 않는다** — 아래 테스트가 그 경계를 지킨다.
   */
  it("★ 10살차와 20살차 사이는 표가 가른다", () => {
    /*
     * D 를 B·C 로부터 **등거리(5살)** 에 둔다. 그래야 D 가 어느 쪽에 앉든 값이 같아서
     * 판이 A 의 선택 하나로 좁혀진다 — D 를 한쪽에 붙여 두면 A 가 아니라 D 가 자리를 정한다.
     */
    const players: Player[] = [
      { ...makePlayers(1, 0)[0], id: "A", gender: "M", age: 30 },
      { ...makePlayers(1, 0)[0], id: "D", gender: "M", age: 45 },
      { ...makePlayers(0, 1, 7)[0], id: "B", gender: "F", age: 40 },
      { ...makePlayers(0, 1, 9)[0], id: "C", gender: "F", age: 50 },
    ];
    const seats = buildSeating({
      players, tableCount: 2, round: 1, history: [],
      votes: { "A>C": 3 }, pokes: {}, maxVote: 3, maxPoke: 3, seed: 5,
    });
    const at = (id: string) => seats.find((s) => s.playerId === id)?.table;
    expect(at("A")).toBe(at("C"));
  });

  /**
   * ★ **상한 아래는 그대로다.** 여기가 무너지면 상한이 아니라 나이차를 걷어낸 것이다.
   *
   * 나이순으로 짝지으면(A30-B31 · D39-C38) 둘 다 1살차이고 나이대 이성(±6)이라 새 만남까지
   * 얹힌다. 표를 따라가면 둘 다 8살차(0.512)가 되고 새 만남도 사라진다 — 표로는 못 뒤집는다.
   */
  it("★ 10살 아래에서는 표가 나이차를 못 이긴다", () => {
    const players: Player[] = [
      { ...makePlayers(1, 0)[0], id: "A", gender: "M", age: 30 },
      { ...makePlayers(1, 0)[0], id: "D", gender: "M", age: 39 },
      { ...makePlayers(0, 1, 7)[0], id: "B", gender: "F", age: 31 },
      { ...makePlayers(0, 1, 9)[0], id: "C", gender: "F", age: 38 },
    ];
    const seats = buildSeating({
      players, tableCount: 2, round: 1, history: [],
      votes: { "A>C": 3 }, pokes: {}, maxVote: 3, maxPoke: 3, seed: 5,
    });
    const at = (id: string) => seats.find((s) => s.playerId === id)?.table;
    expect(at("A")).toBe(at("B"));
  });
});

describe("같은 성별 쌍은 나이차 벌점을 받지 않는다 (ADR-80)", () => {
  /**
   * 나이차 벌점은 **이성 쌍에만** 걸린다. 같은 테이블의 동성끼리는 나이가 얼마나 벌어져도 값이 같다.
   * (재회는 ADR-81 에서 **이성보다 가벼운 값으로** 돌아왔다 — 아래 describe 가 그 크기를 지킨다.)
   *
   * 판을 이렇게 짠다 — 남자는 20세 넷·40세 넷, 여자는 전원 30세, 2테이블.
   * 이성 쌍은 어떻게 앉혀도 전부 10살 차(상한 1.0)라 **상수**고, 나이대 이성(±6)도 재회도 없다.
   * 남는 변수는 **남자끼리의 나이차 하나**다. 여기에 20세 A 가 40세 B 를 콕 하나 찌른다
   * (콕은 성별을 가리지 않는다, ADR-17). 그 끌림은 작다 — 진행도 0 이라 0.4 × 0.25 = 0.1.
   *
   *   동성 벌점이 있으면   A–B 는 +0.1 − 1.0 → 떨어진다
   *   없으면              A–B 는 +0.1       → 붙는다
   *
   * 시작 배치가 나이순이라 A 와 B 는 늘 다른 테이블에서 출발한다. 붙는 건 개선 단계가 한 일이다.
   * 판 자체가 결정적이라 씨앗 8개 **전부**에서 붙어야 한다 — 평균이 아니다.
   *
   * ⚠️ 이 테스트는 **이성 쌍의 벌점까지 걷어낸 변이는 못 잡는다.** 그건 아래
   * `이성 쌍의 나이차 벌점은 그대로다` 가 잡는다. 기존의 `표를 아무리 몰아줘도` 는 못 잡는다 —
   * 변이를 넣어봤더니 새 만남 보너스(±6)만으로도 통과했다. 그래서 새 만남이 없는 판을 따로 짰다.
   */
  const board = () => {
    const men = [20, 20, 20, 20, 40, 40, 40, 40];
    return makePlayers(8, 8).map((p, i) => ({ ...p, age: i < 8 ? men[i] : 30 }));
  };
  const at = (seats: Seat[], id: string) => seats.find((s) => s.playerId === id)?.table;

  it("★ 동성 콕 하나가 20살차를 이긴다 — 이성 쌍이 상수인 판", () => {
    const players = board(); // p0 = 20세 남 A · p4 = 40세 남 B
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const seats = buildSeating({
        players, tableCount: 2, round: 1, history: [],
        votes: {}, pokes: sent(["p0", "p4", 1]), maxVote: 2, maxPoke: 2, seed,
      });
      expect({ seed, together: at(seats, "p0") === at(seats, "p4") }).toEqual({ seed, together: true });
    }
  });

  it("★ 콕이 없으면 동성 나이차는 자리를 가르지 않는다 — 20세끼리·40세끼리 붙는 건 시작점 때문이다", () => {
    /*
     * 같은 판에서 콕을 빼면 남자 배치는 목적함수에 **아무 영향이 없다** (이성 쌍은 상수, 동성은 0).
     * 그래도 20세끼리 모이는 것은 시작 배치(나이순 블록, `AGE_JITTER`)가 그렇게 두기 때문이지
     * 벌점이 지켜서가 아니다. 이 테스트는 그 사실을 **말로만 두지 않으려고** 있다 —
     * 개선 단계가 값이 같은 자리들 사이에서 움직이지 않는다는 것(값이 같으면 안 바꾼다)을 잠근다.
     * 이걸 깨는 변이는 아래 콕 테스트가 아니라 여기서 잡힌다.
     */
    const players = board();
    const seats = buildSeating({
      players, tableCount: 2, round: 1, history: [],
      votes: {}, pokes: {}, maxVote: 2, maxPoke: 2, seed: 3,
    });
    const young = ["p0", "p1", "p2", "p3"].map((id) => at(seats, id));
    expect(new Set(young).size).toBe(1);
  });

  it("★ 이성 쌍의 나이차 벌점은 그대로다 — 새 만남이 없는 판에서 표가 20살차를 못 이긴다", () => {
    /*
     * 앞 판과 반대로 **동성이 상수고 이성만 변수**인 판. 남자 30·30·44·44, 여자 37·37·51·51.
     * 이성 쌍의 나이차가 전부 7 이상이라 새 만남 보너스(±6)가 **어디에도 없다** — 이 판은 벌점
     * 하나로만 갈린다. 나이순 배치({30,30,37,37}+{44,44,51,51}, 벌점 합 2.74)가 최선이고,
     * 30세 남자가 51세 여자에게 표를 몰아줘도(0.24) 그쪽으로 옮기는 값(+1.31)을 못 낸다.
     * 이성 쌍의 벌점을 걷어내면 표가 이기고 둘이 붙는다 — 그 변이를 이 테스트가 잡는다.
     */
    const ages = [30, 30, 44, 44, 37, 37, 51, 51];
    const players = makePlayers(4, 4).map((p, i) => ({ ...p, age: ages[i] }));
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const seats = buildSeating({
        players, tableCount: 2, round: 1, history: [],
        votes: sent(["p0", "p6", 3]), pokes: {}, maxVote: 3, maxPoke: 2, seed,
      });
      expect({ seed, apart: at(seats, "p0") !== at(seats, "p6") }).toEqual({ seed, apart: true });
    }
  });
});

describe("동성 재회 벌점은 이성보다 가볍다 (ADR-81)", () => {
  /**
   * ADR-80 이 0 으로 둔 자리에 **작은 값**이 돌아왔다. 0 이었을 때 같은 남자 셋이 라운드마다
   * 다시 앉았다 — 이성 쪽 사정이 그들을 가르지 않으면 흩을 이유가 없었기 때문이다.
   *
   * **크기가 규칙의 전부다.** 그래서 테스트도 둘이다 — 다른 것이 같을 때 **가르고**,
   * 이성 재회와 부딪히면 **진다.** 한쪽만 잡으면 0 과 0.6 중 하나로 미끄러진다.
   */
  const at = (seats: Seat[], id: string) => seats.find((s) => s.playerId === id)?.table;

  it("★ 다른 것이 모두 같으면 지난 테이블의 동성 쌍이 갈린다", () => {
    /*
     * 남녀 넷씩 전원 30세, 2테이블(남 2 · 여 2). 두 라운드 동안 **모든 이성 쌍이 정확히 한 번씩**
     * 만났다 — 3라운드에서 이성 쪽은 어떻게 앉히든 재회 8쌍 · 나이차 0 · 새 만남 0 · 공정성 1 로
     * **상수**다. 남는 변수는 동성 쌍 하나뿐이다.
     *
     * 두 번 같은 테이블이었던 쌍은 넷(p0–p1 · p2–p3 · p4–p5 · p6–p7). 벌점이 있으면 그 넷을
     * 모두 가르는 배치가 **유일한 최선**이고, 0 이면 판이 평평해 시작 배치가 그대로 남는다 —
     * 그 자리는 씨앗마다 다르다. 그래서 씨앗 8개 전부에서 갈려야 한다.
     */
    const players = makePlayers(4, 4).map((pl) => ({ ...pl, age: 30 }));
    const round = (a: string[], b: string[]): Seat[] => [
      ...a.map((playerId) => ({ playerId, table: 1 })),
      ...b.map((playerId) => ({ playerId, table: 2 })),
    ];
    const history = [
      round(["p0", "p1", "p4", "p5"], ["p2", "p3", "p6", "p7"]),
      round(["p0", "p1", "p6", "p7"], ["p2", "p3", "p4", "p5"]),
    ];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const seats = buildSeating({
        players, tableCount: 2, round: 3, history,
        votes: {}, pokes: {}, maxVote: 2, maxPoke: 2, seed,
      });
      const apart = (x: string, y: string) => at(seats, x) !== at(seats, y);
      expect({
        seed,
        apart: apart("p0", "p1") && apart("p2", "p3") && apart("p4", "p5") && apart("p6", "p7"),
      }).toEqual({ seed, apart: true });
    }
  });

  it("★ 이성 재회와 부딪히면 진다 — 지난 테이블의 남자 셋이 그대로 붙어 있다", () => {
    /*
     * 남자 여섯(전원 30세)·여자 둘(전원 45세)·2테이블 → 테이블마다 남 3 · 여 1.
     * 이성 쌍은 전부 15살 차라 상수고 새 만남도 없다. 1라운드에 {p0,p1,p2}+W1 · {p3,p4,p5}+W2 로 앉았다.
     *
     * 2라운드에서 여자 둘이 자리를 바꾸면 이성 재회는 0 이 된다 — **남자 셋이 그대로일 때만**이다.
     * 남자를 섞으면(2+1) 어느 여자가 앉든 옛 남자를 한 명은 다시 만난다.
     *
     *   셋 그대로 = 동성 6쌍       ·  섞기 = 동성 2쌍 + 이성 2쌍
     *
     * 동성 값이 무거우면 섞는 편이 싸서 셋이 흩어지고, 충분히 가벼우면 그대로다.
     * **이 테스트가 상한을 잡는다** — 0.2 는 통과하고 **0.3 부터 빨개진다** (실측). 씨앗 8개 전부.
     */
    const players = makePlayers(6, 2).map((pl, i) => ({ ...pl, age: i < 6 ? 30 : 45 }));
    const r1: Seat[] = [
      ...["p0", "p1", "p2", "p6"].map((playerId) => ({ playerId, table: 1 })),
      ...["p3", "p4", "p5", "p7"].map((playerId) => ({ playerId, table: 2 })),
    ];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const seats = buildSeating({
        players, tableCount: 2, round: 2, history: [r1],
        votes: {}, pokes: {}, maxVote: 2, maxPoke: 2, seed,
      });
      const trio = new Set(["p0", "p1", "p2"].map((id) => at(seats, id)));
      expect({ seed, together: trio.size === 1 }).toEqual({ seed, together: true });
    }
  });
});

describe("재회 회피", () => {
  it("2라운드는 1라운드와 다른 자리를 만든다", () => {
    const players = makePlayers(10, 10);
    const [r1, r2] = runRounds(players, 5, 2);
    // 이성 쌍만 센다 — 동성 재회 벌점은 1/3 이라(ADR-81) 여기 기준으로 삼을 크기가 아니다.
    // 동성 쪽은 ADR-81 의 판 둘이 따로 잡는다
    const by = new Map(players.map((p) => [p.id, p]));
    const met = (seats: Seat[]) => {
      const s = new Set<string>();
      for (const ids of groups(seats).values()) {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            if (by.get(ids[i])!.gender !== by.get(ids[j])!.gender) s.add([ids[i], ids[j]].sort().join("|"));
          }
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

/**
 * 서로 찌른 쌍 (ADR-51).
 *
 * 예전에는 **커플 자리**라는 전용 라운드가 이 쌍들을 구조로 붙였다 (나이차 면제 · 보너스 ×2.5 ·
 * 붙은 쌍은 맞교환에서 제외). 그 라운드를 걷어냈으므로 이제 붙이는 힘은 **가중치 하나**뿐이고,
 * 끌림의 상한(24)이 나이차 벌점(30)보다 낮아서 **나이차가 큰 쌍은 못 붙인다** (ADR-11).
 *
 * 그래서 여기서 재는 것은 "전부 붙는가" 가 아니라 **"대부분 붙고, 못 붙는 것이 설명되는가"** 다.
 * 나머지는 운영자가 자리 탭에서 💔 를 보고 맞교환으로 붙인다.
 */
describe("서로 찌른 쌍", () => {
  function fixture() {
    const players = makePlayers(12, 12);
    const men = players.filter((p) => p.gender === "M");
    const women = players.filter((p) => p.gender === "F");
    // 서로 찌른 쌍 8개. 나이차 14·9살짜리도 섞여 있다 — 그 쌍이 이 식의 한계다
    const mutual: Array<[string, string]> = men
      .slice(0, 8)
      .map((m, i) => [m.id, women[i].id] as [string, string]);
    const pokes = sent(...mutual.flatMap(([a, b]) => [[a, b, 2], [b, a, 2]] as Array<[string, string, number]>));
    return { players, mutual, pokes, by: new Map(players.map((p) => [p.id, p])) };
  }
  const rate = (seats: Seat[], mutual: Array<[string, string]>) => {
    const t = new Map(seats.map((s) => [s.playerId, s.table]));
    return mutual.filter(([a, b]) => t.get(a) === t.get(b)).length / mutual.length;
  };

  it("첫 라운드도 절반 넘게 붙인다", () => {
    const { players, mutual, pokes } = fixture();
    const [first] = runRounds(players, 4, 1, { pokes });
    expect(rate(first, mutual)).toBeGreaterThanOrEqual(0.6);
  });

  /**
   * ★ **초반에는 새 만남이 끌림을 이기고, 후반에 갚는다** (ADR-57).
   *
   * 라운드가 몇 번인지 알려줄 수 없으므로(운영자가 시계를 보고 끝낸다) 어느 라운드가
   * 마지막이 되어도 되어야 한다. 그 성질은 **새로 만날 사람이 고갈되면서** 저절로 생긴다 —
   * 초반에는 만날 사람이 많아 다양성이 이기고, 후반에는 남은 새 만남이 없어 끌림이 이긴다.
   *
   * 이 줄이 깨지면 둘 중 하나다: 초반에 끌림이 너무 세서 두루 못 만나거나,
   * 후반에도 다양성이 이겨서 마음 맞은 쌍이 흩어진 채로 파티가 끝나거나.
   */
  it("★ 마지막 라운드가 첫 라운드보다 더 붙어 있다", () => {
    const { players, mutual, pokes } = fixture();
    const rounds = runRounds(players, 4, 4, { pokes });
    expect(rate(rounds.at(-1)!, mutual)).toBeGreaterThan(rate(rounds[0], mutual));
  });

  it("★ 라운드가 쌓여도 대부분은 붙어 있다 — 재회 벌점이 쌍을 떼지 않는다", () => {
    const { players, mutual, pokes } = fixture();
    const last = runRounds(players, 4, 3, { pokes }).at(-1)!;
    expect(rate(last, mutual)).toBeGreaterThanOrEqual(0.7);
  });

  it("쌍을 붙여도 성비는 그대로다", () => {
    const { players, pokes } = fixture();
    const caps = tableCaps(4, 12, 12);
    const byId = new Map(players.map((p) => [p.id, p]));
    const last = runRounds(players, 4, 2, { pokes }).at(-1)!;
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
      buildSeating({ players, tableCount: 12, round: 1, history: [],
        votes: {}, pokes: {}, maxVote: 3, maxPoke: 3, seed: 1 });

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
  function triangle(votes: Sent) {
    const players: Player[] = [
      { ...makePlayers(1, 0)[0], id: "A", gender: "M", age: 30 },
      { ...makePlayers(1, 0)[0], id: "D", gender: "M", age: 30 },
      { ...makePlayers(0, 1, 7)[0], id: "B", gender: "F", age: 30 },
      { ...makePlayers(0, 1, 9)[0], id: "C", gender: "F", age: 30 },
    ];
    return buildSeating({
      players, tableCount: 2, round: 1, history: [],
      votes: {}, pokes: votes, maxVote: 3, maxPoke: 6, seed: 5,
    });
  }

  const tableOf = (seats: Seat[], id: string) => seats.find((s) => s.playerId === id)?.table;

  it("★ 콕을 더 많이 주고받은 쪽이 같은 테이블에 앉는다", () => {
    const seats = triangle(sent(["A","B",3],["B","A",3],["A","C",1],["C","A",1]));
    expect(tableOf(seats, "A")).toBe(tableOf(seats, "B"));
    expect(tableOf(seats, "A")).not.toBe(tableOf(seats, "C"));
  });

  it("★ 반대로 기울면 반대쪽이 앉는다 — 목록 순서가 아니라 세기로 정한다", () => {
    const seats = triangle(sent(["A","B",1],["B","A",1],["A","C",3],["C","A",3]));
    expect(tableOf(seats, "A")).toBe(tableOf(seats, "C"));
    expect(tableOf(seats, "A")).not.toBe(tableOf(seats, "B"));
  });

  it("아무도 앉지 못하고 남는 사람은 없다", () => {
    const seats = triangle(sent(["A","B",3],["B","A",3],["A","C",1],["C","A",1]));
    expect(seats.map((s) => s.playerId).sort()).toEqual(["A", "B", "C", "D"]);
  });
});

describe("한쪽만 투표해도 표 수가 자리를 가른다 (ADR-40)", () => {
  /**
   * 2테이블 · 남2 여2 → 테이블마다 남1 여1. A 는 둘 중 한 명하고만 앉을 수 있다.
   * **상호는 하나도 없다** — 단방향 표만으로 갈리는지 보는 게 이 판의 요점이다.
   */
  function crush(votes: Sent) {
    const players: Player[] = [
      { ...makePlayers(1, 0)[0], id: "A", gender: "M", age: 30 },
      { ...makePlayers(1, 0)[0], id: "D", gender: "M", age: 30 },
      { ...makePlayers(0, 1, 7)[0], id: "B", gender: "F", age: 30 },
      { ...makePlayers(0, 1, 9)[0], id: "C", gender: "F", age: 30 },
    ];
    return buildSeating({
      players, tableCount: 2, round: 1, history: [],
      votes, pokes: {}, maxVote: 3, maxPoke: 3, seed: 5,
    });
  }

  const seatOf = (seats: Seat[], id: string) => seats.find((s) => s.playerId === id)?.table;

  it("★ 세 번 투표한 쪽과 앉는다", () => {
    /*
     * 예전에는 단방향이 **한 칸**(−4)이라 표를 몇 장 줬든 같았다.
     * 매력 투표를 2표 이상으로 연 회차에서는 그 표들이 자리에 아무 말도 하지 않았다.
     */
    const seats = crush(sent(["A","B",3],["A","C",1]));
    expect(seatOf(seats, "A")).toBe(seatOf(seats, "B"));
    expect(seatOf(seats, "A")).not.toBe(seatOf(seats, "C"));
  });

  it("★ 반대로 기울면 반대쪽과 앉는다", () => {
    const seats = crush(sent(["A","B",1],["A","C",3]));
    expect(seatOf(seats, "A")).toBe(seatOf(seats, "C"));
    expect(seatOf(seats, "A")).not.toBe(seatOf(seats, "B"));
  });

  it("★ 표를 아무리 몰아줘도 나이차를 이기지는 못한다", () => {
    /*
     * 상한(24)이 나이차 벌점(30)보다 낮다. 넘게 두면 한 쌍이 나이차를 통째로 밀어내고
     * 그 테이블만 이상해진다 (ADR-11). **그래서 나이차 큰 쌍은 알고리즘이 못 붙인다** —
     * 전용 라운드가 면제로 넘던 벽인데 그 라운드를 걷어냈다 (ADR-51).
     * 지금은 운영자가 자리에서 `💔` 를 보고 맞교환으로 옮긴다. 알고 고른 대가다.
     */
    const players: Player[] = [
      { ...makePlayers(1, 0)[0], id: "A", gender: "M", age: 45 },
      { ...makePlayers(1, 0)[0], id: "D", gender: "M", age: 26 },
      { ...makePlayers(0, 1, 7)[0], id: "B", gender: "F", age: 25 },
      { ...makePlayers(0, 1, 9)[0], id: "C", gender: "F", age: 44 },
    ];
    const seats = buildSeating({
      players, tableCount: 2, round: 1, history: [],
      votes: sent(["A", "B", 5]), pokes: {}, maxVote: 5, maxPoke: 3, seed: 5,
    });
    // A(45)–B(25) 는 20살 차이다. 5표를 몰아줘도 붙지 않는다
    expect(seatOf(seats, "A")).not.toBe(seatOf(seats, "B"));
  });
});

describe("붙여 앉히는 힘", () => {
  /**
   * ★ **끌림은 회차 상한으로 정규화된다** (ADR-57).
   *
   * 콕을 1회로 연 회차와 5회로 연 회차가 같은 자에 있어야 나이차·다양성과 섞인다.
   * 예전에는 `/6` 으로 고정이라, 상한 1회 회차에서는 상호라도 절반밖에 못 냈다.
   */
  it("★ 각 회차의 최대치가 1이 된다", () => {
    expect(pull(1, 1, 1)).toBe(1);
    expect(pull(3, 3, 3)).toBe(1);
    expect(pull(5, 5, 5)).toBe(1);
  });

  it("★ 중복이 값을 키운다 — 한 번과 세 번이 같으면 안 된다", () => {
    expect(pull(1, 0, 3)).toBeLessThan(pull(2, 0, 3));
    expect(pull(2, 0, 3)).toBeLessThan(pull(3, 0, 3));
  });

  it("★ 서로 보냈으면 부가 점수가 얹힌다", () => {
    // 같은 2표라도 한 사람이 두 번 보낸 것과 서로 한 번씩 보낸 것은 다른 일이다
    expect(pull(1, 1, 3)).toBeGreaterThan(pull(2, 0, 3));
  });

  /**
   * ★ **받기만 한 것은 값을 만들지 않는다** (ADR-57).
   *
   * 콕은 익명이다 — 받은 쪽은 누가 찔렀는지 모르고, 그래서 같이 앉아도 그 사람의 만족이 아니다.
   * 방향을 지우면 짝사랑 한 번이 양쪽 몫으로 두 번 세어진다.
   */
  it("★ 받기만 한 쪽에게는 끌림이 없다", () => {
    expect(pull(0, 3, 3)).toBe(0);
    expect(pull(0, 0, 3)).toBe(0);
  });

  it("값은 [0,1] 을 벗어나지 않는다", () => {
    expect(pull(99, 99, 3)).toBe(1);
    expect(pull(1, 0, 3)).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────── ADR-57

/** 확률적 규칙은 씨앗 하나로 재면 안 된다 — 실측이 흔들리는 폭이 판정보다 크다 */
const SEEDS = [11, 22, 33, 44, 55, 66, 77, 88];

/**
 * 실제 회차를 흉내 낸다 — 자리에 앉아야 콕을 찌를 수 있고, 그 콕이 다음 자리를 만든다.
 * `budget` 만큼 쓰면 더 못 찌른다.
 */
function party(players: Player[], tableCount: number, rounds: number, seed: number) {
  const rand = rng(seed);
  const pokes: Sent = {};
  const used = new Map(players.map((p) => [p.id, 0]));
  const budget = new Map(players.map((p) => [p.id, rand() < 2 / 3 ? 2 : 0]));
  const history: Seat[][] = [];

  for (let r = 1; r <= rounds; r++) {
    const seats = buildSeating({
      players, tableCount, round: r, history: [...history],
      votes: {}, pokes, maxVote: 3, maxPoke: 2, seed: seed * 1000 + r,
    });
    history.push(seats);
    if (r === rounds) break;              // 마지막 라운드 뒤에는 찌를 자리가 없다
    const by = new Map(players.map((p) => [p.id, p]));
    for (const ids of groups(seats).values()) {
      for (const id of ids) {
        if ((used.get(id) ?? 0) >= (budget.get(id) ?? 0)) continue;
        const others = ids.filter((o) => by.get(o)!.gender !== by.get(id)!.gender);
        if (!others.length || rand() > 0.55) continue;
        const to = others[Math.floor(rand() * others.length)];
        pokes[`${id}>${to}`] = (pokes[`${id}>${to}`] ?? 0) + 1;
        used.set(id, (used.get(id) ?? 0) + 1);
      }
    }
  }
  const mutual: Array<[string, string]> = [];
  for (const key of Object.keys(pokes)) {
    const [a, b] = key.split(">");
    if (a < b && pokes[`${b}>${a}`]) mutual.push([a, b]);
  }
  return { history, pokes, mutual };
}

/** 22~34세로 좁힌 40명(남28·여12). 한가운데(28세)인 사람은 이성 전원이 `MEET_GAP` 안에 든다 */
function tightAges(): Player[] {
  const rand = rng(11);
  return makePlayers(28, 12, 5).map((p) => ({ ...p, age: 22 + Math.floor(rand() * 13) }));
}

describe("어느 라운드가 마지막이 되어도 (ADR-57)", () => {
  /**
   * ★ **상호 콕은 갚은 뒤에도 계속 끌린다.**
   *
   * 운영자는 시계를 보고 아무 때나 파티를 끝낸다 — 몇 번째가 마지막인지 알려줄 수 없다.
   * 한 번 붙여준 뒤 끌림을 없애면, 하필 그 뒤 라운드에서 끝났을 때 쌍이 흩어진 채로 끝난다.
   *
   * 여기서 재는 것은 **마지막 라운드의 동석률**이다. 후반으로 갈수록 새로 만날 사람이
   * 고갈되어 끌림이 저절로 이기는데, 그 성질이 살아 있는지를 본다.
   */
  it("★ 마지막 라운드에 상호 콕 쌍이 같은 테이블에 있다", () => {
    const players = tightAges();
    const rates = SEEDS.map((seed) => {
      const { history, mutual } = party(players, 4, 5, seed);
      if (!mutual.length) return null;
      const last = new Map(history.at(-1)!.map((s) => [s.playerId, s.table]));
      return mutual.filter(([a, b]) => last.get(a) === last.get(b)).length / mutual.length;
    }).filter((x): x is number => x !== null);

    expect(rates.length).toBeGreaterThan(SEEDS.length / 2);
    // 확률적 규칙이라 씨앗 하나로는 못 잰다 — 평균으로 본다 (실측 0.97)
    expect(rates.reduce((a, b) => a + b, 0) / rates.length).toBeGreaterThanOrEqual(0.9);
  });

  it("붙여 앉혀도 성비는 그대로다", () => {
    const players = tightAges();
    const caps = tableCaps(4, 28, 12);
    const by = new Map(players.map((p) => [p.id, p]));
    for (const seats of party(players, 4, 5, 11).history) {
      for (const [table, ids] of groups(seats)) {
        expect(ids.filter((id) => by.get(id)!.gender === "M").length).toBe(caps[table - 1].m);
      }
    }
  });
});

describe("나이대 이성을 두루 만난다 (ADR-57)", () => {
  const missing = (history: Seat[][], players: Player[], only?: Set<string>) => {
    const met = new Set<string>();
    for (const seats of history) {
      for (const ids of groups(seats).values()) {
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) met.add([ids[i], ids[j]].sort().join("|"));
        }
      }
    }
    let miss = 0;
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i];
        const b = players[j];
        if (a.gender === b.gender) continue;
        if (Math.abs(a.age - b.age) > MEET_GAP) continue;
        if (only && !only.has(a.id) && !only.has(b.id)) continue;
        if (!met.has([a.id, b.id].sort().join("|"))) miss++;
      }
    }
    return miss;
  };

  /**
   * ★ **테이블 수보다 한 라운드 더 돌면 나이대 이성을 다 만난다.**
   *
   * 남28·여12 라 남자 쪽이 병목이다 — 10명 테이블(남7·여3)이면 라운드마다 여자 3명을 보고,
   * 5라운드면 15자리다. 28세 남자가 만나야 할 여자가 12명이니 여유가 3이다.
   * ⚠️ 테이블을 5개로 쪼개면 라운드당 2명으로 줄어 이 여유가 사라진다.
   */
  it("★ 4테이블 · 5라운드면 못 만난 쌍이 없다", () => {
    const players = tightAges();
    const misses = SEEDS.map((seed) => missing(party(players, 4, 5, seed).history, players));
    expect(Math.max(...misses)).toBe(0);
  });

  /**
   * ★ **표를 하나도 안 쓴 사람이 버려지지 않는다.**
   *
   * 끌림이 없는 사람은 합만 최대화하는 배치에서 제일 먼저 희생된다 —
   * 그 사람을 어디에 앉혀도 남들의 끌림이 줄지 않기 때문이다. 공정성 가중이 그걸 막는다.
   */
  it("★ 콕을 안 쓴 사람도 나이대 이성을 다 만난다", () => {
    const players = tightAges();
    for (const seed of SEEDS) {
      const { history, pokes } = party(players, 4, 5, seed);
      const senders = new Set(Object.keys(pokes).map((k) => k.split(">")[0]));
      const quiet = players.filter((p) => !senders.has(p.id));
      expect({ seed, quiet: quiet.length > 0 }).toEqual({ seed, quiet: true });
      // 조용한 사람만 따로 센다 — 전체 합계에 묻히면 그 사람이 버려져도 통과한다
      expect({ seed, miss: missing(history, players, new Set(quiet.map((p) => p.id))) }).toEqual({ seed, miss: 0 });
    }
  });
});
