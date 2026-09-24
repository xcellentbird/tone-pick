/**
 * 무대 하나 = Durable Object 하나 (슬라이스 35 S-C5). 두 사람이 나란히 QA 를 해도 서로의 회차를 안 건드린다.
 *
 * 무대의 일은 전부 `core.mjs` 가 한다 — CLI 와 같은 파일이다. 여기는 **워커라서 필요한 것**뿐이다:
 * 상태를 DO 저장소에 두고 되살리기, 오래 안 쓴 무대를 닫는 알람, 무대 목록(로비).
 *
 * QA 로 가는 길은 **서비스 바인딩 `APP` 하나**다 (S-A2). `core` 에 `env.APP.fetch` 를 넘기므로
 * 요청 주소의 호스트는 뜻이 없다(`https://app`). 사람에게 보여 줄 주소는 `QA_PUBLIC_URL` 이다.
 */
import { DurableObject } from "cloudflare:workers";
import { LOG_VIEW, StageError, buildStage, createLog, restoreStage } from "../core.mjs";
import { DAILY, type Spend, quotaDay, refusal } from "./budget.ts";

export interface Env {
  APP: Fetcher;
  STAGE: DurableObjectNamespace<StageDO>;
  LOBBY: DurableObjectNamespace<LobbyDO>;
  /** 참가 링크·운영자 콘솔에 쓸 QA 의 공개 주소. 요청은 이 주소로 가지 않는다 — 바인딩으로 간다 */
  QA_PUBLIC_URL: string;
  /** QA 의 공통 운영자 PIN. 앱 설정 파일에 적힌 공개 값이다 (`check-config` 가 둘을 맞춰 본다) */
  QA_PIN: string;
  /** 이 나라들에서만 열린다. QA 의 `ALLOWED_COUNTRIES` 와 같은 값이다 (`check-config` 가 둘을 맞춰 본다) */
  ALLOWED_COUNTRIES?: string;
}

/** 무대 목록은 하나뿐이다. 하루 상한도 여기서 센다 — 한 곳이라야 두 요청이 나란히 와도 어긋나지 않는다 */
export const lobbyOf = (env: Env) => env.LOBBY.get(env.LOBBY.idFromName("lobby"));

/** 무대를 세울 때 고르는 것. 인원 상한은 **요청 하나의 서브요청 수**가 정한다 — 한 명에 두 번(입장·등록)이다 */
export interface Want {
  people: number;
  phase: string;
  tables: number;
}
export const PEOPLE_MAX = 12;
export const TABLES_MAX = 6;

/**
 * 손을 놓은 무대는 이만큼 뒤에 저절로 닫힌다 — 회차를 지운다.
 * 닫기를 누르지 않고 폰을 덮는 일이 흔하고, 그러면 QA 에 가짜 회차가 쌓인다 (S-C3).
 */
export const IDLE_MS = 12 * 3600_000;

type Stage = Awaited<ReturnType<typeof buildStage>>;

export class StageDO extends DurableObject<Env> {
  private stage: Stage | null = null;
  private log = createLog();
  private loaded = false;

  private coreEnv() {
    return {
      fetch: (url: string, init?: RequestInit) => this.env.APP.fetch(url, init),
      base: "https://app",
      publicBase: this.env.QA_PUBLIC_URL,
      log: this.log,
      // 창 벽·시간 이동·끝내기는 이 무대에 없다 — core 가 `이 무대에는 없어요` 로 답한다 (S-C4)
      platform: {},
      timeTravel: false,
      onChange: async (s: Stage) => this.persist(s),
    };
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

  /** 새로 세운다. 실패하면 이유를 돌려주고 아무것도 남기지 않는다 */
  async build(want: Want): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
    await this.load();
    if (this.stage) return { ok: true, code: this.stage.event.code };
    try {
      this.stage = await buildStage(this.coreEnv(), {
        ...want,
        config: {},
        pin: this.env.QA_PIN,
        // 연습용 환경에만 선다. 바인딩이 QA 를 가리키는 것은 `check-config` 가, 여기서는 라벨이 한 번 더 본다
        practiceOnly: true,
      });
      await this.persist();
      return { ok: true, code: this.stage.event.code };
    } catch (e) {
      await this.ctx.storage.deleteAll();
      return { ok: false, message: e instanceof StageError ? e.message : String(e) };
    }
  }

  async page(): Promise<string | null> {
    await this.load();
    if (!this.stage) return null;
    const footer = `<form method="post" action="close" onsubmit="return confirm('회차 ${this.stage.event.code} 를 지우고 무대를 닫을까요? 되돌릴 수 없어요.')">
<button style="background:#b33;margin-top:12px">무대 닫기 · 회차 삭제</button></form>
<p><a href="../../">← 무대 목록</a></p>`;
    // 스스로 다시 읽지 않는다 (S-D3) — 켜 둔 탭이 1.5초마다 DO 둘을 깨우면 하루에 몇만 번이다
    return this.stage.remotePage({ links: true, hostPin: this.env.QA_PIN, footer, poll: false });
  }

  async logText(): Promise<string> {
    await this.load();
    return this.log.lines.slice(-LOG_VIEW).join("\n");
  }

  async command(line: string): Promise<void> {
    await this.load();
    if (!this.stage) return;
    this.log.say(`> ${line}`);
    /*
     * 하루 상한 (`budget.ts`). 막혔다는 것은 로그에 말하되 **저장하지 않는다** — 리모컨이 바로 뒤에 읽는 것은
     * 메모리의 로그라 그걸로 보인다. 막힌 요청마다 저장하면 상한을 넘긴 뒤에도 두드릴 때마다 줄을 쓴다.
     */
    const no = await lobbyOf(this.env).take("command", Date.now());
    if (no) return this.log.say(`  ✗ ${no}`);
    await this.stage.run(line).catch((e: unknown) => this.log.say(`  ✗ ${e instanceof Error ? e.message : String(e)}`));
    await this.persist();
  }

  /** 닫는다 (S-C3). 회차를 지우고 이 DO 도 비운다 — 가짜 참가자의 세션 쿠키까지 함께 사라진다 */
  async close(): Promise<void> {
    await this.load();
    if (this.stage) await this.stage.close();
    await this.ctx.storage.deleteAll();
    this.stage = null;
    this.loaded = false;
    await lobbyOf(this.env).remove(this.ctx.id.toString());
  }

  /** 오래 손을 놓은 무대 (`IDLE_MS`) */
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
 * 무대 목록. 하나뿐이다 (`lobbyOf`). 무대의 내용은 없고 **어디 있는지만** 든다.
 * 하루 상한(`budget.ts`)도 여기서 센다 — 무대 세우기는 라우터가, 명령은 무대 DO 가 묻는다.
 */
export class LobbyDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // `who` 는 Access 가 알려 주던 이메일이다. 이제 비워 넣는다 — 이미 선 표는 `IF NOT EXISTS` 가 안 고치므로 칸은 그대로 둔다
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, code TEXT NOT NULL, who TEXT NOT NULL, people INTEGER NOT NULL, at INTEGER NOT NULL)",
    );
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

  /** 하루 상한. 되면 한 번을 세고 `null`, 넘었으면 사람에게 할 말. **넘긴 시도는 세지 않는다** */
  take(kind: Spend, now: number): string | null {
    const day = quotaDay(now);
    this.ctx.storage.sql.exec("DELETE FROM usage WHERE day <> ?", day);
    const no = refusal(kind, this.used(day, kind));
    if (no) return no;
    this.ctx.storage.sql.exec(
      "INSERT INTO usage (day, kind, n) VALUES (?, ?, 1) ON CONFLICT (day, kind) DO UPDATE SET n = n + 1",
      day, kind,
    );
    return null;
  }

  /** 로비 한 장 — 열린 무대와 남은 횟수. 한 번에 묶었다 (DO 요청 하나) */
  view(now: number): { rows: StageRow[]; left: Record<Spend, number> } {
    const day = quotaDay(now);
    const left = (k: Spend) => Math.max(0, DAILY[k] - this.used(day, k));
    return {
      rows: this.ctx.storage.sql
        .exec("SELECT id, code, people, at FROM stages ORDER BY at DESC")
        .toArray() as unknown as StageRow[],
      left: { stage: left("stage"), command: left("command") },
    };
  }

  private used(day: string, kind: Spend): number {
    const row = this.ctx.storage.sql.exec("SELECT n FROM usage WHERE day = ? AND kind = ?", day, kind).toArray()[0];
    return row ? Number(row.n) : 0;
  }

  remove(id: string): void {
    this.ctx.storage.sql.exec("DELETE FROM stages WHERE id = ?", id);
  }

  has(id: string): boolean {
    return this.ctx.storage.sql.exec("SELECT 1 FROM stages WHERE id = ?", id).toArray().length > 0;
  }
}
