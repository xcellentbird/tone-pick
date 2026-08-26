/**
 * 집계 지표의 **허용 목록**. 클라이언트와 서버가 같은 것을 본다.
 *
 * ⚠️ **여기 없는 값은 서버가 버린다.** 그게 이 파일이 존재하는 이유다 —
 * 화면이 보내는 문자열을 그대로 지표에 담으면, 언젠가 닉네임이 담긴 변수가
 * 실수로 그 자리에 들어간다. 목록을 좁혀두면 그 사고가 **일어날 자리가 없다.**
 *
 * 키를 더할 때 물을 것은 하나다 — **이 값이 한 사람을 가리킬 수 있나?**
 * 화면 이름·버튼 이름은 안 가리킨다. 닉네임·아이디·상대·자리 번호는 가리킨다.
 */

/** 참가자가 어느 화면까지 왔나. 등록 이탈과 탭 쓰임새를 여기서 읽는다 */
export const NAV_KEYS = [
  "join",
  "register1",
  "register2",
  "register3",
  "home",
  "people",
  "me",
  "fun",
  "help",
  "seat",
  "profile",
  "result",
  "host",
] as const;

/**
 * 눌린 버튼. **누가 눌렀는지는 담지 않는다** — 몇 번 눌렸는지만 센다.
 *
 * ⚠️ **상대를 가리키는 값을 키에 넣지 마라.** `poke_그녀` 같은 건
 * 이 앱이 끝까지 감추기로 한 것을 지표에 적는 일이다 (ADR-56).
 */
export const TAP_KEYS = [
  "poke",
  "poke_undo",
  "help_open",
  "seat_ack",
  "seat_reopen",
  "fortune_open",
  "mission_flip",
  "cover",
  "profile_open",
  "vote",
] as const;

/** 소켓 사건. 파티장 와이파이가 실제로 어떤지 여기서만 보인다 */
export const WS_KEYS = ["open", "drop", "retry"] as const;

export type NavKey = (typeof NAV_KEYS)[number];
export type TapKey = (typeof TAP_KEYS)[number];
export type WsKey = (typeof WS_KEYS)[number];

/**
 * 비콘 한 건.
 *
 * `stay` 만 숫자를 함께 보낸다 — **원값은 서버가 버킷으로 바꾸고 버린다** (ADR-56).
 * 초 단위 체류 시간은 그 자체로 한 사람의 습관이라, 쌓아두면 사람을 가리키기 시작한다.
 */
export interface PulseEvent {
  kind: "nav" | "tap" | "ws" | "stay";
  /** `nav`·`tap`·`ws` 는 위 목록 중 하나. `stay` 는 비운다 */
  key?: string;
  /** `stay` 에만. 밀리초 */
  ms?: number;
}

/** 한 번에 보낼 수 있는 건수. 넘치면 서버가 앞에서 자른다 */
export const PULSE_MAX = 24;

const NAV = new Set<string>(NAV_KEYS);
const TAP = new Set<string>(TAP_KEYS);
const WS = new Set<string>(WS_KEYS);

/** 허용 목록에 있나. **서버가 담기 전에 이걸 통과해야 한다** */
export function allowedKey(kind: PulseEvent["kind"], key: string | undefined): boolean {
  if (kind === "stay") return true;
  if (!key) return false;
  return kind === "nav" ? NAV.has(key) : kind === "tap" ? TAP.has(key) : WS.has(key);
}

/**
 * 체류 시간 버킷. **원값 대신 이것만 담는다.**
 *
 * 경계를 이렇게 고른 이유 — 1분 미만은 잘못 들어왔다 나간 것이고,
 * 5분은 등록을 마칠 만한 시간이며, 30분은 파티 한 라운드다.
 * 그보다 잘게 나눌 이유가 없고, 잘게 나눌수록 사람을 가리킨다.
 */
export function stayBucket(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const s = ms / 1000;
  return s < 60 ? "<1m" : s < 300 ? "<5m" : s < 1800 ? "<30m" : ">30m";
}

/**
 * 응답 시간 버킷. 원값(ms)도 함께 담는다 — 성능은 분위수를 봐야 해서
 * 원값이 필요하고, **응답 시간은 사람을 가리키지 않는다.**
 */
export function msBucket(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  return ms < 50 ? "<50" : ms < 200 ? "<200" : ms < 1000 ? "<1s" : ms < 3000 ? "<3s" : ">3s";
}
