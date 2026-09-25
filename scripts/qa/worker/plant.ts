/**
 * 참가자 틀이 **로그인된 채로** 뜨게 하는 쿠키 (슬라이스 37, ADR-99).
 *
 * 무대 워커는 가짜 참가자마다 QA 의 세션을 이미 들고 있다 — 바인딩으로 실제 경로를 밟아 등록했다.
 * 그 세션 쿠키(`tp_play_<이름표>`)를 **도구와 QA 가 함께 속한 부모 도메인**에 심으면, 같은 탭의 QA 틀이
 * 그 쿠키를 싣는다. 틀 이름(`tp.<이름표>`)이 어느 쿠키를 읽을지 고른다 — 앱의 `src/client/lib/session.ts`.
 * CLI 의 창 벽이 창마다 쿠키를 심는 것과 같은 일을, 한 탭 안에서 한다.
 *
 * ⚠️ **참가자 쿠키만 심는다.** 부모 도메인의 쿠키는 **프로덕션(`tone-pick`)에도 실린다.** 이름표가 붙은 쿠키는
 * 가짜 참가자의 무작위 이름표라 프로덕션이 읽을 일이 없지만, **이름표 없는 기본 쿠키(`tp_play`)나 운영자 쿠키
 * (`tp_host`)를 심으면 프로덕션의 같은 이름 쿠키와 겹친다.** 둘이 함께 실리면 서버는 먼저 온 것을 읽고,
 * 운영자가 프로덕션에 다시 로그인한 뒤라면 먼저 오는 것이 이 QA 토큰이다 — 운영자가 자기 콘솔에서 튕긴다.
 * 그래서 이름은 `tp_play_<16진수>` 하나뿐이고, 운영자 틀은 한 번 PIN 을 친다.
 */

/** 앱의 참가자 쿠키 이름 — `src/server/auth.ts` 의 `PLAYER_COOKIE` 와 같아야 한다 (테스트가 맞춰 본다) */
export const PLAYER_COOKIE = "tp_play";

/** 심은 쿠키가 사는 시간 — 손대지 않은 무대가 닫히는 시간과 같다 (`IDLE_MS`) */
export const PLANT_MAX_AGE_S = 12 * 3600;

const REF = /^[0-9a-f]{1,16}$/;
/** 서명한 세션 — `base64url(페이로드).base64url(서명)`. 이 모양이 아니면 심지 않는다 — 헤더에 `;` 가 들어갈 길을 막는다 */
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** 틀 이름. 앱이 읽는 모양과 같다 (`tp.<16진수>`) */
export const frameName = (ref: string): string => `tp.${ref}`;

/**
 * 쿠키를 어디에 심나.
 *
 *   ""      같은 호스트다 — 로컬(localhost:8790 과 :8787). 쿠키는 포트를 가리지 않으니 호스트에만 심는다
 *   부모    도구와 QA 가 `<부모>` 를 함께 쓴다 — `tone-party.workers.dev`
 *   null    함께 쓰는 부모가 없다 — 심지 않는다. 틀은 번호와 PIN 으로 들어가야 한다
 *
 * 부모는 **QA 주소에서 맨 앞 이름 하나를 뗀 것**이다. 점이 없으면(최상위 도메인 하나) 심지 않는다.
 */
export function cookieDomain(toolHost: string, qaHost: string): string | null {
  if (toolHost === qaHost) return "";
  const dot = qaHost.indexOf(".");
  const parent = dot > 0 ? qaHost.slice(dot + 1) : "";
  if (!parent.includes(".")) return null;
  return toolHost.endsWith(`.${parent}`) ? parent : null;
}

interface Where {
  domain: string;
  secure: boolean;
}

const attrs = ({ domain, secure }: Where, maxAge: number) =>
  [`Path=/`, ...(domain ? [`Domain=${domain}`] : []), "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : []), `Max-Age=${maxAge}`].join(
    "; ",
  );

/** 참가자 하나의 세션을 심는 `Set-Cookie`. 이름표나 토큰이 모양에 안 맞으면 `null` — 아무것도 심지 않는다 */
export function plantCookie(ref: string, token: string, where: Where): string | null {
  if (!REF.test(ref) || !TOKEN.test(token)) return null;
  return `${PLAYER_COOKIE}_${ref}=${token}; ${attrs(where, PLANT_MAX_AGE_S)}`;
}

/** 심은 것을 거둔다. 심을 때와 같은 도메인·경로여야 지워진다 */
export function clearCookie(ref: string, where: Where): string | null {
  if (!REF.test(ref)) return null;
  return `${PLAYER_COOKIE}_${ref}=; ${attrs(where, 0)}`;
}
