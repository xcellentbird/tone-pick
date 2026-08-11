import type { AuthScope } from "../shared/types.ts";

/**
 * PIN 검사 순서가 보안 경계다. (ADR-3)
 *
 * 회차 화면에서는 반드시 **회차 PIN 을 먼저** 본다.
 * 공통 PIN 을 먼저 보면, 두 값이 같을 때 회차 담당자가 전체 관리자 권한을 얻는다.
 * 실제로 겪은 사고: {"회차PIN":"0000","공통PIN":"0000","획득권한":"master"}
 *
 * 그리고 애초에 두 PIN 이 같아지지 못하게 생성 지점(위저드·회차 설정·기본 설정·
 * 자동 생성기) 모두에서 막는다. 검사 시점 방어와 입력 시점 차단을 둘 다 둔다.
 */

export interface PinRecord {
  salt: string;
  hash: string;
}

export async function resolvePin(
  input: string,
  eventId: string | null,
  eventPin: PinRecord | null,
  masterPin: string,
): Promise<AuthScope | null> {
  if (eventId && (await verifyPin(input, eventPin))) return { kind: "host", eventId };
  if (timingSafeEqual(input, masterPin)) return { kind: "master" };
  return null;
}

export function pinCollides(eventPin: string, masterPin: string): boolean {
  return eventPin === masterPin;
}

export async function hash(pin: string, salt: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + pin));
  return hex(new Uint8Array(buf));
}

export async function makePinRecord(pin: string): Promise<PinRecord> {
  const salt = randomHex(8);
  return { salt, hash: await hash(pin, salt) };
}

export async function verifyPin(pin: string, rec: PinRecord | null | undefined): Promise<boolean> {
  if (!rec) return false;
  return timingSafeEqual(await hash(pin, rec.salt), rec.hash);
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

/** 4자리 회차 PIN. 공통 PIN 과 같은 값은 만들지 않는다 (ADR-3) */
export function genPin(masterPin: string): string {
  for (let i = 0; i < 50; i++) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const pin = String(buf[0] % 10000).padStart(4, "0");
    if (!pinCollides(pin, masterPin)) return pin;
  }
  // 50번 연속 같은 값이 나올 수는 없지만, 못 만들었다면 조용히 넘기지 않는다
  throw new Error("pin generation failed");
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
const SESSION_TTL = 12 * 3600_000;

interface SessionPayload {
  scope: AuthScope;
  exp: number;
}

export async function signSession(scope: AuthScope, secret: string, now: number): Promise<string> {
  const payload = b64url(JSON.stringify({ scope, exp: now + SESSION_TTL } satisfies SessionPayload));
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

export function setCookie(name: string, value: string, secure: boolean): string {
  const bits = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_TTL / 1000}`];
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
