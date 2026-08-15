/**
 * 운영자 API. 인증은 여기서 끝내고, 상태 변경은 전부 EventDO 안에서 한다.
 *
 * 권한은 **한 종류뿐**이다 — 운영자 PIN 을 통과했는가. 회차마다 PIN 을 두지 않는다 (ADR-12).
 */
import { Hono } from "hono";
import type {
  CreateEventInput,
  Defaults,
  EventConfig,
  EventPatch,
  EventSchedule,
  EventSummary,
  Phase,
} from "../../shared/types.ts";
import { HOST, HOST_UI } from "../../shared/copy.ts";
import { LIMITS } from "../../shared/constants.ts";
import { PHASE_ORDER } from "../../shared/phase.ts";
import { HOST_COOKIE, clearCookie, resolvePin, sessionTtl, setCookie, signSession } from "../auth.ts";
import {
  apiError,
  eventStub,
  hostScope,
  isMaster,
  isSecure,
  registry,
  serverNow,
  unwrap,
  type Ctx,
  type Env,
} from "../http.ts";
import { pokeLimitMessage, pokeMessage, seatingMessage } from "../messages.ts";

export const hostRoutes = new Hono<{ Bindings: Env }>();

// ─────────────────────────────────── 인증

hostRoutes.post("/pin", async (c) => {
  const body = await json<{ pin?: string }>(c);
  const scope = resolvePin(String(body.pin ?? ""), c.env.MASTER_PIN);
  // 응답 어디에도 올바른 PIN 을 싣지 않는다
  if (!scope) return apiError(c, "unauthorized", HOST.pin.wrong);

  const token = await signSession(scope, c.env.SESSION_SECRET, serverNow());
  c.header("set-cookie", setCookie(HOST_COOKIE, token, isSecure(c), sessionTtl(scope)));
  return c.json({ scope });
});

hostRoutes.post("/logout", (c) => {
  c.header("set-cookie", clearCookie(HOST_COOKIE, isSecure(c)));
  return c.json({ ok: true });
});

hostRoutes.get("/session", async (c) => {
  const scope = await hostScope(c);
  if (!scope) return apiError(c, "unauthorized");
  return c.json({ scope });
});

// ─────────────────────────────────── 기본 설정

hostRoutes.get("/defaults", async (c) => {
  if (!isMaster(await hostScope(c))) return denied(c);
  return c.json(await registry(c.env).getDefaults());
});

hostRoutes.put("/defaults", async (c) => {
  if (!isMaster(await hostScope(c))) return denied(c);
  const body = await json<Defaults>(c);
  if (!validDefaults(body)) return apiError(c, "bad_request");

  // 운영자 PIN 은 여기서 바꾸지 않는다. 배포 시크릿(MASTER_PIN) 하나가 유일한 출처다
  return c.json(
    await registry(c.env).putDefaults({
      maxPre: body.maxPre,
      maxParty: body.maxParty,
      regOpenBeforeD: body.regOpenBeforeD,
      prevoteBeforeH: body.prevoteBeforeH,
    }),
  );
});

hostRoutes.post("/defaults/reset", async (c) => {
  if (!isMaster(await hostScope(c))) return denied(c);
  return c.json(await registry(c.env).resetDefaults());
});

// ─────────────────────────────────── 회차 목록·생성

hostRoutes.get("/events", async (c) => {
  if (!isMaster(await hostScope(c))) return denied(c);
  const now = serverNow();
  const entries = await registry(c.env).listEvents();
  const list: EventSummary[] = [];
  for (const entry of entries) {
    const res = await eventStub(c.env, entry.id).summaryAt(now);
    if (res.ok) list.push(res.value);
  }
  return c.json(list);
});

hostRoutes.post("/events", async (c) => {
  if (!isMaster(await hostScope(c))) return denied(c);
  const body = await json<CreateEventInput>(c);
  const now = serverNow();

  if (!body.name?.trim() || !body.requestId) return apiError(c, "bad_request");
  if (!validConfig(body.config)) return apiError(c, "bad_request");

  // 'now' 는 시각이 아니라 리터럴로 받는다 — datetime-local 이 초를 버리기 때문 (UI.md)
  const openNow = body.regOpenAt === "now";
  const regOpenAt = openNow ? now : Number(body.regOpenAt);
  const partyAt = Number(body.partyAt);
  const prevoteAt = Number(body.prevoteAt);
  if (![regOpenAt, partyAt, prevoteAt].every(Number.isFinite)) return apiError(c, "bad_request");
  // 순서 검증은 **운영자가 고른 두 시각** 사이에서만 한다.
  // '지금 바로'는 고른 시각이 아니라 버튼이라서, 사전 투표 시작이 이미 지났더라도 회차는 만들어진다 —
  // 그때는 등록과 사전 투표가 곧바로 이어서 열린다.
  if (!openNow && prevoteAt <= regOpenAt) return apiError(c, "schedule_order");

  const reserved = await registry(c.env).reserve({
    code: body.code,
    requestId: String(body.requestId),
    now,
  });
  if (!reserved.ok) return apiError(c, "code_taken", HOST.pin.codeTaken);

  const meta = await eventStub(c.env, reserved.id).init({
    id: reserved.id,
    name: body.name.trim(),
    code: reserved.code,
    phase: openNow ? "reg" : "prep",
    fired: openNow ? { reg: now } : {},
    schedule: { partyAt, regOpenAt, prevoteAt },
    // 좁혔을 때만 적는다. 기본값을 굳이 써 넣으면 설정의 모양이 회차마다 달라진다
    config: {
      maxPre: body.config.maxPre,
      maxParty: body.config.maxParty,
      ...(body.config.allowSameGender === false ? { allowSameGender: false } : {}),
    },
    createdAt: now,
  });
  return c.json(meta);
});

// ─────────────────────────────────── 회차 하나

hostRoutes.get("/events/:id", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { value, response } = unwrap(c, await gate.stub.metaAt(serverNow()));
  return response ?? c.json(value);
});

hostRoutes.get("/events/:id/state", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { value, response } = unwrap(c, await gate.stub.hostState(serverNow()));
  return response ?? c.json(value);
});

/**
 * 이름·콕 횟수. **입장 코드는 바꾸지 않는다** (ADR-22) —
 * 이미 나간 링크와 안내가 어긋나고 되돌릴 방법이 없다. 코드를 보내와도 무시한다.
 */
hostRoutes.put("/events/:id", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<EventPatch>(c);
  if (body.config && !validConfig(body.config)) return apiError(c, "bad_request");

  const { value, response } = unwrap(
    c,
    await gate.stub.patchMeta({ name: body.name, config: body.config }, serverNow()),
    pokeLimitMessage,
  );
  return response ?? c.json(value);
});

hostRoutes.put("/events/:id/schedule", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<EventSchedule>(c);
  const { value, response } = unwrap(c, await gate.stub.setSchedule(body, serverNow()));
  return response ?? c.json(value);
});

hostRoutes.post("/events/:id/phase", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<{ to?: Phase }>(c);
  if (!body.to || !PHASE_ORDER.includes(body.to)) return apiError(c, "bad_request");
  const { value, response } = unwrap(c, await gate.stub.setPhase(body.to, serverNow()));
  return response ?? c.json(value);
});

hostRoutes.delete("/events/:id", async (c) => {
  if (!isMaster(await hostScope(c))) return denied(c);
  const id = c.req.param("id");
  await eventStub(c.env, id).destroy();
  await registry(c.env).removeEvent(id);
  return c.json({ ok: true });
});

// ─────────────────────────────────── 입장 명단 (ADR-15)

/** 명단에 더한다. 통째로 갈아치우는 길은 두지 않는다 — 실수 한 번이 파티를 날린다 */
hostRoutes.post("/events/:id/invites", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<{ phones?: unknown }>(c);
  if (!Array.isArray(body.phones)) return apiError(c, "bad_request");
  const { value, response } = unwrap(
    c,
    await gate.stub.addInvites(body.phones.map(String), serverNow()),
    () => HOST_UI.invites.tooMany(LIMITS.inviteMax),
  );
  return response ?? c.json(value);
});

hostRoutes.delete("/events/:id/invites/:phone", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { value, response } = unwrap(c, await gate.stub.removeInvite(c.req.param("phone")));
  return response ?? c.json(value);
});

// ─────────────────────────────────── 참가자 (운영자 시점)

hostRoutes.delete("/events/:id/players/:pid", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { response } = unwrap(c, await gate.stub.deletePlayer(c.req.param("pid")));
  return response ?? c.json({ ok: true });
});

// ─────────────────────────────────── 자리

hostRoutes.post("/events/:id/seating", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<{ tableCount?: number; final?: boolean }>(c);
  const { value, response } = unwrap(
    c,
    await gate.stub.makeSeating(Number(body.tableCount), !!body.final, serverNow()),
    seatingMessage,
  );
  return response ?? c.json(value);
});

hostRoutes.post("/events/:id/seating/swap", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<{ a?: string; b?: string }>(c);
  if (!body.a || !body.b) return apiError(c, "bad_request");
  const { value, response } = unwrap(c, await gate.stub.swapSeats(body.a, body.b));
  return response ?? c.json(value);
});

/** 남녀 비율은 그대로 두고 사람만 다시 섞는다 */
hostRoutes.post("/events/:id/seating/shuffle", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { value, response } = unwrap(c, await gate.stub.shuffleSeating());
  return response ?? c.json(value);
});

hostRoutes.delete("/events/:id/seating", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { response } = unwrap(c, await gate.stub.discardSeating());
  return response ?? c.json({ ok: true });
});

hostRoutes.post("/events/:id/seating/publish", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { value, response } = unwrap(c, await gate.stub.publishSeating(serverNow()));
  return response ?? c.json(value);
});

// ─────────────────────────────────── 시연 도구 (연습용 환경 전용)
//
// **프로덕션에는 존재하지 않는다.** `ENV_LABEL` 이 있는 환경(연습용)에서만 라우트가 산다 —
// 런타임에 403 을 주는 게 아니라 없는 길로 흘려보낸다. 진짜 회차에 가짜 100명을 넣었다
// 지우는 일이 없어야 한다 (CLAUDE.md).

hostRoutes.post("/events/:id/demo/players", async (c) => {
  if (!c.env.ENV_LABEL) return apiError(c, "not_found");
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<{ count?: number }>(c);
  const { value, response } = unwrap(c, await gate.stub.seedPlayers(Number(body.count ?? 8), serverNow()));
  return response ?? c.json({ added: value });
});

hostRoutes.post("/events/:id/demo/pokes", async (c) => {
  if (!c.env.ENV_LABEL) return apiError(c, "not_found");
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { value, response } = unwrap(c, await gate.stub.seedPokes(serverNow()), pokeMessage);
  return response ?? c.json({ added: value });
});

hostRoutes.post("/events/:id/demo/reset", async (c) => {
  if (!c.env.ENV_LABEL) return apiError(c, "not_found");
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { response } = unwrap(c, await gate.stub.resetDemo());
  return response ?? c.json({ ok: true });
});

// ─────────────────────────────────── 데모 뷰 (ADR-7)
//
// 참가자 화면을 한 벌만 유지하기 위해, 데모는 같은 컴포넌트에 "운영자가 대신 본다"는
// 컨텍스트만 다르게 준다. 그래서 참가자 API 와 짝이 맞는 대리 호출이 필요하다.

hostRoutes.get("/events/:id/as/:pid", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { value, response } = unwrap(c, await gate.stub.participantState(c.req.param("pid"), serverNow()));
  return response ?? c.json(value);
});

hostRoutes.post("/events/:id/as/:pid/poke", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<{ toId?: string }>(c);
  if (!body.toId) return apiError(c, "bad_request");
  const { value, response } = unwrap(
    c,
    await gate.stub.poke(c.req.param("pid"), body.toId, serverNow()),
    pokeMessage,
  );
  return response ?? c.json(value);
});

hostRoutes.post("/events/:id/as/:pid/seat/ack", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<{ round?: number }>(c);
  const { response } = unwrap(c, await gate.stub.ackSeat(c.req.param("pid"), Number(body.round)));
  return response ?? c.json({ ok: true });
});

// ─────────────────────────────────── 잡다한 것

/** 그 회차를 열 수 있는지 확인하고 손잡이를 준다. 로그인 없으면 401, 없는 회차는 404 */
async function openEvent(c: Ctx) {
  const id = c.req.param("id")!;
  if (!isMaster(await hostScope(c))) return { response: apiError(c, "unauthorized"), id, stub: null as never };
  if (!(await registry(c.env).hasEvent(id))) {
    return { response: apiError(c, "not_found"), id, stub: null as never };
  }
  return { response: null, id, stub: eventStub(c.env, id) };
}

function denied(c: Ctx) {
  return apiError(c, "unauthorized");
}

async function json<T>(c: Ctx): Promise<T> {
  return (await c.req.json().catch(() => ({}))) as T;
}

function validConfig(config: EventConfig | undefined): boolean {
  if (!config) return false;
  const { maxPre, maxParty } = config;
  return (
    Number.isInteger(maxPre) &&
    Number.isInteger(maxParty) &&
    maxPre >= LIMITS.maxPre.min &&
    maxPre <= LIMITS.maxPre.max &&
    maxParty >= LIMITS.maxParty.min &&
    maxParty <= LIMITS.maxParty.max
  );
}

function validDefaults(d: Defaults): boolean {
  return (
    validConfig(d) &&
    Number.isFinite(d.regOpenBeforeD) &&
    d.regOpenBeforeD >= 0 &&
    Number.isFinite(d.prevoteBeforeH) &&
    d.prevoteBeforeH >= 0
  );
}
