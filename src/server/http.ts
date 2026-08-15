/**
 * Worker 쪽 공통 재료 — 환경 타입, 서버 시각, DO 손잡이, 에러 응답, 인증 확인.
 *
 * 여기 있는 건 전부 "인증과 라우팅"이다. 상태를 바꾸는 코드는 한 줄도 두지 않는다.
 */
import type { Context } from "hono";
import type { AuthScope, ErrorCode } from "../shared/types.ts";
import { HOST_COOKIE, PLAYER_COOKIE, readCookie, readSession } from "./auth.ts";
import type { EventDO, Result } from "./event-do.ts";
import type { RegistryDO } from "./registry-do.ts";

export interface Env {
  EVENT: DurableObjectNamespace<EventDO>;
  REGISTRY: DurableObjectNamespace<RegistryDO>;
  ASSETS: Fetcher;
  MASTER_PIN: string;
  SESSION_SECRET: string;
  /** "1" 일 때만 테스트 전용 라우트를 **등록**한다. 런타임 분기가 아니라 존재 자체를 없앤다 */
  ALLOW_TEST_ENDPOINTS?: string;
  /** 연습용 환경에만 있다. 있으면 화면 위에 띠가 떠서 진짜 파티와 헷갈리지 않게 한다 */
  ENV_LABEL?: string;
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
  code_taken: 409,
  nick_taken: 409,
  closed: 409,
  no_budget: 409,
  same_gender: 409,
  conflict: 409,
  schedule_order: 400,
  bad_request: 400,
};

export function apiError(c: Ctx, error: ErrorCode, message?: string) {
  // 표에 없는 코드가 오면 200 이 나간다 — 실패가 성공으로 보이는 최악의 조용한 실패다.
  // 그래서 기본값을 400 으로 둔다 (ADR-8)
  const status = (STATUS[error] ?? 400) as 400;
  return c.json(message ? { error, message } : { error }, status);
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

// ─────────────────────────────────── 인증

export async function hostScope(c: Ctx): Promise<AuthScope | null> {
  const token = readCookie(c.req.header("cookie") ?? null, HOST_COOKIE);
  return readSession(token, c.env.SESSION_SECRET, serverNow());
}

export async function playerScope(c: Ctx): Promise<AuthScope | null> {
  const token = readCookie(c.req.header("cookie") ?? null, PLAYER_COOKIE);
  const scope = await readSession(token, c.env.SESSION_SECRET, serverNow());
  return scope?.kind === "player" ? scope : null;
}

/** 운영자 권한은 한 종류뿐이다 — 운영자 PIN 을 통과했는가 (ADR-12) */
export function isMaster(scope: AuthScope | null): scope is { kind: "master" } {
  return scope?.kind === "master";
}

export function isSecure(c: Ctx): boolean {
  return new URL(c.req.url).protocol === "https:";
}
