import type { ClientEvent, ServerEvent } from "../../shared/types.ts";
import { tabRef } from "./session.ts";
import { ws as pulseWs } from "./pulse.ts";

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

/**
 * `host` 는 운영자 콘솔만 켠다 (ADR-107). 서버가 운영자 쿠키로 확인하면 운영자 신호(콕·되돌리기·PIN 번호)까지 받는다.
 * 참가자 화면은 켜지 않는다 — 한 브라우저에 운영자 쿠키가 같이 있어도(스테이지의 참가자 틀) 운영자 신호를 받으면 안 된다.
 */
export function connect(code: string, onEvent: (ev: ServerEvent) => void, opts: { host?: boolean } = {}) {
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
    // 운영자 콘솔은 참가자 이름표를 싣지 않는다 — 그 소켓은 누구의 참가자 소켓도 아니다
    const query = opts.host ? "?host=1" : ref ? `?ref=${ref}` : "";
    const sock = new WebSocket(`${proto}://${location.host}/ws/${code}${query}`);
    ws = sock;

    /*
     * **버린 소켓은 아무 말도 못 한다.** 앱으로 돌아올 때(`onVisible`) 붙는 중이던 소켓을 닫고 새로 여는데,
     * 닫은 소켓의 `close` 는 **나중에** 온다. 그게 재연결을 한 번 더 걸면 방금 연 소켓이 `ws` 에서 밀려나
     * 주인 없이 남는다 — 닫는 길이 없어 화면을 떠나도 계속 "다시 읽어라" 를 받고, 돌아올 때마다 하나씩 는다.
     */
    sock.onopen = () => {
      if (sock !== ws) return;
      // 다시 붙은 것과 처음 붙은 것을 갈라 센다 (ADR-56) — 파티장 와이파이가 여기서만 보인다
      pulseWs(opened ? "retry" : "open");
      retry = 0;
      lastSeen = Date.now();
      // 처음이 아니라면 끊겨 있던 동안 놓친 게 있다. 화면을 한 번 따라잡게 한다
      if (opened) onEvent({ type: "reconnect" });
      opened = true;
    };

    sock.onmessage = (e) => {
      if (sock !== ws) return;
      lastSeen = Date.now();
      try {
        const ev = JSON.parse(e.data) as ServerEvent;
        // pong 은 살아 있다는 뜻일 뿐이다. 화면을 다시 그릴 이유는 아니다
        if (ev.type !== "pong") onEvent(ev);
      } catch {
        /* ignore */
      }
    };

    sock.onclose = () => {
      if (closed || sock !== ws) return;
      pulseWs("drop");
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

  /*
   * **닫는 길만 준다.** 소켓으로 보내는 것은 안쪽의 `ping` 하나뿐이고,
   * 참가자가 하는 일(콕·자리 확인)은 전부 HTTP 다 — 실시간은 "다시 읽어라" 신호로만 쓴다 (ADR-26).
   * `send` 를 내주면 부분 갱신을 그리로 하고 싶어지고, 그때 화면과 서버가 조용히 어긋난다.
   */
  return {
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
