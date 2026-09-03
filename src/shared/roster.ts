/**
 * 참가자 목록의 순서 (ADR-73 · 슬라이스 26).
 *
 * 세 층이다 — **서로 찌른 사람 > 같은 테이블 > 나머지.** 각 층 안은 무작위인데,
 * 그 무작위는 **보는 사람마다 고정**이다: 정렬 열쇠가 `해시(나, 상대)` 라서
 *   · 새로고침·재조회에 순서가 안 바뀐다 (남이 일으킨 변화에 목록이 움직이면 안 된다 — ADR-64)
 *   · 새로 등록한 사람은 **끼어들** 뿐 남들의 상대 순서를 밀지 않는다
 *   · 옆 사람 화면과는 다른 순서라 "늘 맨 아래인 사람" 이 없다
 *
 * 등록 순서를 쓰지 않는 이유는 하나 더 있다 — 그 순서가 곧 *누가 먼저 왔나* 라서다.
 *
 * 순수 함수다. 어느 층을 켤지는 부르는 쪽이 정한다 — 발표 후엔 `mateIds` 를 넘기지 않고,
 * 발표 전엔 `matchedIds` 가 비어 있다 (`matches` 는 발표 후에만 채워진다).
 */
import { seedOf } from "./fortune.ts";
import type { PublicPlayer } from "./types.ts";

export interface RosterOrder {
  /** 보는 사람. 무작위 순서의 씨앗이다 */
  viewerId: string;
  /** 같은 테이블 사람들 — 위로 묶는다. 없으면 묶지 않는다 */
  mateIds?: readonly string[];
  /** 서로 찌른 사람들 — 가장 위. 발표 후에만 있다 */
  matchedIds?: readonly string[];
}

export function orderRoster(roster: readonly PublicPlayer[], order: RosterOrder): PublicPlayer[] {
  const mate = new Set(order.mateIds ?? []);
  const matched = new Set(order.matchedIds ?? []);
  const key = (p: PublicPlayer) => seedOf(`${order.viewerId}:${p.id}`);
  return roster
    .map((p) => ({ p, k: key(p), tier: matched.has(p.id) ? 0 : mate.has(p.id) ? 1 : 2 }))
    .sort((a, b) => a.tier - b.tier || a.k - b.k)
    .map(({ p }) => p);
}
