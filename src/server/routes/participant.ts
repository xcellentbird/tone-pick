import { Hono } from "hono";

/**
 * 참가자 API.
 *
 * ⚠️ 여기서 나가는 응답에 실명·전화번호·인스타가 섞이면 안 된다.
 *    반드시 `toPublic()` 을 거칠 것. 발표 전에는 콕 발신자 정보도 응답에 없어야 한다.
 *    (개발자 도구로 응답을 열어보는 참가자가 반드시 있다)
 */
export const participantRoutes = new Hono();

participantRoutes.get("/events/by-code/:code", (c) => c.json({ error: "not_implemented" }, 501));
participantRoutes.post("/events/:code/register", (c) => c.json({ error: "not_implemented" }, 501));
participantRoutes.get("/me", (c) => c.json({ error: "not_implemented" }, 501));
participantRoutes.get("/roster", (c) => c.json({ error: "not_implemented" }, 501));
participantRoutes.post("/poke", (c) => c.json({ error: "not_implemented" }, 501));
participantRoutes.delete("/poke/:toId", (c) => c.json({ error: "not_implemented" }, 501));
participantRoutes.post("/seat/ack", (c) => c.json({ error: "not_implemented" }, 501));
