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
import type { MyPokeState, PokeRound } from "./types.ts";

export function afterPoke(poke: MyPokeState, toId: string, round: PokeRound): MyPokeState {
  const budget = poke.budget[round];
  return {
    ...poke,
    sentTo: { ...poke.sentTo, [toId]: (poke.sentTo[toId] ?? 0) + 1 },
    budget: { ...poke.budget, [round]: { ...budget, used: budget.used + 1 } },
  };
}
