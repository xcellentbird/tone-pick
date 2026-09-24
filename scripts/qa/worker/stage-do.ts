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

export interface Env {
  APP: Fetcher;
  STAGE: DurableObjectNamespace<StageDO>;
  LOBBY: DurableObjectNamespace<LobbyDO>;
  /** 참가 링크·운영자 콘솔에 쓸 QA 의 공개 주소. 요청은 이 주소로 가지 않는다 — 바인딩으로 간다 */
  QA_PUBLIC_URL: string;
  /** QA 의 공통 운영자 PIN. 앱 설정 파일에 적힌 공개 값이다 (`check-config` 가 둘을 맞춰 본다) */
  QA_PIN: string;
  ACCESS_AUD?: string;
  ACCESS_TEAM?: string;
}

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
    return this.stage.remotePage({ links: true, hostPin: this.env.QA_PIN, footer });
  }

  async logText(): Promise<string> {
    await this.load();
    return this.log.lines.slice(-LOG_VIEW).join("\n");
  }

  async command(line: string): Promise<void> {
    await this.load();
    if (!this.stage) return;
    this.log.say(`> ${line}`);
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
    await this.env.LOBBY.get(this.env.LOBBY.idFromName("lobby")).remove(this.ctx.id.toString());
  }

  /** 오래 손을 놓은 무대 (`IDLE_MS`) */
  async alarm(): Promise<void> {
    await this.close();
  }
}

export interface StageRow {
  id: string;
  code: string;
  who: string;
  people: number;
  at: number;
}

/** 무대 목록. 하나뿐이다 (`idFromName("lobby")`). 무대의 내용은 없고 **어디 있는지만** 든다 */
export class LobbyDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, code TEXT NOT NULL, who TEXT NOT NULL, people INTEGER NOT NULL, at INTEGER NOT NULL)",
    );
  }

  add(row: StageRow): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO stages (id, code, who, people, at) VALUES (?,?,?,?,?)",
      row.id, row.code, row.who, row.people, row.at,
    );
  }

  remove(id: string): void {
    this.ctx.storage.sql.exec("DELETE FROM stages WHERE id = ?", id);
  }

  has(id: string): boolean {
    return this.ctx.storage.sql.exec("SELECT 1 FROM stages WHERE id = ?", id).toArray().length > 0;
  }

  list(): StageRow[] {
    return this.ctx.storage.sql.exec("SELECT * FROM stages ORDER BY at DESC").toArray() as unknown as StageRow[];
  }
}
