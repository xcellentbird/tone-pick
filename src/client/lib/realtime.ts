import type { ClientEvent, ServerEvent } from "../../shared/types.ts";

/**
 * 폴링이 아니라 WebSocket 인 이유는 실시간성보다 비용이다.
 * 무료 한도가 10만 요청/일인데 5초 폴링이면 100명 × 3시간에 216,000 요청이 나온다.
 * WS 는 연결 1건만 요청으로 세고 메시지는 세지 않는다.
 */
export function connect(code: string, onEvent: (ev: ServerEvent) => void) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  let ws: WebSocket | null = null;
  let retry = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;

  function open() {
    ws = new WebSocket(`${proto}://${location.host}/ws/${code}`);
    ws.onopen = () => { retry = 0; };
    ws.onmessage = (e) => {
      try { onEvent(JSON.parse(e.data) as ServerEvent); } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (closed) return;
      // 파티장 와이파이는 끊긴다. 지수 백오프로 조용히 재연결한다.
      timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
    };
  }
  open();

  return {
    send(msg: ClientEvent) { ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg)); },
    close() { closed = true; clearTimeout(timer); ws?.close(); },
  };
}
