import { PULSE_MAX, type NavKey, type PulseEvent, type TapKey, type WsKey } from "../../shared/pulse.ts";
import { tabRef } from "./session.ts";

/**
 * 집계 비콘 (ADR-56). **몇 번 일어났나만 보낸다 — 누가 했는지는 안 보낸다.**
 *
 * 이 파일이 지키는 것은 하나다: 여기를 지나는 값에 **사람도 회차도 상대도 없다.**
 * 타입이 그 방어다 — `nav`·`tap`·`ws` 는 `shared/pulse.ts` 의 목록에서만 고를 수 있어서,
 * 닉네임이 든 변수를 넣으려 하면 **타입이 먼저 막는다.**
 *
 * ## 왜 모아서 보내나
 *
 * 무료 한도가 10만 요청/일이다. 탭을 옮길 때마다 요청을 보내면 100명 파티에서
 * 수천 건이 그냥 나간다 — 참가자가 쓰는 요청을 지표가 갉아먹는 꼴이다.
 * 그래서 **모았다가 한 번에** 보낸다. 늦게 도착해도 되는 자료라 그래도 된다.
 *
 * ## 실패하면 그냥 버린다
 *
 * 다시 보내지 않는다. 지표가 안 올라간 것과 화면이 안 뜨는 것 중 무엇이 큰 일인지는
 * 물어볼 필요가 없고, 재시도 큐를 만들면 그 큐가 또 지켜야 할 것이 된다.
 */

/** 이만큼 모으거나 이만큼 지나면 보낸다. 둘 중 먼저 오는 쪽 */
const FLUSH_MS = 15_000;

let queue: PulseEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/** 이 화면이 열린 시각. `stay` 는 여기서 나온다 */
const openedAt = Date.now();
let sent = false;

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, FLUSH_MS);
}

function push(e: PulseEvent) {
  // 넘치면 **앞엣것을 버린다.** 최근 것이 지금 무슨 일이 벌어지는지를 말한다
  if (queue.length >= PULSE_MAX) queue.shift();
  queue.push(e);
  schedule();
}

/**
 * 쌓인 것을 보낸다. `keepalive` 라 화면이 닫히는 중에도 나간다 —
 * 그게 없으면 **가장 알고 싶은 마지막 순간**(이탈 직전)이 늘 비어 있다.
 */
function flush(): void {
  if (!queue.length) return;
  const events = queue;
  queue = [];
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const ref = tabRef();
  void fetch("/api/pulse", {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "content-type": "application/json", ...(ref ? { "x-tp-ref": ref } : {}) },
    body: JSON.stringify({ events }),
  }).catch(() => {
    /* 위에 적은 대로 — 다시 보내지 않는다 */
  });
}

/** 어느 화면까지 왔나 */
export function nav(key: NavKey): void {
  push({ kind: "nav", key });
}

/** 무엇이 눌렸나. **상대를 담지 마라** — 인자가 목록이라 담을 수도 없다 */
export function tap(key: TapKey): void {
  push({ kind: "tap", key });
}

/** 소켓이 열렸나 끊겼나 다시 붙었나 */
export function ws(key: WsKey): void {
  push({ kind: "ws", key });
}

/**
 * 화면을 떠난다. 머문 길이를 **한 번만** 보낸다.
 *
 * `visibilitychange` 를 쓰는 이유는 `beforeunload` 가 모바일에서 안 오기 때문이다 —
 * 폰에서 앱을 바꾸면 그냥 숨겨질 뿐이고, 그대로 다시 안 돌아오는 경우가 대부분이다.
 */
export function startPulse(): () => void {
  const onHide = () => {
    if (document.visibilityState !== "hidden") return;
    if (!sent) {
      sent = true;
      push({ kind: "stay", ms: Date.now() - openedAt });
    }
    flush();
  };
  document.addEventListener("visibilitychange", onHide);
  return () => document.removeEventListener("visibilitychange", onHide);
}
