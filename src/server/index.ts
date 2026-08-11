import { Hono } from "hono";
import { EventDO } from "./event-do.ts";
import { RegistryDO } from "./registry-do.ts";
import { hostRoutes } from "./routes/host.ts";
import { participantRoutes } from "./routes/participant.ts";
import { PLAYER_COOKIE, readCookie, readSession } from "./auth.ts";
import { eventStub, moveServerClock, registry, serverNow, syncClock, type Env } from "./http.ts";

export { EventDO, RegistryDO };
export type { Env };

const app = new Hono<{ Bindings: Env }>();

/** 모든 응답에 서버 시각을 실어 보낸다. 클라이언트 시계를 믿지 않는다. */
app.use("/api/*", async (c, next) => {
  await syncClock(c.env);
  await next();
  c.header("x-server-time", String(serverNow()));
});

app.get("/api/health", (c) => c.json({ ok: true, serverTime: serverNow() }));

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
    readCookie(c.req.header("cookie") ?? null, PLAYER_COOKIE),
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

export default app;
