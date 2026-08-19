/**
 * 회차 1개 = Durable Object 1개.
 *
 * 이 매핑이 주는 것:
 *  - 요청이 순차 처리되므로 닉네임 유일성·콕 예산 차감에 경쟁 조건이 없다
 *  - 브로드캐스트 대상이 정확히 그 회차 참가자다
 *  - 회차가 끝나면 이 DO 만 지우면 개인정보 파기가 끝난다
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
  EnterResult,
  Gender,
  Invite,
  MatchInfo,
  MyPokeState,
  ParticipantState,
  Phase,
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
import { rosterOpen, toPublic } from "../shared/types.ts";
import { ENTRY } from "../shared/copy.ts";
import {
  ENTRY_TRIES,
  LIMITS,
  RETENTION_DAYS,
  cleanName,
  nicknameProblem,
  normalizeInstagram,
  normalizeNickname,
  normalizePhone,
  realNameProblem,
} from "../shared/constants.ts";
import { PHASE_ORDER, canPoke, dueTransition, purgeDueAt } from "../shared/phase.ts";
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
CREATE TABLE IF NOT EXISTS invites (
  phone    TEXT PRIMARY KEY,      -- 숫자만. 운영자가 미리 넣어두는 초대 명단
  added_at INTEGER NOT NULL
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

type Fail =
  | "not_found"
  | "not_invited"
  | "too_many"
  | "conflict"
  | "forbidden"
  | "bad_request"
  | "schedule_order"
  | "nick_taken"
  | "closed"
  | "same_gender"
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
      partyAt: meta.schedule.partyAt,
      // 등록 화면의 "N일 뒤에 지워져요" 약속이 읽는다 — 회차 설정과 어긋나면 안 된다
      retentionDays: meta.config.retentionDays ?? RETENTION_DAYS,
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

    const forward = PHASE_ORDER.indexOf(to) > PHASE_ORDER.indexOf(meta.phase);
    meta.phase = to;
    if (forward && to !== "prep") meta.fired[to] = now;
    await this.ctx.storage.put("meta", meta);
    await this.rearm(meta, now);
    this.broadcast({ type: "phase", phase: meta.phase, fired: meta.fired });
    if (to === "done") this.broadcast({ type: "reveal" });
    return ok(meta);
  }

  async setSchedule(patch: EventSchedule, now: number): Promise<Result<EventMeta>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    const next: EventSchedule = { ...meta.schedule, ...patch };
    if (!validSchedule(next)) return fail("schedule_order");
    meta.schedule = next;
    await this.ctx.storage.put("meta", meta);
    await this.rearm(meta, now);
    this.broadcast({ type: "phase", phase: meta.phase, fired: meta.fired });
    return ok(meta);
  }

  async patchMeta(
    patch: { name?: string; config?: EventConfig },
    now: number,
  ): Promise<Result<EventMeta>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (patch.name !== undefined) {
      if (!patch.name.trim()) return fail("bad_request");
      meta.name = patch.name.trim();
    }
    if (patch.config) {
      const { maxPre, maxParty, allowSameGender } = patch.config;
      if (!inRange(maxPre, LIMITS.maxPre) || !inRange(maxParty, LIMITS.maxParty)) return fail("bad_request");

      // 안 보내면 지금 값을 지킨다 — 파기 약속이 다른 설정 저장에 딸려 초기화되면 안 된다
      const retentionDays = patch.config.retentionDays ?? meta.config.retentionDays;
      if (retentionDays !== undefined) {
        if (!Number.isInteger(retentionDays) || !inRange(retentionDays, LIMITS.retentionDays)) {
          return fail("bad_request");
        }
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
        ...(retentionDays !== undefined && retentionDays !== RETENTION_DAYS ? { retentionDays } : {}),
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

  /**
   * 보관 기간이 지났으면 통째로 버린다.
   *
   * 개인정보만 골라 지우는 대신 회차째 지운다 — 반쯤 지워진 상태를 만들지 않기 위해서다.
   * "회차 1개 = DO 1개"로 잡은 것이 여기서 값을 한다. 지울 게 한 곳에 다 있다.
   */
  async purgeIfExpired(now: number): Promise<boolean> {
    const meta = await this.ctx.storage.get<EventMeta>("meta");
    if (!meta) return false;
    // 대기 일수는 회차 설정을 따른다. 등록 화면이 한 약속과 같은 값이다
    if (now < purgeDueAt(meta, meta.config.retentionDays ?? RETENTION_DAYS)) return false;
    await this.ctx.storage.deleteAll();
    return true;
  }

  // ─────────────────────────── 입장 명단
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

    for (const phone of fresh) {
      this.ctx.storage.sql.exec("INSERT INTO invites (phone, added_at) VALUES (?,?)", phone, now);
    }
    return ok(this.invites());
  }

  async removeInvite(phone: string): Promise<Result<Invite[]>> {
    this.ctx.storage.sql.exec("DELETE FROM invites WHERE phone = ?", normalizePhone(phone));
    return ok(this.invites());
  }

  /**
   * 입장 확인. 명단에 있는 번호만 통과한다.
   *
   * **이미 등록한 사람은 명단과 무관하게 통과한다.** 명단은 문이지 자격이 아니다 —
   * 운영자가 명단을 정리하다 이미 등록한 사람을 지웠다고 파티 중에 쫓겨나면 안 된다.
   *
   * 실패는 회차·접속지별로 센다. 이 문은 인증 없이 열려서, 제한이 없으면
   * "이 번호가 이 파티에 있나"를 되묻는 창구가 된다 (constants.ts).
   */
  async checkEntry(phone: string, ipHash: string, now: number): Promise<Result<EnterResult>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");

    this.ctx.storage.sql.exec("DELETE FROM entry_tries WHERE at < ?", now - ENTRY_TRIES.windowMs);
    const tries =
      this.rows<{ n: number }>("SELECT COUNT(*) AS n FROM entry_tries WHERE ip_hash = ?", ipHash)[0]?.n ?? 0;
    if (tries >= ENTRY_TRIES.max) return fail("too_many");

    const clean = normalizePhone(phone);
    const mine = this.rows<PlayerRow>("SELECT * FROM players WHERE phone = ?", clean)[0];
    const invited = !!this.rows<{ phone: string }>("SELECT phone FROM invites WHERE phone = ?", clean)[0];

    if (!mine && !invited) {
      this.ctx.storage.sql.exec("INSERT INTO entry_tries (ip_hash, at) VALUES (?,?)", ipHash, now);
      return fail("not_invited");
    }
    // 들어온 사람의 시도 기록은 남기지 않는다
    this.ctx.storage.sql.exec("DELETE FROM entry_tries WHERE ip_hash = ?", ipHash);
    return ok(mine ? { registered: true, code: meta.code } : { registered: false });
  }

  /** 번호로 그 사람을 찾는다. 입장 확인을 통과한 뒤 세션을 만들 때만 쓴다 */
  async playerIdByPhone(phone: string): Promise<Result<string | null>> {
    const row = this.rows<{ id: string }>("SELECT id FROM players WHERE phone = ?", normalizePhone(phone))[0];
    return ok(row?.id ?? null);
  }

  private invites(): Invite[] {
    const byPhone = new Map(this.players().map((p) => [p.phone, p.nickname]));
    return this.rows<{ phone: string; added_at: number }>(
      "SELECT * FROM invites ORDER BY added_at, phone",
    ).map((r) => ({ phone: r.phone, addedAt: r.added_at, nickname: byPhone.get(r.phone) }));
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

    this.broadcast({ type: "roster", count: this.playerCount() });
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
  async editProfile(playerId: string, input: RegisterInput, now: number): Promise<Result<Player>> {
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
    this.toHosts({ type: "roster", count: this.playerCount() });
    return saved;
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
      `INSERT INTO players (id, nickname, nick_norm, real_name, age, gender, phone, instagram, mbti, charms, no_show, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?)
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
  async registerAndLoad(input: RegisterInput, phone: string, now: number): Promise<Result<RegisterResult>> {
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
    this.broadcast({ type: "roster", count: this.playerCount() });
    return ok(true);
  }

  // ─────────────────────────── 콕

  async poke(fromId: string, toId: string, now: number): Promise<Result<MyPokeState>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (!canPoke(meta.phase)) return fail("closed");

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
    // 익명이다. 누가 찔렀는지는 이 메시지에도, 어디에도 싣지 않는다
    this.toPlayer(toId, { type: "poke", receivedCount: this.receivedCount(toId) });
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
        playerCount: this.playerCount(),
      },
      me,
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

    const sent: Record<string, number> = {};
    const received: Record<string, number> = {};
    const preReceived: Record<string, number> = {};
    // 상한을 내릴 수 있는지 판단하려면 **한 사람이 라운드마다 몇 번 썼는지**가 필요하다
    const usedBy: Record<PokeRound, Record<string, number>> = { pre: {}, party: {} };
    for (const p of players) {
      sent[p.id] = 0;
      received[p.id] = 0;
      preReceived[p.id] = 0;
    }
    const pokeCount: Record<PokeRound, number> = { pre: 0, party: 0 };
    const pairs = new Set<string>();
    for (const k of pokes) {
      sent[k.fromId] = (sent[k.fromId] ?? 0) + 1;
      received[k.toId] = (received[k.toId] ?? 0) + 1;
      if (k.round === "pre") preReceived[k.toId] = (preReceived[k.toId] ?? 0) + 1;
      usedBy[k.round][k.fromId] = (usedBy[k.round][k.fromId] ?? 0) + 1;
      pokeCount[k.round]++;
      pairs.add(`${k.fromId}>${k.toId}`);
    }
    const pokeUsedMax: Record<PokeRound, number> = {
      pre: Math.max(0, ...Object.values(usedBy.pre)),
      party: Math.max(0, ...Object.values(usedBy.party)),
    };
    const mutual: Array<[string, string]> = [];
    for (const key of pairs) {
      const [a, b] = key.split(">");
      if (a < b && pairs.has(`${b}>${a}`)) mutual.push([a, b]);
    }

    return ok({
      meta,
      players,
      sent,
      received,
      prevoteRank: Object.entries(preReceived)
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count),
      mutual,
      pokeCount,
      pokeUsedMax,
      seatings: this.seatings(),
      invites: this.invites(),
    });
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
  async makeSeating(tableCount: number, final: boolean, now: number): Promise<Result<SeatingRound>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (meta.phase === "done") return fail("closed");
    if (!Number.isInteger(tableCount) || tableCount < 1 || tableCount > LIMITS.tableMax) {
      return fail("bad_request");
    }

    const players = this.players();
    if (players.length < tableCount * 2) return fail("bad_request");

    const published = this.seatings().filter((s) => s.status === "published");
    const round = (published.at(-1)?.round ?? 0) + 1;
    const { mutual, oneWay, strength } = this.pairs();

    const seats = buildSeating({
      players,
      tableCount,
      round,
      final,
      history: published.map((s) => s.seats),
      mutual,
      strength,
      oneWay,
    });

    const draft: SeatingRound = {
      round,
      tableCount,
      final,
      status: "draft",
      seats,
      acks: [],
      createdAt: now,
    };
    this.writeSeating(draft);
    return ok(draft);
  }

  /**
   * 좌석 변경은 **맞교환 하나뿐**이다. 한 명만 옮기면 그 테이블 인원이 늘고 옆이 준다 (SEATING.md).
   *
   * 남녀를 맞바꾸는 것도 허용한다. 두 테이블의 남녀 구성이 바뀌지만 인원은 그대로다 —
   * 현장에서 운영자가 아는 사정(아는 사이, 자리 요청)은 배정 알고리즘이 모른다.
   * 바뀐 성비는 자리 화면의 `남 N / 여 M` 에 곧바로 보인다.
   */
  async swapSeats(a: string, b: string): Promise<Result<SeatingRound>> {
    const draft = this.seatings().find((s) => s.status === "draft");
    if (!draft) return fail("not_found");
    const sa = draft.seats.find((s) => s.playerId === a);
    const sb = draft.seats.find((s) => s.playerId === b);
    if (!sa || !sb || sa.playerId === sb.playerId) return fail("not_found");
    [sa.table, sb.table] = [sb.table, sa.table];
    this.writeSeating(draft);
    return ok(draft);
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
    const draft = this.seatings().find((s) => s.status === "draft");
    if (!draft) return fail("not_found");

    const gender = new Map(
      this.rows<{ id: string; gender: Gender }>("SELECT id, gender FROM players").map((r) => [r.id, r.gender]),
    );
    const held = draft.final ? this.pairedSeatIds(draft) : new Set<string>();

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
    for (const [a, b] of this.pairs().mutual) {
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
    const at = nextDue(meta);
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

  private receivedCount(toId: string): number {
    return this.rows<{ n: number }>("SELECT COUNT(*) AS n FROM pokes WHERE to_id = ?", toId)[0]?.n ?? 0;
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
    for (const r of mine) {
      sentTo[r.to_id] = (sentTo[r.to_id] ?? 0) + r.n;
      used[r.round] += r.n;
    }

    const matches: MatchInfo[] = [];
    if (meta.phase === "done") {
      const { mutual } = this.pairs();
      const mySeat = this.mySeat(playerId);
      const last = this.lastPublished();
      for (const [a, b] of mutual) {
        const otherId = a === playerId ? b : b === playerId ? a : null;
        if (!otherId) continue;
        const other = this.player(otherId);
        if (!other) continue;
        const theirTable = last?.seats.find((s) => s.playerId === otherId)?.table;
        matches.push({
          player: toPublic(other, meta.phase),
          sameTable: mySeat && theirTable === mySeat.table ? mySeat.table : undefined,
          // 연락처가 참가자에게 나가는 유일한 자리다 (ADR-19).
          // 이 블록은 `meta.phase === "done"` 안이고, `mutual` 에 든 쌍만 지난다
          contact: {
            realName: other.realName,
            phone: other.phone,
            ...(other.instagram ? { instagram: other.instagram } : {}),
          },
        });
      }
    }

    return {
      budget: {
        pre: { max: meta.config.maxPre, used: used.pre },
        party: { max: meta.config.maxParty, used: used.party },
      },
      sentTo,
      receivedCount: this.receivedCount(playerId),
      matches,
    };
  }

  /**
   * 서로 찌른 쌍과 한쪽만 찌른 쌍.
   *
   * 상호 매칭은 **주고받은 콕이 많은 순**으로 준다 (ADR-25). 한 사람이 여러 명과 이어졌는데
   * 정원이 모자라면 앞의 쌍이 자리를 가져가고, 화면의 커플 목록도 같은 순서로 읽힌다.
   */
  private pairs() {
    const sent = new Map<string, number>();
    for (const k of this.pokes()) sent.set(`${k.fromId}>${k.toId}`, (sent.get(`${k.fromId}>${k.toId}`) ?? 0) + 1);

    const mutual: Array<[string, string]> = [];
    const oneWay: Array<[string, string]> = [];
    const strength: Record<string, number> = {};
    for (const key of sent.keys()) {
      const [a, b] = key.split(">");
      if (sent.has(`${b}>${a}`)) {
        if (a < b) {
          mutual.push([a, b]);
          strength[`${a}|${b}`] = (sent.get(key) ?? 0) + (sent.get(`${b}>${a}`) ?? 0);
        }
      } else {
        oneWay.push([a, b]);
      }
    }
    mutual.sort((x, y) => strength[`${y[0]}|${y[1]}`] - strength[`${x[0]}|${x[1]}`]);
    return { mutual, oneWay, strength };
  }

  private seatings(): SeatingRound[] {
    return this.rows<SeatingRow>("SELECT * FROM seatings ORDER BY round").map((r) => ({
      round: r.round,
      tableCount: r.table_count,
      final: !!r.final,
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
      final: last.final,
      mates: mates.length,
      men,
      acked: last.acks.includes(playerId),
    };
  }

  private writeSeating(s: SeatingRound) {
    this.ctx.storage.sql.exec(
      `INSERT INTO seatings (round, table_count, final, status, seats, acks, created_at, published_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(round) DO UPDATE SET
         table_count=excluded.table_count, final=excluded.final, status=excluded.status,
         seats=excluded.seats, acks=excluded.acks, published_at=excluded.published_at`,
      s.round,
      s.tableCount,
      s.final ? 1 : 0,
      s.status,
      JSON.stringify(s.seats),
      JSON.stringify(s.acks),
      s.createdAt,
      s.publishedAt ?? null,
    );
  }

}

// ─────────────────────────── 순수 헬퍼

interface PlayerRow {
  id: string;
  nickname: string;
  real_name: string;
  age: number;
  gender: Gender;
  phone: string;
  instagram: string | null;
  mbti: string;
  charms: string;
  no_show: number;
  created_at: number;
}

interface SeatingRow {
  round: number;
  table_count: number;
  final: number;
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
    instagram: r.instagram ?? undefined,
    mbti: r.mbti,
    charms: JSON.parse(r.charms) as [string, string, string],
    noShow: !!r.no_show,
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
 * 다음에 울릴 예약 시각. fired 가 찬 항목은 이미 울린 것이므로 건너뛴다.
 * 사전 투표 마감부터는 예약이 없어서 알람도 걸지 않는다.
 */
function nextDue(meta: EventMeta): number | null {
  const { phase, fired, schedule } = meta;
  if (phase === "prep" && schedule.regOpenAt && !fired.reg) return schedule.regOpenAt;
  if (phase === "reg" && schedule.prevoteAt && !fired.prevote) return schedule.prevoteAt;
  return null;
}

/**
 * 순서 검증. 등록보다 먼저 사전 투표가 열리는 것만 막는다.
 * 파티 일시는 언제든 옮길 수 있다 — 장소가 바뀌면 시각이 바뀌고, 그건 일정이 아니라 사실이다.
 */
export function validSchedule(s: EventSchedule): boolean {
  return !(s.regOpenAt && s.prevoteAt && s.prevoteAt <= s.regOpenAt);
}
