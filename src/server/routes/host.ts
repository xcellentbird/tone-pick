import { Hono } from "hono";

/** 운영자 API. 인증은 여기서 끝내고, 상태 변경은 전부 EventDO 안에서 한다. */
export const hostRoutes = new Hono();

// 인증
hostRoutes.post("/pin", (c) => c.json({ error: "not_implemented" }, 501));
hostRoutes.post("/logout", (c) => c.json({ error: "not_implemented" }, 501));

// 회차 (공통 PIN 전용)
hostRoutes.get("/events", (c) => c.json({ error: "not_implemented" }, 501));
hostRoutes.post("/events", (c) => c.json({ error: "not_implemented" }, 501));
hostRoutes.get("/defaults", (c) => c.json({ error: "not_implemented" }, 501));
hostRoutes.put("/defaults", (c) => c.json({ error: "not_implemented" }, 501));

// 회차 콘솔
hostRoutes.get("/events/:id", (c) => c.json({ error: "not_implemented" }, 501));
hostRoutes.put("/events/:id/settings", (c) => c.json({ error: "not_implemented" }, 501));
hostRoutes.post("/events/:id/phase", (c) => c.json({ error: "not_implemented" }, 501));
hostRoutes.get("/events/:id/players", (c) => c.json({ error: "not_implemented" }, 501));
hostRoutes.delete("/events/:id/players/:pid", (c) => c.json({ error: "not_implemented" }, 501));

// 자리 — 테이블 수는 이 요청의 body 로 들어온다 (사전 설정이 아니다)
hostRoutes.post("/events/:id/seating", (c) => c.json({ error: "not_implemented" }, 501));
hostRoutes.post("/events/:id/seating/publish", (c) => c.json({ error: "not_implemented" }, 501));
hostRoutes.post("/events/:id/seating/reopen", (c) => c.json({ error: "not_implemented" }, 501));
