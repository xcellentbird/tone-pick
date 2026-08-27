/**
 * **옛 회차를 지금 코드로 열어본다.**
 *
 * `CREATE TABLE IF NOT EXISTS` 는 이미 있는 표를 건드리지 않는다. 그래서 칸을 더하는 일은
 * 생성자의 `ALTER` 목록이 따로 맡고, **새 칸을 가리키는 인덱스가 `SCHEMA` 로 올라가면**
 * 옛 표에서 `no such column` 으로 던진다 — 그 exec 는 try 밖이라 **DO 가 통째로 죽는다.**
 * 회차 목록이 모든 회차를 훑으므로 화면 하나가 아니라 운영자 콘솔 전체가 멈춘다.
 *
 * CLAUDE.md 는 이걸 "테스트가 못 잡는다 — 테스트 DO 는 언제나 새것이라 옛 표를 만나지
 * 않는다" 고 적어뒀다. 그 제약은 **옛 표를 직접 만들면 깨진다.** 여기서 하는 일이 그거다:
 * 지금 코드로 회차를 하나 만들고 → 표를 2.0.0 **이전 모양으로 되돌리고** → DO 를 죽였다가
 * → 공개 API 로 다시 열어본다.
 *
 * **릴리스 차선에서만 돈다** (`npm run guard`, ADR-66). 매 PR 이 아니라 프로덕션으로 가는
 * 길에서 보는 검사다 — 실제 옛 DO 는 QA 에만 있고, 여기서 잡는 건 그 앞의 한 겹이다.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { api, enter, freshEvent, invite, join, master, signInMaster } from "../helpers/party.ts";
import type { EventMeta, HostState, PublicEvent } from "../../src/shared/types.ts";
import type { Env as AppEnv } from "../../src/server/http.ts";

/**
 * `cloudflare:test` 의 `env` 는 `Cloudflare.Env` 로 타입이 매겨진다 — 프로젝트가 다시 선언해
 * 넓히라고 비워둔 자리다. 여기 말고는 `env` 를 직접 쓰는 테스트가 없어서
 * (다들 `SELF.fetch` 로 문 앞에서 논다) 이 파일 안에 둔다 —
 * 쓰는 데가 늘면 그때 `test/env.d.ts` 로 옮긴다.
 */
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
  }
}

beforeAll(signInMaster);

/**
 * **2.0.0 이전의 표를 그대로 적는다.** 빼기로 만들지 않는 이유가 둘 있다 —
 * `ALTER TABLE ... DROP COLUMN` 은 지금 `SCHEMA` 에서 아예 안 된다(칸 뒤에 붙은 주석 때문에
 * SQLite 가 CREATE 문을 다시 쓰다 `incomplete input` 으로 던진다). 그리고 빼기로 만들면
 * **옛 모양이 지금 모양에 매달린다** — 지금 것이 바뀔 때마다 옛 것도 따라 흔들려서,
 * 정작 "옛 회차는 이렇게 생겼다" 는 사실을 아무 데서도 읽을 수 없게 된다.
 *
 * 지금과 다른 셋: 토큰 칸이 없고(ADR-32 이전), 걷어낸 칸들이 남아 있고(ADR-42·45·51),
 * 토큰 인덱스가 없다.
 */
// copy-ok — SQL 이지 화면 문구가 아니다
const V1_PLAYERS = `CREATE TABLE players (
  id TEXT PRIMARY KEY, nickname TEXT NOT NULL, nick_norm TEXT NOT NULL UNIQUE,
  real_name TEXT NOT NULL, age INTEGER NOT NULL, gender TEXT NOT NULL CHECK (gender IN ('M','F')),
  phone TEXT NOT NULL UNIQUE, instagram TEXT NOT NULL, mbti TEXT NOT NULL,
  charms TEXT NOT NULL, created_at INTEGER NOT NULL,
  attendance TEXT NOT NULL DEFAULT 'yes', contact_share TEXT NOT NULL DEFAULT 'none'
)`;
// copy-ok — SQL 이지 화면 문구가 아니다
const V1_INVITES = `CREATE TABLE invites (
  phone TEXT PRIMARY KEY, added_at INTEGER NOT NULL, sent_at INTEGER
)`;

const PLAYER_COLS =
  "id,nickname,nick_norm,real_name,age,gender,phone,instagram,mbti,charms,created_at";

/**
 * 표를 옛 모양으로 되돌리고 DO 를 죽인다. 다음 요청이 생성자를 다시 태운다.
 *
 * 줄은 **옮겨 담는다.** 비운 표로 되돌리면 생성자가 빈 회차를 만나서, 정작 보고 싶은
 * "옛 줄이 새 코드를 만났을 때" 가 사라진다.
 */
async function ageToV1(eventId: string) {
  const stub = env.EVENT.get(env.EVENT.idFromName(eventId));
  await runInDurableObject(stub, (_i, ctx) => {
    const sql = ctx.storage.sql;
    const players = sql.exec(`SELECT ${PLAYER_COLS} FROM players`).toArray();
    const invites = sql.exec("SELECT phone, added_at FROM invites").toArray();

    // copy-ok — SQL 이지 화면 문구가 아니다
    sql.exec("DROP TABLE players");
    sql.exec("DROP TABLE invites");
    sql.exec(V1_PLAYERS);
    sql.exec(V1_INVITES);

    const marks = PLAYER_COLS.split(",").map(() => "?").join(",");
    for (const p of players) {
      // copy-ok — SQL 이지 화면 문구가 아니다
      sql.exec(`INSERT INTO players (${PLAYER_COLS}) VALUES (${marks})`, ...Object.values(p));
    }
    for (const i of invites) {
      // copy-ok — SQL 이지 화면 문구가 아니다
      sql.exec("INSERT INTO invites (phone, added_at) VALUES (?, ?)", i.phone, i.added_at);
    }
  });
  /*
   * `abort()` 는 출력 게이트를 부수며 던진다 — 그게 이 함수의 목적이다.
   * 삼키지 않으면 테스트가 여기서 끝난다.
   */
  await runInDurableObject(stub, (_i, ctx) => ctx.abort("옛 회차로 되돌린다")).catch(() => {});
}

describe("옛 모양으로 저장된 회차", () => {
  it("★ 토큰 칸이 없던 회차를 열어도 DO 가 죽지 않는다", async () => {
    const ev = await freshEvent();
    await join(ev);
    await ageToV1(ev.id);

    // 죽었다면 여기서 500 이 온다. 회차 목록이 모든 회차를 훑는 자리다
    const res = await api<EventMeta>(`/api/host/events/${ev.id}`, { cookie: master });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe(ev.id);

    const list = await api<{ events: unknown[] }>("/api/host/events", { cookie: master });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
  });

  it("★ 옛 참가자와 옛 명단이 그대로 남는다 — 되돌리며 지우지 않는다", async () => {
    const ev = await freshEvent();
    const player = await join(ev);
    await ageToV1(ev.id);

    const state = await api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master });
    expect(state.status, JSON.stringify(state.body)).toBe(200);
    expect(state.body.players.map((p) => p.id)).toContain(player.id);
    expect(state.body.invites.map((i) => i.phone)).toContain(player.phone);
  });

  it("★ 토큰 없이 남은 명단 줄에 새 토큰이 채워진다 — 문이 잠긴 파티를 남기지 않는다", async () => {
    const ev = await freshEvent();
    const phone = "01098765432";
    const before = await invite(ev.id, phone);
    await ageToV1(ev.id);

    const state = await api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master });
    expect(state.status, JSON.stringify(state.body)).toBe(200);
    const row = state.body.invites.find((i) => i.phone === phone);
    expect(row, "명단 줄이 사라졌다").toBeTruthy();
    // 되돌리며 토큰을 버렸으니 같은 값일 수 없다. 비어 있지도 않아야 한다
    expect(row!.token).toBeTruthy();
    expect(row!.token).not.toBe(before);

    // 그 토큰으로 실제로 문이 열려야 한다. 값만 채우고 안 통하면 고친 게 아니다
    const gate = await enter(ev.id, row!.token);
    expect(gate.status, JSON.stringify(gate.body)).toBe(200);
  });

  it("★ 참가자 쪽 화면도 뜬다 — 옛 회차의 참가자가 앱을 열 수 있다", async () => {
    const ev = await freshEvent();
    const phone = "01055556666";
    await invite(ev.id, phone);
    await ageToV1(ev.id);

    const state = await api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master });
    const token = state.body.invites.find((i) => i.phone === phone)!.token;

    // 참가 링크가 여는 화면이다. 운영자 쪽만 살아나고 여기가 죽으면 파티가 안 열린다
    const res = await api<PublicEvent>(`/api/events/by-id/${ev.id}?t=${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe(ev.id);
  });
});
