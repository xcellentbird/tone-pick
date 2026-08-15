/**
 * 참가자 API.
 *
 * ⚠️ 여기서 나가는 응답에 실명·전화번호·인스타가 섞이면 안 된다.
 *    반드시 `toPublic()` 을 거칠 것. 발표 전에는 콕 발신자 정보도 응답에 없어야 한다.
 *    (개발자 도구로 응답을 열어보는 참가자가 반드시 있다)
 *
 *    참가자 응답을 만드는 곳은 EventDO 의 participantState() 하나뿐이다.
 *    새 화면이 필요해도 여기서 자료를 조립하지 말고 그쪽을 넓혀라.
 */
import { Hono } from "hono";
import type { EnterResult, RegisterInput } from "../../shared/types.ts";
import { ENTRY } from "../../shared/copy.ts";
import { normalizePhone } from "../../shared/constants.ts";
import {
  INVITE_COOKIE,
  PLAYER_COOKIE,
  clearCookie,
  sessionTtl,
  setCookie,
  signSession,
} from "../auth.ts";
import {
  apiError,
  eventStub,
  inviteScope,
  ipHash,
  isSecure,
  playerScope,
  registry,
  serverNow,
  unwrap,
  type Ctx,
  type Env,
} from "../http.ts";
import { enterMessage, pokeMessage, registerMessage } from "../messages.ts";

export const participantRoutes = new Hono<{ Bindings: Env }>();

/**
 * 참가 링크가 여는 화면. 회차 이름과 단계만 준다 — **입장 코드는 주지 않는다**.
 *
 * 링크는 "어느 파티인가"까지만 알려주고, 문을 여는 건 **초대 명단에 있는 전화번호**다 (ADR-15).
 */
participantRoutes.get("/events/by-id/:id", async (c) => {
  const id = c.req.param("id");
  if (!(await registry(c.env).hasEvent(id))) return apiError(c, "not_found", ENTRY.notFound);
  const { value, response } = unwrap(c, await eventStub(c.env, id).publicAt(serverNow()), () => ENTRY.notFound);
  return response ?? c.json(value);
});

/** 입장 코드 조회. 인증이 없으므로 `PublicEvent` 밖의 필드를 절대 넣지 않는다 */
participantRoutes.get("/events/by-code/:code", async (c) => {
  const id = await registry(c.env).idByCode(c.req.param("code"));
  if (!id) return apiError(c, "not_found", ENTRY.notFound);
  const { value, response } = unwrap(c, await eventStub(c.env, id).publicAt(serverNow()), () => ENTRY.notFound);
  return response ?? c.json(value);
});

/**
 * 입장. **운영자가 미리 넣어둔 번호만 통과한다** (ADR-15).
 *
 * 통과한 번호는 쿠키에 서명해 담는다 — 등록 폼이 번호를 다시 받으면
 * 명단에 없는 번호로 바꿔 낼 수 있다. 이미 등록한 사람에게는 곧바로 참가자 세션을 준다.
 *
 * 이 문은 인증 없이 열려 있어서 시도 횟수를 센다. 제한이 없으면
 * "이 번호가 이 파티에 있나"를 되묻는 창구가 된다.
 */
participantRoutes.post("/events/:id/enter", async (c) => {
  const id = c.req.param("id");
  if (!(await registry(c.env).hasEvent(id))) return apiError(c, "not_found", ENTRY.notFound);

  const body = (await c.req.json().catch(() => ({}))) as { phone?: string };
  const phone = normalizePhone(String(body.phone ?? ""));
  if (phone.length < 9) return apiError(c, "bad_request", ENTRY.phoneBad);

  const { value, response } = unwrap(
    c,
    await eventStub(c.env, id).checkEntry(phone, await ipHash(c, id), serverNow()),
    enterMessage,
  );
  if (response) return response;

  const result = value as EnterResult;
  // 이미 등록을 마친 사람에게는 곧바로 참가자 세션을 준다. 번호가 곧 재접속 키다
  const scope = result.registered
    ? await playerScopeFor(c, id, phone)
    : ({ kind: "invited", eventId: id, phone } as const);
  if (!scope) return apiError(c, "not_found", ENTRY.notFound);

  const token = await signSession(scope, c.env.SESSION_SECRET, serverNow());
  const cookie = scope.kind === "player" ? PLAYER_COOKIE : INVITE_COOKIE;
  c.header("set-cookie", setCookie(cookie, token, isSecure(c), sessionTtl(scope)));
  return c.json(result);
});

/**
 * 등록. 번호는 **초대 쿠키에서** 꺼낸다 — 폼에서 받지 않는다.
 * 등록이 끝나면 초대 쿠키를 비우고 참가자 세션으로 바꾼다.
 */
participantRoutes.post("/register", async (c) => {
  const scope = await inviteScope(c);
  if (!scope) return apiError(c, "unauthorized", ENTRY.enterAgain);

  const input = (await c.req.json().catch(() => ({}))) as RegisterInput;
  // 회차 DO 는 요청을 순차 처리한다. 등록이 몰리는 순간을 위해 왕복을 한 번으로 줄였다
  const result = await eventStub(c.env, scope.eventId).registerAndLoad(input, scope.phone, serverNow());
  const { value, response } = unwrap(c, result, registerMessage(String(input.nickname ?? "")));
  if (response) return response;

  const player = { kind: "player", eventId: scope.eventId, playerId: value!.state.me.id } as const;
  const token = await signSession(player, c.env.SESSION_SECRET, serverNow());
  c.header("set-cookie", setCookie(PLAYER_COOKIE, token, isSecure(c), sessionTtl(player)));
  // 두 번째 쿠키는 **덧붙여야** 한다. 그냥 쓰면 앞의 참가자 세션을 덮어써서 로그인이 날아간다
  c.header("set-cookie", clearCookie(INVITE_COOKIE, isSecure(c)), { append: true });
  return c.json(value);
});

/**
 * 한 브라우저에 참가자 세션은 하나뿐이다. 다른 회차에 등록하면 앞의 세션이 덮인다.
 * 그때 `/e/앞회차코드` 를 열면 **다른 회차의 자료가 그 URL 로 보인다** —
 * 그래서 화면이 어느 회차를 보고 있는지 함께 받아 확인한다.
 */
participantRoutes.get("/me", async (c) => {
  const seat = await seatOf(c);
  if (!seat) return apiError(c, "unauthorized");
  const { value, response } = unwrap(c, await seat.stub.participantState(seat.playerId, serverNow()));
  if (response) return response;

  // 화면은 코드로도(참가자 탭), 회차 아이디로도(참가 링크) 물어볼 수 있다
  const askedCode = c.req.query("code");
  const askedId = c.req.query("event");
  if (askedCode && askedCode.toUpperCase() !== value!.event.code) {
    return apiError(c, "unauthorized", ENTRY.notFound);
  }
  if (askedId && askedId !== value!.event.id) return apiError(c, "unauthorized", ENTRY.notFound);
  return c.json(value);
});

participantRoutes.post("/poke", async (c) => {
  const seat = await seatOf(c);
  if (!seat) return apiError(c, "unauthorized");
  const body = (await c.req.json().catch(() => ({}))) as { toId?: string };
  if (!body.toId) return apiError(c, "bad_request");
  const { value, response } = unwrap(
    c,
    await seat.stub.poke(seat.playerId, body.toId, serverNow()),
    pokeMessage,
  );
  return response ?? c.json(value);
});

participantRoutes.post("/seat/ack", async (c) => {
  const seat = await seatOf(c);
  if (!seat) return apiError(c, "unauthorized");
  const body = (await c.req.json().catch(() => ({}))) as { round?: number };
  const { response } = unwrap(c, await seat.stub.ackSeat(seat.playerId, Number(body.round)));
  return response ?? c.json({ ok: true });
});

/** 참가자 세션. URL 이 아니라 HttpOnly 쿠키에서만 참가자를 알아낸다 */
async function seatOf(c: Ctx) {
  const scope = await playerScope(c);
  if (scope?.kind !== "player") return null;
  return { playerId: scope.playerId, stub: eventStub(c.env, scope.eventId) };
}

/** 이미 등록한 사람의 세션. 번호로 그 사람을 찾는다 */
async function playerScopeFor(c: Ctx, eventId: string, phone: string) {
  const found = await eventStub(c.env, eventId).playerIdByPhone(phone);
  return found.ok && found.value ? ({ kind: "player", eventId, playerId: found.value } as const) : null;
}
