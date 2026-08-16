import { Hono } from "hono";
import { EventDO } from "./event-do.ts";
import { RegistryDO } from "./registry-do.ts";
import { hostRoutes } from "./routes/host.ts";
import { participantRoutes } from "./routes/participant.ts";
import { PLAYER_COOKIE, readCookie, readSession } from "./auth.ts";
import { eventStub, missingSecrets, moveServerClock, registry, serverNow, syncClock, type Env } from "./http.ts";

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

/**
 * 개인정보 파기.  하루 한 번, 보관 기간이 지난 회차를 지운다.
 *
 * 참가자에게 실명과 전화번호를 받아놓고 언제까지 들고 있을지 정해두지 않는 건 그 자체가 사고다.
 * 회차 1개 = DO 1개라서 지울 것이 한 곳에 다 있다 — 그 매핑이 여기서 값을 한다.
 *
 * 실패해도 다음 날 다시 온다. 한 회차가 막혔다고 나머지를 건너뛰지 않는다.
 */
async function scheduled(_event: ScheduledController, env: Env) {
  // 단계 판정과 같은 시계를 쓴다. 테스트에서 시간을 앞으로 돌려 이 경로를 확인할 수 있게
  await syncClock(env);
  const reg = registry(env);
  const now = serverNow();
  let purged = 0;

  for (const entry of await reg.listEvents()) {
    try {
      // 대기 일수는 회차 설정을 따르므로 DO 가 스스로 판단한다
      if (await eventStub(env, entry.id).purgeIfExpired(now)) {
        await reg.removeEvent(entry.id);
        purged++;
      }
    } catch (e) {
      // 한 건이 막혀도 나머지는 돈다. 다음 날 다시 시도한다
      console.error("purge failed", entry.id, e);
    }
  }
  console.log(`purge: ${purged} events removed`);
}

export default { fetch: app.fetch, scheduled };
