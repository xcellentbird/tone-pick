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
  PokeRound,
  PublicEvent,
  PublicPlayer,
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
import { DEMO_UI, ENTRY } from "../shared/copy.ts";
import { ENTRY_TRIES, LIMITS, normalizeNickname, normalizePhone } from "../shared/constants.ts";
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

interface Flags {
  /** 마지막 자리까지 끝났는가. 지각자가 오면 다시 열 수 있어야 한다 */
  seatingClosed: boolean;
}

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
    const base = { id: meta.id, name: meta.name, phase: meta.phase, partyAt: meta.schedule.partyAt };
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
      // 기본이 '모두에게'라, **좁혔을 때만** 적는다. 켠 상태를 굳이 써 넣으면 설정 모양이 회차마다 달라진다
      meta.config = { maxPre, maxParty, ...(allowSameGender === false ? { allowSameGender: false } : {}) };
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
  async purgeIfExpired(now: number, retentionDays: number): Promise<boolean> {
    const meta = await this.ctx.storage.get<EventMeta>("meta");
    if (!meta) return false;
    if (now < purgeDueAt(meta, retentionDays)) return false;
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
    const nickNorm = normalizeNickname(input.nickname);
    if (!nickNorm || !input.realName.trim() || !phone) return fail("bad_request");
    if (input.nickname.trim().length > LIMITS.nicknameMax) return fail("bad_request");
    if (!Number.isInteger(input.age) || input.age < 18 || input.age > 99) return fail("bad_request");
    if (input.gender !== "M" && input.gender !== "F") return fail("bad_request");
    if (!/^[EI][NS][TF][JP]$/.test(input.mbti)) return fail("bad_request");
    if (input.charms.length !== LIMITS.charms || input.charms.some((c) => !c.trim())) {
      return fail("bad_request");
    }
    if (input.instagram && !/^[A-Za-z0-9._]+$/.test(input.instagram)) return fail("bad_request");

    const mine = this.rows<PlayerRow>("SELECT * FROM players WHERE phone = ?", phone)[0];
    const clash = this.rows<PlayerRow>("SELECT * FROM players WHERE nick_norm = ?", nickNorm)[0];
    if (clash && clash.id !== mine?.id) return fail("nick_taken");

    const player: Player = {
      id: mine?.id ?? randomHex(8),
      nickname: input.nickname.trim(),
      realName: input.realName.trim(),
      age: input.age,
      gender: input.gender,
      phone,
      instagram: input.instagram?.trim() || undefined,
      mbti: input.mbti,
      charms: input.charms.map((c) => c.trim()) as [string, string, string],
      createdAt: mine?.created_at ?? now,
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
      nickNorm,
      player.realName,
      player.age,
      player.gender,
      player.phone,
      player.instagram ?? null,
      player.mbti,
      JSON.stringify(player.charms),
      player.createdAt,
    );

    this.broadcast({ type: "roster", count: this.playerCount() });
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
    this.ctx.storage.sql.exec("DELETE FROM pokes WHERE from_id = ? OR to_id = ?", playerId, playerId);
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

  /**
   * 시연용 가짜 참가자. **연습용 환경에서만** 부를 수 있다 (Worker 가 막는다).
   *
   * 명단·등록을 한 번에 끝낸다. 시연은 "이 단계에서 화면이 어떻게 보이나" 를 보는 일이라,
   * 사람을 넣는 데 시간을 쓰면 정작 볼 것을 못 본다.
   */
  async seedPlayers(count: number, now: number): Promise<Result<number>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (!Number.isInteger(count) || count < 1 || count > LIMITS.demoSeedMax) return fail("bad_request");

    const start = this.playerCount();
    for (let i = 0; i < count; i++) {
      const n = start + i;
      const gender: Gender = n % 2 === 0 ? "M" : "F";
      const phone = `010${String(now).slice(-4)}${String(n).padStart(4, "0")}`;
      const pick = <T,>(list: readonly T[]) => list[(n * 7 + list.length) % list.length];
      const made = await this.register(
        {
          nickname: `${pick(DEMO_UI.seed.nicknames)}${n}`,
          realName: `${pick(DEMO_UI.seed.surnames)}${pick(DEMO_UI.seed.givenNames)}`,
          age: 24 + (n * 3) % 18,
          gender,
          mbti: pick(DEMO_UI.seed.mbti),
          charms: [pick(DEMO_UI.seed.charms), pick(DEMO_UI.seed.charms.slice(1)), pick(DEMO_UI.seed.charms.slice(2))],
        },
        phone,
        now,
      );
      // 닉네임이 겹치면 그 한 명만 건너뛴다. 시연이 멈출 이유는 아니다
      if (made.ok) this.ctx.storage.sql.exec("INSERT OR IGNORE INTO invites (phone, added_at) VALUES (?,?)", phone, now);
    }
    return ok(this.playerCount() - start);
  }

  /**
   * 시연용 무작위 콕. **연습용 환경에서만.**
   *
   * 매칭이 생긴 상태를 손으로 만들려면 여러 번 찔러야 한다 —
   * 발표 화면과 커플 자리는 그 상태여야 볼 수 있는데, 거기까지 가는 데 시연 시간을 다 쓴다.
   */
  async seedPokes(now: number): Promise<Result<number>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (!canPoke(meta.phase)) return fail("closed");

    const players = this.players();
    const round = roundOf(meta.phase);
    const max = round === "pre" ? meta.config.maxPre : meta.config.maxParty;
    let made = 0;

    for (const me of players) {
      const targets = players.filter(
        (p) => p.id !== me.id && (meta.config.allowSameGender !== false || p.gender !== me.gender),
      );
      if (targets.length === 0) continue;
      const budget = max - this.sentCount(me.id, round);
      // 예산을 다 쓰지는 않는다. 매칭이 골고루 갈리게 절반쯤만
      for (let i = 0; i < Math.ceil(budget / 2); i++) {
        const to = targets[Math.floor(Math.random() * targets.length)];
        this.ctx.storage.sql.exec(
          "INSERT INTO pokes (id, from_id, to_id, round, at) VALUES (?,?,?,?,?)",
          randomHex(8),
          me.id,
          to.id,
          round,
          now,
        );
        made++;
      }
    }
    this.broadcast({ type: "roster", count: this.playerCount() });
    return ok(made);
  }

  /** 시연을 처음부터. 참가자·콕·자리·명단·운세를 비운다. 회차 설정과 단계는 그대로 */
  async resetDemo(): Promise<Result<true>> {
    for (const table of ["players", "pokes", "seatings", "invites", "fortunes", "entry_tries"]) {
      this.ctx.storage.sql.exec(`DELETE FROM ${table}`);
    }
    await this.setFlags({ seatingClosed: false });
    this.broadcast({ type: "roster", count: 0 });
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

  /**
   * 매력 세 줄을 고친다. **사전 투표가 열리기 전까지만** (ADR-27).
   *
   * 사전 투표가 시작되면 사람들이 그 세 줄을 보고 콕을 찌른다.
   * 그 뒤에 바꾸면 누군가 나를 고른 근거가 조용히 사라진다 —
   * 등록할 때 급히 쓴 걸 다듬을 시간은 주되, 남이 읽은 뒤로는 그대로 둔다.
   */
  async editCharms(playerId: string, charms: string[], now: number): Promise<Result<Player>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    if (meta.phase !== "reg") return fail("closed");

    const me = this.player(playerId);
    if (!me) return fail("not_found");
    const clean = charms.map((c) => String(c ?? "").trim());
    if (clean.length !== LIMITS.charms || clean.some((c) => !c)) return fail("bad_request");

    this.ctx.storage.sql.exec("UPDATE players SET charms = ? WHERE id = ?", JSON.stringify(clean), playerId);
    return ok({ ...me, charms: clean as [string, string, string] });
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

  async hostState(now: number): Promise<Result<HostState & { seatingClosed: boolean }>> {
    const meta = await this.touch(now);
    if (!meta) return fail("not_found");
    const players = this.players();
    const pokes = this.pokes();

    const sent: Record<string, number> = {};
    const preReceived: Record<string, number> = {};
    // 상한을 내릴 수 있는지 판단하려면 **한 사람이 라운드마다 몇 번 썼는지**가 필요하다
    const usedBy: Record<PokeRound, Record<string, number>> = { pre: {}, party: {} };
    for (const p of players) {
      sent[p.id] = 0;
      preReceived[p.id] = 0;
    }
    const pokeCount: Record<PokeRound, number> = { pre: 0, party: 0 };
    const pairs = new Set<string>();
    for (const k of pokes) {
      sent[k.fromId] = (sent[k.fromId] ?? 0) + 1;
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
      prevoteRank: Object.entries(preReceived)
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count),
      mutual,
      pokeCount,
      pokeUsedMax,
      seatings: this.seatings(),
      invites: this.invites(),
      seatingClosed: (await this.flags()).seatingClosed,
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
  async saveFortune(playerId: string, fortune: Fortune): Promise<Result<Fortune>> {
    if (!this.player(playerId)) return fail("not_found");
    this.ctx.storage.sql.exec(
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
    if ((await this.flags()).seatingClosed) return fail("closed");
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
    if (draft.final) await this.setFlags({ seatingClosed: true });

    for (const seat of draft.seats) {
      this.toPlayer(seat.playerId, { type: "seating", round: draft.round, table: seat.table });
    }
    return ok(draft);
  }

  /** 마지막 자리까지 끝난 뒤 지각자가 오면 다시 열 수 있어야 한다 */
  async reopenSeating(): Promise<Result<true>> {
    await this.setFlags({ seatingClosed: false });
    return ok(true);
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

  private pokes() {
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

  private async flags(): Promise<Flags> {
    return (await this.ctx.storage.get<Flags>("flags")) ?? { seatingClosed: false };
  }

  private async setFlags(patch: Partial<Flags>) {
    await this.ctx.storage.put("flags", { ...(await this.flags()), ...patch });
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
