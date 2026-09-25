/**
 * Worker 쪽 공통 재료 — 환경 타입, 서버 시각, DO 손잡이, 에러 응답, 인증 확인.
 *
 * 여기 있는 건 전부 "인증과 라우팅"이다. 상태를 바꾸는 코드는 한 줄도 두지 않는다.
 */
import type { MiddlewareHandler } from "hono";
import { pulse, type Who } from "./metrics.ts";
import type { Context } from "hono";
import type { ApiErrorBody, AuthScope, ErrorCode } from "../shared/types.ts";
import {
  HOST_COOKIE,
  INVITE_COOKIE,
  PLAYER_COOKIE,
  REF_HEADER,
  cookieName,
  readCookie,
  readSession,
} from "./auth.ts";
import type { EventDO, Result } from "./event-do.ts";
import type { RegistryDO } from "./registry-do.ts";

export interface Env {
  EVENT: DurableObjectNamespace<EventDO>;
  REGISTRY: DurableObjectNamespace<RegistryDO>;
  ASSETS: Fetcher;
  /**
   * 운영 카운터가 쌓이는 곳 (`metrics.ts`). **없어도 앱은 돈다** —
   * 지표는 있으면 좋은 것이지 없으면 안 되는 게 아니다. 테스트·로컬에는 없다.
   */
  METRICS?: AnalyticsEngineDataset;
  /**
   * 콕 로그 파일이 쌓이는 버킷 (ADR-84, `poke-log.ts`). **없어도 콕은 된다** — 테스트·로컬 밖에서
   * 빠지면 로그만 조용히 비므로, 두 환경 모두에 있는지는 `npm run check` 가 본다.
   */
  LOGS?: R2Bucket;
  MASTER_PIN: string;
  SESSION_SECRET: string;
  /** "1" 일 때만 테스트 전용 라우트를 **등록**한다. 런타임 분기가 아니라 존재 자체를 없앤다 */
  ALLOW_TEST_ENDPOINTS?: string;
  /**
   * 들여보낼 나라. 쉼표로 잇는다 (`"KR"`). **비어 있으면 문이 없다** (ADR-92).
   *
   * 설정값으로 둔 이유는 **끄는 길이 있어야** 해서다 — 파티 당일 로밍 중인 참가자가 막히면
   * 이 값을 비우고 배포하는 것이 유일한 되돌리기다. 회차 DO 에 두지 않은 건
   * 요청마다 DO 왕복이 생기기 때문이다 (바로 위 서버 시각 주석과 같은 이유).
   */
  ALLOWED_COUNTRIES?: string;
  /** 연습용 환경에만 있다. 있으면 화면 위에 띠가 떠서 진짜 파티와 헷갈리지 않게 한다 */
  ENV_LABEL?: string;
  /**
   * 오늘의 연애운을 쓰는 모델. **없어도 앱은 돈다** — 규칙 문구로 떨어진다 (ADR-20).
   * 모델과 주소를 설정으로 둬서 제공자가 바뀌어도 코드가 아니라 변수가 바뀐다.
   */
  OPENAI_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
  /**
   * 운세 호출의 temperature (ADR-60). **없으면 아예 안 보낸다** — 제공자 기본값을 쓴다.
   *
   * 설정으로 둔 이유는 이게 **재봐야 아는 값**이라서다. QA 에서 값을 바꿔가며
   * 마흔 명분을 뽑아 서로 얼마나 겹치는지 보고 정한다. 코드에 박아두면 그 실험이 배포가 된다.
   * 숫자가 아니면 무시한다 — 오타 하나로 그 회차의 운세가 전부 규칙 문구가 되면 안 된다.
   */
  LLM_TEMPERATURE?: string;
}

export type Ctx = Context<{ Bindings: Env }>;

// ─────────────────────────────────── 배포 안전장치
//
// 시크릿을 안 넣고 배포하면 조용히 뚫린다.
//   SESSION_SECRET 없음 → HMAC 키가 빈 문자열이 된다. 누구나 { kind: "master" } 쿠키를 위조할 수 있다
//   MASTER_PIN 없음     → PIN 비교에서 500 이 난다
// 앞의 것이 훨씬 위험하다 — 에러가 안 나고 그냥 열린다. 그래서 뜨기 전에 막는다.

export function missingSecrets(env: Partial<Env>): string[] {
  return (["MASTER_PIN", "SESSION_SECRET"] as const).filter((key) => !env[key]);
}

// ─────────────────────────────────── 서버 시각
//
// 단계 전환은 서버 시각으로만 판단한다. 클라이언트가 뭐라고 주장하든 보지 않는다.
// 오프셋은 테스트 전용 라우트에서만 움직인다 — 프로덕션에서는 언제나 0 이고,
// 그때는 레지스트리를 보러 가지도 않는다 (요청마다 DO 왕복을 만들지 않기 위해).

let offset = 0;

export function serverNow(): number {
  return Date.now() + offset;
}

/** 요청 시작마다 한 번. 테스트가 아니면 즉시 0 으로 되돌리고 끝난다 */
export async function syncClock(env: Env): Promise<void> {
  if (env.ALLOW_TEST_ENDPOINTS !== "1") {
    offset = 0;
    return;
  }
  offset = await registry(env).clockOffset();
}

export async function moveServerClock(env: Env, at: number): Promise<void> {
  offset = at - Date.now();
  await registry(env).setClockOffset(offset);
}

// ─────────────────────────────────── DO 손잡이

export function registry(env: Env) {
  return env.REGISTRY.get(env.REGISTRY.idFromName("registry"));
}

export function eventStub(env: Env, eventId: string) {
  return env.EVENT.get(env.EVENT.idFromName(eventId));
}

// ─────────────────────────────────── 응답

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  not_invited: 403,
  too_many: 429,
  pin_wrong: 403,
  pin_locked: 423,
  code_taken: 409,
  nick_taken: 409,
  closed: 409,
  no_budget: 409,
  same_gender: 409,
  locked: 409,
  conflict: 409,
  note_floor: 409,
  region_blocked: 403,
  bad_request: 400,
  order: 400,
};

export function apiError(c: Ctx, error: ErrorCode, message?: string) {
  // 표에 없는 코드가 오면 200 이 나간다 — 실패가 성공으로 보이는 최악의 조용한 실패다.
  // 그래서 기본값을 400 으로 둔다 (ADR-8)
  const status = (STATUS[error] ?? 400) as 400;
  // 계약(ApiErrorBody)에 맞춰 나간다 — 타입을 달아두면 모양이 어긋날 때 컴파일이 잡는다
  const body: ApiErrorBody = message ? { error, message } : { error };
  return c.json(body, status);
}

/**
 * DO 가 돌려준 실패 사유를 HTTP 로 옮긴다. 문구는 호출부가 정한다 —
 * DO 는 상태만 알고, 무슨 문장을 보여줄지는 화면 쪽 사정이기 때문이다.
 */
export function unwrap<T>(
  c: Ctx,
  res: Result<T>,
  message?: (error: string, detail?: number) => string | undefined,
) {
  if (res.ok) return { value: res.value, response: null };
  const code = res.error as ErrorCode;
  return { value: null, response: apiError(c, code, message?.(res.error, res.detail)) };
}

// ─────────────────────────────────── 접속 국가 (ADR-92)

/**
 * 허용한 나라 밖에서 온 요청인가.
 *
 * 나라는 **Cloudflare 가 요청에 붙여주는 값**(`cf.country`)으로만 본다 — 헤더가 아니라
 * 엣지가 만드는 값이라 참가자가 지어낼 수 없다. `cf-ipcountry` 헤더로 읽지 마라:
 * 같은 값처럼 보이지만 그건 요청에 실려 오는 것이고, 문을 여는 판단에 쓸 물건이 아니다.
 *
 * **모르는 나라는 막지 않는다.** `cf` 는 로컬 워커와 테스트에 없다 —
 * 없을 때 막으면 개발과 테스트가 통째로 닫힌다. 프로덕션에서는 엣지가 언제나 채워주므로
 * 이 되돌림이 밖으로 열리는 길이 되지 않는다. 지어낼 수 없는 값이라 비울 수도 없다.
 *
 * ⚠️ **이 문은 `/api` 와 `/ws` 에만 선다.** 나머지 주소는 워커를 거치지 않고 정적 자산이
 * 바로 낸다 (`wrangler.jsonc` 의 `run_worker_first`). 해외에서 화면 껍데기는 떠도
 * 자료는 한 줄도 안 나간다 — 껍데기에는 아무것도 없어서 그걸로 충분하다.
 * 껍데기까지 막으려고 `run_worker_first` 를 넓히지 마라. 모든 요청이 워커를 거치게 된다.
 */
export function regionBlocked(c: Ctx): boolean {
  const allow = (c.env.ALLOWED_COUNTRIES ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (!allow.length) return false;

  const country = (c.req.raw as { cf?: { country?: string } }).cf?.country?.toUpperCase();
  if (!country) return false;
  return !allow.includes(country);
}

// ─────────────────────────────────── 인증

export async function hostScope(c: Ctx): Promise<AuthScope | null> {
  const token = readCookie(c.req.header("cookie") ?? null, HOST_COOKIE);
  return readSession(token, c.env.SESSION_SECRET, serverNow());
}

/** 운영자 로그인의 시도를 셀 때 쓰는 자리 이름 (ADR-94). 회차 아이디와 겹치지 않는다 — 그건 16자리 16진수다 */
export const HOST_SCOPE = "host";

/**
 * 접속지 해시. 문을 두드린 횟수를 세는 열쇠다.
 *
 * 원본 IP 를 저장하지 않는다 — 참가자 개인정보를 회차 DO 밖으로도, 안으로도
 * 필요 이상 들이지 않는다. 자리마다 다른 해시가 나오도록 `scope` 를 섞는다:
 * 참가자 입장은 회차 아이디, 운영자 로그인은 `HOST_SCOPE` 다.
 * **같은 사람이라도 자리가 다르면 다른 해시가 된다** — 한 곳의 실패가 다른 곳을 잠그지 않는다.
 */
export async function ipHash(c: Ctx, scope: string): Promise<string> {
  const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${scope}:${ip}`));
  return [...new Uint8Array(buf).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 이 요청이 읽을 세션 이름표 (ADR-44). 탭마다 다른 참가자로 있기 위한 것이다.
 *
 * 이름표가 **틀렸다고 남의 세션으로 떨어지지 않는다** — `cookieName` 이 16진수가 아닌 값을
 * 이름표 없음으로 되돌리고, 그러면 기본 쿠키를 읽을 뿐이다.
 */
export function sessionRef(c: Ctx): string | undefined {
  return c.req.header(REF_HEADER);
}

export async function playerScope(c: Ctx): Promise<AuthScope | null> {
  const token = readCookie(c.req.header("cookie") ?? null, cookieName(PLAYER_COOKIE, sessionRef(c)));
  const scope = await readSession(token, c.env.SESSION_SECRET, serverNow());
  return scope?.kind === "player" ? scope : null;
}

/**
 * 번호는 통과했지만 아직 등록하지 않은 사람. 등록 폼 하나만 열 수 있다.
 * **번호가 아니라 명단 행의 식별자(토큰)를 들고 있다** (ADR-75) — 번호는 회차 DO 안에서만 푼다.
 * 세션은 서명만 하고 암호화하지 않아서, 번호를 담으면 개발자 도구에 그대로 읽힌다.
 */
export async function inviteScope(c: Ctx): Promise<{ eventId: string; token: string } | null> {
  const session = readCookie(c.req.header("cookie") ?? null, cookieName(INVITE_COOKIE, sessionRef(c)));
  const scope = await readSession(session, c.env.SESSION_SECRET, serverNow());
  return scope?.kind === "invited" ? { eventId: scope.eventId, token: scope.token } : null;
}

/** 운영자 권한은 한 종류뿐이다 — 운영자 PIN 을 통과했는가 (ADR-12) */
export function isMaster(scope: AuthScope | null): scope is { kind: "master" } {
  return scope?.kind === "master";
}

export function isSecure(c: Ctx): boolean {
  return new URL(c.req.url).protocol === "https:";
}

/**
 * 응답 시간을 잰다 (ADR-56). 두 라우터가 각자 맨 위에 붙인다.
 *
 * ⚠️ **원본 경로를 담지 마라.** 거기에는 회차 아이디(`/events/abc123/state`)와
 * 참가 토큰(`?t=…`)이 그대로 있다. 담는 건 `routePath` — **Hono 에 등록된 패턴**이라
 * 자리마다 `:id` 가 들어가 있고 실제 값이 아니다.
 *
 * 그래도 한 겹 더 본다: 패턴에 `:` 도 `*` 도 없고 아는 낱말도 아니면 `other` 로 떨어뜨린다.
 * 라우팅이 바뀌어 원본이 새어 나오는 날에도 지표에는 안 담기게 하려는 것이다.
 */
export function timed(app: string): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const started = Date.now();
    await next();
    const route = safeRoute(c.req.routePath);
    pulse(c.env, {
      kind: "api",
      route: `${app}${route}`,
      outcome: String(c.res.status),
      ms: Date.now() - started,
    });
  };
}

/**
 * 패턴만 통과시킨다. 값이 박힌 경로는 `other` 다 —
 * **못 알아보는 것은 담지 않는다**가 여기서도 같은 규칙이다.
 */
function safeRoute(path: string | undefined): string {
  if (!path) return "/other";
  // 등록된 패턴은 `/`, 영문 소문자, `-`, `_`, `:이름`, `*` 로만 이루어진다
  return /^[/a-z_*:-]*$/.test(path) ? path : "/other";
}

/**
 * 집계 비콘을 받아도 되는 사람인가, 그리고 **어느 쪽 화면인가** (ADR-56).
 *
 * 세션을 보는 이유는 하나다 — 아무나 두드리는 문으로 두지 않으려는 것.
 * 돌려주는 건 `player` / `host` 라는 **범주**뿐이고, 누구였는지는 여기서 끝난다.
 * ⚠️ **playerId 나 eventId 를 돌려주게 고치지 마라.** 그 순간 이 함수가 지키던 것이 사라진다.
 */
export async function pulseWho(c: Ctx): Promise<Who | null> {
  if (await playerScope(c)) return "player";
  const host = await readSession(
    readCookie(c.req.header("cookie") ?? null, HOST_COOKIE),
    c.env.SESSION_SECRET,
    serverNow(),
  );
  return isMaster(host) ? "host" : null;
}
