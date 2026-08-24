import type { ClientEvent, ServerEvent } from "../../shared/types.ts";
import { tabRef } from "./session.ts";

/**
 * 폴링이 아니라 WebSocket 인 이유는 실시간성보다 비용이다.
 * 무료 한도가 10만 요청/일인데 5초 폴링이면 100명 × 3시간에 216,000 요청이 나온다.
 * WS 는 연결 1건만 요청으로 세고 메시지는 세지 않는다.
 *
 * 실시간은 "다시 읽어라" 신호로만 쓴다. 그래서 **끊겼다 붙었을 때도 한 번 부른다** —
 * 끊긴 동안 서버에서 일어난 일(콕·단계 전환)은 다시 밀어주지 않기 때문이다.
 * 그걸 안 하면 파티장에서 폰을 주머니에 넣었다 꺼낸 사람만 옛 화면을 본다.
 */

/** 살아 있는지 확인하는 주기. 파티 세 시간에 1인당 400여 번이고, 메시지는 요청으로 세지 않는다 */
const PING_MS = 25_000;
/** 이만큼 아무 소식이 없으면 죽은 줄로 본다. ping 두 번을 놓친 셈이다 */
const SILENT_MS = 70_000;

export function connect(code: string, onEvent: (ev: ServerEvent) => void) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  let ws: WebSocket | null = null;
  let retry = 0;
  let closed = false;
  let opened = false;
  let lastSeen = Date.now();
  let timer: ReturnType<typeof setTimeout>;
  let beat: ReturnType<typeof setInterval>;

  function open() {
    /*
     * **이름표는 붙일 때마다 다시 읽는다.** 이 탭이 등록을 마치면 이름표가 생기는데,
     * 연결 함수가 만들어질 때 한 번 읽고 말면 그 뒤 재연결이 계속 옛 세션으로 붙는다.
     *
     * 브라우저 WebSocket 은 헤더를 못 실어서 여기만 쿼리다. 이름표는 비밀이 아니라
     * 주소에 실려도 되고, 증명은 여전히 쿠키다 (ADR-44).
     */
    const ref = tabRef();
    ws = new WebSocket(`${proto}://${location.host}/ws/${code}${ref ? `?ref=${ref}` : ""}`);

    ws.onopen = () => {
      retry = 0;
      lastSeen = Date.now();
      // 처음이 아니라면 끊겨 있던 동안 놓친 게 있다. 화면을 한 번 따라잡게 한다
      if (opened) onEvent({ type: "reconnect" });
      opened = true;
    };

    ws.onmessage = (e) => {
      lastSeen = Date.now();
      try {
        const ev = JSON.parse(e.data) as ServerEvent;
        // pong 은 살아 있다는 뜻일 뿐이다. 화면을 다시 그릴 이유는 아니다
        if (ev.type !== "pong") onEvent(ev);
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      if (closed) return;
      // 파티장 와이파이는 끊긴다. 지수 백오프로 조용히 재연결한다.
      timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
    };
  }

  /**
   * 죽은 소켓은 `close` 없이 조용히 멈추기도 한다 — 폰이 잠들거나 통신사가 바뀔 때 그렇다.
   * 주기적으로 두드려 보고, 한참 조용하면 끊어서 재연결 경로를 태운다.
   */
  function heartbeat() {
    if (closed) return;
    if (ws?.readyState === WebSocket.OPEN) {
      if (Date.now() - lastSeen > SILENT_MS) return ws.close();
      ws.send(JSON.stringify({ type: "ping" } satisfies ClientEvent));
    }
  }

  /**
   * 앱으로 돌아왔을 때. 폰을 꺼내는 순간이 사람이 화면을 가장 믿는 순간이다.
   * 소켓이 죽어 있으면 백오프를 기다리지 않고 바로 다시 붙는다.
   */
  function onVisible() {
    if (closed || document.visibilityState !== "visible") return;
    if (ws?.readyState !== WebSocket.OPEN) {
      clearTimeout(timer);
      retry = 0;
      ws?.close();
      open();
    }
    onEvent({ type: "reconnect" });
  }

  /**
   * **iOS 사파리는 페이지를 얼렸다 되살린다** (bfcache). 뒤로 가기로 돌아오거나
   * 오래 백그라운드에 있다 오면 소켓은 이미 죽었는데 `visibilitychange` 가 안 올 수 있다.
   * 그 사이 놓친 것은 서버가 다시 밀어주지 않으므로 (ADR-26) 여기서 잡는다.
   *
   * 없어도 심장박동이 25초 안에 알아채지만, 그 25초는 파티장에서 화면을 믿는 시간이다.
   */
  const onShow = (e: PageTransitionEvent) => e.persisted && onVisible();

  open();
  beat = setInterval(heartbeat, PING_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onShow);

  return {
    send(msg: ClientEvent) {
      ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      clearTimeout(timer);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onShow);
      ws?.close();
    },
  };
}
