/**
 * 테스트가 워커에 요청을 넣는 **유일한 문**이다. `SELF.fetch` 를 쓰지 마라.
 *
 * `@cloudflare/vitest-pool-workers`(0.20 ~ 0.22 확인)의 `SELF` 는 요청마다 진입점 래퍼를 새로 만드는데,
 * 만들 때마다 래퍼 클래스의 `prototype` 을 Proxy 로 **한 겹 더** 감싼다 (`createProxyPrototypeClass`).
 * N 번째 요청은 속성 하나를 찾으려고 Proxy N 겹을 지난다 — 한 파일에서 요청이 쌓일수록 요청 하나가
 * 느려지고(아무 일도 안 하는 요청이 600번 뒤 1.7ms → 153ms), 파일 전체는 제곱으로 느려졌다.
 * `워커 테스트는 파일이 커지면 초선형으로 느려진다` 의 정체가 이것이었다. DO 를 지워도 안 줄던 이유다.
 *
 * 워커의 `fetch` 를 직접 부르면 그 래퍼를 지나지 않는다. **같은 진입점**(`src/server/index.ts` 의
 * 기본 내보내기)에 **같은 바인딩**(`env`)이라, 테스트가 보는 공개 표면은 그대로다.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/server/index.ts";
import type { Env } from "../../src/server/http.ts";

export async function fetchApp(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(input, init), env as unknown as Env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
