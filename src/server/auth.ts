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
export async function resolvePin(
  input: string,
  eventId: string | null,
  eventPinHash: string | null,
  masterPin: string,
): Promise<AuthScope | null> {
  if (eventId && eventPinHash && (await verify(input, eventPinHash))) {
    return { kind: "host", eventId };
  }
  if (timingSafeEqual(input, masterPin)) return { kind: "master" };
  return null;
}

export function pinCollides(eventPin: string, masterPin: string): boolean {
  return eventPin === masterPin;
}

export async function hash(pin: string, salt: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + pin));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verify(_pin: string, _hash: string): Promise<boolean> {
  // TODO: salt 를 meta 에서 읽어 hash() 비교
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 6자리 입장 코드. 헷갈리는 글자(0/O, 1/I)는 뺀다. */
export function genCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => A[Math.floor(Math.random() * A.length)]).join("");
}
