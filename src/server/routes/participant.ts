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
import type { RegisterInput } from "../../shared/types.ts";
import { ENTRY } from "../../shared/copy.ts";
import { PLAYER_COOKIE, sessionTtl, setCookie, signSession } from "../auth.ts";
import {
  apiError,
  eventStub,
  isSecure,
  playerScope,
  registry,
  serverNow,
  unwrap,
  type Ctx,
  type Env,
} from "../http.ts";
import { pokeMessage, registerMessage } from "../messages.ts";

export const participantRoutes = new Hono<{ Bindings: Env }>();

/** 입장 코드 조회. 인증이 없으므로 `PublicEvent` 밖의 필드를 절대 넣지 않는다 */
participantRoutes.get("/events/by-code/:code", async (c) => {
  const id = await registry(c.env).idByCode(c.req.param("code"));
  if (!id) return apiError(c, "not_found", ENTRY.notFound);
  const { value, response } = unwrap(c, await eventStub(c.env, id).publicAt(serverNow()), () => ENTRY.notFound);
  return response ?? c.json(value);
});

participantRoutes.post("/events/:code/register", async (c) => {
  const id = await registry(c.env).idByCode(c.req.param("code"));
  if (!id) return apiError(c, "not_found", ENTRY.notFound);

  const input = (await c.req.json().catch(() => ({}))) as RegisterInput;
  // 회차 DO 는 요청을 순차 처리한다. 등록이 몰리는 순간을 위해 왕복을 한 번으로 줄였다
  const result = await eventStub(c.env, id).registerAndLoad(input, serverNow());
  const { value, response } = unwrap(c, result, registerMessage(String(input.nickname ?? "")));
  if (response) return response;

  const scope = { kind: "player", eventId: id, playerId: value!.state.me.id } as const;
  const token = await signSession(scope, c.env.SESSION_SECRET, serverNow());
  c.header("set-cookie", setCookie(PLAYER_COOKIE, token, isSecure(c), sessionTtl(scope)));
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

  const asked = c.req.query("code");
  if (asked && asked.toUpperCase() !== value!.event.code) return apiError(c, "unauthorized", ENTRY.notFound);
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
