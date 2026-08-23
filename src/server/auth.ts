import type { AuthScope } from "../shared/types.ts";
import { INVITE_TTL } from "../shared/constants.ts";

/**
 * 운영자 PIN 은 하나뿐이다. (ADR-12)
 *
 * 예전에는 회차마다 PIN 을 따로 두고, 회차 화면에서는 회차 PIN 을 **먼저** 봐야 했다.
 * 순서를 지키지 않으면 두 PIN 이 같을 때 회차 담당자가 전체 권한을 얻었기 때문이다 —
 * 실제로 겪은 사고: {"회차PIN":"0000","공통PIN":"0000","획득권한":"master"}.
 *
 * 지금은 권한이 한 종류라 그 순서 자체가 없다. 규칙을 지키는 대신 규칙이 필요 없게 만들었다.
 */

export function resolvePin(input: string, masterPin: string): AuthScope | null {
  return timingSafeEqual(input, masterPin) ? { kind: "master" } : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 6자리 입장 코드. 헷갈리는 글자(0/O, 1/I)는 뺀다. */
export function genCode(): string {
  // copy-ok — 코드 알파벳이지 화면 문구가 아니다
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => A[b % A.length]).join("");
}

export function randomHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return hex(buf);
}

function hex(buf: Uint8Array): string {
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─────────────────────────────────── 세션
//
// 세션은 HttpOnly 쿠키다. 전화번호나 PIN 을 URL·바디에 남기지 않기 위해서다.
// 서버에 세션 테이블을 두지 않고 서명한 토큰을 그대로 쿠키에 넣는다 —
// 회차가 끝나면 DO 하나만 지우면 되도록, 회차 밖에 상태를 늘리지 않는다.

/** 운영자 세션과 참가자 세션은 쿠키가 다르다. 한 브라우저에서 둘 다 가능해야 한다 */
export const HOST_COOKIE = "tp_host";
export const PLAYER_COOKIE = "tp_play";
/** 명단 확인을 통과했지만 아직 등록하지 않은 상태. 등록 폼 하나만 연다 */
export const INVITE_COOKIE = "tp_inv";

/**
 * 참가자 세션은 길게, 운영자 세션은 짧게.
 *
 * **7일이었는데 파티 당일에 딱 걸렸다.** 등록은 파티 6일 전에 열리므로
 * (`DEFAULTS.regOpenBeforeD`) 첫날 등록한 사람은 파티 당일이 7일째다.
 * 끊기면 참가 링크를 다시 찾아야 하는데, 그게 하필 파티장에서 일어난다.
 *
 * **30일로 둬도 실질 노출은 늘지 않는다** — 회차가 파티 사흘 뒤 파기되므로
 * (`RETENTION_DAYS`) 세션이 살아 있어도 열리는 게 없다. 파기가 진짜 상한이다.
 * Safari ITP 의 7일 상한은 `document.cookie` 로 심은 것에 걸린다.
 * 이 쿠키는 서버가 `Set-Cookie` + `HttpOnly` 로 심으므로 대상이 아니다.
 *
 * 운영자 세션은 전체 권한이라 반대로 짧게 둔다.
 */
const TTL = { player: 30 * 24 * 3600_000, host: 12 * 3600_000 } as const;

export function sessionTtl(scope: AuthScope): number {
  if (scope.kind === "player") return TTL.player;
  // 초대는 등록 폼을 채울 시간이면 된다. 확인한 번호를 오래 들고 있을 이유가 없다
  if (scope.kind === "invited") return INVITE_TTL;
  return TTL.host;
}

interface SessionPayload {
  scope: AuthScope;
  exp: number;
}

export async function signSession(scope: AuthScope, secret: string, now: number): Promise<string> {
  const payload = b64url(JSON.stringify({ scope, exp: now + sessionTtl(scope) } satisfies SessionPayload));
  return `${payload}.${await sign(payload, secret)}`;
}

export async function readSession(
  token: string | undefined,
  secret: string,
  now: number,
): Promise<AuthScope | null> {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  if (!timingSafeEqual(mac, await sign(payload, secret))) return null;
  try {
    const parsed = JSON.parse(unb64url(payload)) as SessionPayload;
    if (!parsed.exp || parsed.exp < now) return null;
    return parsed.scope;
  } catch {
    return null;
  }
}

async function sign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(String.fromCharCode(...new Uint8Array(mac)));
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

export function setCookie(name: string, value: string, secure: boolean, ttlMs: number): string {
  const bits = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.floor(ttlMs / 1000)}`];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  const bits = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}
