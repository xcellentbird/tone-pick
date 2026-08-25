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
import type { EnterResult, EntryOutcome, RegisterInput } from "../../shared/types.ts";
import { ENTRY, FORTUNE, ME } from "../../shared/copy.ts";
import { canOpenFortune, canOpenMission } from "../../shared/phase.ts";
import { fortuneInput, missionInput, validBirth } from "../../shared/fortune.ts";
import { makeFortune, makeMission } from "../fortune.ts";
import { count } from "../metrics.ts";
import { todayIn } from "../../shared/time.ts";
import {
  INVITE_COOKIE,
  PLAYER_COOKIE,
  clearCookie,
  cookieName,
  newRef,
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
  sessionRef,
  unwrap,
  type Ctx,
  type Env,
} from "../http.ts";
import { enterMessage, pokeMessage, registerMessage } from "../messages.ts";

export const participantRoutes = new Hono<{ Bindings: Env }>();

/**
 * 참가 링크가 여는 화면. 회차 이름과 단계만 준다 — **입장 코드는 주지 않는다**.
 *
 * **토큰이 있어야 열린다** (ADR-32). 경로에서 토큰을 빼는 것만으로는 모자랐다 —
 * 이 응답이 열려 있으면 **회차 아이디만으로 파티 이름·일정이 나온다.**
 * `by-code` 오라클을 걷어낸 것과 같은 종류라, 길을 하나 막을 때 옆문도 같이 본다.
 *
 * 회차가 없든 토큰이 틀렸든 **같은 답**이다. 가르면 그 구분이 곧 답이 된다.
 */
participantRoutes.get("/events/by-id/:id", async (c) => {
  const id = c.req.param("id");
  const link = String(c.req.query("t") ?? "").trim();
  if (!link || !(await registry(c.env).hasEvent(id))) return apiError(c, "not_found", ENTRY.notFound);

  const link_ = await eventStub(c.env, id).tokenState(link);
  if (!link_.ok || !link_.value.known) return apiError(c, "not_found", ENTRY.notFound);

  const { value, response } = unwrap(c, await eventStub(c.env, id).publicAt(serverNow()), () => ENTRY.notFound);
  // 이미 등록한 사람에게 `등록하기` 라고 하면 두 번 등록하려 든다. 실제로 나온 신고다
  return response ?? c.json({ ...value!, registered: link_.value.registered });
});
/*
 * 코드로 회차를 찾던 길(`/events/by-code/:code`)을 닫았다.
 *
 * 그 응답에는 **회차 아이디**가 들어 있었다. 즉 30비트 코드(32^6)를 뚫으면
 * 64비트 링크가 그대로 나왔다 — 링크의 강도가 코드까지 내려가 있었던 셈이다.
 * 이제 문은 참가 링크 하나뿐이고, 코드는 참가자 주소(`/e/:code`)를 가리키는 이름으로만 남는다.
 */

/**
 * 입장. **명단 한 줄의 토큰만 통과한다** (ADR-32) — 참가자는 번호를 치지 않는다.
 *
 * 통과한 토큰은 쿠키에 서명해 담는다 — 등록 폼이 번호를 받으면
 * 명단에 없는 번호로 바꿔 낼 수 있어서, 번호는 회차 DO 안에서만 푼다.
 * 이미 등록한 사람에게는 곧바로 참가자 세션을 준다.
 *
 * 이 문은 인증 없이 열려 있어서 시도 횟수를 센다. 제한이 없으면
 * "이 번호가 이 파티에 있나"를 되묻는 창구가 된다.
 */
participantRoutes.post("/events/:id/enter", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { token?: string };
  const link = String(body.token ?? "").trim();

  /*
   * **없는 회차도 "초대되지 않았어요" 라고 답한다** (S-A4). 여기서 `not_found` 를 주면
   * "그런 회차가 없다" 와 "너는 명단에 없다" 가 갈리고, 그 갈림이 곧 답이 된다.
   */
  if (!link || !(await registry(c.env).hasEvent(id))) {
    count(c.env, id, { kind: "enter", outcome: "not_invited" });
    return apiError(c, "forbidden", ENTRY.notInvited);
  }

  const checked = await eventStub(c.env, id).checkEntry(link, await ipHash(c, id), serverNow());
  /*
   * **입장 결과를 센다.** 명단 문제는 조용히 쌓인다 — 참가자는 "안 되네" 하고 말지
   * 운영자에게 매번 말하지 않는다. 어제 iPhone 연락처의 `+82` 번호가 명단에 잘못
   * 들어간 것도 이 숫자가 있었으면 보였다.
   *
   * 번호도 사람도 담지 않는다. **결과 한 글자만** 센다 (`metrics.ts`).
   */
  count(c.env, id, {
    kind: "enter",
    outcome: checked.ok ? "ok" : checked.error === "too_many" ? "too_many" : "not_invited",
  });

  const { value, response } = unwrap(c, checked, enterMessage);
  if (response) return response;

  const result = value as EntryOutcome;
  /*
   * **쿠키에 번호를 담지 않는다** (ADR-32). 세션은 서명만 하고 암호화하지 않아서
   * 페이로드가 개발자 도구에 그대로 읽힌다 — 번호를 치지 않기로 했으면
   * 번호가 브라우저에 남을 이유도 없다. 번호는 회차 DO 안에서만 푼다.
   */
  const scope = result.registered
    ? await playerScopeFor(c, id, link)
    : ({ kind: "invited", eventId: id, token: link } as const);
  if (!scope) return apiError(c, "forbidden", ENTRY.notInvited);

  /*
   * **들어올 때마다 새 이름표를 준다** (ADR-44). 이 탭이 그걸 들고 다니면
   * 다른 탭이 다른 링크로 들어와도 서로를 덮지 않는다 — 링크가 사람마다 달라도
   * 세션이 하나면 소용이 없었다.
   */
  const ref = newRef();
  putSession(
    c,
    scope.kind === "player" ? PLAYER_COOKIE : INVITE_COOKIE,
    ref,
    await signSession(scope, c.env.SESSION_SECRET, serverNow()),
    sessionTtl(scope),
  );
  return c.json({ ...result, ref } satisfies EnterResult);
});

/**
 * 등록. 초대 쿠키에 든 것은 **토큰**이고, 번호는 회차 DO 가 그 토큰에서 푼다 (ADR-32) — 폼은 받지 않는다.
 * 등록이 끝나면 초대 쿠키를 비우고 참가자 세션으로 바꾼다.
 */
participantRoutes.post("/register", async (c) => {
  const scope = await inviteScope(c);
  if (!scope) return apiError(c, "unauthorized", ENTRY.enterAgain);

  const input = (await c.req.json().catch(() => ({}))) as RegisterInput;
  // 회차 DO 는 요청을 순차 처리한다. 등록이 몰리는 순간을 위해 왕복을 한 번으로 줄였다
  const result = await eventStub(c.env, scope.eventId).registerAndLoad(input, scope.token, serverNow());
  const { value, response } = unwrap(c, result, registerMessage(String(input.nickname ?? "")));
  if (response) return response;

  /*
   * **이름표는 들어온 것을 그대로 쓴다** (ADR-44). 새로 만들면 이 탭이 방금 만든 세션을
   * 놓치고, 기본 쿠키만 남아 다른 탭에 열린 참가자를 덮는다.
   */
  const ref = sessionRef(c);
  const player = { kind: "player", eventId: scope.eventId, playerId: value!.state.me.id } as const;
  putSession(c, PLAYER_COOKIE, ref, await signSession(player, c.env.SESSION_SECRET, serverNow()), sessionTtl(player));
  // 뒤따르는 쿠키는 **덧붙여야** 한다. 그냥 쓰면 앞의 참가자 세션을 덮어써서 로그인이 날아간다
  c.header("set-cookie", clearCookie(cookieName(INVITE_COOKIE, ref), isSecure(c)), { append: true });
  if (ref) c.header("set-cookie", clearCookie(INVITE_COOKIE, isSecure(c)), { append: true });
  return c.json(value);
});

/**
 * 세션 쿠키를 **두 벌** 심는다 (ADR-44).
 *
 * · `tp_play_<이름표>` — 이 탭의 것. 다른 탭이 다른 사람으로 들어와도 안 건드린다
 * · `tp_play`         — 이름표 없이 온 요청(링크를 닫고 앱 주소만 연 사람)이 읽을 기본값
 *
 * 기본값이 없으면 링크를 잃고 앱 주소만 다시 연 참가자가 로그인을 잃는다.
 * 기본값만 있으면 탭이 서로를 덮는다. 둘 다 필요하다.
 */
function putSession(c: Ctx, base: string, ref: string | undefined, token: string, ttl: number): void {
  c.header("set-cookie", setCookie(cookieName(base, ref), token, isSecure(c), ttl));
  if (ref) c.header("set-cookie", setCookie(base, token, isSecure(c), ttl), { append: true });
}

/**
 * 참가자 세션은 **탭마다** 다를 수 있다 (ADR-44). 다만 이름표 없이 온 요청은 기본 세션을
 * 읽고, 그건 마지막으로 들어온 사람이다 — 다른 회차에 들어가면 앞의 세션이 덮인다.
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
 * 콕 되돌리기 (ADR-34). **두 라운드 다 회차 설정을 따른다** — `allowUndoPre`·`allowUndo` 가 따로다.
 * 알림은 파생값이라 무르면 그 줄이 저절로 사라진다 (`noticesOf`).
 */
participantRoutes.post("/unpoke", async (c) => {
  const seat = await seatOf(c);
  if (!seat) return apiError(c, "unauthorized");
  const body = (await c.req.json().catch(() => ({}))) as { toId?: string };
  if (!body.toId) return apiError(c, "bad_request");
  const { value, response } = unwrap(
    c,
    await seat.stub.unpoke(seat.playerId, body.toId, serverNow()),
    pokeMessage,
  );
  return response ?? c.json(value);
});

/**
 * A/B 투표에 한 표 (슬라이스 14).
 *
 * **갱신된 알림 하나를 돌려준다.** 화면은 이 값을 그대로 쓰고 다시 읽지 않는다 —
 * 서버가 방금 준 답을 버리고 또 묻지 않는 게 슬라이스 17 에서 배운 것이다.
 */
participantRoutes.post("/vote", async (c) => {
  const seat = await seatOf(c);
  if (!seat) return apiError(c, "unauthorized");
  const body = (await c.req.json().catch(() => ({}))) as { id?: string; choice?: string };
  if (!body.id || (body.choice !== "a" && body.choice !== "b")) return apiError(c, "bad_request");
  const { value, response } = unwrap(c, await seat.stub.vote(seat.playerId, body.id, body.choice));
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

  // 명단·콕까지 빚는 `participantState()` 대신 **좁은 읽기**다. 파티 시작 때 인원 수만큼 열린다
  const ctx = await seat.stub.fortuneContext(seat.playerId, serverNow());
  if (!ctx.ok) return apiError(c, "not_found");
  // 매력 투표와 함께 열린다 (ADR-20 후기). 그 전에는 탭이 꺼져 있다
  if (!canOpenFortune(ctx.value.phase)) return apiError(c, "closed", FORTUNE.closed);
  // 한 번 연 운세는 다시 만들지 않는다 (ADR-20)
  if (ctx.value.fortune) return c.json(ctx.value.fortune);

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
   *
   * 그리고 **여는 시각이 아니라 파티 시각의 날짜**를 보낸다 (ADR-20 후기).
   * 매력 투표가 열린 뒤로 문이 앞당겨져서, 전날 밤에 연 사람은 어제 날짜로 운세를 받는다 —
   * 한 번 연 운세는 그대로 남으니(ADR-20) 파티 당일에 어제 것을 읽게 된다.
   * 세 문단이 말하는 `오늘` 은 언제 열었느냐가 아니라 **그 파티의 날**이다.
   */
  const now = serverNow();
  const made = await makeFortune(
    c.env,
    // 일정 없이 만든 회차에는 파티 시각이 없다. 그때만 지금을 쓴다
    fortuneInput(ctx.value.me, todayIn(ctx.value.partyAt ?? now), birth),
    now,
  );
  // LLM 이 조용히 죽어도 화면은 멀쩡히 뜬다 (ADR-20). 그래서 세지 않으면 아무도 모른다
  count(c.env, seat.eventId, { kind: "fortune", outcome: made.fallback ? "fallback" : "llm" });
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

  const ctx = await seat.stub.fortuneContext(seat.playerId, serverNow());
  if (!ctx.ok) return apiError(c, "not_found");
  /*
   * **미션의 문은 하나 늦다** (ADR-20 후기) — 파티장에서만 할 수 있는 것이라
   * 매력 투표 중에 뒤집으면 못 할 미션이 그대로 굳는다.
   */
  if (!canOpenMission(ctx.value.phase)) return apiError(c, "closed", FORTUNE.missionClosed);
  const saved = ctx.value.fortune;
  // 운세가 없으면 재료가 없다. 화면에서도 이 버튼은 운세가 나온 뒤에야 뜬다
  if (!saved) return apiError(c, "closed", FORTUNE.closed);
  if (saved.mission) return c.json(saved);

  // 두 칸이 함께 온다 — 왜 오늘 이것인지(`lead`)와 언제 무엇을(`mission`)
  const made = await makeMission(c.env, missionInput(ctx.value.me, saved));
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
  // eventId 도 함께 준다 — 지표가 회차별로 쌓이려면 필요하다 (사람은 안 담는다)
  return { playerId: scope.playerId, eventId: scope.eventId, stub: eventStub(c.env, scope.eventId) };
}

/** 이미 등록한 사람의 세션. **토큰으로** 그 사람을 찾는다 (ADR-32) — 번호로 찾던 길은 닫혔다 */
async function playerScopeFor(c: Ctx, eventId: string, token: string) {
  const found = await eventStub(c.env, eventId).playerIdByToken(token);
  return found.ok && found.value ? ({ kind: "player", eventId, playerId: found.value } as const) : null;
}
