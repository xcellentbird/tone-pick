/**
 * 스테이지 하나 = Durable Object 하나 (슬라이스 35 S-C5). 두 사람이 나란히 QA 를 해도 서로의 회차를 안 건드린다.
 *
 * 스테이지의 일은 전부 `core.mjs` 가 한다 — CLI 와 같은 파일이다. 여기는 **워커라서 필요한 것**뿐이다:
 * 상태를 DO 저장소에 두고 되살리기, 오래 안 쓴 스테이지를 닫는 알람, 스테이지 목록(로비), 하루 상한(`budget.ts`),
 * 그리고 스테이지 화면(`view.ts`)이 그릴 것과 틀에 심을 참가자 세션.
 *
 * QA 로 가는 길은 **서비스 바인딩 `APP` 하나**다 (S-A2). `core` 에 `env.APP.fetch` 를 넘기므로
 * 요청 주소의 호스트는 뜻이 없다(`https://app`). 사람에게 보여 줄 주소는 `QA_PUBLIC_URL` 이다.
 */
import { DurableObject } from "cloudflare:workers";
import { BULK_MAX, LOG_VIEW, StageError, beginStage, createLog, restoreStage } from "../core.mjs";
import { DAILY, OVERHEAD, grant, quotaDay, refusal } from "./budget.ts";
import { PLAYER_COOKIE } from "./plant.ts";

export interface Env {
  APP: Fetcher;
  STAGE: DurableObjectNamespace<StageDO>;
  LOBBY: DurableObjectNamespace<LobbyDO>;
  /** 참가 링크·운영자 콘솔·틀에 쓸 QA 의 공개 주소. 스테이지의 요청은 이 주소로 가지 않는다 — 바인딩으로 간다 */
  QA_PUBLIC_URL: string;
  /** QA 의 공통 운영자 PIN. 앱 설정 파일에 적힌 공개 값이다 (`check-config` 가 둘을 맞춰 본다) */
  QA_PIN: string;
  /** 이 나라들에서만 열린다. QA 의 `ALLOWED_COUNTRIES` 와 같은 값이다 (`check-config` 가 둘을 맞춰 본다) */
  ALLOWED_COUNTRIES?: string;
}

/** 스테이지 목록은 하나뿐이다. 하루 상한도 여기서 센다 — 한 곳이라야 두 요청이 나란히 와도 어긋나지 않는다 */
export const lobbyOf = (env: Env) => env.LOBBY.get(env.LOBBY.idFromName("lobby"));

/** 한 성별의 나이 — 평균과 범위. 앱이 받는 범위 안으로 맞추는 것은 core 의 `ageRange` 다 */
export interface Ages {
  avg: number;
  min: number;
  max: number;
}

/** 스테이지를 만들 때 고르는 것 (슬라이스 37) — 남녀를 따로, **늘 등록이 끝난 뒤에서** 시작한다 */
export interface Want {
  men: number;
  women: number;
  ages: { M: Ages; F: Ages };
  phase: (typeof START_PHASES)[number];
}
export const PER_GENDER = { min: 2, max: 50 } as const;
/** 등록 중(`reg`)은 없다 — 등록 전 화면은 QA 에서 손으로 본다. 스테이지는 여러 사람의 화면을 한꺼번에 보는 자리다 */
export const START_PHASES = ["prevote", "party", "done"] as const;

/**
 * 요청 하나가 QA 를 부를 수 있는 몫. **요청당 서브요청 상한(무료 50) 아래**다 — 바인딩 호출이 그 50 에
 * 드는지는 엣지에서 재지 못했으므로 드는 쪽으로 잡는다. 묶음 명령(`BULK_MAX` 40)과 등록 한 묶음(20명 × 2)이 든다.
 */
export const ACTION_MAX = 45;
/** 등록 한 묶음. 한 명에 두 번(입장 · 등록)이라 20명이면 40번 */
export const ENROLL_BATCH = 20;

/**
 * 손을 놓은 스테이지는 이만큼 뒤에 저절로 닫힌다 — 회차를 지운다.
 * 닫기를 누르지 않고 폰을 덮는 일이 흔하고, 그러면 QA 에 가짜 회차가 쌓인다 (S-C3).
 */
export const IDLE_MS = 12 * 3600_000;

/** QA 호출 하나를 기다리는 끝 */
const QA_TIMEOUT_MS = 20_000;

type Stage = Awaited<ReturnType<typeof beginStage>>;

/** 스테이지 화면이 그리는 것. **참가자 세션(쿠키)은 싣지 않는다** — 그건 `/view` 가 `Set-Cookie` 로만 준다 */
export interface StageView {
  event: { id: string; code: string };
  phase: string;
  tables: number;
  cast: { n: number; nickname: string; gender: "M" | "F"; age: number; ref: string; phone: string; pin: string }[];
  lines: string[];
  /** 아직 안 보낸 자동 콕. 0 보다 크면 페이지가 `drain` 을 이어 부른다 */
  backlog: number;
}

/** 만드는 걸음의 답. 실패하면 이미 지웠다 */
export type Step = { ok: true; pending: number } | { ok: false; message: string };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class StageDO extends DurableObject<Env> {
  private stage: Stage | null = null;
  private log = createLog();
  private loaded = false;
  /** 이번 걸음에 남은 QA 호출 (`within`) */
  private allowance = 0;
  private queue: Promise<unknown> = Promise.resolve();

  private coreEnv() {
    return {
      /*
       * QA 를 부를 때마다 몫에서 뺀다. **지우는 요청은 세지 않는다** — 상한을 다 쓴 날에도 회차는 지워야 한다.
       * 몫이 떨어지면 **여기서 바로 던진다** (`Promise` 로 돌려주면 `health` 확인의 `.catch` 가 삼켜서
       * "…에 연결하지 못했어요" 로 둔갑한다).
       */
      fetch: (url: string, init?: RequestInit) => {
        if (init?.method !== "DELETE") {
          if (this.allowance <= 0) throw new StageError("budget", refusal());
          this.allowance--;
        }
        // 답이 없는 호출을 끝없이 기다리지 않는다 — 걸음이 한 줄로 서므로(`serial`) 하나가 멈추면 스테이지 전체가 멈춘다
        return this.env.APP.fetch(url, { ...init, signal: AbortSignal.timeout(QA_TIMEOUT_MS) });
      },
      base: "https://app",
      publicBase: this.env.QA_PUBLIC_URL,
      log: this.log,
      // 창 벽·시간 이동·끝내기는 이 스테이지에 없다 — core 가 `이 스테이지에서는 쓸 수 없어요` 로 답한다 (S-C4)
      platform: {},
      timeTravel: false,
      // 자동 콕은 한 요청에 이만큼씩 — 나머지는 페이지가 `drain` 으로 이어 부른다
      batch: BULK_MAX,
      onChange: async (s: Stage) => this.persist(s),
    };
  }

  /** 걸음은 한 줄로 선다 — 몫(`allowance`)을 두 요청이 나눠 쓰지 않게 */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /** 하루 상한 안에서 한 걸음 (슬라이스 37). 몫을 먼저 받고, 다 쓰지 못한 것은 받은 날로 돌려준다 */
  private within<T>(want: number, fn: () => Promise<T>): Promise<T> {
    return this.serial(async () => {
      const lobby = lobbyOf(this.env);
      const day = quotaDay(Date.now());
      const got = await lobby.reserve(Date.now(), want + OVERHEAD);
      if (!got) throw new StageError("budget", refusal());
      this.allowance = got - OVERHEAD;
      try {
        return await fn();
      } finally {
        const back = this.allowance;
        this.allowance = 0;
        if (back > 0) await lobby.refund(day, back);
      }
    });
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const [saved, lines] = await Promise.all([
      this.ctx.storage.get<Record<string, unknown>>("stage"),
      this.ctx.storage.get<string[]>("log"),
    ]);
    this.log = createLog(() => {}, lines ?? []);
    if (saved) this.stage = restoreStage(this.coreEnv(), saved);
  }

  private async persist(s: Stage | null = this.stage): Promise<void> {
    await this.ctx.storage.put({ ...(s ? { stage: s.toJSON() } : {}), log: this.log.lines });
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  /** 만들다 막혔다 — 회차를 지우고 이 DO 도 비운다. 아무도 못 닫는 회차를 남기지 않는다 */
  private async abandon(e: unknown): Promise<Step> {
    if (this.stage) await this.stage.close().catch(() => {});
    await this.ctx.storage.deleteAll();
    this.stage = null;
    this.loaded = false;
    return { ok: false, message: messageOf(e) };
  }

  /** 1걸음 — 회차와 명단 (S-C1). 등록은 `enroll` 이 묶음으로 한다 */
  async start(want: Want): Promise<Step> {
    await this.load();
    if (this.stage) return { ok: true, pending: this.stage.pending.length };
    try {
      this.stage = await this.within(8, () =>
        beginStage(this.coreEnv(), {
          men: want.men,
          women: want.women,
          ages: want.ages,
          config: {},
          pin: this.env.QA_PIN,
          // 연습용 환경에만 선다. 바인딩이 QA 를 가리키는 것은 `check-config` 가, 여기서는 라벨이 한 번 더 본다
          practiceOnly: true,
        }),
      );
      await this.persist();
      return { ok: true, pending: this.stage.pending.length };
    } catch (e) {
      return this.abandon(e);
    }
  }

  /** 2걸음 — 한 묶음(`ENROLL_BATCH`)을 실제 경로로 등록한다. 남은 수를 돌려준다 */
  async enroll(): Promise<Step> {
    await this.load();
    const stage = this.stage;
    if (!stage) return { ok: false, message: "스테이지가 없어요." };
    try {
      const pending = await this.within(ENROLL_BATCH * 2, () => stage.enrollSome(ENROLL_BATCH));
      return { ok: true, pending };
    } catch (e) {
      return this.abandon(e);
    }
  }

  /** 3걸음 — 원하는 단계까지. 파티면 투표를 닫고 자리를 발행해 둔다 */
  async finish(phase: Want["phase"]): Promise<Step> {
    await this.load();
    const stage = this.stage;
    if (!stage) return { ok: false, message: "스테이지가 없어요." };
    try {
      await this.within(12, () => stage.gotoPhase(phase));
      await this.persist();
      return { ok: true, pending: 0 };
    } catch (e) {
      return this.abandon(e);
    }
  }

  async view(): Promise<StageView | null> {
    await this.load();
    const s = this.stage;
    if (!s) return null;
    return {
      event: { id: s.event.id, code: s.event.code },
      phase: s.phase,
      tables: s.tables,
      cast: s.cast.map((p: StageView["cast"][number] & { session: { ref: string } }) => ({
        n: p.n,
        nickname: p.nickname,
        gender: p.gender,
        age: p.age,
        ref: p.session.ref,
        phone: p.phone,
        pin: p.pin,
      })),
      lines: this.log.lines.slice(-LOG_VIEW),
      backlog: s.backlog.length,
    };
  }

  /**
   * 틀에 심을 참가자 세션 (슬라이스 37). **스테이지 화면이 지금 띄우는 사람만** — 나머지는 거둘 이름표만 준다.
   * 토큰은 여기서 나가 라우터의 `Set-Cookie` 로만 브라우저에 간다. 페이지의 본문에는 싣지 않는다.
   */
  async sessions(show: number[], hide: number[]): Promise<{ plant: { ref: string; token: string }[]; clear: string[] }> {
    await this.load();
    const cast = (this.stage?.cast ?? []) as { n: number; session: { ref?: string; cookies: Map<string, string> } }[];
    const plant = cast
      .filter((p) => show.includes(p.n) && p.session.ref)
      .flatMap((p) => {
        const token = p.session.cookies.get(`${PLAYER_COOKIE}_${p.session.ref}`);
        return token ? [{ ref: p.session.ref!, token }] : [];
      });
    const clear = cast.filter((p) => hide.includes(p.n) && p.session.ref).map((p) => p.session.ref!);
    return { plant, clear };
  }

  /** 명령 한 줄. 답으로 스테이지 화면을 돌려준다 — 페이지는 스스로 다시 읽지 않는다 (S-D3) */
  async command(line: string): Promise<StageView | null> {
    await this.load();
    const stage = this.stage;
    if (!stage) return null;
    try {
      await this.within(ACTION_MAX, async () => {
        this.log.say(`> ${line}`);
        await stage.run(line).catch((e: unknown) => this.log.say(`  ✗ ${messageOf(e)}`));
      });
      await this.persist();
    } catch (e) {
      /*
       * 몫을 못 받았다. 막혔다는 것은 로그에 말하되 **저장하지 않는다** — 페이지는 이 답에 실린 로그를 본다.
       * 막힌 요청마다 저장하면 상한을 넘긴 뒤에도 두드릴 때마다 줄을 쓴다 (ADR-97 후기 4).
       */
      this.log.say(`> ${line}`);
      this.log.say(`  ✗ ${messageOf(e)}`);
    }
    return this.view();
  }

  /**
   * 자동 콕의 남은 줄을 한 묶음(`BULK_MAX`) 보낸다. 페이지가 줄이 빌 때까지 이어 부른다 — **명령의 이어짐이지
   * 다시 읽기가 아니다** (S-D3): 줄이 비면 몫도 받지 않고 바로 답한다. 몫을 못 받으면 줄을 비운다 —
   * 남겨 두면 페이지가 멈춘 줄을 안고 있고, 다음 `auto` 가 어차피 계획을 새로 짠다.
   */
  async drain(): Promise<StageView | null> {
    await this.load();
    const stage = this.stage;
    if (!stage) return null;
    if (!stage.backlog.length) return this.view();
    try {
      await this.within(ACTION_MAX, () => stage.drain(BULK_MAX));
    } catch (e) {
      stage.backlog = [];
      stage.autoRun = null;
      this.log.say(`  ✗ ${messageOf(e)}`);
    }
    await this.persist();
    return this.view();
  }

  /** 닫는다 (S-C3). 회차를 지우고 이 DO 도 비운다 — 가짜 참가자의 세션 쿠키까지 함께 사라진다 */
  async close(): Promise<void> {
    await this.serial(async () => {
      await this.load();
      if (this.stage) await this.stage.close();
      await this.ctx.storage.deleteAll();
      this.stage = null;
      this.loaded = false;
      await lobbyOf(this.env).remove(this.ctx.id.toString());
    });
  }

  /** 오래 손을 놓은 스테이지 (`IDLE_MS`) */
  async alarm(): Promise<void> {
    await this.close();
  }
}

export interface StageRow {
  id: string;
  code: string;
  people: number;
  at: number;
}

/**
 * 스테이지 목록. 하나뿐이다 (`lobbyOf`). 스테이지의 내용은 없고 **어디 있는지만** 든다.
 * 하루 상한(`budget.ts`)도 여기서 센다 — 스테이지 DO 가 걸음마다 몫을 받고 남은 것을 돌려준다.
 */
export class LobbyDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // `who` 는 Access 가 알려 주던 이메일이다. 이제 비워 넣는다 — 이미 선 표는 `IF NOT EXISTS` 가 안 고치므로 칸은 그대로 둔다
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, code TEXT NOT NULL, who TEXT NOT NULL, people INTEGER NOT NULL, at INTEGER NOT NULL)",
    );
    // `kind` 는 세던 단위의 이름이다. 지금은 `calls` 하나 — 옛 단위(`stage`·`command`)의 줄은 날이 바뀌면 지워진다
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, kind))",
    );
  }

  add(row: StageRow): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO stages (id, code, who, people, at) VALUES (?,?,?,?,?)",
      row.id, row.code, "", row.people, row.at,
    );
  }

  /** 몫을 준다 (`grant`). 못 주면 0 이고 **세지 않는다** — 넘긴 시도가 남의 몫을 깎지 않게 */
  reserve(now: number, want: number): number {
    const day = quotaDay(now);
    this.ctx.storage.sql.exec("DELETE FROM usage WHERE day <> ?", day);
    const n = grant(this.used(day), want);
    if (n) {
      this.ctx.storage.sql.exec(
        "INSERT INTO usage (day, kind, n) VALUES (?, 'calls', ?) ON CONFLICT (day, kind) DO UPDATE SET n = n + excluded.n",
        day, n,
      );
    }
    return n;
  }

  /** 쓰고 남은 몫을 돌려받는다. **받은 날의 줄에만** — 날이 바뀌었으면 그 줄은 이미 없다 */
  refund(day: string, n: number): void {
    this.ctx.storage.sql.exec("UPDATE usage SET n = MAX(0, n - ?) WHERE day = ? AND kind = 'calls'", n, day);
  }

  /** 오늘 남은 몫 */
  left(now: number): number {
    return Math.max(0, DAILY - this.used(quotaDay(now)));
  }

  /** 로비 한 장 — 열린 스테이지와 남은 몫. 한 번에 묶었다 (DO 요청 하나) */
  view(now: number): { rows: StageRow[]; left: number } {
    return {
      rows: this.ctx.storage.sql
        .exec("SELECT id, code, people, at FROM stages ORDER BY at DESC")
        .toArray() as unknown as StageRow[],
      left: this.left(now),
    };
  }

  private used(day: string): number {
    const row = this.ctx.storage.sql.exec("SELECT n FROM usage WHERE day = ? AND kind = 'calls'", day).toArray()[0];
    return row ? Number(row.n) : 0;
  }

  remove(id: string): void {
    this.ctx.storage.sql.exec("DELETE FROM stages WHERE id = ?", id);
  }

  has(id: string): boolean {
    return this.ctx.storage.sql.exec("SELECT 1 FROM stages WHERE id = ?", id).toArray().length > 0;
  }
}
