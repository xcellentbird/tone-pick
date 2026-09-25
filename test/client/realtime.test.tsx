/**
 * 실시간 연결은 **하나만** 산다 (ADR-26).
 *
 * 실시간은 "다시 읽어라" 신호일 뿐이라 소켓이 둘이면 화면이 두 번 읽힐 뿐 틀리지는 않는다 —
 * 그래서 사람 눈으로는 안 잡힌다. 하지만 닫는 길이 없는 소켓은 화면을 떠나도 계속 신호를 받고,
 * 앱으로 돌아올 때마다 하나씩 늘어 회차 DO 에 붙은 연결이 불어난다.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connect } from "../../src/client/lib/realtime.ts";

/** 브라우저 소켓처럼 `close` 가 **나중에** 온다. 붙는 것은 테스트가 정한다 */
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    FakeSocket.all.push(this);
  }
  send() {}
  close() {
    if (this.readyState >= FakeSocket.CLOSING) return;
    this.readyState = FakeSocket.CLOSING;
    setTimeout(() => {
      this.readyState = FakeSocket.CLOSED;
      this.onclose?.();
    }, 0);
  }
}

const alive = () => FakeSocket.all.filter((s) => s.readyState !== FakeSocket.CLOSED);

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  // 연결 지표(ADR-56)가 보내는 요청은 여기서 볼 것이 아니다
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("★ 붙는 중에 앱으로 돌아와도 소켓이 하나만 남고, 닫으면 다 닫힌다", async () => {
  const conn = connect("ABCDEF", () => {});
  expect(alive()).toHaveLength(1);

  // 파티장 와이파이가 느려 아직 붙는 중인데 폰을 껐다 켠다 — 붙는 중이던 소켓을 버리고 새로 연다
  document.dispatchEvent(new Event("visibilitychange"));
  // 버린 소켓의 `close` 가 늦게 오고, 재연결 백오프가 몇 번 돌 만큼 기다린다
  await vi.advanceTimersByTimeAsync(60_000);
  expect(alive(), "버린 소켓의 close 가 재연결을 한 번 더 걸었다").toHaveLength(1);

  // 화면을 떠난다. 닫는 길은 하나라서, 그 길로 닫히지 않는 소켓이 있으면 계속 신호를 받는다
  conn.close();
  await vi.advanceTimersByTimeAsync(0);
  expect(alive()).toHaveLength(0);
});
