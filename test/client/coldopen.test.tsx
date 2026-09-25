/**
 * 참가자 화면을 **처음 열 때** (`/e/<코드>` 를 새로 고치거나 링크로 다시 들어올 때).
 *
 * 참가자 화면은 따로 내려받는 청크라, 그 안에서 `/me` 를 부르면 청크가 다 온 **뒤에야** 질문이 떠난다.
 * 둘은 서로를 기다릴 이유가 없다 — 앱이 올라오는 순간 함께 출발시킨다.
 * 다만 `index.html` 에서 띄우지는 않는다 — 거기서는 이 탭의 이름표를 실을 수 없다 (ADR-44, ADR-75).
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prefetchSession, sessionSource } from "../../src/client/lib/participant.ts";
import { setTabRef } from "../../src/client/lib/session.ts";

const me = { event: { code: "ABCDEF" } };

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(me), { headers: { "content-type": "application/json" } })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const asked = () =>
  vi.mocked(fetch).mock.calls.map(([url, init]) => ({
    url: String(url),
    ref: new Headers((init as RequestInit | undefined)?.headers).get("x-tp-ref"),
  }));

it("★ 참가자 화면을 열면 /me 는 화면 청크를 기다리지 않고 떠나고, 화면은 그 답을 받아간다", async () => {
  setTabRef("abcd1234");
  prefetchSession("/e/ABCDEF/people");
  // 청크가 아직 안 왔어도 질문은 이미 떠났다 — 이 탭의 이름표를 싣고
  expect(asked()).toEqual([{ url: "/api/me?code=ABCDEF", ref: "abcd1234" }]);

  await expect(sessionSource("ABCDEF").load()).resolves.toEqual(me);
  expect(asked(), "화면이 같은 것을 한 번 더 물었다").toHaveLength(1);

  // **한 번만 받아간다** — 다시 읽기는 새 값을 원하는 것이다
  await sessionSource("ABCDEF").load();
  expect(asked()).toHaveLength(2);
});

it("참가자 화면이 아니면 아무것도 묻지 않는다 — 다른 회차의 화면에 넘겨주지도 않는다", async () => {
  prefetchSession("/j/e1");
  prefetchSession("/host/events");
  expect(asked()).toEqual([]);

  prefetchSession("/e/ABCDEF");
  await sessionSource("GHIJKL").load();
  expect(asked().map((a) => a.url)).toEqual(["/api/me?code=ABCDEF", "/api/me?code=GHIJKL"]);
  // 받아가지 않은 것은 남은 채 두지 않는다
  await sessionSource("ABCDEF").load();
});
