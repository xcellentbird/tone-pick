/**
 * 참가 링크는 회차까지만 데려다준다. 문을 여는 건 **입장 코드**다 (ADR-13).
 *
 * 링크(`/j/<회차id>`)는 단톡방에 돌 수 있는 물건이라 그 자체로 들어올 수 있으면 안 된다.
 * 운영자가 따로 알려준 6자리를 맞춰야 등록으로 넘어간다.
 *
 * 맞춘 코드는 **sessionStorage** 에 둔다.
 *   · 등록 3스텝을 오가고 새로고침해도 다시 묻지 않는다
 *   · 탭을 닫으면 사라진다 — 빌려준 폰에 남지 않는다
 *   · localStorage 가 아니다. 이 코드는 오래 들고 있을 이유가 없다
 *
 * 서버는 이 값을 신뢰하지 않는다. 등록 요청은 코드가 담긴 경로로 나가고 서버가 다시 본다 —
 * 여기 있는 건 "이미 맞췄다"는 기억이지 권한이 아니다.
 */

const key = (eventId: string) => `tp_code_${eventId}`;

export function rememberCode(eventId: string, code: string): void {
  try {
    sessionStorage.setItem(key(eventId), code.toUpperCase());
  } catch {
    /* 사파리 비공개 모드 등. 기억하지 못하면 한 번 더 물을 뿐이다 */
  }
}

export function codeFor(eventId: string): string | null {
  try {
    return sessionStorage.getItem(key(eventId));
  } catch {
    return null;
  }
}
