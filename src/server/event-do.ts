/**
 * 회차 1개 = Durable Object 1개.
 *
 * 이 매핑이 주는 것:
 *  - 요청이 순차 처리되므로 닉네임 유일성·콕 예산 차감에 경쟁 조건이 없다
 *  - 브로드캐스트 대상이 정확히 그 회차 참가자다
 *  - 운영자가 회차를 지우면 이 DO 하나로 개인정보가 다 사라진다 (자동 파기는 없다 — ADR-36)
 *
 * 무료 플랜에서 쓰려면 wrangler.jsonc 의 migrations 가 `new_sqlite_classes` 여야 한다.
 *
 * 상태를 바꾸는 건 전부 여기다. Worker 는 인증과 라우팅만 한다.
 */
import { DurableObject } from "cloudflare:workers";
import type {
  EventConfig,
  EventMeta,
  EventSchedule,
  EventSummary,
  EntryOutcome,
  Gender,
  Invite,
  MatchInfo,
  MyPokeState,
  AnnounceInput,
  Announcement,
  HostAnnouncement,
  ParticipantState,
  PollChoice,
  PublicAnnouncement,
  Phase,
  MyProfile,
  Player,
  Poke,
  PokeRound,
  PublicEvent,
  RegisterInput,
  RegisterResult,
  Seat,
  SeatingRound,
  ServerEvent,
  HostState,
  MySeat,
} from "../shared/types.ts";
import type { Fortune } from "../shared/fortune.ts";
import { readFortune } from "../shared/fortune.ts";
import { rosterOpen, toMe, toPublic } from "../shared/types.ts";
import { ENTRY } from "../shared/copy.ts";
import {
  ENTRY_TRIES,
  LIMITS,
  cleanName,
  nicknameProblem,
  normalizeInstagram,
  normalizeNickname,
  normalizePhone,
  realNameProblem,
} from "../shared/constants.ts";
import { PHASE_ORDER, canPoke, dueAt, dueTransition, rulesLocked, schedLocked, voteClosed } from "../shared/phase.ts";
import { formatWhen } from "../shared/time.ts";
import { buildSeating } from "./seating.ts";
import { randomHex } from "./auth.ts";

// copy-ok — SQL 스키마 주석이지 화면 문구가 아니다
const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,
  nickname   TEXT NOT NULL,
  nick_norm  TEXT NOT NULL UNIQUE,   -- 공백·대소문자 정규화. 유일성은 여기서 강제된다
  real_name  TEXT NOT NULL,
  age        INTEGER NOT NULL,
  gender     TEXT NOT NULL CHECK (gender IN ('M','F')),
  phone      TEXT NOT NULL UNIQUE,   -- 재접속 키
  instagram  TEXT NOT NULL,
  mbti       TEXT NOT NULL,
  charms     TEXT NOT NULL,          -- JSON string[3]
  created_at INTEGER NOT NULL,
  attendance TEXT,                   -- 안 쓴다 (ADR-45 가 ADR-33 을 되돌렸다). 옛 회차의 값이 남아 있을 뿐이다
  contact_share TEXT,                -- 안 쓴다 (ADR-42 가 ADR-37 을 되돌렸다). 읽지도 쓰지도 않는다.
                                     -- 지우지 마라 — DROP COLUMN 은 옛 회차의 표를 건드리는 일이고,
                                     -- 남은 값은 참·거짓 둘뿐이라 개인정보도 아니다
  token      TEXT                    -- 등록할 때 초대 명단에서 복사해 온다 (ADR-32).
                                     -- 명단에서 지워져도 자기 링크로 계속 들어오게 하는 값이다
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
CREATE TABLE IF NOT EXISTS invites (
  phone    TEXT PRIMARY KEY,      -- 숫자만. 운영자가 미리 넣어두는 초대 명단
  added_at INTEGER NOT NULL,
  token    TEXT                   -- 이 사람의 참가 링크. 넣는 순간 생긴다 (ADR-32)
);
CREATE TABLE IF NOT EXISTS entry_tries (
  ip_hash TEXT NOT NULL,          -- 접속지 해시. 원본 IP 는 저장하지 않는다
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entry_tries_ip ON entry_tries(ip_hash);
CREATE TABLE IF NOT EXISTS fortunes (
  player_id TEXT PRIMARY KEY,   -- 1인 1회. 다시 열어도 같은 운세가 나온다
  json      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS announcements (
  id         TEXT PRIMARY KEY,
  at         INTEGER NOT NULL,
  text       TEXT NOT NULL,
  poll_a     TEXT,                 -- 있으면 A/B 투표다
  poll_b     TEXT,
  closed_at  INTEGER
);
CREATE TABLE IF NOT EXISTS votes (
  ann_id    TEXT NOT NULL,
  player_id TEXT NOT NULL,
  choice    TEXT NOT NULL CHECK (choice IN ('a','b')),
  PRIMARY KEY (ann_id, player_id)   -- 한 사람 한 표. 다시 고르면 옮겨간다
);
CREATE INDEX IF NOT EXISTS votes_ann ON votes(ann_id);
CREATE TABLE IF NOT EXISTS seatings (
  round        INTEGER PRIMARY KEY,
  table_count  INTEGER NOT NULL,
  final        INTEGER NOT NULL DEFAULT 0,   -- 안 쓴다 (ADR-51 가 ADR-23 을 걷어냈다). 옛 회차의 값이 남아 있을 뿐이다
  status       TEXT NOT NULL DEFAULT 'draft',
  seats        TEXT NOT NULL,        -- JSON Seat[]
  acks         TEXT NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL,
  published_at INTEGER
);
`;

type Fail =
  | "not_found"
  | "not_invited"
  | "too_many"
  | "conflict"
  | "forbidden"
  | "bad_request"
  | "nick_taken"
  | "closed"
  | "same_gender"
  | "locked"
  | "no_budget";

/** `detail` 은 문구에 들어갈 숫자다 (예: 남은 콕 최대 횟수). 문장은 Worker 가 고른다 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Fail; detail?: number };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
const fail = <T,>(error: Fail, detail?: number): Result<T> => ({ ok: false, error, detail });

interface Attachment {
  playerId?: string;
}

export class EventDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx as never, env as never);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(SCHEMA);
      /*
       * 옛 회차에는 토큰 칸이 없다. `CREATE TABLE IF NOT EXISTS` 는 **이미 있는 표를 건드리지 않아서**,
       * 칸을 더하는 건 여기서 따로 해야 한다. 이미 있으면 던지므로 삼킨다 —
       * 버전 표를 두는 것보다 싸고, 칸을 더하는 일은 되돌릴 게 없다.
       *
       * ⚠️ **새 칸을 가리키는 인덱스를 `SCHEMA` 에 두지 마라.** 옛 표에는 그 칸이 아직 없어서
       * `no such column` 으로 던지는데, `SCHEMA` 의 exec 는 이 try 밖이라 **DO 가 통째로 죽는다.**
       * 회차 목록이 모든 회차를 훑기 때문에 화면 하나가 아니라 운영자 콘솔 전체가 멈췄다.
       * 칸을 더한 **뒤에** 인덱스를 만든다. 순서가 곧 규칙이다.
       */
      // copy-ok — SQL 이지 화면 문구가 아니다
      for (const sql of [
        "ALTER TABLE invites ADD COLUMN token TEXT",
        // 보냄 표시를 걷었다 (ADR-32 후기). 안 읽는 칸을 들고 다니면 다음 사람이 쓰이는 줄 안다
        "ALTER TABLE invites DROP COLUMN sent_at",
        "ALTER TABLE players ADD COLUMN token TEXT",
        "ALTER TABLE players ADD COLUMN attendance TEXT",
        "ALTER TABLE players ADD COLUMN contact_share TEXT",
        "CREATE UNIQUE INDEX IF NOT EXISTS invites_token ON invites(token)",
        "CREATE INDEX IF NOT EXISTS players_token ON players(token)",
      ]) {
        try {
          ctx.storage.sql.exec(sql);
        } catch {
          /* 이미 있다 */
        }
      }

      /*
       * **토큰 없는 명단 행은 아무도 못 쓰는 행이다.** 옛 회차의 초대 명단을 그대로 두면
       * 그 파티는 문이 잠긴 채 남는다 — 운영자가 안내문을 다시 보내면 살아난다.
       * 한 번만 돌고, 그 뒤로는 빈 UPDATE 다.
       */
      try {
        const rows = ctx.storage.sql
          .exec<{ phone: string }>("SELECT phone FROM invites WHERE token IS NULL OR token = ''")
          .toArray();
        for (const r of rows) {
          ctx.storage.sql.exec("UPDATE invites SET token = ? WHERE phone = ?", randomHex(16), r.phone);
        }
      } catch {
        /* 명단이 아직 없다 */
      }
    });
  }

  // ─────────────────────────── 회차 메타

  /** 회차를 만든다. 같은 회차로 두 번 들어와도 이미 있는 걸 돌려준다 (멱등) */
  async init(meta: EventMeta): Promise<EventMeta> {
    const existing = await this.ctx.storage.get<EventMeta>("meta");
    if (existing) return existing;
    await this.ctx.storage.put("meta", meta);
    await this.rearm(meta, meta.createdAt);
    return meta;
  }

  async metaAt(now: number): Promise<Result<EventMeta>> {
    const meta = await this.touch(now);
    return meta ? ok(meta) : fail("not_found");
  }

  async summaryAt(now: number): Promise<Result<EventSummary>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    return ok({
      id: meta.id,
      name: meta.name,
      code: meta.code,
      phase: meta.phase,
      playerCount: this.playerCount(),
      createdAt: meta.createdAt,
    });
  }

  /**
   * 인증 없이 누구나 받는 응답. `PublicEvent` 밖의 필드를 넣지 마라 (S-C2).
   * 여기에 **입장 코드**·참가자·콕이 새면 개발자 도구를 여는 참가자에게 그대로 보인다.
   * 특히 코드는 이 응답의 목적 자체를 무너뜨린다 — 참가 링크 뒤의 문이 코드다 (ADR-13).
   */
  async publicAt(now: number): Promise<Result<PublicEvent>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    const base = {
      id: meta.id,
      name: meta.name,
      phase: meta.phase,
      ...(meta.schedule.partyAt ? { partyAt: meta.schedule.partyAt } : {}),
    };
    if (meta.phase === "prep") {
      return ok({
        ...base,
        canRegister: false,
        message: meta.schedule.regOpenAt
          ? ENTRY.notOpenYet(formatWhen(meta.schedule.regOpenAt))
          : ENTRY.notOpenYetUnknown,
      });
    }
    if (meta.phase === "done") return ok({ ...base, canRegister: false, message: ENTRY.finished });
    return ok({ ...base, canRegister: true });
  }

  /** 수동 진행. 되돌리기(뒤로 가는 전환)에서는 fired 를 건드리지 않는다 (ADR-2) */
  async setPhase(to: Phase, now: number): Promise<Result<EventMeta>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (!PHASE_ORDER.includes(to)) return fail("bad_request");
    /*
     * **발표는 끝이다** (ADR-50). `done` 에서는 어디로도 못 나간다.
     *
     * 화면에서 버튼만 걷어내면 요청은 그대로 통한다 — 이 앱에서 되돌리기가 위험한 건
     * 운영자가 실수해서가 아니라, **한 번 본 것은 못 되돌리기 때문**이다. 결과를 본 사람과
     * 못 본 사람이 갈린 채로 화면만 닫히고, 그 뒤에 오는 질문에 앱이 답할 말이 없다.
     * 그래서 문을 여기서 잠근다.
     *
     * **다만 `done` → `done` 은 통과시킨다.** 두 번 눌린 발표를 실패로 답하면 운영자는
     * 안 된 줄 알고 다시 누른다 — 앞의 `forward` 판정이 거짓이라 `fired.done` 은
     * 처음 발표한 시각 그대로 남는다.
     */
    if (meta.phase === "done" && to !== "done") return fail("bad_request");

    const forward = PHASE_ORDER.indexOf(to) > PHASE_ORDER.indexOf(meta.phase);
    meta.phase = to;
    if (forward && to !== "prep") meta.fired[to] = now;
    await this.ctx.storage.put("meta", meta);
    await this.rearm(meta, now);
    this.broadcast({ type: "phase", phase: meta.phase, fired: meta.fired });
    if (to === "done") this.broadcast({ type: "reveal" });
    return ok(meta);
  }

  /**
   * 매력 투표를 **지금** 마감한다 (ADR-39 후기).
   *
   * 다른 단계 버튼과 같은 꼴이다 — 예약(`voteEndAt`)을 앞당긴다. 다만 **단계는 넘기지 않는다**:
   * `phase` 는 `prevote` 그대로고, 나이·MBTI(ADR-21)도 파티 콕도 `파티 시작` 이 연다.
   * 넘기면 아직 아무도 안 온 자리에서 파티가 시작된 것이 된다.
   *
   * **예약 시각은 덮어쓰지 않는다.** 실제로 닫은 시각만 `fired.voteEnd` 에 남긴다 —
   * 지나간 예약은 기록이라, 덮으면 "예약은 20시였는데 19시에 닫았다" 를 말할 수 없다.
   *
   * 이미 닫혀 있으면 **아무 일도 하지 않는다** — 두 번 눌러도 처음 닫은 시각이 남아야 한다.
   * 알람은 다시 걸지 않는다. 마감에는 알람이 없다 (`dueAt` 이 이 값을 모른다).
   */
  async closeVote(now: number): Promise<Result<EventMeta>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (meta.phase !== "prevote") return fail("bad_request");
    if (voteClosed(meta.schedule, meta.fired, now)) return ok(meta);

    meta.fired.voteEnd = now;
    await this.ctx.storage.put("meta", meta);
    // 참가자 화면은 콕 버튼이 닫힌 걸 그 자리에서 알아야 한다 — 단계 신호를 그대로 쓴다
    this.broadcast({ type: "phase", phase: meta.phase, fired: meta.fired });
    return ok(meta);
  }

  async setSchedule(patch: EventSchedule, now: number): Promise<Result<EventMeta>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    const next: EventSchedule = { ...meta.schedule, ...patch };
    /*
     * **순서는 검사하지 않는다** (ADR-36). 등록이 늘 열려 있는 지금, "사전 투표가 등록보다
     * 먼저 열렸다" 는 위반이 성립하지 않는다. 검사를 남겨두면 오히려 **매력 투표를
     * 지금 당장 열려는 정당한 조작**이 회차 만든 시각에 걸려 거절당했다.
     */
    /*
     * 잠긴 항목은 못 고친다. **키마다 따로 본다** (ADR-39) — 매력 투표 마감과 파티 일시는
     * 파티가 시작될 때까지 열려 있어야 한다. 파티가 늦어지면 마감도 미뤄야 하기 때문이다.
     *
     * **같은 값이 오는 건 통과시킨다** — 설정 탭은 저장할 때마다 일정을 통째로 다시 보내므로,
     * 있고 없고로 막으면 이름만 고쳐도 거절당한다. 막는 것은 '보냈나'가 아니라 '달라졌나'다.
     */
    if (SCHEDULE_KEYS.some((k) => next[k] !== meta.schedule[k] && schedLocked(meta.fired, k))) {
      return fail("locked");
    }
    meta.schedule = next;
    await this.ctx.storage.put("meta", meta);
    await this.rearm(meta, now);
    this.broadcast({ type: "phase", phase: meta.phase, fired: meta.fired });
    return ok(meta);
  }

  async patchMeta(
    patch: { name?: string; place?: string; config?: EventConfig },
    now: number,
  ): Promise<Result<EventMeta>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (patch.name !== undefined) {
      if (!patch.name.trim()) return fail("bad_request");
      meta.name = patch.name.trim();
    }
    // 장소는 지울 수도 있어야 한다 — 빈 문자열이면 없앤다 (안내문에서 자리만 빈다)
    if (patch.place !== undefined) {
      const place = patch.place.trim();
      if (place) meta.place = place;
      else delete meta.place;
    }
    if (patch.config) {
      const { maxPre, maxParty } = patch.config;
      // 안 보내면 지금 값을 지킨다 — 콕 횟수만 고치다 알림 설정이 딸려 초기화되면 안 된다
      const allowSameGender = patch.config.allowSameGender ?? meta.config.allowSameGender;
      const allowUndo = patch.config.allowUndo ?? meta.config.allowUndo;
      const allowUndoPre = patch.config.allowUndoPre ?? meta.config.allowUndoPre;
      const preNotify = patch.config.preNotify ?? meta.config.preNotify;
      const pokeNotify = patch.config.pokeNotify ?? meta.config.pokeNotify;
      if (!inRange(maxPre, LIMITS.maxPre) || !inRange(maxParty, LIMITS.maxParty)) return fail("bad_request");

      /*
       * 굳은 규칙은 못 고친다 (ADR-35). 일정과 같은 이유로 **달라졌을 때만** 막는다.
       * 비교는 '적혀 있나'가 아니라 **뜻**으로 한다 — 기본값과 같으면 아예 안 적히므로
       * (`allowUndo` 없음 = 할 수 있음), 키 유무로 재면 저장할 때마다 달라 보인다.
       */
      if (rulesLocked(meta.fired)) {
        const next = { ...meta.config, allowSameGender, allowUndo, allowUndoPre, preNotify, pokeNotify };
        if (frozenRules(next).some((v, i) => v !== frozenRules(meta.config)[i])) return fail("locked");
      }

      /**
       * 이미 쓴 횟수보다 낮게 내릴 수 없다.
       *
       * 내리면 그 사람의 남은 횟수가 음수가 되고, 화면은 "−1회 남음" 을 보여준다.
       * 이미 보낸 콕을 되물릴 방법도 없다 — 그래서 **막는 쪽**이 맞다.
       * `detail` 에 지금 가장 많이 쓴 횟수를 실어 보낸다. 문장은 Worker 가 만든다
       */
      for (const [round, next] of [["pre", maxPre], ["party", maxParty]] as const) {
        const used = this.rows<{ n: number }>(
          "SELECT COUNT(*) AS n FROM pokes WHERE round = ? GROUP BY from_id ORDER BY n DESC LIMIT 1",
          round,
        )[0]?.n;
        if (used && next < used) return fail("conflict", used);
      }
      // 기본과 다를 때만 적는다. 기본값을 굳이 써 넣으면 설정 모양이 회차마다 달라진다
      meta.config = {
        maxPre,
        maxParty,
        ...(allowSameGender === false ? { allowSameGender: false } : {}),
        // 기본은 '되돌릴 수 있다' 와 '알리지 않는다' 다 (ADR-34)
        ...(allowUndo === false ? { allowUndo: false } : {}),
        ...(allowUndoPre === false ? { allowUndoPre: false } : {}),
        ...(preNotify === true ? { preNotify: true } : {}),
        ...(pokeNotify === true ? { pokeNotify: true } : {}),
      };
    }
    await this.ctx.storage.put("meta", meta);
    // 콕 횟수가 바뀌면 참가자 화면의 남은 횟수가 그 자리에서 재계산돼야 한다
    this.broadcast({ type: "phase", phase: meta.phase, fired: meta.fired });
    return ok(meta);
  }

  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  // ─────────────────────────── 초대 명단
  //
  // 파티에 들어오는 문은 **운영자가 미리 넣어둔 전화번호**다 (ADR-15).
  // 코드 여섯 자리는 옮겨 적을 수 있지만 남의 번호로는 들어올 수 없다.

  async listInvites(): Promise<Result<Invite[]>> {
    return ok(this.invites());
  }

  /**
   * 명단에 **더한다**. 한 명이든 붙여넣은 백 명이든 같은 문이다.
   *
   * 통째로 갈아치우는 길은 두지 않는다 — 한 명 추가하려다 손이 미끄러지면
   * 그 파티의 명단 전체가 날아간다. 빼는 건 한 번에 하나씩이다.
   */
  async addInvites(phones: string[], now: number): Promise<Result<Invite[]>> {
    const clean = [...new Set(phones.map(normalizePhone).filter((p) => p.length >= 9))];
    if (!clean.length) return fail("bad_request");

    const already = new Set(this.rows<{ phone: string }>("SELECT phone FROM invites").map((r) => r.phone));
    const fresh = clean.filter((p) => !already.has(p));
    if (already.size + fresh.length > LIMITS.inviteMax) return fail("bad_request");

    /*
     * **토큰은 넣는 순간 생긴다. 그리고 그뿐이다** (S-B1).
     * 여기서 안내를 보내면 붙여넣기 사고가 그대로 문자로 새어나가고, 되돌릴 방법이 없다.
     */
    for (const phone of fresh) {
      this.ctx.storage.sql.exec(
        "INSERT INTO invites (phone, added_at, token) VALUES (?,?,?)",
        phone,
        now,
        randomHex(16),
      );
    }
    return ok(this.invites());
  }

  async removeInvite(phone: string): Promise<Result<Invite[]>> {
    this.ctx.storage.sql.exec("DELETE FROM invites WHERE phone = ?", normalizePhone(phone));
    return ok(this.invites());
  }

  /**
   * 입장 확인. **참가 링크의 토큰만 통과한다** (ADR-32).
   *
   * 번호를 받지 않는다 — 같은 파티에 오는 사람들은 서로 번호를 아는 사이라
   * 번호는 열쇠가 못 된다. 토큰은 그 사람에게만 배달된 값이다.
   *
   * **이미 등록한 사람은 명단과 무관하게 통과한다.** 명단은 문이지 자격이 아니다 —
   * 운영자가 명단을 정리하다 이미 등록한 사람을 지웠다고 파티 중에 쫓겨나면 안 된다.
   * 그래서 등록할 때 토큰을 `players` 에도 복사해 둔다.
   *
   * 실패는 회차·접속지별로 센다. 문은 여전히 인증 없이 열려 있다 — 다만
   * **"번호 넣어보기" 는 이제 일어나지 않는다.** 넣어볼 칸이 없다.
   */
  async checkEntry(token: string, ipHash: string, now: number): Promise<Result<EntryOutcome>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");

    this.ctx.storage.sql.exec("DELETE FROM entry_tries WHERE at < ?", now - ENTRY_TRIES.windowMs);
    const tries =
      this.rows<{ n: number }>("SELECT COUNT(*) AS n FROM entry_tries WHERE ip_hash = ?", ipHash)[0]?.n ?? 0;
    if (tries >= ENTRY_TRIES.max) return fail("too_many");

    const clean = String(token ?? "").trim();
    // 등록을 마친 사람이 먼저다 — 명단에서 지워졌어도 그의 토큰은 여기 남아 있다
    const mine = clean ? this.rows<PlayerRow>("SELECT * FROM players WHERE token = ?", clean)[0] : undefined;
    const invited =
      !!clean && !!this.rows<{ phone: string }>("SELECT phone FROM invites WHERE token = ?", clean)[0];

    if (!mine && !invited) {
      this.ctx.storage.sql.exec("INSERT INTO entry_tries (ip_hash, at) VALUES (?,?)", ipHash, now);
      return fail("not_invited");
    }
    // 들어온 사람의 시도 기록은 남기지 않는다
    this.ctx.storage.sql.exec("DELETE FROM entry_tries WHERE ip_hash = ?", ipHash);
    return ok(mine ? { registered: true, code: meta.code } : { registered: false });
  }

  /**
  * 토큰이 가리키는 번호. **DO 안에서만 쓴다** — 이 값이 Worker 를 지나 쿠키로 나가면
  * 번호를 치지 않기로 한 결정(ADR-32)이 브라우저에서 새어 나간다.
  */
  private phoneOf(token: string): string | null {
    const clean = String(token ?? "").trim();
    if (!clean) return null;
    const inv = this.rows<{ phone: string }>("SELECT phone FROM invites WHERE token = ?", clean)[0];
    if (inv) return inv.phone;
    return this.rows<{ phone: string }>("SELECT phone FROM players WHERE token = ?", clean)[0]?.phone ?? null;
  }

  /**
   * 이 토큰이 이 회차의 것인가, 그리고 그 주인이 이미 등록했나.
   * **번호를 꺼내지 않는다** — 회차 정보를 여는 데 번호는 필요 없다.
   */
  async tokenState(token: string): Promise<Result<{ known: boolean; registered: boolean }>> {
    const clean = String(token ?? "").trim();
    if (!clean) return ok({ known: false, registered: false });
    const registered = !!this.rows<{ id: string }>("SELECT id FROM players WHERE token = ?", clean)[0];
    return ok({ known: registered || !!this.phoneOf(clean), registered });
  }

  /** 토큰의 주인이 이미 등록했다면 그 사람. 통과한 뒤 참가자 세션을 만들 때 쓴다 */
  async playerIdByToken(token: string): Promise<Result<string | null>> {
    const clean = String(token ?? "").trim();
    if (!clean) return ok(null);
    const row = this.rows<{ id: string }>("SELECT id FROM players WHERE token = ?", clean)[0];
    return ok(row?.id ?? null);
  }

  /** 번호로 그 사람을 찾는다. 입장 확인을 통과한 뒤 세션을 만들 때만 쓴다 */
  async playerIdByPhone(phone: string): Promise<Result<string | null>> {
    const row = this.rows<{ id: string }>("SELECT id FROM players WHERE phone = ?", normalizePhone(phone))[0];
    return ok(row?.id ?? null);
  }

  private invites(): Invite[] {
    const byPhone = new Map(this.players().map((p) => [p.phone, p.nickname]));
    /*
     * 칸을 골라 읽는다. `SELECT *` 로 두면 걷어낸 `sent_at` 이 남아 있는 옛 회차에서
     * 그 값이 응답에 딸려 나간다 — 지운 기능이 조용히 되살아 보이는 자리다.
     */
    return this.rows<{ phone: string; added_at: number; token: string | null }>(
      "SELECT phone, added_at, token FROM invites ORDER BY added_at, phone",
    ).map((r) => ({
      phone: r.phone,
      addedAt: r.added_at,
      token: r.token ?? "",
      nickname: byPhone.get(r.phone),
    }));
  }

  // ─────────────────────────── 참가자

  /**
   * 등록. 같은 전화번호로 다시 오면 새로 만들지 않고 그 사람으로 재접속시킨다.
   * 닉네임 유일성은 회차 안에서만 — 다른 회차의 같은 닉네임은 상관없다.
   */
  async register(input: RegisterInput, phone: string, now: number): Promise<Result<Player>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (meta.phase === "prep" || meta.phase === "done") return fail("closed");

    // 번호는 폼이 아니라 입장할 때 확인한 값에서 온다 (ADR-15)
    if (!phone) return fail("bad_request");
    const clean = cleanProfile(input);
    if (!clean) return fail("bad_request");

    const mine = this.rows<PlayerRow>("SELECT * FROM players WHERE phone = ?", phone)[0];
    const saved = this.writeProfile(clean, {
      id: mine?.id ?? randomHex(8),
      phone,
      createdAt: mine?.created_at ?? now,
    });
    if (!saved.ok) return saved;

    /*
     * **토큰을 이 사람에게 붙인다** (ADR-32). 명단에서 지워져도 자기 링크로 계속 들어온다 —
     * "명단은 문이지 자격이 아니다" 를 지키는 자리가 여기다.
     */
    const tok = this.rows<{ token: string | null }>("SELECT token FROM invites WHERE phone = ?", phone)[0]?.token;
    if (tok) this.ctx.storage.sql.exec("UPDATE players SET token = ? WHERE phone = ?", tok, phone);

    this.broadcast({ type: "roster" });
    return saved;
  }

  /**
   * 내 정보 고치기 (ADR-31). **사전 투표가 열리기 전까지만.**
   *
   * 그 뒤에는 사람들이 이 정보를 보고 콕을 찌른다 —
   * 바꾸면 누군가 나를 고른 근거가 조용히 사라진다.
   * 명단이 열리는 순간과 정보가 굳는 순간을 같게 뒀다 (ADR-21).
   *
   * **전화번호는 바뀌지 않는다.** 입력에 자리가 없고, 저장할 때도 저장된 값을 그대로 쓴다 (ADR-15).
   * 고치는 대상은 쿠키에서 온 `playerId` 뿐이다 — 입력에 담긴 id 는 읽지 않는다.
   */
  async editProfile(playerId: string, input: RegisterInput, now: number): Promise<Result<MyProfile>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (meta.phase !== "reg") return fail("closed");

    const mine = this.rows<PlayerRow>("SELECT * FROM players WHERE id = ?", playerId)[0];
    if (!mine) return fail("not_found");
    const clean = cleanProfile(input);
    if (!clean) return fail("bad_request");

    const saved = this.writeProfile(clean, {
      id: mine.id,
      phone: mine.phone,
      createdAt: mine.created_at,
    });
    if (!saved.ok) return saved;

    /*
     * **운영자에게만 알린다.** 고치기가 열려 있는 건 등록 중뿐이고, 그때 참가자에게는
     * 명단이 아예 안 내려간다 (ADR-21). 인원수도 그대로다 — 전원에게 보내면 50명이
     * 똑같은 화면을 다시 읽으려고 줄을 서고, 그 읽기는 쓰기 큐 뒤에 선다.
     * 바뀐 닉네임이 필요한 건 운영자 명단 하나뿐이다.
     */
    this.toHosts({ type: "roster" });
    // 저장 응답도 참가자에게 그대로 간다 — 여기서도 번호를 싣지 않는다 (ADR-47)
    return ok(toMe(saved.value));
  }

  /**
   * 등록과 수정이 함께 쓰는 쓰기.
   *
   * 닉네임 유일성은 **자기 자신을 뺀** 회차 안에서만 본다 —
   * 안 그러면 나이 하나 고치는 데 닉네임까지 바꿔야 한다.
   * 실패하면 아무것도 쓰지 않는다. 저장은 전부 되거나 전부 안 된다.
   */
  private writeProfile(
    clean: CleanProfile,
    who: { id: string; phone: string; createdAt: number },
  ): Result<Player> {
    const clash = this.rows<PlayerRow>("SELECT * FROM players WHERE nick_norm = ?", clean.nickNorm)[0];
    if (clash && clash.id !== who.id) return fail("nick_taken");

    const player: Player = {
      id: who.id,
      nickname: clean.nickname,
      realName: clean.realName,
      age: clean.age,
      gender: clean.gender,
      phone: who.phone,
      instagram: clean.instagram,
      mbti: clean.mbti,
      charms: clean.charms,
      createdAt: who.createdAt,
    };

    this.ctx.storage.sql.exec(
      `INSERT INTO players (id, nickname, nick_norm, real_name, age, gender, phone, instagram, mbti, charms, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         nickname=excluded.nickname, nick_norm=excluded.nick_norm, real_name=excluded.real_name,
         age=excluded.age, gender=excluded.gender, instagram=excluded.instagram,
         mbti=excluded.mbti, charms=excluded.charms`,
      player.id,
      player.nickname,
      clean.nickNorm,
      player.realName,
      player.age,
      player.gender,
      player.phone,
      player.instagram ?? null,
      player.mbti,
      JSON.stringify(player.charms),
      player.createdAt,
    );
    return ok(player);
  }

  /**
   * 등록하고 화면 한 벌까지 한 번에 돌려준다.
   *
   * 예전에는 Worker 가 findByPhone → register → participantState 로 **세 번** 들어왔다.
   * 회차 DO 는 요청을 순차 처리하므로, 등록이 몰리는 순간 그 세 배가 그대로 줄이 된다.
   */
  async registerAndLoad(input: RegisterInput, token: string, now: number): Promise<Result<RegisterResult>> {
    // 번호는 **여기서** 푼다. 쿠키에는 토큰만 들어 있다 (ADR-32)
    const phone = this.phoneOf(token);
    if (!phone) return fail("not_invited") as Result<RegisterResult>;
    const before = this.rows<{ id: string }>("SELECT id FROM players WHERE phone = ?", phone)[0];

    const made = await this.register(input, phone, now);
    if (!made.ok) return made as Result<RegisterResult>;

    const state = await this.participantState(made.value.id, now);
    if (!state.ok) return state as Result<RegisterResult>;
    return ok({ state: state.value, resumed: !!before });
  }

  async deletePlayer(playerId: string): Promise<Result<true>> {
    const row = this.rows<PlayerRow>("SELECT * FROM players WHERE id = ?", playerId)[0];
    if (!row) return fail("not_found");
    this.ctx.storage.sql.exec("DELETE FROM players WHERE id = ?", playerId);

    /**
     * **이 사람이 보낸 콕은 남긴다** (ADR-29).
     *
     * 지우면 받은 사람의 숫자가 줄어든다. 참가자 탭에서 누가 사라졌는지가 동시에 보이므로,
     * 그 둘을 맞추면 **누가 나를 찔렀는지 알아낼 수 있다.** 받은 콕은 끝까지 익명이어야 한다.
     * 남는 건 아무것도 가리키지 않는 아이디뿐이다 — 이름도 번호도 pokes 테이블에 없다.
     *
     * 이 사람이 **받은** 콕은 지운다. 보낸 사람의 예산이 돌아온다 —
     * 없는 사람에게 쓴 횟수를 물릴 이유가 없다.
     */
    this.ctx.storage.sql.exec("DELETE FROM pokes WHERE to_id = ?", playerId);
    // 운세 문장에는 닉네임이 들어 있다. 사람을 지웠는데 그 문장이 남으면 지운 게 아니다
    this.ctx.storage.sql.exec("DELETE FROM fortunes WHERE player_id = ?", playerId);
    // 이미 발행한 자리에서도 빠진다
    for (const s of this.seatings()) {
      const seats = s.seats.filter((x) => x.playerId !== playerId);
      const acks = s.acks.filter((x) => x !== playerId);
      this.ctx.storage.sql.exec(
        "UPDATE seatings SET seats = ?, acks = ? WHERE round = ?",
        JSON.stringify(seats),
        JSON.stringify(acks),
        s.round,
      );
    }
    this.broadcast({ type: "roster" });
    return ok(true);
  }

  // ─────────────────────────── 콕

  async poke(fromId: string, toId: string, now: number): Promise<Result<MyPokeState>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (!canPoke(meta.phase, now, meta.schedule, meta.fired)) return fail("closed");

    const me = this.player(fromId);
    const target = this.player(toId);
    if (!me || !target) return fail("not_found");
    // 자기 자신은 어떤 설정에서도 못 찌른다
    if (me.id === target.id) return fail("same_gender");
    // 운영자가 이성만으로 좁힌 회차에서만 막는다 (ADR-17)
    if (meta.config.allowSameGender === false && me.gender === target.gender) return fail("same_gender");

    const round = roundOf(meta.phase);
    const max = round === "pre" ? meta.config.maxPre : meta.config.maxParty;
    if (this.sentCount(fromId, round) >= max) return fail("no_budget", max);

    this.ctx.storage.sql.exec(
      "INSERT INTO pokes (id, from_id, to_id, round, at) VALUES (?,?,?,?,?)",
      randomHex(8),
      fromId,
      toId,
      round,
      now,
    );
    /*
     * 익명이다. 누가 찔렀는지는 이 메시지에도, 어디에도 싣지 않는다.
     * **알림은 회차 설정을 따르고, 라운드마다 따로다** (ADR-34·43) — 없으면 보내지 않는다.
     * 싣는 숫자도 `visibleReceived` 여야 한다. 총합을 실으면 꺼둔 라운드가 그대로 새어나간다.
     */
    if (notifyOn(meta.config, round)) {
      this.toPlayer(toId, { type: "poke", received: this.visibleReceived(toId, meta) });
    }
    return ok(await this.pokeState(fromId, meta));
  }

  /**
   * 콕 되돌리기 (ADR-34). **하나씩 무른다** — 그 사람에게 여러 번 찔렀으면 한 번만 준다.
   *
   * **라운드마다 따로 정한다** — 매력 투표는 `allowUndoPre`, 파티 콕은 `allowUndo`.
   *
   * 알림은 저장하지 않고 `receivedCount` 에서 파생되므로(`noticesOf`),
   * 무르면 그 줄이 저절로 사라져 **받지 않았던 상태로 돌아간다.**
   */
  async unpoke(fromId: string, toId: string, now: number): Promise<Result<MyPokeState>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (!canPoke(meta.phase, now, meta.schedule, meta.fired)) return fail("closed");

    const round = roundOf(meta.phase);
    const allowed = round === "pre" ? meta.config.allowUndoPre !== false : meta.config.allowUndo !== false;
    if (!allowed) return fail("closed");

    const one = this.rows<{ id: string }>(
      "SELECT id FROM pokes WHERE from_id = ? AND to_id = ? AND round = ? ORDER BY at DESC LIMIT 1",
      fromId,
      toId,
      round,
    )[0];
    if (!one) return fail("not_found");
    this.ctx.storage.sql.exec("DELETE FROM pokes WHERE id = ?", one.id);

    if (notifyOn(meta.config, round)) {
      this.toPlayer(toId, { type: "poke", received: this.visibleReceived(toId, meta) });
    }
    return ok(await this.pokeState(fromId, meta));
  }

  // ─────────────────────────── 참가자 화면

  async participantState(playerId: string, now: number): Promise<Result<ParticipantState>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    const me = this.player(playerId);
    if (!me) return fail("not_found");
    const saved = this.rows<{ json: string }>("SELECT json FROM fortunes WHERE player_id = ?", playerId)[0];

    return ok({
      event: {
        id: meta.id,
        name: meta.name,
        code: meta.code,
        phase: meta.phase,
        fired: meta.fired,
        schedule: meta.schedule,
        config: meta.config,
      },
      me: toMe(me),
      // 명단은 사전 투표부터 열린다. 그 전에는 몇 명이 왔는지만 안다 (ADR-21)
      roster: rosterOpen(meta.phase)
        ? this.players()
            .filter((p) => p.id !== playerId)
            .map((p) => toPublic(p, meta.phase))
        : [],
      poke: await this.pokeState(playerId, meta),
      seat: this.mySeat(playerId),
      // 이미 연 사람에게만. 안 열었으면 없는 채로 내려가고, 화면은 뒷면 카드를 그린다
      ...(saved ? { fortune: readFortune(JSON.parse(saved.json)) } : {}),
      announcements: this.publicAnnouncements(playerId),
    });
  }

  /**
   * 운세 두 경로가 쓰는 **좁은 읽기**.
   *
   * `participantState()` 로 이걸 하면 명단 전체를 `toPublic()` 으로 빚고 콕을 집계하고
   * 자리를 찾는다 — 정작 필요한 건 단계·나·저장된 운세 셋뿐이다.
   * 파티가 시작되면 인원 수만큼 이 경로가 한꺼번에 열리는데, 그 일이 전부
   * **직렬화된 DO 스레드**에서 벌어진다. 그 시간이 곧 다른 사람의 읽기가 기다리는 시간이다.
   *
   * ⚠️ 여기 담긴 `me` 에는 실명이 있다. **참가자 응답에 그대로 싣지 마라** —
   * LLM 입력(`fortuneInput`·`missionInput`)을 만드는 데만 쓰고, 라우트는 `Fortune` 만 돌려준다.
   */
  async fortuneContext(
    playerId: string,
    now: number,
    /**
     * 파티 시각도 함께 준다 — 운세의 `오늘` 이 그 날이다 (ADR-20 후기).
     * **비어 있을 수 있다** (일정 없이 만든 회차). 그때는 부르는 쪽이 지금을 쓴다.
     */
  ): Promise<Result<{ phase: Phase; partyAt?: number; me: Player; fortune?: Fortune }>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    const me = this.player(playerId);
    if (!me) return fail("not_found");
    const row = this.rows<{ json: string }>("SELECT json FROM fortunes WHERE player_id = ?", playerId)[0];
    return ok({
      phase: meta.phase,
      ...(meta.schedule.partyAt ? { partyAt: meta.schedule.partyAt } : {}),
      me,
      ...(row ? { fortune: readFortune(JSON.parse(row.json)) } : {}),
    });
  }

  async ackSeat(playerId: string, round: number): Promise<Result<true>> {
    const s = this.seatings().find((x) => x.round === round && x.status === "published");
    if (!s) return fail("not_found");
    if (!s.acks.includes(playerId)) {
      s.acks.push(playerId);
      this.ctx.storage.sql.exec(
        "UPDATE seatings SET acks = ? WHERE round = ?",
        JSON.stringify(s.acks),
        round,
      );
    }
    return ok(true);
  }

  // ─────────────────────────── 운영자 화면

  async hostState(now: number): Promise<Result<HostState>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    const players = this.players();
    // 지워진 사람이 보낸 콕은 남아 있다 (ADR-29). 집계에서는 **지금 있는 사람만** 센다 —
    // 없는 사람의 아이디가 화면에 빈 이름으로 뜨거나, 상한을 묶으면 안 된다
    const here = new Set(players.map((p) => p.id));
    const pokes = this.pokes().filter((k) => here.has(k.fromId) && here.has(k.toId));

    /** 참석 상태. **운영자 응답에만 실린다** (ADR-33) */

    const sent: Record<PokeRound, Record<string, number>> = { pre: {}, party: {} };
    /*
     * **라운드마다 따로 센다** (ADR-46). 합치면 현황 탭의 `콕 TOP` 에 매력 투표 표가 얹혀서,
     * 운영자가 "이 사람이 파티에서 몇 번 받았나" 를 못 읽는다 — 그 둘은 쓰임이 다르다 (ADR-34).
     */
    const received: Record<PokeRound, Record<string, number>> = { pre: {}, party: {} };
    // 상한을 내릴 수 있는지 판단하려면 **한 사람이 라운드마다 몇 번 썼는지**가 필요하다
    const usedBy: Record<PokeRound, Record<string, number>> = { pre: {}, party: {} };
    for (const p of players) {
      sent.pre[p.id] = 0;
      sent.party[p.id] = 0;
      received.pre[p.id] = 0;
      received.party[p.id] = 0;
    }
    const pokeCount: Record<PokeRound, number> = { pre: 0, party: 0 };
    const pairs = new Set<string>();
    const when = new Map<string, Set<PokeRound>>();
    for (const k of pokes) {
      sent[k.round][k.fromId] = (sent[k.round][k.fromId] ?? 0) + 1;
      received[k.round][k.toId] = (received[k.round][k.toId] ?? 0) + 1;
      usedBy[k.round][k.fromId] = (usedBy[k.round][k.fromId] ?? 0) + 1;
      pokeCount[k.round]++;
      pairs.add(`${k.fromId}>${k.toId}`);
      // 어느 라운드에 찔렀는지. 매칭이 **어떻게 이루어졌는가**를 가르는 데만 쓴다
      const key = `${k.fromId}>${k.toId}`;
      if (!when.has(key)) when.set(key, new Set());
      when.get(key)!.add(k.round);
    }
    const pokeUsedMax: Record<PokeRound, number> = {
      pre: Math.max(0, ...Object.values(usedBy.pre)),
      party: Math.max(0, ...Object.values(usedBy.party)),
    };
    /*
     * 매칭은 **파티 콕만** 센다 (ADR-34). 매력 투표는 프로필만 보고 고른 것이라
     * 첫 자리 배정의 재료일 뿐이고, 만나보고 찌른 것과 같은 무게로 세면 안 된다.
     */
    const partyPairs = new Set(pokes.filter((k) => k.round === "party").map((k) => `${k.fromId}>${k.toId}`));
    const mutual: Array<[string, string]> = [];
    for (const key of partyPairs) {
      const [a, b] = key.split(">");
      if (a < b && partyPairs.has(`${b}>${a}`)) mutual.push([a, b]);
    }

    return ok({
      meta,
      players,
      sent,
      received,
      mutual,
      pokeCount,
      pokeUsedMax,
      seatings: this.seatings(),
      invites: this.invites(),
      announcements: this.hostAnnouncements(),
    });
  }

  // ─────────────────────────── 운영자가 보내는 알림 (슬라이스 14)

  /**
   * 참가자에게 내려가는 모양. **표의 주인은 여기 없다** — 숫자 둘과 *내* 선택뿐이다.
   *
   * 한 사람 한 표를 지키려 `votes` 에 짝을 저장하지만, 그 짝은 어떤 응답에도 실리지 않는다.
   * **운영자 응답에도 없다** — 운영자는 전체를 보지만 *누가 9시를 골랐나* 를 알 이유가 없고,
   * 응답에 없으면 화면이 실수로라도 보여줄 수 없다.
   */
  private publicAnnouncements(playerId: string): PublicAnnouncement[] {
    const counts = this.voteCounts();
    const mine = new Map(
      this.rows<{ ann_id: string; choice: PollChoice }>(
        "SELECT ann_id, choice FROM votes WHERE player_id = ?",
        playerId,
      ).map((r) => [r.ann_id, r.choice]),
    );
    return this.announcementRows().map((r) => ({
      id: r.id,
      at: r.at,
      text: r.text,
      ...(r.poll_a !== null && r.poll_b !== null
        ? {
            poll: {
              a: r.poll_a,
              b: r.poll_b,
              count: counts.get(r.id) ?? { a: 0, b: 0 },
              ...(mine.has(r.id) ? { mine: mine.get(r.id)! } : {}),
              closed: r.closed_at !== null,
            },
          }
        : {}),
    }));
  }

  private hostAnnouncements(): HostAnnouncement[] {
    const counts = this.voteCounts();
    return this.announcementRows().map((r) => ({
      ...toAnnouncement(r),
      count: counts.get(r.id) ?? { a: 0, b: 0 },
    }));
  }

  /** 보낸다. 투표면 **열려 있던 투표를 먼저 닫는다** — 열린 투표는 한 번에 하나다 */
  announce(input: AnnounceInput, now: number): Result<HostAnnouncement> {
    const text = input.text?.trim() ?? "";
    if (!text) return fail("bad_request");
    const a = input.poll?.a.trim() ?? "";
    const b = input.poll?.b.trim() ?? "";
    if (input.poll && (!a || !b)) return fail("bad_request");

    if (input.poll) {
      // 둘이 동시에 열려 있으면 참가자는 무엇에 답할지, 운영자는 어느 집계를 볼지 헷갈린다.
      // **텍스트 알림은 닫지 않는다** — 글 하나 보냈다고 투표가 끝나면 운영자가 놀란다
      this.ctx.storage.sql.exec("UPDATE announcements SET closed_at = ? WHERE poll_a IS NOT NULL AND closed_at IS NULL", now);
    }
    const id = randomHex(8);
    this.ctx.storage.sql.exec(
      "INSERT INTO announcements (id, at, text, poll_a, poll_b) VALUES (?, ?, ?, ?, ?)",
      id,
      now,
      text,
      input.poll ? a : null,
      input.poll ? b : null,
    );
    this.broadcast({ type: "notice" });
    return ok(this.hostAnnouncements().find((x) => x.id === id)!);
  }

  /** 닫기·다시 열기. **되돌릴 수 있으므로 확인창이 없다** */
  setAnnouncementOpen(id: string, open: boolean, now: number): Result<HostAnnouncement> {
    const row = this.announcementRows().find((r) => r.id === id);
    if (!row) return fail("not_found");
    this.ctx.storage.sql.exec("UPDATE announcements SET closed_at = ? WHERE id = ?", open ? null : now, id);
    this.broadcast({ type: "notice" });
    return ok(this.hostAnnouncements().find((x) => x.id === id)!);
  }

  /**
   * 지운다. **표도 함께 지운다** — 남겨두면 같은 자리에 온 다음 투표에 옛 표가 섞인다.
   * 참가자 화면은 파생이라 지우기만 하면 따라온다 (ADR-4).
   */
  removeAnnouncement(id: string): Result<true> {
    const row = this.announcementRows().find((r) => r.id === id);
    if (!row) return fail("not_found");
    this.ctx.storage.sql.exec("DELETE FROM votes WHERE ann_id = ?", id);
    this.ctx.storage.sql.exec("DELETE FROM announcements WHERE id = ?", id);
    this.broadcast({ type: "notice" });
    return ok(true);
  }

  /** 한 표. 다시 부르면 **옮겨간다** — 마음을 바꾸는 건 실패가 아니다 */
  vote(playerId: string, id: string, choice: PollChoice): Result<PublicAnnouncement> {
    if (!this.player(playerId)) return fail("not_found");
    const row = this.announcementRows().find((r) => r.id === id);
    if (!row || row.poll_a === null) return fail("not_found");
    if (row.closed_at !== null) return fail("closed");

    this.ctx.storage.sql.exec(
      "INSERT INTO votes (ann_id, player_id, choice) VALUES (?, ?, ?)" +
        " ON CONFLICT(ann_id, player_id) DO UPDATE SET choice = excluded.choice",
      id,
      playerId,
      choice,
    );
    this.broadcast({ type: "notice" });
    return ok(this.publicAnnouncements(playerId).find((x) => x.id === id)!);
  }

  private announcementRows(): AnnRow[] {
    return this.rows<AnnRow>("SELECT * FROM announcements ORDER BY at DESC, id DESC");
  }

  private voteCounts(): Map<string, { a: number; b: number }> {
    const out = new Map<string, { a: number; b: number }>();
    for (const r of this.rows<{ ann_id: string; choice: PollChoice; n: number }>(
      "SELECT ann_id, choice, COUNT(*) AS n FROM votes GROUP BY ann_id, choice",
    )) {
      const cur = out.get(r.ann_id) ?? { a: 0, b: 0 };
      cur[r.choice] = Number(r.n);
      out.set(r.ann_id, cur);
    }
    return out;
  }

  // ─────────────────────────── 오늘의 연애운 (ADR-20)

  /**
   * 저장된 운세를 준다. 없으면 null — 만드는 건 Worker 가 한다.
   *
   * LLM 호출을 여기서 하지 않는 이유: DO 는 요청을 한 줄로 처리한다.
   * 응답을 1~3초 기다리는 동안 그 회차의 모든 요청이 뒤에 선다.
   */
  async fortuneOf(playerId: string): Promise<Result<Fortune | null>> {
    const row = this.rows<{ json: string }>("SELECT json FROM fortunes WHERE player_id = ?", playerId)[0];
    return ok(row ? readFortune(JSON.parse(row.json)) : null);
  }

  /**
   * 처음 저장한 것만 남는다. 두 번 눌러 두 번 만들어졌더라도 **먼저 온 하나**가 오늘의 운세다 —
   * 열 때마다 달라지면 그 순간 전부 거짓말이 된다.
   */
  /**
   * 미션만 채운다. **운세 본문은 건드리지 않는다** —
   * 한 번 연 운세는 바뀌지 않는다 (ADR-20). 저장하는 자리가 그 규칙을 지키게 둔다.
   *
   * 이미 채워져 있으면 그대로 돌려준다. 두 번 눌러도 같은 문장이 온다.
   *
   * `lead`(왜 오늘 이것인지)는 미션과 **함께** 들어오고 함께 잠긴다.
   * 없이 올 수도 있다 — LLM 이 빼먹은 경우다. 그때는 미션만 남고 화면이 한 줄로 그린다.
   */
  async saveMission(playerId: string, m: { mission: string; lead?: string }): Promise<Result<Fortune>> {
    const row = this.rows<{ json: string }>("SELECT json FROM fortunes WHERE player_id = ?", playerId)[0];
    if (!row) return fail("not_found");
    const saved = readFortune(JSON.parse(row.json));
    if (saved.mission) return ok(saved);

    const next = { ...saved, ...m };
    this.ctx.storage.sql.exec(
      "UPDATE fortunes SET json = ? WHERE player_id = ?",
      JSON.stringify(next),
      playerId,
    );
    return ok(next);
  }

  async saveFortune(playerId: string, fortune: Fortune): Promise<Result<Fortune>> {
    if (!this.player(playerId)) return fail("not_found");
    this.ctx.storage.sql.exec(
      // DO NOTHING 이 곧 "한 번 연 운세는 바뀌지 않는다" 다 (ADR-20).
      // 미션을 채우는 건 `saveMission` 이 따로 한다 — 여기로 덮어쓰면 그 규칙이 무너진다
      "INSERT INTO fortunes (player_id, json) VALUES (?,?) ON CONFLICT(player_id) DO NOTHING",
      playerId,
      JSON.stringify(fortune),
    );
    const row = this.rows<{ json: string }>("SELECT json FROM fortunes WHERE player_id = ?", playerId)[0];
    return ok(readFortune(JSON.parse(row.json)));
  }

  // ─────────────────────────── 자리

  /** 초안 생성. 참가자에게는 보이지 않으므로 확인 없이 몇 번이든 다시 만든다 (ADR-6) */
  async makeSeating(tableCount: number, exclude: string[], now: number): Promise<Result<SeatingRound>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (meta.phase === "done") return fail("closed");
    if (!Number.isInteger(tableCount) || tableCount < 1 || tableCount > LIMITS.tableMax) {
      return fail("bad_request");
    }

    /*
     * **뺄 사람은 운영자가 이 라운드에만 고른다** (ADR-45).
     *
     * 참가자에게 붙는 상태를 만들지 않는다 — 노쇼는 다음 라운드에 나타날 수 있고,
     * 온 사람이 잠깐 빠질 수도 있다. 사람에게 붙는 플래그는 시간이 지나면 틀리고,
     * 틀린 상태는 다음 라운드에서 사람을 조용히 빠뜨린다 (FLOWS.md).
     *
     * 그래서 이 목록은 **요청에만 있고 어디에도 저장되지 않는다.** 다음 배정은 전원으로 시작한다.
     * `buildSeating` 은 그대로다 — 명단이 짧아질 뿐이라 순수 함수를 건드릴 일이 없다.
     */
    const out = new Set(exclude);
    const players = this.players().filter((p) => !out.has(p.id));
    if (players.length < tableCount * 2) return fail("bad_request");

    const published = this.seatings().filter((s) => s.status === "published");
    const round = (published.at(-1)?.round ?? 0) + 1;
    const { mutual, oneWay, votes } = this.pairs();

    const seats = buildSeating({
      players,
      tableCount,
      round,
      history: published.map((s) => s.seats),
      mutual,
      votes,
      oneWay,
    });

    const draft: SeatingRound = {
      round,
      tableCount,
      status: "draft",
      seats,
      acks: [],
      createdAt: now,
    };
    this.writeSeating(draft);
    return ok(draft);
  }

  /**
   * 고칠 라운드를 찾는다. **초안이든 발행된 것이든 같은 조작을 받는다** (슬라이스 11).
   *
   * 발행한 라운드가 손댈 수 없는 것이던 시절에는, 한 명이 늦게 왔을 때 쓸 수 있는 게
   * 새 라운드 발행뿐이었다 — 전원이 자리를 옮기고 전원이 확인 화면을 다시 받았다.
   *
   * 번호를 안 주면 초안이다. 운영자가 지금 보고 있는 카드가 어느 것인지는 화면이 안다.
   */
  private editableRound(round?: number): SeatingRound | null {
    const all = this.seatings();
    return (round ? all.find((s) => s.round === round) : all.find((s) => s.status === "draft")) ?? null;
  }

  /** 발표만이 자리를 끝낸다 (ADR-28). 확정도, 발행도 끝내지 않는다 */
  private async seatsOpen(): Promise<boolean> {
    return (await this.ctx.storage.get<EventMeta>("meta"))?.phase !== "done";
  }

  /**
   * 고친 라운드를 저장하고, 발행된 것이면 **다시 읽으라고** 알린다.
   *
   * 방송을 거르면 참가자 화면이 옛 테이블 번호를 그대로 들고 있게 된다 —
   * **알림을 안 보내는 것과 화면을 안 고치는 것은 다른 일이다** (ADR-26).
   * 자리 이동 확인 화면이 뜨지 않는 건 `acks` 가 막는다.
   */
  private saveRound(s: SeatingRound) {
    this.writeSeating(s);
    if (s.status === "published") this.broadcast({ type: "seating", round: s.round });
  }

  /**
   * 좌석 **변경**은 맞교환 하나뿐이다. 한 명만 옮기면 그 테이블 인원이 늘고 옆이 준다 (SEATING.md).
   *
   * 남녀를 맞바꾸는 것도 허용한다. 두 테이블의 남녀 구성이 바뀌지만 인원은 그대로다 —
   * 현장에서 운영자가 아는 사정(아는 사이, 자리 요청)은 배정 알고리즘이 모른다.
   * 바뀐 성비는 자리 화면의 `남 N / 여 M` 에 곧바로 보인다.
   *
   * **`acks` 는 건드리지 않는다.** 둘 다 이미 들어 있고, 빼면 그 둘에게만 확인 화면이 뜬다 —
   * 라운드 하나를 고치는 건 운영자가 그 사람 앞에 서서 하는 일이라 앱이 대신 말할 게 없다.
   */
  async swapSeats(a: string, b: string, round?: number): Promise<Result<SeatingRound>> {
    if (!(await this.seatsOpen())) return fail("closed");
    const target = this.editableRound(round);
    if (!target) return fail("not_found");
    const sa = target.seats.find((s) => s.playerId === a);
    const sb = target.seats.find((s) => s.playerId === b);
    if (!sa || !sb || sa.playerId === sb.playerId) return fail("not_found");
    [sa.table, sb.table] = [sb.table, sa.table];
    this.saveRound(target);
    return ok(target);
  }

  /**
   * 자리 없는 사람을 이 라운드에 **끼워 넣는다.** 옮기는 게 아니라 더하는 것이라
   * 아무도 자리를 잃지 않는다 — 커플 자리의 쌍도 그대로다 (ADR-23).
   *
   * **테이블은 서버가 고른다.** 운영자가 고르게 하면 그게 곧 SEATING.md 가 금지한
   * 단일 이동 API 다 — 조작 한 번에 성비 불변식이 깨진다.
   * 자기 성별이 가장 적은 테이블, 같으면 사람이 적은 쪽, 그것도 같으면 낮은 번호.
   * **난수를 쓰지 않는다** — 같은 상태에서 같은 자리가 나와야 한다.
   *
   * 발행된 라운드라면 `acks` 에 함께 넣는다. 안 그러면 이 사람에게만 자리 이동 확인이
   * 뜬다 — 방금 운영자가 손으로 앉히며 말해준 것을 앱이 한 번 더 묻는 꼴이다.
   */
  async seatPlayer(playerId: string, round?: number): Promise<Result<SeatingRound>> {
    if (!(await this.seatsOpen())) return fail("closed");
    const target = this.editableRound(round);
    if (!target) return fail("not_found");
    const me = this.player(playerId);
    if (!me) return fail("not_found");
    if (target.seats.some((s) => s.playerId === playerId)) return ok(target);

    const gender = new Map(
      this.rows<{ id: string; gender: Gender }>("SELECT id, gender FROM players").map((r) => [r.id, r.gender]),
    );
    let best = 1;
    let bestKey: [number, number] = [Infinity, Infinity];
    for (let t = 1; t <= target.tableCount; t++) {
      const here = target.seats.filter((s) => s.table === t);
      const key: [number, number] = [here.filter((s) => gender.get(s.playerId) === me.gender).length, here.length];
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        best = t;
        bestKey = key;
      }
    }

    target.seats.push({ playerId, table: best });
    if (target.status === "published" && !target.acks.includes(playerId)) target.acks.push(playerId);
    this.saveRound(target);
    return ok(target);
  }

  /**
   * 이 라운드 자리에서만 뺀다. **참가자를 지우는 것이 아니다** —
   * 명단에도 콕 대상에도 그대로 있고, 그가 만든 매칭은 아무것도 바뀌지 않는다.
   * (지우면 그 매칭이 상대에게서도 사라진다 — `FLOWS.md`.)
   *
   * `acks` 에서도 뺀다. 자리가 없는 사람이 "자리를 안다" 로 세어지면
   * 운영자가 보는 `N/총원` 의 분자와 분모가 서로 다른 것을 센다.
   */
  async unseatPlayer(playerId: string, round?: number): Promise<Result<SeatingRound>> {
    if (!(await this.seatsOpen())) return fail("closed");
    const target = this.editableRound(round);
    if (!target) return fail("not_found");
    if (!target.seats.some((s) => s.playerId === playerId)) return fail("not_found");

    target.seats = target.seats.filter((s) => s.playerId !== playerId);
    target.acks = target.acks.filter((x) => x !== playerId);
    this.saveRound(target);
    return ok(target);
  }

  /**
   * 남녀 비율을 **그대로 두고** 사람만 다시 섞는다.
   *
   * 테이블마다 남 몇·여 몇인지는 손대지 않고, 그 자리에 누가 앉는지만 바꾼다.
   * 나이차·재회·콕 보너스는 보지 않는다 — 운영자가 "그냥 다시 섞어줘" 라고 할 때 쓰는 손잡이다.
   * 다시 계산하고 싶으면 자리 재배정을 누르면 된다.
   *
   * **커플 자리에서는 이어진 쌍이 움직이지 않는다** (ADR-23).
   * 그 배정의 목적이 쌍을 같은 테이블에 앉히는 것인데, 섞기가 그걸 흩어놓으면
   * 버튼 하나로 그 라운드가 무의미해진다. 붙어 앉은 쌍은 자리를 지키고 나머지만 섞인다.
   */
  async shuffleSeating(): Promise<Result<SeatingRound>> {
    if (!(await this.seatsOpen())) return fail("closed");
    const draft = this.seatings().find((s) => s.status === "draft");
    if (!draft) return fail("not_found");

    const gender = new Map(
      this.rows<{ id: string; gender: Gender }>("SELECT id, gender FROM players").map((r) => [r.id, r.gender]),
    );
    const held = this.pairedSeatIds(draft);

    for (const g of ["M", "F"] as const) {
      // 이 성별이 앉아 있던 자리들과 사람들을 따로 모아, 사람 쪽만 섞어 도로 앉힌다.
      // 붙어 앉은 쌍은 애초에 이 목록에 들어오지 않으므로 제자리에 남는다
      const mine = draft.seats.filter((s) => gender.get(s.playerId) === g && !held.has(s.playerId));
      const ids = shuffle(mine.map((s) => s.playerId));
      mine.forEach((seat, i) => (seat.playerId = ids[i]));
    }
    this.writeSeating(draft);
    return ok(draft);
  }

  /** 이 배정에서 **같은 테이블에 앉은** 상호 매칭 쌍의 사람들 */
  private pairedSeatIds(round: SeatingRound): Set<string> {
    const table = new Map(round.seats.map((s) => [s.playerId, s.table]));
    const held = new Set<string>();
    for (const [a, b] of this.pairs("party").mutual) {
      if (table.has(a) && table.get(a) === table.get(b)) {
        held.add(a);
        held.add(b);
      }
    }
    return held;
  }

  async discardSeating(): Promise<Result<true>> {
    const draft = this.seatings().find((s) => s.status === "draft");
    if (!draft) return fail("not_found");
    this.ctx.storage.sql.exec("DELETE FROM seatings WHERE round = ? AND status = 'draft'", draft.round);
    return ok(true);
  }

  async publishSeating(now: number): Promise<Result<SeatingRound>> {
    // 발표만이 자리를 끝낸다 (ADR-28). 끝난 뒤에 발행하면 아무도 보지 못할 자리가 생긴다
    if (!(await this.seatsOpen())) return fail("closed");
    const draft = this.seatings().find((s) => s.status === "draft");
    if (!draft) return fail("not_found");
    draft.status = "published";
    draft.publishedAt = now;
    draft.acks = [];
    this.writeSeating(draft);

    /*
     * **전원에게 보낸다.** 자리에 앉은 사람에게만 개인 소켓으로 보내면 두 곳에서 샌다 —
     * 반쯤 죽은 소켓(폰 잠금·통신망 전환)에는 send 가 성공한 척 사라지고,
     * 참가자 식별이 붙지 않은 소켓은 영영 매칭되지 않는다. 둘 다 조용해서 알림이
     * 사라진 게 아니라 **늦게, 엉뚱한 순간에** 뜬다 (다음 리로드 때).
     *
     * 클라이언트는 어차피 내용을 읽지 않고 "다시 읽어라" 로만 쓴다 (ADR-26).
     * 자리 확정은 파티당 서너 번뿐이라 전원에게 보내도 비용이 무시할 수준이다.
     * 반대로 콕(`poke`)은 받은 횟수가 개인 정보고 빈도도 높아 개인 전송으로 남긴다.
     */
    this.broadcast({ type: "seating", round: draft.round });
    return ok(draft);
  }

  // ─────────────────────────── 예약 알람 (ADR-2)

  /**
   * 예약은 한 번만 울리는 알람이다. 실제 전환 시각을 fired 에 남기고,
   * fired 가 비어 있을 때만 울린다. 그래서 되돌리기를 해도 즉시 다시 밀리지 않는다.
   */
  private async touch(now: number): Promise<EventMeta | null> {
    let meta = await this.ctx.storage.get<EventMeta>("meta");
    if (!meta) return null;
    let moved = false;
    for (let i = 0; i < PHASE_ORDER.length; i++) {
      const to = dueTransition(meta, now);
      if (!to) break;
      meta = { ...meta, phase: to, fired: { ...meta.fired, [to]: now } };
      moved = true;
    }
    if (moved) {
      await this.ctx.storage.put("meta", meta);
      await this.rearm(meta, now);
      this.broadcast({ type: "phase", phase: meta.phase, fired: meta.fired });
      if (meta.phase === "done") this.broadcast({ type: "reveal" });
    }
    return meta;
  }

  /** 다음에 울릴 예약 하나만 걸어둔다. 폴링이 아니라서 유휴 중 비용이 0이다 */
  private async rearm(meta: EventMeta, now: number) {
    const at = dueAt(meta);
    if (at === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(at, now + 1000));
  }

  async alarm() {
    await this.touch(Date.now());
  }

  // ─────────────────────────── 실시간

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Hibernation: 연결은 유지하되 유휴 중 컴퓨트를 소모하지 않는다
    this.ctx.acceptWebSocket(server);
    const playerId = req.headers.get("x-player-id") ?? undefined;
    server.serializeAttachment({ playerId } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: { type?: string; round?: number };
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (msg.type === "ping") return this.send(ws, { type: "pong", serverTime: Date.now() });
    if (msg.type === "ack-seat" && typeof msg.round === "number") {
      const at = (ws.deserializeAttachment() ?? {}) as Attachment;
      if (at.playerId) await this.ackSeat(at.playerId, msg.round);
    }
  }

  private send(ws: WebSocket, ev: ServerEvent) {
    try {
      ws.send(JSON.stringify(ev));
    } catch {
      /* 끊긴 소켓은 다음 브로드캐스트에서 자연히 빠진다 */
    }
  }

  /** 회차 전체에 방송. 콕처럼 수신자별로 내용이 달라야 하는 건 toPlayer 를 쓴다 */
  private broadcast(ev: ServerEvent) {
    for (const ws of this.ctx.getWebSockets()) this.send(ws, ev);
  }

  private toPlayer(playerId: string, ev: ServerEvent) {
    for (const ws of this.ctx.getWebSockets()) {
      const at = (ws.deserializeAttachment() ?? {}) as Attachment;
      if (at.playerId === playerId) this.send(ws, ev);
    }
  }

  /**
   * 운영자 콘솔에만 보낸다. 참가자 화면이 달라지지 않는 변화를 위한 통로다.
   *
   * **신호 하나가 곧 N번의 재조회다** (ADR-26 — 실시간은 "다시 읽어라" 신호로만 쓴다).
   * 참가자 화면이 똑같이 그려질 변화까지 전원에게 보내면, 아무것도 바꾸지 않는 읽기가
   * 인원수만큼 쌓이고 그 읽기는 쓰기 큐 뒤에 선다. 50명에서 재조회 하나가 8초까지 밀렸다.
   *
   * 참가자 소켓에는 `playerId` 가 붙어 있다 (Worker 가 세션 쿠키를 보고 붙인다).
   * 안 붙은 소켓은 운영자 콘솔이다 — 세션이 끊긴 참가자도 여기 섞일 수 있지만,
   * 이 통로로 나가는 건 이미 참가자에게 보이는 값뿐이라 새어도 잃을 게 없다.
   */
  private toHosts(ev: ServerEvent) {
    for (const ws of this.ctx.getWebSockets()) {
      const at = (ws.deserializeAttachment() ?? {}) as Attachment;
      if (!at.playerId) this.send(ws, ev);
    }
  }

  // ─────────────────────────── 내부 조회

  private rows<T>(query: string, ...binds: unknown[]): T[] {
    return this.ctx.storage.sql.exec(query, ...(binds as never[])).toArray() as T[];
  }

  private players(): Player[] {
    return this.rows<PlayerRow>("SELECT * FROM players ORDER BY created_at").map(toPlayer);
  }

  private player(id: string): Player | null {
    const row = this.rows<PlayerRow>("SELECT * FROM players WHERE id = ?", id)[0];
    return row ? toPlayer(row) : null;
  }

  private playerCount(): number {
    return this.rows<{ n: number }>("SELECT COUNT(*) AS n FROM players")[0]?.n ?? 0;
  }

  private pokes(): Poke[] {
    return this.rows<{ id: string; from_id: string; to_id: string; round: PokeRound; at: number }>(
      "SELECT * FROM pokes",
    ).map((r) => ({ id: r.id, fromId: r.from_id, toId: r.to_id, round: r.round, at: r.at }));
  }

  private sentCount(fromId: string, round: PokeRound): number {
    return (
      this.rows<{ n: number }>(
        "SELECT COUNT(*) AS n FROM pokes WHERE from_id = ? AND round = ?",
        fromId,
        round,
      )[0]?.n ?? 0
    );
  }

  private receivedCount(toId: string, only?: PokeRound): number {
    return only
      ? this.rows<{ n: number }>(
          "SELECT COUNT(*) AS n FROM pokes WHERE to_id = ? AND round = ?",
          toId,
          only,
        )[0]?.n ?? 0
      : this.rows<{ n: number }>("SELECT COUNT(*) AS n FROM pokes WHERE to_id = ?", toId)[0]?.n ?? 0;
  }

  /**
   * 참가자에게 **보여도 되는** 받은 수 (ADR-43).
   *
   * 알림이 라운드마다 따로라, 꺼둔 라운드는 **0으로 내려보낸다** — 실어 보내면
   * 매력 투표 알림을 끈 회차에서 파티가 시작되는 순간 그때까지 쌓인 표가 드러난다.
   * 화면에서 감추는 걸로는 부족하다. 개발자 도구를 여는 참가자가 있고,
   * **이 숫자가 곧 "지금까지 몇 명이 나를 골랐나" 다** (ADR-34).
   *
   * **라운드를 가른다** (ADR-46 후기). 합쳐 두면 소식 줄이 매력 투표에서도 `콕` 이라고
   * 부르게 되는데, 참가자는 그 단계에서 콕을 찌른 적이 없다. 가른 대가는 그 후기에 적었다.
   */
  private visibleReceived(toId: string, meta: EventMeta): Record<PokeRound, number> {
    // 발표 뒤에는 전부 센다 — 그때는 매칭까지 열리므로 감출 것이 없다
    if (meta.phase === "done") {
      return { pre: this.receivedCount(toId, "pre"), party: this.receivedCount(toId, "party") };
    }
    return {
      pre: meta.config.preNotify ? this.receivedCount(toId, "pre") : 0,
      party: meta.config.pokeNotify ? this.receivedCount(toId, "party") : 0,
    };
  }

  /**
   * 참가자 본인에게 내려가는 콕 상태.
   * 받은 콕은 **횟수만** 넣는다. 발신자(fromId)는 발표 후에도 상호 매칭이 아니면 넣지 않는다 (ADR-1).
   */
  private async pokeState(playerId: string, meta: EventMeta): Promise<MyPokeState> {
    const sentTo: Record<string, number> = {};
    const used: Record<PokeRound, number> = { pre: 0, party: 0 };

    // 색인(pokes_from)으로 **내 것만** 센다. 예전엔 요청마다 콕 전체를 읽어서
    // 파티가 무르익을수록 콕 한 번이 느려졌다 — 100명 리허설에서 드러났다
    const mine = this.rows<{ to_id: string; round: PokeRound; n: number }>(
      "SELECT to_id, round, COUNT(*) AS n FROM pokes WHERE from_id = ? GROUP BY to_id, round",
      playerId,
    );
    /*
     * **`sentTo` 는 이번 라운드만 센다** (ADR-34).
     *
     * 예전에는 두 라운드를 합쳤다. 그래서 매력 투표에서 한 번 고른 사람이 파티가 시작되자
     * **콕을 이미 한 번 찌른 것처럼** 보였다 — 남은 콕은 그대로인데 그 사람 카드에만 `1` 이 붙었다.
     * 매력 투표와 콕은 다른 일이고(ADR-34), 그 둘을 한 숫자로 더하면 어느 쪽도 아닌 값이 된다.
     *
     * 되돌리기도 같은 자리에서 어긋났다. 서버는 **이번 라운드의 콕만** 지우는데
     * (`unpoke` 의 `round = ?`), 화면은 합계를 보고 되돌리기를 내줬다 —
     * 누르면 지울 것이 없어 아무 일도 일어나지 않았다.
     *
     * 예산(`used`)은 그대로 라운드마다 따로 센다. 그건 처음부터 맞았다.
     */
    const round = roundOf(meta.phase);
    for (const r of mine) {
      if (r.round === round) sentTo[r.to_id] = (sentTo[r.to_id] ?? 0) + r.n;
      used[r.round] += r.n;
    }

    const matches: MatchInfo[] = [];
    if (meta.phase === "done") {
      // 매칭은 **만나보고 찌른 것**만 센다 (ADR-34). 매력 투표는 자리의 재료일 뿐이다
      const { mutual } = this.pairs("party");
      const mySeat = this.mySeat(playerId);
      const last = this.lastPublished();
      for (const [a, b] of mutual) {
        const otherId = a === playerId ? b : b === playerId ? a : null;
        if (!otherId) continue;
        const other = this.player(otherId);
        if (!other) continue;
        const theirTable = last?.seats.find((s) => s.playerId === otherId)?.table;

        /*
         * **실명이 참가자에게 나가는 유일한 자리다** (ADR-19·42). 조건 셋이 여기 겹쳐 있다 —
         * 이 블록은 `meta.phase === "done"` 안이고(①), `mutual` 에 든 쌍만 지나며(②),
         * 꺼내는 건 `other` 의 것이다(③).
         *
         * ⚠️ **여기에 `other.phone`·`other.instagram` 을 다시 더하지 마라** (ADR-42).
         * 연락처는 매칭된 쌍에게도 안 나간다 — 앱은 *누구와 마음이 맞았는지*까지만 알려주고,
         * 연락은 그 자리에서 두 사람이 직접 한다. `MatchInfo` 에 담을 자리가 없는 것이 곧 방어다.
         */
        matches.push({
          player: toPublic(other, meta.phase),
          sameTable: mySeat && theirTable === mySeat.table ? mySeat.table : undefined,
          realName: other.realName,
        });
      }
    }

    return {
      budget: {
        pre: { max: meta.config.maxPre, used: used.pre },
        party: { max: meta.config.maxParty, used: used.party },
      },
      sentTo,
      // 알림을 끈 라운드는 발표 전까지 세지 않는다 (ADR-34·43) — `visibleReceived` 가 판단한다
      received: this.visibleReceived(playerId, meta),
      matches,
    };
  }

  /**
   * 서로 찌른 쌍과 한쪽만 찌른 쌍.
   *
   * 상호 매칭은 **주고받은 콕이 많은 순**으로 준다 (ADR-25). 한 사람이 여러 명과 이어졌는데
   * 정원이 모자라면 앞의 쌍이 자리를 가져가고, 화면의 커플 목록도 같은 순서로 읽힌다.
   */
  /**
   * 쌍을 센다. `only` 를 주면 그 라운드만 본다.
   *
   * **매칭은 `party` 만 본다** (ADR-34). 매력 투표는 프로필만 보고 고른 것이라
   * 첫 자리 배정의 재료일 뿐이고, 만나보고 찌른 것과 같은 무게로 세면 안 된다.
   * 자리 배정은 반대로 **둘 다** 본다 — 첫 라운드를 정하는 게 매력 투표다.
   */
  /**
   * 서로 찌른 쌍과 한쪽만 찌른 쌍, 그리고 **쌍마다 오간 표의 총합**.
   *
   * `votes` 는 **단방향 쌍에도 채운다** (ADR-40) — 자리 배정의 끌림이 표 하나하나에서
   * 나오기 때문이다. 예전에는 상호 쌍에만 있었고, 그래서 한 사람에게 세 번 투표한 것과
   * 한 번 투표한 것이 자리에서는 똑같았다.
   */
  private pairs(only?: PokeRound) {
    const sent = new Map<string, number>();
    for (const k of this.pokes()) {
      if (only && k.round !== only) continue;
      const key = `${k.fromId}>${k.toId}`;
      sent.set(key, (sent.get(key) ?? 0) + 1);
    }

    const mutual: Array<[string, string]> = [];
    const oneWay: Array<[string, string]> = [];
    const votes: Record<string, number> = {};
    const add = (a: string, b: string, n: number) => {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      votes[key] = (votes[key] ?? 0) + n;
    };
    for (const [key, n] of sent) {
      const [a, b] = key.split(">");
      add(a, b, n);
      if (sent.has(`${b}>${a}`)) {
        // 상호는 한 번만 담는다. 뒤집힌 같은 쌍이 또 오기 때문
        if (a < b) mutual.push([a, b]);
      } else {
        oneWay.push([a, b]);
      }
    }
    mutual.sort((x, y) => votes[`${y[0]}|${y[1]}`] - votes[`${x[0]}|${x[1]}`]);
    return { mutual, oneWay, votes };
  }

  private seatings(): SeatingRound[] {
    return this.rows<SeatingRow>("SELECT * FROM seatings ORDER BY round").map((r) => ({
      round: r.round,
      tableCount: r.table_count,
      status: r.status,
      seats: JSON.parse(r.seats) as Seat[],
      acks: JSON.parse(r.acks) as string[],
      createdAt: r.created_at,
      publishedAt: r.published_at ?? undefined,
    }));
  }

  private lastPublished(): SeatingRound | undefined {
    return this.seatings().filter((s) => s.status === "published").at(-1);
  }

  /**
   * 내 자리. **파티가 시작돼야 나간다.**
   *
   * 예전에는 단계를 안 봐서, 운영자가 사전 투표 중에 발행하면 그 순간 참가자 화면에
   * 테이블 번호가 뜨고 전체 화면 확인창이 덮쳤다. 그래서 **미리 짜둘 수가 없었고**,
   * 파티가 시작된 뒤에 급히 배정하게 됐다 — 피하려던 바로 그 상황이다.
   *
   * 이제 미리 짜둬도 조용하다. 그리고 **파티 시작 버튼이 그대로 자리 알림이 된다** —
   * 단계 전환 방송이 이미 전원 재조회를 부르므로 (ADR-26) 새 장치가 필요 없다.
   *
   * 발표 후에도 남긴다. 매칭 상대와 같은 테이블이었는지를 발표 화면이 쓴다 (`MatchInfo.sameTable`).
   * **화면에서 감추는 것으로는 부족하다** — 개발자 도구를 여는 참가자가 있다.
   */
  /**
   * **발행하면 그 순간부터 보인다** (ADR-39). 단계를 보지 않는다.
   *
   * 슬라이스 12 에서는 파티가 시작돼야 보이게 막았다 — 운영자가 자리를 미리 짜두려면
   * 짜는 동안 참가자에게 새지 않아야 했기 때문이다. 그 방어는 지금 **초안**이 맡는다.
   * 초안은 발행하기 전까지 `lastPublished()` 에 잡히지 않는다.
   *
   * 게이트를 풀어야 했던 이유는 **일찍 온 사람을 앉히기** 위해서다.
   * 파티 시작 전에 자리를 보내고, 온 사람이 자기 테이블을 보고 앉아 기다린다.
   */
  private mySeat(playerId: string): MySeat | undefined {
    const last = this.lastPublished();
    if (!last) return undefined;
    const mine = last.seats.find((s) => s.playerId === playerId);
    if (!mine) return undefined;
    const mates = last.seats.filter((s) => s.table === mine.table);
    // 한 명씩 조회하면 테이블 인원만큼 질의가 나간다. 성별만 한 번에 읽는다
    const genders = new Map(
      this.rows<{ id: string; gender: Gender }>("SELECT id, gender FROM players").map((r) => [r.id, r.gender]),
    );
    const men = mates.filter((s) => genders.get(s.playerId) === "M").length;
    return {
      round: last.round,
      table: mine.table,
      mates: mates.length,
      men,
      acked: last.acks.includes(playerId),
    };
  }

  private writeSeating(s: SeatingRound) {
    /*
     * **`final` 칸은 쓰지 않는다** (ADR-51). 칸은 남겨둔다 — `DROP COLUMN` 은 옛 회차의
     * 표를 건드리는 일이고, `NOT NULL DEFAULT 0` 이라 안 적어도 들어간다.
     * `contact_share`·`attendance` 와 같은 자리다.
     */
    this.ctx.storage.sql.exec(
      `INSERT INTO seatings (round, table_count, status, seats, acks, created_at, published_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(round) DO UPDATE SET
         table_count=excluded.table_count, status=excluded.status,
         seats=excluded.seats, acks=excluded.acks, published_at=excluded.published_at`,
      s.round,
      s.tableCount,
      s.status,
      JSON.stringify(s.seats),
      JSON.stringify(s.acks),
      s.createdAt,
      s.publishedAt ?? null,
    );
  }

}

// ─────────────────────────── 순수 헬퍼


interface AnnRow {
  id: string;
  at: number;
  text: string;
  /** null 이면 텍스트 알림, 값이 있으면 A/B 투표다 */
  poll_a: string | null;
  poll_b: string | null;
  closed_at: number | null;
}

function toAnnouncement(r: AnnRow): Announcement {
  return {
    id: r.id,
    at: r.at,
    text: r.text,
    ...(r.poll_a !== null && r.poll_b !== null
      ? { poll: { a: r.poll_a, b: r.poll_b, ...(r.closed_at !== null ? { closedAt: r.closed_at } : {}) } }
      : {}),
  };
}

interface PlayerRow {
  id: string;
  nickname: string;
  real_name: string;
  age: number;
  gender: Gender;
  phone: string;
  instagram: string;
  mbti: string;
  charms: string;
  created_at: number;
}

interface SeatingRow {
  round: number;
  table_count: number;
  status: "draft" | "published";
  seats: string;
  acks: string;
  created_at: number;
  published_at: number | null;
}

/** 검증을 지난 정규화본. 여기까지 온 값만 저장한다 */
interface CleanProfile {
  nickname: string;
  nickNorm: string;
  realName: string;
  age: number;
  gender: Gender;
  instagram: string;
  mbti: string;
  charms: [string, string, string];
}

/**
 * 등록과 수정이 함께 보는 검증. 통과하면 정규화본만 돌려준다.
 *
 * 닉네임·실명 규칙은 화면과 **같은 함수**를 본다 — 폼을 우회해 API 로 바로 쏘는 참가자가 있다.
 * `input` 원본은 문자열이 아닐 수도 있어서 그대로 내려보내지 않는다.
 *
 * **전화번호는 여기 없다.** 입장할 때 확인한 값이라 입력에서 오지 않는다 (ADR-15) —
 * 등록 폼에서 받지 않는 것과 같은 이유고, 수정에서도 같다.
 */
function cleanProfile(input: RegisterInput): CleanProfile | null {
  const nickname = cleanName(input.nickname);
  const realName = cleanName(input.realName);
  if (nicknameProblem(nickname) || realNameProblem(realName)) return null;
  if (!Number.isInteger(input.age) || input.age < 18 || input.age > 99) return null;
  if (input.gender !== "M" && input.gender !== "F") return null;
  if (!/^[EI][NS][TF][JP]$/.test(String(input.mbti))) return null;

  const charms = Array.isArray(input.charms)
    ? input.charms.map((c) => (typeof c === "string" ? c.trim() : ""))
    : [];
  if (charms.length !== LIMITS.charms || charms.some((c) => !c || c.length > LIMITS.charmMax)) {
    return null;
  }

  // 인스타는 필수다. 매칭되면 서로에게 공개되는 연락 수단이라 없이는 매칭이 반쪽이 된다
  const instagram = normalizeInstagram(String(input.instagram ?? ""));
  if (instagram.length > LIMITS.instagramMax || !/^[A-Za-z0-9._]+$/.test(instagram)) return null;

  return {
    nickname,
    nickNorm: normalizeNickname(nickname),
    realName,
    age: input.age,
    gender: input.gender,
    instagram,
    mbti: input.mbti,
    charms: charms as [string, string, string],
  };
}

function toPlayer(r: PlayerRow): Player {
  return {
    id: r.id,
    nickname: r.nickname,
    realName: r.real_name,
    age: r.age,
    gender: r.gender,
    phone: r.phone,
    instagram: r.instagram,
    mbti: r.mbti,
    charms: JSON.parse(r.charms) as [string, string, string],
    createdAt: r.created_at,
  };
}

/** Fisher–Yates. `Math.random` 대신 crypto 를 쓴다 — 같은 밀리초에 두 번 눌러도 다르게 나오게 */
function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  const rnd = new Uint32Array(out.length);
  crypto.getRandomValues(rnd);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function roundOf(phase: Phase): PokeRound {
  return phase === "prevote" ? "pre" : "party";
}

function inRange(n: number, r: { min: number; max: number }): boolean {
  return Number.isInteger(n) && n >= r.min && n <= r.max;
}

/**
 * 이 라운드의 알림이 켜져 있나 (ADR-43). **되돌리기와 같은 꼴이다** —
 * 매력 투표는 `preNotify`, 파티 콕은 `pokeNotify`. 둘 다 없으면 알리지 않는다.
 */
function notifyOn(config: EventConfig, round: PokeRound): boolean {
  return round === "pre" ? config.preNotify === true : config.pokeNotify === true;
}

/**
 * 순서 검증. 등록보다 먼저 사전 투표가 열리는 것만 막는다.
 * 파티 일시는 언제든 옮길 수 있다 — 장소가 바뀌면 시각이 바뀌고, 그건 일정이 아니라 사실이다.
 */
const SCHEDULE_KEYS = ["partyAt", "regOpenAt", "prevoteAt", "voteEndAt", "revealAt"] as const;

/**
 * 굳는 규칙 다섯을 **뜻으로** 편다 (ADR-35·43).
 *
 * 기본값이 항목마다 다르다 — 대상·되돌리기는 없으면 '열림', 알림은 없으면 '끔'.
 * 그래서 `undefined` 를 그대로 견주면 안 되고, 저마다의 기본으로 접어서 본다.
 * 새 규칙을 굳히려면 이 배열에 한 줄을 더한다. 그게 잠금 목록의 전부다.
 */
function frozenRules(c: EventConfig): boolean[] {
  return [
    c.allowSameGender !== false,
    c.allowUndo !== false,
    c.allowUndoPre !== false,
    c.preNotify === true,
    c.pokeNotify === true,
  ];
}
