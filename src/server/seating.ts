/**
 * 자리 배정. 설계와 실측치는 `docs/SEATING.md`.
 *
 * 핵심 불변식: 성비는 소프트 제약이 아니다.
 *   ① tableCaps() 로 테이블별 남/여 정원을 먼저 고정하고
 *   ② 개선 단계에서는 **같은 성별끼리만 맞바꾼다**
 * 따라서 성비는 "지켜지도록 노력"하는 게 아니라 깨질 수 없다.
 *
 * ⚠️ 무료 플랜은 요청당 CPU 10ms. 그래서 안쪽 루프는 사람 객체가 아니라 **번호**로 돈다.
 *    (문자열 키로 Map 을 두드리던 판은 100명에 23ms 였다. 지금은 typed array 색인이다)
 *
 * 순수 함수다 — DO·요청·현재시각에 접근하지 않는다. 난수도 쓰지 않는다:
 * 초기 배치와 훑는 순서가 정해져 있어 같은 입력이면 같은 자리가 나온다.
 */
import type { Player, Seat } from "../shared/types.ts";
import { AGE_GAP, FINAL_MUTUAL_BOOST, PULL_CAP, REP_CAP_RATIO, SEAT_W } from "../shared/constants.ts";

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

export interface BuildInput {
  players: Player[];
  tableCount: number;
  round: number;
  final: boolean;
  /** 이전 라운드들의 좌석. 재회 회피에 쓴다. */
  history: Seat[][];
  /**
   * 서로 찌른 쌍. **주고받은 콕이 많은 쌍이 앞**이라고 보고 그 순서대로 자리를 잡는다 (ADR-25).
   * 한 사람이 여러 명과 이어졌는데 정원이 모자라면, 앞의 쌍이 자리를 가져간다.
   */
  mutual: Array<[string, string]>;
  /**
   * 쌍이 **주고받은 표의 총합.** `"a|b"`(정렬된 두 아이디) → 횟수.
   * 상호든 단방향이든 다 들어온다 — 끌림은 표 하나하나가 만든다 (ADR-40).
   */
  votes?: Record<string, number>;
  oneWay: Array<[string, string]>;
}

/** 서로 찌른 쌍의 최소 교환 — 한 번씩 주고받은 것 */
const MIN_EXCHANGE = 2;

/**
 * 두 사람을 붙여 앉히는 힘. **표 하나하나가 값을 만들고, 상호면 부가 점수가 얹힌다** (ADR-40).
 *
 * ```
 * 한쪽만 1표  →  4        상호 1:1 (2표)  →  16
 * 한쪽만 2표  →  8        상호 2:1 (3표)  →  20
 * 한쪽만 3표  →  12       상호 2:2 (4표)  →  24 (상한)
 * ```
 *
 * **상한이 나이차 벌점(30)보다 낮다.** 넘게 두면 한 쌍이 나이차를 통째로 밀어내고
 * 그 테이블만 이상해진다 (ADR-11). 나이차 큰 상호 쌍은 마지막 라운드가 붙여준다 —
 * 거기서는 가중치가 아니라 구조가 한다.
 */
export function pullScore(votes: number, mutual: boolean): number {
  if (votes <= 0) return 0;
  return Math.min(PULL_CAP, SEAT_W.VOTE * votes + (mutual ? SEAT_W.MUTUAL : 0));
}

const MUTUAL = 1;
const ONE_WAY = 2;

export function buildSeating(input: BuildInput): Seat[] {
  const { players, tableCount, round, final } = input;
  const n = players.length;
  if (n === 0 || tableCount < 1) return [];

  const w = new World(input);
  const menCount = w.male.reduce((s, x) => s + x, 0);
  const caps = tableCaps(tableCount, menCount, n - menCount);

  const tables: number[][] = Array.from({ length: tableCount }, () => []);
  const left = caps.map((c) => ({ ...c }));
  const seatOf = new Int32Array(n).fill(-1);

  const room = (t: number, i: number) => (w.male[i] ? left[t].m : left[t].w) >= 1;
  const sit = (t: number, i: number) => {
    tables[t].push(i);
    seatOf[i] = t;
    if (w.male[i]) left[t].m--;
    else left[t].w--;
  };

  // ① 서로 찌른 쌍을 먼저 붙여 앉힌다. 한쪽이 이미 앉아 있으면 그 테이블로 데려간다 —
  //    한 사람이 여러 쌍에 걸쳐 있을 수 있고, 그때 나머지를 버리면 동석률이 그대로 떨어진다.
  //
  //    **순서가 곧 우선순위다** (ADR-25). 정원이 모자라 한 쌍만 앉힐 수 있을 때
  //    앞에 온 쌍이 자리를 가져가므로, 주고받은 콕이 많은 쌍부터 본다.
  const byStrength = [...w.mutualPairs].sort(
    (x, y) => w.votes[y[0] * w.n + y[1]] - w.votes[x[0] * w.n + x[1]],
  );
  for (const [a, b] of byStrength) {
    if (w.male[a] === w.male[b]) continue;
    const known = seatOf[a] >= 0 ? seatOf[a] : seatOf[b];
    if (known >= 0) {
      const rest = seatOf[a] >= 0 ? b : a;
      if (seatOf[rest] < 0 && room(known, rest)) sit(known, rest);
      continue;
    }
    const t = left.findIndex((_, i) => room(i, a) && room(i, b));
    if (t >= 0) {
      sit(t, a);
      sit(t, b);
    }
  }

  // ② 남은 사람은 나이순으로 블록을 잘라 채운다 — 시작점에서 나이차 벌점이 거의 0이 된다
  const rest = (male: 0 | 1) =>
    players
      .map((_, i) => i)
      .filter((i) => w.male[i] === male && seatOf[i] < 0)
      .sort((x, y) => w.age[x] - w.age[y] || x - y);

  for (const male of [1, 0] as const) {
    const list = rest(male);
    let k = 0;
    for (let t = 0; t < tableCount && k < list.length; t++) {
      const capacity = male ? left[t].m : left[t].w;
      for (let c = 0; c < capacity && k < list.length; c++) sit(t, list[k++]);
    }
    // 정원 계산과 어긋나 남은 사람이 있으면 조용히 버리지 않는다
    for (; k < list.length; k++) sit(shortest(tables), list[k]);
  }

  // ③ 같은 성별 2인 맞교환으로 개선한다. 성비는 이 단계에서 바뀔 방법이 없다
  optimize(tables, w, round, final, n);

  return tables.flatMap((group, t) => group.map((i) => ({ playerId: players[i].id, table: t + 1 })));
}

// ─────────────────────────────────── 벌점 재료
//
// 사람을 번호로 바꿔두고 관계를 n×n 바이트 판에 펼쳐둔다.
// 100명이면 10KB 짜리 판이고, 안쪽 루프에서 문자열도 Map 도 만들지 않는다.

class World {
  readonly age: Int32Array;
  readonly male: Uint8Array;
  readonly intro: Uint8Array;
  /** i*n+j → MUTUAL | ONE_WAY */
  readonly rel: Uint8Array;
  /** i*n+j → 이전 라운드에서 같은 테이블이었던 횟수 */
  readonly met: Uint8Array;
  readonly partners: number[][];
  readonly mutualPairs: Array<[number, number]> = [];
  /** i*n+j → 그 쌍이 주고받은 **표의 총합.** 상호든 단방향이든 다 들어간다 (ADR-40) */
  readonly votes: Uint8Array;
  readonly n: number;

  constructor(input: BuildInput) {
    const { players } = input;
    const n = (this.n = players.length);
    this.age = new Int32Array(n);
    this.male = new Uint8Array(n);
    this.intro = new Uint8Array(n);
    this.rel = new Uint8Array(n * n);
    this.met = new Uint8Array(n * n);
    this.votes = new Uint8Array(n * n);
    this.partners = players.map(() => []);

    const index = new Map<string, number>();
    players.forEach((p, i) => {
      index.set(p.id, i);
      this.age[i] = p.age;
      this.male[i] = p.gender === "M" ? 1 : 0;
      this.intro[i] = p.mbti[0] === "I" ? 1 : 0;
    });

    const pair = (a: string, b: string): [number, number] | null => {
      const i = index.get(a);
      const j = index.get(b);
      return i === undefined || j === undefined ? null : [i, j];
    };

    /** 표 수는 부르는 쪽이 준다. 없으면 최소치로 본다 — 상호는 2표, 단방향은 1표 */
    const votesOf = (a: string, b: string, least: number) =>
      Math.min(255, input.votes?.[[a, b].sort().join("|")] ?? least);

    for (const [a, b] of input.mutual) {
      const ij = pair(a, b);
      if (!ij) continue;
      this.set(this.rel, ij[0], ij[1], MUTUAL);
      this.set(this.votes, ij[0], ij[1], votesOf(a, b, MIN_EXCHANGE));
      this.partners[ij[0]].push(ij[1]);
      this.partners[ij[1]].push(ij[0]);
      this.mutualPairs.push(ij);
    }
    for (const [a, b] of input.oneWay) {
      const ij = pair(a, b);
      if (!ij || this.get(this.rel, ij[0], ij[1]) === MUTUAL) continue;
      this.set(this.rel, ij[0], ij[1], ONE_WAY);
      // **단방향도 표를 센다** (ADR-40). 세 번 투표한 것과 한 번 투표한 것이 같으면 안 된다
      this.set(this.votes, ij[0], ij[1], votesOf(a, b, 1));
    }

    for (const seats of input.history) {
      const groups = new Map<number, number[]>();
      for (const s of seats) {
        const i = index.get(s.playerId);
        if (i === undefined) continue;
        groups.set(s.table, [...(groups.get(s.table) ?? []), i]);
      }
      for (const ids of groups.values()) {
        for (let x = 0; x < ids.length; x++) {
          for (let y = x + 1; y < ids.length; y++) {
            const a = ids[x];
            const b = ids[y];
            this.set(this.met, a, b, Math.min(255, this.get(this.met, a, b) + 1));
          }
        }
      }
    }
  }

  private set(board: Uint8Array, i: number, j: number, v: number) {
    board[i * this.n + j] = v;
    board[j * this.n + i] = v;
  }

  private get(board: Uint8Array, i: number, j: number): number {
    return board[i * this.n + j];
  }
}

/**
 * 두 사람이 같은 테이블일 때의 벌점.
 * 재회 벌점에는 상한이 있다 — 무제한이면 라운드가 쌓일수록 나이 제약을 밀어낸다
 * (프로토타입에서 3라운드에 나이차 위반 26쌍이 났다).
 */
function pairCost(w: World, i: number, j: number, rep: { opp: number; same: number }, final: boolean): number {
  const k = i * w.n + j;
  const rel = w.rel[k];
  const mutual = rel === MUTUAL;
  let cost = 0;

  // 마지막 라운드의 상호 매칭 쌍은 나이차를 묻지 않는다. 이 라운드의 목적이 그들을 모으는 것이다
  if (!(final && mutual) && Math.abs(w.age[i] - w.age[j]) >= AGE_GAP) cost += SEAT_W.AGE;

  // 표 하나하나가 끌림을 만들고, 상호면 부가 점수가 얹힌다 (ADR-40)
  if (rel) cost -= pullScore(w.votes[k], mutual) * (final && mutual ? FINAL_MUTUAL_BOOST : 1);

  // 마지막 라운드는 재회를 막지 않는다. 서로 찌른 쌍도 언제나 면제 — 억지로 떼어놓지 않는다
  if (!final && !mutual) {
    const times = w.met[k];
    if (times) cost += (w.male[i] === w.male[j] ? rep.same : rep.opp) * times;
  }
  return cost;
}

/** 라운드마다 커지되 상한을 넘지 않는 재회 가중치. 한 번만 계산해 두고 돌려쓴다 */
function repWeights(round: number) {
  const base = SEAT_W.REP * (1 + 0.5 * Math.max(0, round - 1));
  const cap = SEAT_W.AGE * REP_CAP_RATIO;
  return { opp: Math.min(base * 1.6, cap), same: Math.min(base * 0.35, cap / 2) };
}

/** I·E 가 한쪽으로 쏠린 테이블에 가벼운 벌점 */
function ieCost(w: World, group: number[]): number {
  if (group.length < 2) return 0;
  let intro = 0;
  for (const i of group) intro += w.intro[i];
  return (SEAT_W.IE * Math.abs(2 * intro - group.length)) / group.length;
}

function memberCost(w: World, i: number, group: number[], rep: { opp: number; same: number }, final: boolean) {
  let sum = 0;
  for (const j of group) if (j !== i) sum += pairCost(w, i, j, rep, final);
  return sum;
}

/** 이 사람의 상호 매칭 상대가 지금 같은 테이블에 있는가 */
function withPartner(w: World, i: number, group: number[]): boolean {
  const mates = w.partners[i];
  if (mates.length === 0) return false;
  for (const j of group) if (j !== i && mates.includes(j)) return true;
  return false;
}

/**
 * 같은 성별 두 자리를 맞바꿔가며 내려간다.
 *
 * 무작위 표집이 아니라 **전수 훑기를 반복**한다 — 무작위는 마지막 몇 개의 나이차 위반을
 * 끝내 못 찾고 남긴다. 대신 평가 횟수에 예산을 둬서 CPU 10ms 를 넘지 않게 한다.
 */
function optimize(tables: number[][], w: World, round: number, final: boolean, n: number) {
  const slots: Array<[number, number]> = [];
  for (let t = 0; t < tables.length; t++) {
    for (let i = 0; i < tables[t].length; i++) slots.push([t, i]);
  }
  if (slots.length < 2) return;

  const rep = repWeights(round);
  // 예산을 10배로 올려도 결과가 같았다 — 지역 최소에서 멈추는 것이지 예산이 모자란 게 아니다
  const budget = Math.min(12_000, 150 * n);
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
        if (a === undefined || b === undefined || w.male[a] !== w.male[b]) continue;   // 성비 불변식

        // 마지막 라운드에서 이미 붙어 앉은 상호 매칭 쌍은 떼어놓지 않는다.
        // 가중치 싸움으로 두면 나이차 30 이 보너스 30 을 밀어내며 실제로 쪼개졌다
        if (final && (withPartner(w, a, tables[ta]) || withPartner(w, b, tables[tb]))) continue;
        evals++;

        const before =
          memberCost(w, a, tables[ta], rep, final) +
          memberCost(w, b, tables[tb], rep, final) +
          ieCost(w, tables[ta]) +
          ieCost(w, tables[tb]);

        tables[ta][ia] = b;
        tables[tb][ib] = a;

        const after =
          memberCost(w, b, tables[ta], rep, final) +
          memberCost(w, a, tables[tb], rep, final) +
          ieCost(w, tables[ta]) +
          ieCost(w, tables[tb]);

        if (after < before - 1e-9) improved = true;
        else {
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
