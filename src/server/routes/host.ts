/**
 * 운영자 API. 인증은 여기서 끝내고, 상태 변경은 전부 EventDO 안에서 한다.
 *
 * 권한은 두 종류뿐이다.
 *   master — 전부. 회차 목록·기본 설정·회차 생성은 여기만
 *   host   — 그 회차 하나. 다른 회차는 403
 */
import { Hono } from "hono";
import type {
  CreateEventInput,
  Defaults,
  EventPatch,
  EventSchedule,
  EventSummary,
  Phase,
} from "../../shared/types.ts";
import { HOST } from "../../shared/copy.ts";
import { LIMITS } from "../../shared/constants.ts";
import { PHASE_ORDER } from "../../shared/phase.ts";
import { HOST_COOKIE, clearCookie, pinCollides, resolvePin, setCookie, signSession } from "../auth.ts";
import {
  apiError,
  canOpenEvent,
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
import { pokeMessage, seatingMessage } from "../messages.ts";

export const hostRoutes = new Hono<{ Bindings: Env }>();

// ─────────────────────────────────── 인증

hostRoutes.post("/pin", async (c) => {
  const body = await json<{ pin?: string; eventId?: string }>(c);
  const pin = String(body.pin ?? "");
  const eventId = body.eventId ? String(body.eventId) : null;
  const reg = registry(c.env);

  const masterPin = await reg.getMasterPin(c.env.MASTER_PIN);
  // 회차 PIN 을 **먼저** 본다. 두 값이 같을 때 회차 담당자가 master 를 얻으면 안 된다 (ADR-3)
  const eventPin = eventId ? await reg.pinOf(eventId) : null;
  const scope = await resolvePin(pin, eventId, eventPin, masterPin);
  // 응답 어디에도 올바른 PIN 을 싣지 않는다
  if (!scope) return apiError(c, "unauthorized", HOST.pin.wrong);

  const token = await signSession(scope, c.env.SESSION_SECRET, serverNow());
  c.header("set-cookie", setCookie(HOST_COOKIE, token, isSecure(c)));
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

// ─────────────────────────────────── 기본 설정 (공통 PIN 전용)

hostRoutes.get("/defaults", async (c) => {
  if (!isMaster(await hostScope(c))) return denied(c);
  return c.json(await registry(c.env).getDefaults());
});

hostRoutes.put("/defaults", async (c) => {
  if (!isMaster(await hostScope(c))) return denied(c);
  const body = await json<Defaults & { masterPin?: string }>(c);
  if (!validDefaults(body)) return apiError(c, "bad_request");

  const next = await registry(c.env).putDefaults(
    {
      maxPre: body.maxPre,
      maxParty: body.maxParty,
      regOpenAfterH: body.regOpenAfterH,
      voteWindowH: body.voteWindowH,
    },
    body.masterPin,
  );
  // 공통 PIN 을 기존 회차 PIN 과 같게 만드는 것도 막는다 (입력 시점 차단, ADR-3)
  if (next === "pin_collision") return apiError(c, "pin_collision", HOST.pin.usedByEvent);
  return c.json(next);
});

hostRoutes.post("/defaults/reset", async (c) => {
  if (!isMaster(await hostScope(c))) return denied(c);
  return c.json(await registry(c.env).resetDefaults());
});

// ─────────────────────────────────── 회차 목록·생성 (공통 PIN 전용)

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

  const reg = registry(c.env);
  const masterPin = await reg.getMasterPin(c.env.MASTER_PIN);
  if (body.pin && pinCollides(String(body.pin), masterPin)) {
    return apiError(c, "pin_collision", HOST.pin.sameAsMaster(masterPin));
  }

  // 'now' 는 시각이 아니라 리터럴로 받는다 — datetime-local 이 초를 버리기 때문 (UI.md)
  const openNow = body.regOpenAt === "now";
  const regOpenAt = openNow ? now : Number(body.regOpenAt);
  const voteCloseAt = Number(body.voteCloseAt);
  if (!Number.isFinite(regOpenAt) || !Number.isFinite(voteCloseAt)) return apiError(c, "bad_request");
  // 순서 검증은 **운영자가 고른 두 시각** 사이에서만 한다.
  // '지금 바로'는 고른 시각이 아니라 버튼이라서, 마감이 이미 지났더라도 회차는 만들어진다 —
  // 그 상황은 사전 투표 시작 확인창의 ⚠️ 경고(PREVOTE_ALREADY_CLOSED)가 맡는다.
  if (!openNow && voteCloseAt <= regOpenAt) return apiError(c, "schedule_order");

  const reserved = await reg.reserve({
    code: body.code,
    pin: body.pin,
    requestId: String(body.requestId),
    masterPin,
    now,
  });
  if (!reserved.ok) {
    return reserved.error === "code_taken"
      ? apiError(c, "code_taken", HOST.pin.codeTaken)
      : apiError(c, "pin_collision", HOST.pin.sameAsMaster(masterPin));
  }

  const meta = await eventStub(c.env, reserved.id).init({
    id: reserved.id,
    name: body.name.trim(),
    code: reserved.code,
    phase: openNow ? "reg" : "prep",
    fired: openNow ? { reg: now } : {},
    schedule: { regOpenAt, voteCloseAt },
    config: { maxPre: body.config.maxPre, maxParty: body.config.maxParty },
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

/** 이름·PIN·입장 코드·콕 횟수. 코드와 PIN 의 유일성은 레지스트리가 판정한다 */
hostRoutes.put("/events/:id", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<EventPatch>(c);
  if (body.config && !validConfig(body.config)) return apiError(c, "bad_request");

  const reg = registry(c.env);
  if (body.pin || body.code) {
    const masterPin = await reg.getMasterPin(c.env.MASTER_PIN);
    const res = await reg.updateIdentity(gate.id, { code: body.code, pin: body.pin }, masterPin);
    if (!res.ok) {
      if (res.error === "code_taken") return apiError(c, "code_taken", HOST.pin.codeTaken);
      if (res.error === "pin_collision") {
        return apiError(c, "pin_collision", HOST.pin.sameAsMaster(masterPin));
      }
      return apiError(c, "not_found");
    }
  }

  const { value, response } = unwrap(
    c,
    await gate.stub.patchMeta({ name: body.name, code: body.code, config: body.config }, serverNow()),
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

hostRoutes.post("/events/:id/seating/reopen", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { response } = unwrap(c, await gate.stub.reopenSeating());
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

hostRoutes.delete("/events/:id/as/:pid/poke/:toId", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { value, response } = unwrap(
    c,
    await gate.stub.unpoke(c.req.param("pid"), c.req.param("toId"), serverNow()),
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

/** 그 회차를 열 수 있는지 확인하고 손잡이를 준다. 없는 회차는 404, 남의 회차는 403 */
async function openEvent(c: Ctx) {
  const id = c.req.param("id")!;
  const scope = await hostScope(c);
  if (!scope) return { response: apiError(c, "unauthorized"), id, stub: null as never };
  if (!canOpenEvent(scope, id)) return { response: apiError(c, "forbidden"), id, stub: null as never };
  if (!(await registry(c.env).hasEvent(id))) {
    return { response: apiError(c, "not_found"), id, stub: null as never };
  }
  return { response: null, id, stub: eventStub(c.env, id) };
}

function denied(c: Ctx) {
  // 로그인 자체가 없으면 401, 회차 PIN 으로 목록에 손대면 403
  return hostScope(c).then((scope) => (scope ? apiError(c, "forbidden") : apiError(c, "unauthorized")));
}

async function json<T>(c: Ctx): Promise<T> {
  return (await c.req.json().catch(() => ({}))) as T;
}

function validConfig(config: { maxPre: number; maxParty: number } | undefined): boolean {
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
    Number.isFinite(d.regOpenAfterH) &&
    d.regOpenAfterH >= 0 &&
    Number.isFinite(d.voteWindowH) &&
    d.voteWindowH > 0
  );
}
