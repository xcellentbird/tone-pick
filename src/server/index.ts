import { Hono } from "hono";
import { EventDO } from "./event-do.ts";
import { hostRoutes } from "./routes/host.ts";
import { participantRoutes } from "./routes/participant.ts";

export { EventDO };

export interface Env {
  EVENT: DurableObjectNamespace;
  INDEX: KVNamespace;
  ASSETS: Fetcher;
  MASTER_PIN: string;
  SESSION_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

/** 모든 응답에 서버 시각을 실어 보낸다. 클라이언트 시계를 믿지 않는다. */
app.use("/api/*", async (c, next) => {
  await next();
  c.header("x-server-time", String(Date.now()));
});

app.get("/api/health", (c) => c.json({ ok: true, serverTime: Date.now() }));

app.route("/api/host", hostRoutes);
app.route("/api", participantRoutes);

/**
 * WebSocket 은 회차 DO 로 그대로 넘긴다.
 * 폴링 대신 WS 를 쓰는 이유: 무료 플랜 10만 요청/일 안에 들어오기 위해서다.
 * (5초 폴링이면 100명 × 3시간에 216,000 요청)
 */
app.get("/ws/:code", async (c) => {
  const id = await resolveEvent(c.env, c.req.param("code"));
  if (!id) return c.text("not found", 404);
  return c.env.EVENT.get(id).fetch(c.req.raw);
});

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

/** 입장 코드 -> 회차 DO. KV 는 인덱스 용도로만 쓰고, 진실은 DO 안에 있다. */
export async function resolveEvent(env: Env, code: string): Promise<DurableObjectId | null> {
  const eventId = await env.INDEX.get(`code:${code.toUpperCase()}`);
  if (!eventId) return null;
  return env.EVENT.idFromString(eventId);
}

export default app;
