import type { Gender } from "./types.ts";

/**
 * 자리 없는 사람을 **어느 테이블에 넣을지** 고른다 (`SEATING.md` 의 앉히기 규칙).
 *
 * **떼어 놓을 상대가 없는 테이블**(ADR-90) → 자기 성별이 가장 적은 테이블 → 같으면 사람이 적은 쪽 → 그것도 같으면 낮은 번호.
 * 떼어 놓을 상대는 성비보다 앞에 둔다 — 자동으로 앉히는 순간 운영자가 넣은 규칙이 깨지면 안 된다.
 * 모든 테이블에 상대가 있으면 가장 적게 걸리는 쪽이다.
 * **난수를 쓰지 않는다.** 같은 상태면 같은 답이라, 시트가 *3번에 앉혀요* 라고 미리 말한 뒤
 * 서버가 다른 번호에 앉히는 일이 없다 — 그 어긋남은 화면이 하는 거짓말이 된다.
 *
 * 서버(`seatPlayer`)와 화면(앉힐 자리 고르기 시트)이 **같은 함수**를 쓴다.
 * 규칙을 두 곳에 적으면 한쪽만 고쳐지고, 그때 틀리는 쪽은 언제나 화면이다.
 */
export function autoTable(
  seats: readonly { playerId: string; table: number }[],
  tableCount: number,
  genderOf: (playerId: string) => Gender | undefined,
  mine: Gender,
  /** 이 사람과 떼어 놓을 사람들 (ADR-90) — `apartFrom`. 기본값을 두지 않는다: 빠뜨리면 그 규칙이 조용히 사라진다 */
  avoid: ReadonlySet<string>,
): number {
  let best = 1;
  let bestKey: [number, number, number] = [Infinity, Infinity, Infinity];
  for (let t = 1; t <= tableCount; t++) {
    const here = seats.filter((s) => s.table === t);
    const key: [number, number, number] = [
      here.filter((s) => avoid.has(s.playerId)).length,
      here.filter((s) => genderOf(s.playerId) === mine).length,
      here.length,
    ];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) {
      best = t;
      bestKey = key;
    }
  }
  return best;
}

/**
 * 떼어 놓을 상대와 **같은 테이블에 앉은** 사람 → 그 상대들 (ADR-90).
 *
 * 서버의 섞기와 운영자 자리 칩이 **같은 함수**를 쓴다 — 섞기가 "안 걸린다" 고 본 자리에
 * 칩이 ⛔ 를 띄우면 둘 중 하나가 거짓말이다. 쌍에는 방향이 없어 양쪽 사람에게 다 적는다.
 * 자리가 없는 사람은 걸리지 않는다.
 */
export function apartClashes(
  seats: readonly { playerId: string; table: number }[],
  pairs: ReadonlyArray<readonly [string, string]>,
): Map<string, string[]> {
  const table = new Map(seats.map((s) => [s.playerId, s.table]));
  const out = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    if (!table.has(a) || table.get(a) !== table.get(b)) continue;
    out.set(a, [...(out.get(a) ?? []), b]);
    out.set(b, [...(out.get(b) ?? []), a]);
  }
  return out;
}

/** 이 사람과 떼어 놓을 사람들 (ADR-90). 쌍에는 방향이 없어 양쪽을 다 본다 */
export function apartFrom(playerId: string, pairs: ReadonlyArray<readonly [string, string]>): Set<string> {
  const out = new Set<string>();
  for (const [a, b] of pairs) {
    if (a === playerId) out.add(b);
    else if (b === playerId) out.add(a);
  }
  return out;
}

/** 쌍의 정규형 — 방향이 없어 정렬한다 (ADR-90). `apart` 표에 넣을 때도 견줄 때도 이 하나를 거친다 */
export const sortPair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
export const pairKey = (a: string, b: string): string => sortPair(a, b).join("|");

/**
 * "이 둘은 떼어 놓을 쌍인가". 서버의 섞기(`pairedSeatIds`)와 운영자 자리 화면(`couples`)이 **같은 함수**를 쓴다 —
 * 한쪽이 정렬 안 한 키로 찾으면 그쪽만 조용히 `아니다` 라고 답하고, 그때 붙잡아 둔 쌍과 화면의 쌍이 갈린다.
 */
export function isApart(pairs: ReadonlyArray<readonly [string, string]>): (a: string, b: string) => boolean {
  const keys = new Set(pairs.map(([a, b]) => pairKey(a, b)));
  return (a, b) => keys.has(pairKey(a, b));
}
