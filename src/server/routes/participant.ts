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
import { ENTRY, FORTUNE, ME } from "../../shared/copy.ts";
import { canOpenFortune } from "../../shared/phase.ts";
import { fortuneInput, missionInput, validBirth } from "../../shared/fortune.ts";
import { makeFortune, makeMission } from "../fortune.ts";
import { normalizePhone } from "../../shared/constants.ts";
import { todayIn } from "../../shared/time.ts";
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
/*
 * 코드로 회차를 찾던 길(`/events/by-code/:code`)을 닫았다.
 *
 * 그 응답에는 **회차 아이디**가 들어 있었다. 즉 30비트 코드(32^6)를 뚫으면
 * 64비트 링크가 그대로 나왔다 — 링크의 강도가 코드까지 내려가 있었던 셈이다.
 * 이제 문은 참가 링크 하나뿐이고, 코드는 참가자 주소(`/e/:code`)를 가리키는 이름으로만 남는다.
 */

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
  // 회차는 멀쩡한데 **내가** 없는 경우가 있다 — 운영자가 참가자를 지웠을 때.
  // 여기서 아무 말도 안 하면 화면이 "그런 회차가 없어요" 라고 거짓말한다
  const { value, response } = unwrap(c, await seat.stub.participantState(seat.playerId, serverNow()), () => ENTRY.removed);
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

/**
 * 오늘의 연애운을 연다 (ADR-20).
 *
 * 이미 연 사람에게는 저장된 것을 그대로 준다 — 열 때마다 달라지면 전부 거짓말이 된다.
 * LLM 호출은 **Worker 에서** 한다. DO 안에서 기다리면 그 회차 전체가 멈춘다.
 */
participantRoutes.post("/fortune", async (c) => {
  const seat = await seatOf(c);
  if (!seat) return apiError(c, "unauthorized");

  const state = await seat.stub.participantState(seat.playerId, serverNow());
  if (!state.ok) return apiError(c, "not_found");
  // 파티가 시작돼야 열린다. 그 전에는 탭도 없다
  if (!canOpenFortune(state.value.event.phase)) return apiError(c, "closed", FORTUNE.closed);
  // 한 번 연 운세는 다시 만들지 않는다 (ADR-20)
  if (state.value.fortune) return c.json(state.value.fortune);

  // 생년월일은 여기서 읽고 여기서 버린다 — LLM 전송에만 쓰고 저장하지 않는다 (ADR-20)
  const body = (await c.req.json().catch(() => ({}))) as { birth?: unknown };
  let birth: { year: number; month: number; day: number } | undefined;
  if (body.birth !== undefined) {
    const t = String(body.birth);
    const [year, month, day] = [Number(t.slice(0, 4)), Number(t.slice(4, 6)), Number(t.slice(6, 8))];
    if (!/^[0-9]{8}$/.test(t) || !validBirth(year, month, day)) {
      return apiError(c, "bad_request", FORTUNE.birthBad);
    }
    birth = { year, month, day };
  }

  /*
   * **운세만 만든다.** 미션은 참가자가 그 카드를 뒤집을 때 따로 부른다 —
   * 여는 동작이 있어야 그 한 줄이 오늘 것처럼 읽히고(ADR-20),
   * 안 열어 본 사람 몫은 아예 만들지 않는다.
   *
   * 오늘 날짜는 **파티가 열리는 지역 기준**이다 (`todayIn`). UTC 로 자르면 자정 넘은 파티가
   * 어제 날짜를 읽는다.
   */
  const now = serverNow();
  const made = await makeFortune(c.env, fortuneInput(state.value.me, todayIn(now), birth), now);
  const { value, response } = unwrap(c, await seat.stub.saveFortune(seat.playerId, made));
  return response ?? c.json(value);
});

/**
 * 오늘의 미션. **운세를 연 뒤에만** 부를 수 있다 — 재료가 그 운세라서.
 *
 * 한 번 연 미션은 다시 만들지 않는다 (ADR-20). 두 번 눌러도 같은 문장이 온다.
 */
participantRoutes.post("/fortune/mission", async (c) => {
  const seat = await seatOf(c);
  if (!seat) return apiError(c, "unauthorized");

  const state = await seat.stub.participantState(seat.playerId, serverNow());
  if (!state.ok) return apiError(c, "not_found");
  const saved = state.value.fortune;
  // 운세가 없으면 재료가 없다. 화면에서도 이 버튼은 운세가 나온 뒤에야 뜬다
  if (!saved) return apiError(c, "closed", FORTUNE.closed);
  if (saved.mission) return c.json(saved);

  // 두 칸이 함께 온다 — 왜 오늘 이것인지(`lead`)와 언제 무엇을(`mission`)
  const made = await makeMission(c.env, missionInput(state.value.me, saved));
  // 운세 본문은 건드리지 않는 전용 경로다 — `saveFortune` 로 덮으면 ADR-20 이 무너진다
  const { value, response } = unwrap(c, await seat.stub.saveMission(seat.playerId, made));
  return response ?? c.json(value);
});

/**
 * 내 정보 고치기. 사전 투표가 열리기 전까지만 열려 있다 (ADR-31).
 *
 * 입력은 등록과 같은 모양이다 — **전화번호는 그 모양에 없다** (ADR-15).
 * 고칠 사람은 쿠키에서 온다. 본문에 담긴 id 는 읽지 않는다.
 */
participantRoutes.put("/me", async (c) => {
  const seat = await seatOf(c);
  if (!seat) return apiError(c, "unauthorized");
  const input = (await c.req.json().catch(() => ({}))) as RegisterInput;
  const nickTaken = registerMessage(String(input.nickname ?? ""));
  const { value, response } = unwrap(
    c,
    await seat.stub.editProfile(seat.playerId, input, serverNow()),
    (error) => (error === "closed" ? ME.locked : nickTaken(error)),
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
