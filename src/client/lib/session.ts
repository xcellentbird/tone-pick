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
 * **틀(iframe) 안에서는 틀 이름이 이름표일 수 있다** (ADR-99).
 *
 * `sessionStorage` 는 탭마다 별개지만 **한 탭 안의 같은 출처 틀들은 하나를 같이 쓴다.** 무대 워커가 한 탭에
 * 참가자 여럿을 틀로 띄우면 마지막으로 들어온 사람이 전부가 된다 — 그래서 여는 쪽이 틀 이름(`tp.<이름표>`)에
 * 이름표를 싣는다. 이름표는 비밀이 아니다: 증명은 여전히 HttpOnly 쿠키이고, 쿠키는 **같은 사이트의 틀에만**
 * 실린다(`SameSite=Lax`). 모양은 서버의 `cookieName` 과 같다 — 16진수만.
 *
 * ⚠️ **맨 위 창에는 적용하지 마라.** 창 이름은 여는 쪽이 정하는 값이다 — 링크로 들어온 탭이 남이 고른
 * 이름표를 받을 이유가 없다. 틀 밖에서는 전과 똑같이 탭의 저장소만 본다.
 */
const FRAME_NAME = /^tp\.([0-9a-f]{1,16})$/;

function frameRef(): string | undefined {
  if (window.top === window.self) return undefined;
  return FRAME_NAME.exec(window.name)?.[1];
}

/**
 * 사파리 프라이빗 창은 `sessionStorage` 접근 자체가 예외를 던진다.
 * 이름표가 없으면 기본 세션을 쓰게 될 뿐이라 — 탭 하나짜리 평소 동선은 그대로 돈다.
 */
export function tabRef(): string | undefined {
  const framed = frameRef();
  if (framed) return framed;
  try {
    return sessionStorage.getItem(REF_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setTabRef(ref: string): void {
  // 이름표를 받은 틀은 끝까지 그 사람이다 — 틀 안에서 누가 새로 들어와도 옆 틀의 저장소를 덮지 않는다
  if (frameRef()) return;
  try {
    sessionStorage.setItem(REF_KEY, ref);
  } catch {
    /* 못 써도 진행한다 — 기본 세션으로 떨어질 뿐이다 */
  }
}
