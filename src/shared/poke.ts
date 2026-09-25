/**
 * 콕을 보낸 **직후의 내 콕 상태**를 미리 계산한다.
 *
 * 화면이 서버 답을 기다리지 않고 그 자리에서 바뀌게 하려고 쓴다 (슬라이스 17).
 * 서버가 답하면 그 값으로 곧바로 덮어쓰므로, 여기 값이 화면에 남아 있는 시간은 한 왕복뿐이다.
 *
 * ⚠️ **ADR-26 의 좁은 예외다.** 실시간을 "다시 읽어라" 신호로만 쓰는 이유는
 * 부분 갱신이 화면과 서버를 조용히 어긋나게 해서인데, 그 규칙은 그대로다.
 * 여기만 예외인 근거는 한 줄이다 —
 *
 *   **내가 방금 한 행동의 결과만 미리 그린다.**
 *
 * 남이 한 일(받은 콕·매칭)이나 서버만 아는 것(명단)은 여전히 다시 읽어야 안다.
 * 그래서 이 함수는 **두 칸만** 만진다. 늘리고 싶어지면 그건 이 예외를 넓히는 것이다.
 *
 * 순수 함수라 테스트를 먼저 쓰고 구현했다 (`buildSeating` 과 같은 예외).
 */
import type { Gender, MyPokeState, PokeRound } from "./types.ts";

export function afterPoke(poke: MyPokeState, toId: string, round: PokeRound): MyPokeState {
  const budget = poke.budget[round];
  return {
    ...poke,
    sentTo: { ...poke.sentTo, [toId]: (poke.sentTo[toId] ?? 0) + 1 },
    budget: { ...poke.budget, [round]: { ...budget, used: budget.used + 1 } },
  };
}

/** 매력 투표 1위가 되려면 적어도 몇 표를 받아야 하나 (ADR-100). 1표뿐이면 1표 받은 여럿이 모두 1위가 된다 */
export const TOP_VOTE_MIN = 2;

/**
 * 매력 투표 1위 (ADR-100). **성별마다** 받은 표가 가장 많은 사람이고, 공동 1위는 모두다.
 * 가장 많은 표가 `TOP_VOTE_MIN` 에 못 미치는 성별에서는 아무도 없다.
 *
 * 서버가 파티를 여는 순간 한 번 부르고(`meta.topVoters`), 운영자 화면은 파티 전에 **누가 받게 될지** 미리 보는 데 쓴다 —
 * 같은 함수라 확인창이 말한 사람과 실제로 받는 사람이 어긋나지 않는다.
 */
export function topVoters(
  players: readonly { id: string; gender: Gender }[],
  received: Readonly<Record<string, number>>,
): string[] {
  const out: string[] = [];
  for (const g of ["M", "F"] as const) {
    const mine = players.filter((p) => p.gender === g);
    const best = Math.max(0, ...mine.map((p) => received[p.id] ?? 0));
    if (best < TOP_VOTE_MIN) continue;
    out.push(...mine.filter((p) => (received[p.id] ?? 0) === best).map((p) => p.id));
  }
  return out;
}
