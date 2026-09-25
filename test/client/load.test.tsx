/**
 * 되불러오기가 겹칠 때 (ADR-26).
 *
 * 실시간은 "다시 읽어라" 신호뿐이라, 파티 중에는 신호가 잇따라 온다 — 콕 하나, 자리 발행 하나,
 * 앱으로 돌아온 순간과 소켓이 다시 붙은 순간. 새 되불러오기가 시작될 때마다 앞의 답을 버리면
 * **신호가 답보다 빨리 오는 동안 화면이 한 번도 안 바뀐다.**
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useLoad } from "../../src/client/lib/useLoad.ts";

afterEach(cleanup);

/** 부를 때마다 답을 따로 쥐고 있다가 테스트가 원하는 순서로 돌려준다 */
function deferred() {
  const calls: Array<(v: number) => void> = [];
  const load = () => new Promise<number>((resolve) => calls.push(resolve));
  return { calls, load };
}

it("★ 되불러오기가 겹쳐도 먼저 온 새 답은 바로 그린다", async () => {
  const { calls, load } = deferred();
  const { result } = renderHook(() => useLoad(load));
  await act(async () => calls[0](1));
  expect(result.current.data).toBe(1);

  // 두 신호가 잇따라 온다. 둘째가 떠난 뒤에 첫째 답이 온다
  act(() => result.current.reload());
  act(() => result.current.reload());
  await act(async () => calls[1](2));
  expect(result.current.data, "뒤에 또 부른다고 먼저 온 답을 버렸다").toBe(2);

  await act(async () => calls[2](3));
  expect(result.current.data).toBe(3);
});

it("★ 늦게 온 옛 답은 새 답을 덮지 않는다", async () => {
  const { calls, load } = deferred();
  const { result } = renderHook(() => useLoad(load));
  await act(async () => calls[0](1));

  act(() => result.current.reload());
  act(() => result.current.reload());
  await act(async () => calls[2](3));
  await act(async () => calls[1](2));
  expect(result.current.data, "옛 답이 새 답을 덮었다").toBe(3);
});

it("★ 화면이 갈아끼운 값은 그 전에 떠난 답에 덮이지 않고, 그 답의 다른 소식은 그린다", async () => {
  type S = { poked: boolean; phase: string };
  const calls: Array<(v: S) => void> = [];
  const load = () => new Promise<S>((resolve) => calls.push(resolve));
  const { result } = renderHook(() => useLoad(load));
  await act(async () => calls[0]({ poked: false, phase: "prevote" }));

  // 신호로 다시 읽는 중에 콕을 눌렀고, 콕의 답(서버가 방금 쓴 값)이 먼저 왔다
  act(() => result.current.reload());
  act(() => result.current.set((cur) => (cur ? { ...cur, poked: true } : cur)));
  // 먼저 떠난 답은 콕을 모르지만, 그 사이 파티가 시작됐다는 소식을 싣고 있다
  await act(async () => calls[1]({ poked: false, phase: "party" }));
  expect(result.current.data, "누른 콕이 그 전에 떠난 답에 풀렸다").toEqual({ poked: true, phase: "party" });
  expect(calls, "갈아끼웠다고 더 묻지 않는다").toHaveLength(2);

  // 콕을 안 뒤에 떠난 답은 그대로 그린다 — 그 사이 되돌렸을 수도 있다
  act(() => result.current.reload());
  await act(async () => calls[2]({ poked: false, phase: "party" }));
  expect(result.current.data).toEqual({ poked: false, phase: "party" });
});
