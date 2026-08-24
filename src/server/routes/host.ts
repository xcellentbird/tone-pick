/**
 * 운영자 API. 인증은 여기서 끝내고, 상태 변경은 전부 EventDO 안에서 한다.
 *
 * 권한은 **한 종류뿐**이다 — 운영자 PIN 을 통과했는가. 회차마다 PIN 을 두지 않는다 (ADR-12).
 */
import { Hono } from "hono";
import type {
  AnnounceInput,
  CreateEventInput,
  Defaults,
  EventConfig,
  EventPatch,
  EventSchedule,
  EventSummary,
  Phase,
  SeatingInput,
} from "../../shared/types.ts";
import { HOST, HOST_UI } from "../../shared/copy.ts";
import { LIMITS } from "../../shared/constants.ts";
import { PHASE_ORDER } from "../../shared/phase.ts";
import { HOST_COOKIE, resolvePin, sessionTtl, setCookie, signSession } from "../auth.ts";
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
import { seatingMessage, settingsMessage } from "../messages.ts";

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
      place: String(body.place ?? "").trim().slice(0, LIMITS.placeMax),
      prevoteBeforeH: body.prevoteBeforeH,
      voteEndBeforeH: body.voteEndBeforeH,
      revealAfterH: body.revealAfterH,
      inviteTemplate: String(body.inviteTemplate ?? "").slice(0, LIMITS.inviteTemplateMax),
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

  /*
   * **등록은 만드는 순간 열린다** (ADR-38). 시각을 받지 않으므로 순서를 검증할 두 시각도 없다.
   * 매력 투표 시작이 이미 지났더라도 회차는 만들어진다 — 그때는 둘이 곧바로 이어서 열린다.
   */
  const partyAt = Number(body.partyAt);
  const prevoteAt = Number(body.prevoteAt);
  const voteEndAt = Number(body.voteEndAt);
  const revealAt = Number(body.revealAt);
  if (![partyAt, prevoteAt, voteEndAt, revealAt].every(Number.isFinite)) return apiError(c, "bad_request");
  // 발표가 파티보다 앞이면 파티가 시작되자마자 끝난다 (ADR-43)
  if (revealAt <= partyAt) return apiError(c, "bad_request");

  const reserved = await registry(c.env).reserve({
    code: body.code,
    requestId: String(body.requestId),
    now,
  });
  if (!reserved.ok) return apiError(c, "code_taken", HOST.pin.codeTaken);

  const place = String(body.place ?? "").trim().slice(0, LIMITS.placeMax);
  const meta = await eventStub(c.env, reserved.id).init({
    id: reserved.id,
    name: body.name.trim(),
    ...(place ? { place } : {}),
    code: reserved.code,
    // 만드는 순간 등록이 열린다. 시각은 **기록으로** 남긴다 — 지나간 예약을 지우지 않는 것과 같다
    phase: "reg",
    fired: { reg: now },
    schedule: { partyAt, regOpenAt: now, prevoteAt, voteEndAt, revealAt },
    // 좁혔을 때만 적는다. 기본값을 굳이 써 넣으면 설정의 모양이 회차마다 달라진다
    config: {
      maxPre: body.config.maxPre,
      maxParty: body.config.maxParty,
      ...(body.config.allowSameGender === false ? { allowSameGender: false } : {}),
      // 기본은 '되돌릴 수 있다' 와 '알리지 않는다' 다 (ADR-34)
      ...(body.config.allowUndo === false ? { allowUndo: false } : {}),
      ...(body.config.allowUndoPre === false ? { allowUndoPre: false } : {}),
      ...(body.config.preNotify === true ? { preNotify: true } : {}),
      ...(body.config.pokeNotify === true ? { pokeNotify: true } : {}),
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
 * 이름·장소·콕 횟수·파기 일수. **입장 코드는 바꾸지 않는다** (ADR-22) —
 * 이미 나간 링크와 안내가 어긋나고 되돌릴 방법이 없다. 코드를 보내와도 무시한다.
 *
 * 콕 대상·되돌리기·알림은 콕이 오가기 시작하면 굳는다 (ADR-35). DO 가 거절한다.
 */
hostRoutes.put("/events/:id", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<EventPatch>(c);
  if (body.config && !validConfig(body.config)) return apiError(c, "bad_request");

  const { value, response } = unwrap(
    c,
    await gate.stub.patchMeta({ name: body.name, place: body.place, config: body.config }, serverNow()),
    settingsMessage,
  );
  return response ?? c.json(value);
});

hostRoutes.put("/events/:id/schedule", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<EventSchedule>(c);
  const { value, response } = unwrap(c, await gate.stub.setSchedule(body, serverNow()), settingsMessage);
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

// ─────────────────────────────────── 초대 명단 (ADR-15)

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

// ─────────────────────────────────── 운영자가 보내는 알림 (슬라이스 14)

hostRoutes.post("/events/:id/announcements", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  // 바깥에서 온 값이라 Partial 이다. 모양은 계약(AnnounceInput)이 정한다
  const body = await json<Partial<AnnounceInput>>(c);
  const { value, response } = unwrap(
    c,
    await gate.stub.announce({ text: String(body.text ?? ""), poll: body.poll }, serverNow()),
  );
  return response ?? c.json(value);
});

/** 닫기·다시 열기. **되돌릴 수 있으므로 확인창이 없다** — 길도 하나면 된다 */
hostRoutes.put("/events/:id/announcements/:aid", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<{ open?: unknown }>(c);
  if (typeof body.open !== "boolean") return apiError(c, "bad_request");
  const { value, response } = unwrap(
    c,
    await gate.stub.setAnnouncementOpen(c.req.param("aid"), body.open, serverNow()),
  );
  return response ?? c.json(value);
});

hostRoutes.delete("/events/:id/announcements/:aid", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const { response } = unwrap(c, await gate.stub.removeAnnouncement(c.req.param("aid")));
  return response ?? c.body(null, 204);
});

// ─────────────────────────────────── 자리

hostRoutes.post("/events/:id/seating", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  // 값이 없을 수도 있는 바깥 입력이라 Partial 이다. 모양은 계약(SeatingInput)이 정한다
  const body = await json<Partial<SeatingInput>>(c);
  const { value, response } = unwrap(
    c,
    await gate.stub.makeSeating(
      Number(body.tableCount),
      !!body.final,
      // 바깥에서 온 목록이다. 문자열만 통과시켜 DO 가 이상한 값을 만나지 않게 한다
      Array.isArray(body.exclude) ? body.exclude.map(String) : [],
      serverNow(),
    ),
    seatingMessage,
  );
  return response ?? c.json(value);
});

/**
 * 라운드 하나를 고치는 조작 셋. **초안이든 발행된 것이든 같은 길로 간다** (슬라이스 11).
 *
 * `round` 를 안 주면 초안이다 — 운영자가 지금 보고 있는 카드가 어느 것인지는 화면이 안다.
 * 발행된 라운드를 고쳐도 자리 이동 확인은 뜨지 않는다. 화면은 방송으로 다시 읽는다.
 */
hostRoutes.post("/events/:id/seating/swap", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<{ a?: string; b?: string; round?: number }>(c);
  if (!body.a || !body.b) return apiError(c, "bad_request");
  const { value, response } = unwrap(c, await gate.stub.swapSeats(body.a, body.b, body.round));
  return response ?? c.json(value);
});

/** 자리 없는 사람을 앉힌다. **테이블은 받지 않는다** — 서버가 고른다 (SEATING.md) */
hostRoutes.post("/events/:id/seating/seat", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<{ playerId?: string; round?: number }>(c);
  if (!body.playerId) return apiError(c, "bad_request");
  const { value, response } = unwrap(c, await gate.stub.seatPlayer(body.playerId, body.round));
  return response ?? c.json(value);
});

/** 이 라운드 자리에서만 뺀다. 참가자를 지우는 길(`DELETE /players/:id`)과 다른 일이다 */
hostRoutes.post("/events/:id/seating/unseat", async (c) => {
  const gate = await openEvent(c);
  if (gate.response) return gate.response;
  const body = await json<{ playerId?: string; round?: number }>(c);
  if (!body.playerId) return apiError(c, "bad_request");
  const { value, response } = unwrap(c, await gate.stub.unseatPlayer(body.playerId, body.round));
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
  const { maxPre, maxParty, allowSameGender, allowUndo, allowUndoPre, preNotify, pokeNotify } = config;
  /*
   * 없으면 기본값이다. 있으면 불리언이어야 한다 — `"true"` 라는 글자가 들어오면 안 된다.
   * **굳는 규칙 다섯이 다 여기 있어야 한다** (ADR-35). 하나가 빠지면 그 값만
   * 이상한 것이 들어와도 조용히 기본값으로 접히고, 운영자는 고른 대로 저장된 줄 안다.
   */
  for (const flag of [allowSameGender, allowUndo, allowUndoPre, preNotify, pokeNotify]) {
    if (flag !== undefined && typeof flag !== "boolean") return false;
  }
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
  /*
   * 등록 시작 오프셋은 사라졌다 (ADR-38) — 회차를 만드는 순간 열린다.
   * 그래서 "사전 투표가 등록보다 먼저 열리면 안 된다" 는 순서 검사도 함께 없앴다.
   * 매력 투표가 회차를 만드는 시점보다 앞이면 등록과 곧바로 이어 열릴 뿐, 어긋나지 않는다.
   */
  return (
    validConfig(d) &&
    (d.place === undefined || typeof d.place === "string") &&
    Number.isFinite(d.prevoteBeforeH) &&
    d.prevoteBeforeH >= 0 &&
    Number.isFinite(d.voteEndBeforeH) &&
    d.voteEndBeforeH >= 0 &&
    // 발표만 파티 **뒤**를 잰다 (ADR-43). 0 이면 파티 시작과 동시에 발표라 뜻이 없다
    Number.isFinite(d.revealAfterH) &&
    d.revealAfterH > 0
  );
}
