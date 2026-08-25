/**
 * 콕을 보낸 직후 화면이 미리 그리는 값 (슬라이스 17).
 *
 * 이건 **ADR-26 의 좁은 예외**라, 좁다는 것 자체가 규칙이다.
 * 그래서 테스트가 보는 건 "잘 더하는가" 보다 **"무엇을 안 건드리는가"** 쪽이다 —
 * 여기가 넓어지는 순간 화면과 서버가 조용히 어긋나기 시작한다.
 */
import { describe, expect, it } from "vitest";
import { afterPoke } from "../src/shared/poke.ts";
import type { MyPokeState } from "../src/shared/types.ts";

function state(over: Partial<MyPokeState> = {}): MyPokeState {
  return {
    budget: { pre: { max: 3, used: 1 }, party: { max: 5, used: 0 } },
    sentTo: { a: 1 },
    received: { pre: 0, party: 4 },
    matches: [],
    ...over,
  };
}

describe("콕을 보낸 직후 미리 그리는 값", () => {
  it("★ 보낸 사람과 쓴 횟수만 1 늘어난다", () => {
    const next = afterPoke(state(), "b", "pre");
    expect(next.sentTo).toEqual({ a: 1, b: 1 });
    expect(next.budget.pre).toEqual({ max: 3, used: 2 });
  });

  it("★ 이미 찌른 사람은 그 위에 쌓인다", () => {
    expect(afterPoke(state(), "a", "pre").sentTo.a).toBe(2);
  });

  it("★ 받은 콕과 매칭은 손대지 않는다 — 남이 한 일이다", () => {
    /*
     * 판별 기준은 하나다: **내가 방금 한 행동의 결과만 미리 그린다.**
     * 받은 콕은 남이 한 일이고 매칭은 서버만 아는 것이라, 다시 읽어야만 안다.
     * 여기서 늘어나면 화면이 서버보다 앞서 나가 조용히 어긋난다.
     */
    const before = state();
    const next = afterPoke(before, "b", "pre");
    expect(next.received).toEqual(before.received);
    expect(next.matches).toBe(before.matches);
  });

  it("★ 다른 라운드의 예산은 그대로다", () => {
    // 사전과 파티는 예산이 나뉜다. 한쪽을 쓰면 다른 쪽이 줄어드는 것처럼 보이면 안 된다
    const next = afterPoke(state(), "b", "pre");
    expect(next.budget.party).toEqual({ max: 5, used: 0 });
  });

  it("★ 넘겨받은 값을 고치지 않는다 — 되돌릴 수 있어야 한다", () => {
    /*
     * 실패하면 누르기 전 값으로 되돌린다. 원본이 그때 이미 바뀌어 있으면
     * 되돌릴 자리가 없어서, **쓰지도 않은 콕이 쓴 것으로 남는다.**
     */
    const before = state();
    afterPoke(before, "b", "pre");
    expect(before.sentTo).toEqual({ a: 1 });
    expect(before.budget.pre).toEqual({ max: 3, used: 1 });
  });
});
