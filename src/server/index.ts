import { Hono } from "hono";
import { EventDO } from "./event-do.ts";
import { RegistryDO } from "./registry-do.ts";
import { hostRoutes } from "./routes/host.ts";
import { participantRoutes } from "./routes/participant.ts";
import { PLAYER_COOKIE, cookieName, readCookie, readSession } from "./auth.ts";
import { eventStub, missingSecrets, moveServerClock, registry, serverNow, syncClock, type Env } from "./http.ts";
import { withOgFor } from "./og.ts";

export { EventDO, RegistryDO };
export type { Env };

const app = new Hono<{ Bindings: Env }>();

/**
 * 시크릿이 없으면 아무것도 하지 않는다.
 * SESSION_SECRET 이 비면 세션 서명 키가 빈 문자열이 되어 운영자 쿠키를 누구나 위조할 수 있다 —
 * 에러 없이 그냥 열리는 종류의 사고라 요청을 받기 전에 막는다.
 */
app.use("/api/*", async (c, next) => {
  const missing = missingSecrets(c.env);
  if (missing.length) return c.json({ error: "server_misconfigured", missing }, 500);
  await next();
});

/** 모든 응답에 서버 시각을 실어 보낸다. 클라이언트 시계를 믿지 않는다. */
app.use("/api/*", async (c, next) => {
  await syncClock(c.env);
  await next();
  c.header("x-server-time", String(serverNow()));
});

app.get("/api/health", (c) =>
  c.json({ ok: true, serverTime: serverNow(), label: c.env.ENV_LABEL || undefined }),
);

app.route("/api/host", hostRoutes);
app.route("/api", participantRoutes);

/**
 * WebSocket 은 회차 DO 로 그대로 넘긴다.
 * 폴링 대신 WS 를 쓰는 이유: 무료 플랜 10만 요청/일 안에 들어오기 위해서다.
 * (5초 폴링이면 100명 × 3시간에 216,000 요청)
 *
 * 누구의 소켓인지는 쿠키로만 판단해서 DO 에 알려준다 — 콕 알림은 수신자에게만 가야 한다.
 */
app.get("/ws/:code", async (c) => {
  await syncClock(c.env);
  const eventId = await registry(c.env).idByCode(c.req.param("code"));
  if (!eventId) return c.text("not found", 404);

  const scope = await readSession(
    /*
     * **어느 쿠키인지는 `?ref=` 가 고른다** (ADR-44). 브라우저 WebSocket 은 헤더를 못 실어서
     * 여기만 쿼리다. 이름표는 비밀이 아니라 주소에 실려도 되고, 증명은 여전히 쿠키다 —
     * 남의 이름표를 적어봐야 그 쿠키가 없으면 어떤 소켓도 그 사람 것이 되지 않는다.
     */
    readCookie(c.req.header("cookie") ?? null, cookieName(PLAYER_COOKIE, c.req.query("ref"))),
    c.env.SESSION_SECRET,
    serverNow(),
  );
  const headers = new Headers(c.req.raw.headers);
  headers.delete("x-player-id");
  if (scope?.kind === "player" && scope.eventId === eventId) {
    headers.set("x-player-id", scope.playerId);
  }
  return eventStub(c.env, eventId).fetch(new Request(c.req.raw.url, { headers }));
});

/**
 * 테스트 전용 시간 이동. 예약 전환과 시계 조작 방지를 검증하려면 시간을 앞으로 돌릴 수단이 필요하다.
 * 런타임에 403 을 주는 게 아니라 **라우트를 아예 등록하지 않는다** — 프로덕션에는 존재하지 않는다.
 */
app.post("/api/__test__/now", async (c, next) => {
  // Workers 는 env 를 요청 시점에만 준다. 그래서 "등록하지 않음"을
  // 아래 404 핸들러로 흘려보내는 것으로 구현한다 — 밖에서 본 결과는 라우트가 없는 것과 같다.
  if (c.env.ALLOW_TEST_ENDPOINTS !== "1") return next();
  const body = (await c.req.json().catch(() => ({}))) as { at?: number };
  if (!Number.isFinite(body.at)) return c.json({ error: "bad_request" }, 400);
  await moveServerClock(c.env, Number(body.at));
  return c.json({ now: serverNow() });
});

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

/**
 * 사라진 번들은 **404 여야 한다.**
 *
 * 화면 상태가 전부 URL 에 있어서(ROUTES.md) 어느 주소로 들어와도 `index.html` 이 떠야 하고,
 * 그게 `not_found_handling: single-page-application` 의 일이다. 그런데 그 폴백은
 * **없는 자산에도 똑같이 걸린다.**
 *
 * 옛 `index.html` 을 들고 있는 브라우저가 사라진 번들(`/assets/index-옛해시.js`)을
 * 달라고 하면 HTML 이 200 으로 돌아온다. 브라우저는 HTML 을 JS 모듈로 실행하지 않으므로
 * **JS 도 CSS 도 안 붙어 하얀 화면이 된다.** 게다가 그 응답이 `/assets/` 규칙을 타고
 * **1년짜리 immutable** 로 캐시된다 — 잘못된 답이 오래 남는다.
 *
 * 404 는 다르다. 브라우저가 "다시 받으면 되는 것" 으로 다루고, 캐시도 안 한다.
 * 배포 직후 옛 화면을 열어둔 사람은 새로고침 한 번으로 돌아온다.
 */
app.all("/assets/*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  // 자산 자리에서 HTML 이 돌아왔다면 그건 그 파일이 없다는 뜻이다 (SPA 폴백)
  if (res.headers.get("content-type")?.includes("text/html")) {
    return c.text("not found", 404, { "cache-control": "no-store" });
  }
  return res;
});

/**
 * **참가 링크만 워커를 거친다** — 카톡에 붙는 주소가 이것 하나뿐이라서다.
 *
 * 미리보기 카드를 만드는 건 카톡 서버이고 그 크롤러는 JS 를 안 돌린다. 그래서 og 태그가
 * 정적 HTML 에 있어야 하는데, 카카오는 절대 https 주소를 요구한다 — 상대경로는 안 받는다.
 * 요청이 온 주소에서 origin 을 꺼내면 프로덕션·QA·나중의 커스텀 도메인이 저절로 맞는다.
 *
 * 다른 경로(`/`, `/e/*`, `/host/*`)는 그대로 ASSETS 가 낸다. 아무도 공유하지 않는 주소라
 * 태그가 필요 없고, **문이 아닌 곳까지 워커를 거치게 할 이유가 없다.**
 *
 * ⚠️ **여기서 던지면 문이 막힌다.** 참가자가 앱에 들어오는 길이 이 경로 하나뿐이라,
 * 주입이 실패하면 손대지 않은 응답을 그대로 낸다. 미리보기는 없어도 되지만 문은 아니다.
 */
app.get("/j/*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (!res.headers.get("content-type")?.includes("text/html")) return res;
  const copy = res.clone();
  try {
    // 토큰을 버리는 일은 `withOgFor` 안에서 한다 — 여기서 origin 을 만들지 않는다
    const html = withOgFor(await res.text(), c.req.url);
    const headers = new Headers(res.headers);
    // 길이가 바뀌었다. 옛 값을 남기면 응답이 잘린다
    headers.delete("content-length");
    return new Response(html, { status: res.status, headers });
  } catch {
    return copy;
  }
});

/**
 * 자동 파기는 없다 (ADR-36). 회차는 운영자가 지울 때까지 남는다 —
 * 지우는 길은 설정 탭의 `이 회차 삭제하기` 하나이고, 그것도 DO 하나를 버리는 일이다.
 */
export default { fetch: app.fetch };
