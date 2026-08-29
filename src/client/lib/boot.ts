/**
 * `index.html` 이 번들보다 먼저 띄워둔 요청을 받아간다.
 *
 * 참가 링크의 회차 조회는 첫 화면에 꼭 필요한데, 번들이 다 내려와 실행된 뒤에야 나가면
 * 그 앞의 1초를 통째로 기다리게 된다. 그래서 HTML 이 파싱되는 순간 출발시켜 두고
 * 여기서 받아간다 — 앱이 올라올 때는 이미 답이 와 있다.
 *
 * ⚠️ **한 번만 받아간다.** 되불러오기(`reload`)는 새 값을 원하는 것이므로 이 자리를 쓰면 안 된다.
 *    받아가는 즉시 지워서, 두 번째부터는 평소대로 서버에 묻는다.
 */
interface BootHandoff {
  url: string;
  p: Promise<unknown>;
}
declare global {
  interface Window {
    __tpBoot?: BootHandoff;
  }
}

/**
 * `path` 가 미리 띄워둔 그 요청이면 그 약속을 돌려준다. 아니면 `null`.
 * `path` 는 `api()` 에 넘기는 것과 같은 모양(`/events/by-id/…`)으로 준다.
 */
export function takeBoot<T>(path: string): Promise<T> | null {
  const held = window.__tpBoot;
  if (!held || held.url !== `/api${path}`) return null;
  window.__tpBoot = undefined;
  return held.p as Promise<T>;
}
