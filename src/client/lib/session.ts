/**
 * 이 탭이 누구인가 (ADR-44).
 *
 * 참가자 증명은 **HttpOnly 쿠키**에 있고 여기서는 읽지도 못한다. 여기 있는 건
 * `ref` — 브라우저가 들고 있는 여러 참가자 쿠키 중 **어느 것을 읽을지 고르는 이름표**다.
 * 이름표만으로는 아무 문도 열리지 않으므로 JS 가 읽는 곳에 둬도 되고, 로그에 찍혀도 무해하다.
 *
 * `sessionStorage` 인 이유가 전부다 — **탭마다 별개**다. 쿠키는 브라우저 단위라
 * 개인 링크가 사람마다 달라도(ADR-32) 두 번째 탭에서 다른 링크를 열면
 * 첫 번째 탭이 조용히 그 사람이 됐다. 새로고침에는 남고, 탭을 닫으면 사라진다.
 */

const REF_KEY = "tp.ref";

/**
 * 사파리 프라이빗 창은 `sessionStorage` 접근 자체가 예외를 던진다.
 * 이름표가 없으면 기본 세션을 쓰게 될 뿐이라 — 탭 하나짜리 평소 동선은 그대로 돈다.
 */
export function tabRef(): string | undefined {
  try {
    return sessionStorage.getItem(REF_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setTabRef(ref: string): void {
  try {
    sessionStorage.setItem(REF_KEY, ref);
  } catch {
    /* 못 써도 진행한다 — 기본 세션으로 떨어질 뿐이다 */
  }
}
