/**
 * 무대 워커 스파이크 (슬라이스 35 S-A1, ADR-97). **이 한 가지만 잰다** —
 * 서비스 바인딩을 지나 QA 를 부르면, QA 의 국가 문(`cf.country`, ADR-92)이 그 요청을 들여보내는가.
 *
 * 예상은 "들여보낸다" 다: 바인딩으로 **새로 만든** `Request` 에는 `cf` 가 없어서
 * QA 의 `regionBlocked` 가 "모르는 나라는 통과" 로 넘긴다. 그걸 **배포해서 재는** 것이 이 파일이다.
 *
 * 두 길을 함께 잰다. 진짜 무대 워커는 첫째 길(새 요청)만 쓸 것이지만, 둘째 길(들어온 요청에서
 * 만든 것)이 `cf` 를 실어 나르는지도 알아야 한다 — 실어 나른다면 **요청을 넘겨 만드는 코드를
 * 쓰는 순간 문이 해외 사용자를 막는다.** 어느 쪽인지 적어 두면 다음 사람이 헛갈리지 않는다.
 *
 * ⚠️ 막혔다고 `cf-ipcountry` 헤더를 지어 보내는 답은 없다 (CLAUDE.md) — 그때는 다시 설계한다.
 * 결과는 ADR-97 후기로 적는다.
 */
interface Env {
  APP: Fetcher;
}

async function probe(env: Env, make: () => Request) {
  try {
    const res = await env.APP.fetch(make());
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* JSON 이 아니면 글자 그대로 싣는다 */
    }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, error: String(e) };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // 표적을 고르는 입력은 없다 (S-A2). 여는 자리도 `/` 하나다
    if (url.pathname !== "/") return new Response("not found", { status: 404 });

    const target = "https://app/api/health";
    const result = {
      // 이 스파이크를 연 사람의 나라 — 엣지가 붙여준 값이다. "한국 밖에서 열었나" 의 증거
      caller: (request as { cf?: { country?: string } }).cf?.country ?? null,
      // ① 새로 만든 요청 — 진짜 무대 워커가 쓸 길
      fresh: await probe(env, () => new Request(target)),
      // ② 들어온 요청에서 만든 것 — `cf` 가 실려 가는지 본다
      derived: await probe(env, () => new Request(target, request)),
    };
    return new Response(JSON.stringify(result, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  },
} satisfies ExportedHandler<Env>;
