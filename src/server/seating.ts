/**
 * 자리 배정. 설계와 실측치는 `docs/SEATING.md`, 왜 이 모양인지는 ADR-56.
 *
 * **사람마다 만족을 재고 그 합을 최대화한다.** 예전에는 쌍마다 벌점을 매겨 더했는데,
 * 그러면 한 사람을 통째로 희생시켜 나머지를 올리는 배치가 이긴다.
 *
 * 핵심 불변식 셋 — 어느 것도 가중치로 지키지 않는다:
 *   ① `tableCaps()` 가 테이블별 남/여 정원을 **먼저** 고정한다
 *   ② 초기 배치가 그 정원을 만족한다
 *   ③ 개선 단계의 이웃 연산이 **같은 성별 2인 맞교환뿐**이다
 * 따라서 성비는 "지키려고 노력"하는 게 아니라 바뀔 방법이 없다.
 *
 * ⚠️ 무료 플랜은 요청당 CPU 10ms. 안쪽 루프는 사람 객체가 아니라 **번호**로 돌고,
 *    쌍마다의 값은 미리 n×n 판에 펼쳐 둔다 (문자열 키로 Map 을 두드리면 100명에 23ms 였다).
 *
 * 순수 함수다 — DO·요청·현재시각에 접근하지 않는다. **난수도 부르지 않는다**:
 * 씨앗을 입력으로 받아 안에서 돌리므로 같은 입력이면 같은 자리가 나온다.
 */
import type { Player, Seat } from "../shared/types.ts";
import { FAIR, MEET_GAP, SEAT_W } from "../shared/constants.ts";

export function spread(n: number, t: number): number[] {
  const base = Math.floor(n / t);
  const rest = n % t;
  return Array.from({ length: t }, (_, i) => base + (i < rest ? 1 : 0));
}

/**
 * 총원을 고르게 나눈 뒤, 각 테이블 정원 안에서 전체 성비대로 남/여를 쪼갠다.
 * 반올림을 테이블마다 따로 하면 마지막 테이블에 오차가 몰리므로 최대잔여법으로 나눈다.
 */
export function tableCaps(t: number, m: number, w: number): Array<{ m: number; w: number }> {
  const total = spread(m + w, t);
  const n = m + w;
  if (n === 0) return total.map(() => ({ m: 0, w: 0 }));

  const exact = total.map((cap) => (cap * m) / n);
  const caps = exact.map((x, i) => ({ m: Math.min(Math.floor(x), total[i]), w: 0 }));
  let left = m - caps.reduce((s, c) => s + c.m, 0);

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (caps[i].m < total[i]) {
      caps[i].m++;
      left--;
    }
  }
  return caps.map((c, i) => ({ m: c.m, w: total[i] - c.m }));
}

/** `"보낸이>받는이"` → 횟수. 같은 사람에게 몰아준 표가 그대로 세어진다 */
export type SentCounts = Record<string, number>;

export interface BuildInput {
  players: Player[];
  tableCount: number;
  round: number;
  /** 이전 라운드들의 **발행된** 좌석. 재회 회피와 공정성 가중이 여기서 나온다 */
  history: Seat[][];
  /** 매력 투표 — 프로필만 보고 고른 것이라 가볍게 본다 */
  votes: SentCounts;
  /** 파티 콕 — 만나본 뒤에 고른 것이라 무겁게 본다 */
  pokes: SentCounts;
  /** 회차 설정의 상한. 끌림을 여기에 맞춰 [0,1] 로 정규화한다 */
  maxVote: number;
  maxPoke: number;
  /** 같은 상태면 같은 자리가 나오도록 **부르는 쪽이** 준다 (보통 서버 시각) */
  seed: number;
}

/**
 * 한 사람이 상대에게 느끼는 끌림, [0,1].
 *
 * **방향이 있다** (ADR-56) — 내가 보낸 것만 나에게 만족을 준다. 콕은 익명이라
 * 받은 쪽은 누가 찔렀는지 모르고, 그래서 같이 앉아도 그 사람의 만족이 아니다.
 * 상호면 양쪽이 각자 보낸 것으로 각자 얻고, 거기에 부가 점수가 얹힌다.
 *
 * **상한을 회차 설정으로 정규화한다.** 콕을 1회로 연 회차와 5회로 연 회차가
 * 같은 자에 있어야 나이차·다양성과 섞인다.
 */
export function pull(sent: number, back: number, cap: number): number {
  if (sent <= 0) return 0;
  return Math.min(1, (sent + (back > 0 ? 2 : 0)) / (cap + 2));
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** 씨앗 있는 난수 (mulberry32). `Math.random()` 을 부르면 순수 함수가 아니게 된다 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildSeating(input: BuildInput): Seat[] {
  const { players, tableCount } = input;
  const n = players.length;
  if (n === 0 || tableCount < 1) return [];

  const w = new World(input);

  /*
   * **재시작을 여러 번 한다** (ADR-56). 예산을 늘려도 결과가 같았다는 실측이 있었는데,
   * 그건 한 시작점에서 갈 수 있는 데까지 간다는 뜻이었다 — 막는 것은 지역 최소값이다.
   * 예산을 **나눠서** 여러 시작점을 보는 편이 같은 CPU로 더 좋은 자리를 찾는다.
   */
  const restarts = clamp(Math.round(240 / n), 3, 12);
  const budget = Math.floor(Math.min(12_000, 150 * n) / restarts);

  let best: number[][] | null = null;
  let bestValue = -Infinity;
  for (let r = 0; r < restarts; r++) {
    const tables = oneStart(w, tableCount, budget, (input.seed + r * 0x9e3779b1) >>> 0);
    const value = total(w, tables);
    if (value > bestValue) {
      bestValue = value;
      best = tables;
    }
  }

  return best!.flatMap((group, t) => group.map((i) => ({ playerId: players[i].id, table: t + 1 })));
}

function oneStart(w: World, tableCount: number, budget: number, seed: number): number[][] {
  const rand = rng(seed);
  const menCount = w.male.reduce((s: number, x: number) => s + x, 0);
  const caps = tableCaps(tableCount, menCount, w.n - menCount);

  const tables: number[][] = Array.from({ length: tableCount }, () => []);
  const left = caps.map((c) => ({ ...c }));
  const seatOf = new Int32Array(w.n).fill(-1);

  const room = (t: number, i: number) => (w.male[i] ? left[t].m : left[t].w) >= 1;
  const sit = (t: number, i: number) => {
    tables[t].push(i);
    seatOf[i] = t;
    if (w.male[i]) left[t].m--;
    else left[t].w--;
  };

  /*
   * ① 서로 콕을 찌른 쌍을 먼저 붙여 앉힌다. 한쪽이 이미 앉아 있으면 그 테이블로 데려간다 —
   *    한 사람이 여러 쌍에 걸쳐 있을 수 있고(ADR-24), 그때 나머지를 버리면 동석률이 그대로 떨어진다.
   *
   *    **순서가 곧 우선순위다** (ADR-25). 정원이 모자라 한 쌍만 앉힐 수 있을 때
   *    앞에 온 쌍이 자리를 가져가므로, 주고받은 콕이 많은 쌍부터 본다.
   */
  for (const [a, b] of w.mutualPairs) {
    const known = seatOf[a] >= 0 ? seatOf[a] : seatOf[b];
    if (known >= 0) {
      const rest = seatOf[a] >= 0 ? b : a;
      if (seatOf[rest] < 0 && room(known, rest)) sit(known, rest);
      continue;
    }
    const t = shuffle([...left.keys()], rand).find((i) => room(i, a) && room(i, b));
    if (t !== undefined) {
      sit(t, a);
      sit(t, b);
    }
  }

  /*
   * ② 남은 사람은 나이순 블록으로 채운다 — 시작점에서 나이차 벌점이 거의 0이 된다.
   *
   *    나이에 지터를 주고 테이블 순서를 섞는다. 안 그러면 **최연소가 늘 1번 테이블**이고,
   *    같은 사람들이 매번 같은 자리에 몰린다 (ADR-56).
   */
  for (const male of [1, 0] as const) {
    const list = Array.from({ length: w.n }, (_, i) => i)
      .filter((i) => w.male[i] === male && seatOf[i] < 0)
      .map((i) => [i, w.age[i] + (rand() * 2 - 1) * AGE_JITTER] as const)
      .sort((x, y) => x[1] - y[1])
      .map(([i]) => i);
    let k = 0;
    for (const t of shuffle([...tables.keys()], rand)) {
      const capacity = male ? left[t].m : left[t].w;
      for (let c = 0; c < capacity && k < list.length; c++) sit(t, list[k++]);
    }
    // 정원 계산과 어긋나 남은 사람이 있으면 조용히 버리지 않는다
    for (; k < list.length; k++) sit(shortest(tables), list[k]);
  }

  optimize(w, tables, budget, rand);
  return tables;
}

/** 나이순 블록을 살짝 흐트러뜨리는 폭(년). 0 이면 같은 사람들이 매번 같은 자리에 몰린다 */
const AGE_JITTER = 1.5;

// ─────────────────────────────────── 값
//
// 사람을 번호로 바꿔두고, **쌍마다의 값을 미리 n×n 판에 펼쳐 둔다.**
// 안쪽 루프는 곱셈 하나와 덧셈 몇 개뿐이라 100명에도 CPU 예산 안에 든다.

class World {
  readonly n: number;
  readonly age: Int32Array;
  readonly male: Uint8Array;
  /** `i*n+j` → **i 가** j 와 같은 테이블일 때 얻는 값 (나눗셈 전). 방향이 있다 */
  readonly give: Float32Array;
  /** `i*n+j` → i 가 j 를 **처음** 만날 때의 값. 인원으로 나누지 않는다 */
  readonly fresh: Float32Array;
  /** 서로 콕을 찌른 이성 쌍. 주고받은 수가 많은 쌍이 앞이다 */
  readonly mutualPairs: Array<[number, number]> = [];

  constructor(input: BuildInput) {
    const { players, history, votes, pokes, maxVote, maxPoke } = input;
    const n = (this.n = players.length);
    this.age = new Int32Array(n);
    this.male = new Uint8Array(n);
    this.give = new Float32Array(n * n);
    this.fresh = new Float32Array(n * n);

    const index = new Map<string, number>();
    players.forEach((p, i) => {
      index.set(p.id, i);
      this.age[i] = p.age;
      this.male[i] = p.gender === "M" ? 1 : 0;
    });

    // 이전 라운드에서 같은 테이블이었던 횟수
    const met = new Uint8Array(n * n);
    for (const seats of history) {
      const byTable = new Map<number, number[]>();
      for (const s of seats) {
        const i = index.get(s.playerId);
        if (i === undefined) continue;
        byTable.set(s.table, [...(byTable.get(s.table) ?? []), i]);
      }
      for (const ids of byTable.values()) {
        for (let x = 0; x < ids.length; x++) {
          for (let y = x + 1; y < ids.length; y++) {
            const k = ids[x] * n + ids[y];
            const k2 = ids[y] * n + ids[x];
            met[k] = met[k2] = Math.min(255, met[k] + 1);
          }
        }
      }
    }

    const counts = (src: Record<string, number>) => {
      const board = new Uint8Array(n * n);
      for (const [key, times] of Object.entries(src)) {
        const [from, to] = key.split(">");
        const i = index.get(from);
        const j = index.get(to);
        if (i === undefined || j === undefined) continue;
        board[i * n + j] = Math.min(255, times);
      }
      return board;
    };
    const voteOut = counts(votes);
    const pokeOut = counts(pokes);

    /*
     * **얼마나 채웠나** — 나이대 이성 중 아직 못 만난 비율. 두 곳에 쓴다:
     * 아직 많이 남은 사람의 새 만남을 더 값지게 보고(결핍), 그 사람의 자리를 더 크게 본다(공정성).
     */
    const need = new Float32Array(n);
    const served = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let all = 0;
      let seen = 0;
      for (let j = 0; j < n; j++) {
        if (j === i || this.male[i] === this.male[j]) continue;
        if (Math.abs(this.age[i] - this.age[j]) > MEET_GAP) continue;
        all++;
        if (met[i * n + j] > 0) seen++;
      }
      need[i] = all ? 1 - seen / all : 0;
      served[i] = all ? seen / all : 1;
    }
    const meanServed = served.reduce((s: number, x: number) => s + x, 0) / Math.max(1, n);

    /*
     * **진행도.** 라운드 번호가 아니라 **쌓인 상호 콕**으로 잰다 (ADR-56) —
     * 운영자가 시간을 보고 아무 때나 끝내므로 몇 번째인지는 아무것도 말해주지 않는다.
     * 콕은 만나본 사람에게만 갈 수 있어서 파티가 진행될수록 저절로 쌓인다.
     */
    let mutualCount = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (this.male[i] === this.male[j]) continue;
        if (pokeOut[i * n + j] > 0 && pokeOut[j * n + i] > 0) {
          mutualCount++;
          this.mutualPairs.push([i, j]);
        }
      }
    }
    const progress = Math.min(1, mutualCount / Math.max(1, n / 3));
    const wNew = SEAT_W.NEW_BASE + SEAT_W.NEW_SPAN * (1 - progress);
    const wPoke = SEAT_W.POKE_BASE + SEAT_W.POKE_SPAN * progress;

    // 주고받은 콕이 많은 쌍이 앞. 정원이 모자라면 앞의 쌍이 자리를 가져간다 (ADR-25)
    this.mutualPairs.sort(
      (x, y) =>
        pokeOut[y[0] * n + y[1]] + pokeOut[y[1] * n + y[0]] -
        (pokeOut[x[0] * n + x[1]] + pokeOut[x[1] * n + x[0]]),
    );

    for (let i = 0; i < n; i++) {
      const lam = clamp((meanServed + FAIR.c) / (served[i] + FAIR.c), FAIR.min, FAIR.max);
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const k = i * n + j;
        const gap = Math.abs(this.age[i] - this.age[j]) / 10;
        const opposite = this.male[i] !== this.male[j];
        const mutual = opposite && pokeOut[k] > 0 && pokeOut[j * n + i] > 0;

        let v = 0;
        v += wPoke * pull(pokeOut[k], pokeOut[j * n + i], maxPoke);
        v += SEAT_W.VOTE * pull(voteOut[k], voteOut[j * n + i], maxVote);
        if (mutual) v += SEAT_W.MUTUAL;
        v -= SEAT_W.AGE * gap * gap * gap;
        v -= SEAT_W.REP * Math.min(1, met[k] / 2);
        this.give[k] = lam * v;

        const first = opposite && met[k] === 0 && Math.abs(this.age[i] - this.age[j]) <= MEET_GAP;
        this.fresh[k] = first ? lam * wNew * (1 + need[i]) : 0;
      }
    }
  }
}

/**
 * 이 사람이 이 테이블에서 만드는 값 — **양쪽 방향을 다 센다.**
 * 맞교환은 두 사람만 움직이므로 이 값만 다시 재면 된다 (나머지 쌍은 그대로다).
 *
 * ⚠️ `give` 는 인원으로 나누고 `fresh` 는 나누지 않는다 (ADR-56). 나누면 이성이 3명인
 * 테이블과 2명인 테이블이 같은 값이 되어, 성비가 치우친 테이블에 계속 앉는 사람이 생긴다.
 */
function cell(w: World, i: number, group: number[]): number {
  const k = Math.max(1, group.length - 1);
  let sum = 0;
  for (const j of group) {
    if (j === i) continue;
    sum += (w.give[i * w.n + j] + w.give[j * w.n + i]) / k;
    sum += w.fresh[i * w.n + j] + w.fresh[j * w.n + i];
  }
  return sum;
}

function total(w: World, tables: number[][]): number {
  let sum = 0;
  for (const group of tables) {
    const k = Math.max(1, group.length - 1);
    for (let x = 0; x < group.length; x++) {
      for (let y = x + 1; y < group.length; y++) {
        const i = group[x];
        const j = group[y];
        sum += (w.give[i * w.n + j] + w.give[j * w.n + i]) / k;
        sum += w.fresh[i * w.n + j] + w.fresh[j * w.n + i];
      }
    }
  }
  return sum;
}

/**
 * 같은 성별 두 자리를 맞바꿔가며 올라간다.
 *
 * 무작위 표집이 아니라 **전수 훑기를 반복**한다 — 무작위는 마지막 몇 개의 나이차 위반을
 * 끝내 못 찾고 남긴다. 대신 평가 횟수에 예산을 둬서 CPU 10ms 를 넘지 않게 한다.
 *
 * **값이 같은 이동도 절반의 확률로 받는다.** 평평한 지대를 걸어 다녀야 지역 최소를 빠져나온다.
 */
function optimize(w: World, tables: number[][], budget: number, rand: () => number) {
  const slots: Array<[number, number]> = [];
  for (let t = 0; t < tables.length; t++) {
    for (let i = 0; i < tables[t].length; i++) slots.push([t, i]);
  }
  if (slots.length < 2) return;

  let evals = 0;
  let improved = true;
  while (improved && evals < budget) {
    improved = false;
    for (let x = 0; x < slots.length && evals < budget; x++) {
      const [ta, ia] = slots[x];
      for (let y = x + 1; y < slots.length && evals < budget; y++) {
        const [tb, ib] = slots[y];
        if (ta === tb) continue;
        const a = tables[ta][ia];
        const b = tables[tb][ib];
        if (a === undefined || b === undefined || w.male[a] !== w.male[b]) continue; // 성비 불변식
        evals++;

        const before = cell(w, a, tables[ta]) + cell(w, b, tables[tb]);
        tables[ta][ia] = b;
        tables[tb][ib] = a;
        const after = cell(w, b, tables[ta]) + cell(w, a, tables[tb]);

        if (after > before + 1e-9) improved = true;
        else if (Math.abs(after - before) > 1e-9 || rand() < 0.5) {
          tables[ta][ia] = a;
          tables[tb][ib] = b;
        }
      }
    }
  }
}

function shortest(tables: number[][]): number {
  let best = 0;
  for (let i = 1; i < tables.length; i++) if (tables[i].length < tables[best].length) best = i;
  return best;
}
