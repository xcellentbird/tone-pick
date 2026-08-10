/**
 * 회차 1개 = Durable Object 1개.
 *
 * 이 매핑이 주는 것:
 *  - 요청이 순차 처리되므로 닉네임 유일성·콕 예산 차감에 경쟁 조건이 없다
 *  - 브로드캐스트 대상이 정확히 그 회차 참가자다
 *  - 회차가 끝나면 이 DO 만 지우면 개인정보 파기가 끝난다
 *
 * 무료 플랜에서 쓰려면 wrangler.jsonc 의 migrations 가 `new_sqlite_classes` 여야 한다.
 */
import type { ClientEvent, ServerEvent } from "../shared/types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  nickname   TEXT NOT NULL,
  nick_norm  TEXT NOT NULL UNIQUE,   -- 공백·대소문자 정규화. 유일성은 여기서 강제된다
  real_name  TEXT NOT NULL,
  age        INTEGER NOT NULL,
  gender     TEXT NOT NULL CHECK (gender IN ('M','F')),
  phone      TEXT NOT NULL UNIQUE,   -- 재접속 키
  instagram  TEXT,
  mbti       TEXT NOT NULL,
  charms     TEXT NOT NULL,          -- JSON string[3]
  no_show    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pokes (
  id      TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL,
  round   TEXT NOT NULL CHECK (round IN ('pre','party')),
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pokes_from ON pokes(from_id, round);
CREATE INDEX IF NOT EXISTS pokes_to   ON pokes(to_id);
CREATE TABLE IF NOT EXISTS seatings (
  round        INTEGER PRIMARY KEY,
  table_count  INTEGER NOT NULL,
  final        INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'draft',
  seats        TEXT NOT NULL,        -- JSON Seat[]
  acks         TEXT NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL,
  published_at INTEGER
);
`;

export class EventDO implements DurableObject {
  private sessions = new Map<WebSocket, { playerId?: string; host?: boolean }>();

  constructor(
    private state: DurableObjectState,
    private env: unknown,
  ) {
    this.state.blockConcurrencyWhile(async () => {
      this.state.storage.sql.exec(SCHEMA);
    });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") === "websocket") return this.handleUpgrade(req);

    // TODO: 내부 라우팅 (운영자/참가자 명령). Worker 에서만 호출되므로 인증은 그쪽에서 끝난 상태.
    return new Response("not implemented", { status: 501 });
  }

  // ─────────────────── 실시간

  private handleUpgrade(req: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Hibernation: 연결은 유지하되 유휴 중 컴퓨트를 소모하지 않는다
    this.state.acceptWebSocket(server);
    this.sessions.set(server, {});
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: ClientEvent;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    switch (msg.type) {
      case "ping":
        return this.send(ws, { type: "pong", serverTime: Date.now() });
      case "ack-seat":
        // TODO: acks 에 playerId 추가 → 운영자 확인율 갱신
        return;
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.sessions.delete(ws);
  }

  private send(ws: WebSocket, ev: ServerEvent) {
    try {
      ws.send(JSON.stringify(ev));
    } catch {
      this.sessions.delete(ws);
    }
  }

  /** 회차 전체에 방송. 콕 알림처럼 수신자별로 내용이 달라야 하는 건 여기 쓰지 말 것. */
  protected broadcast(ev: ServerEvent) {
    for (const ws of this.state.getWebSockets()) this.send(ws, ev);
  }

  // ─────────────────── TODO: 도메인 명령
  // registerPlayer / poke / unpoke / setPhase / makeSeating / publishSeating / reveal
  // 전부 이 클래스 안에서만 상태를 바꾼다. Worker 는 인증과 라우팅만 한다.
}
