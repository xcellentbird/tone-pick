/**
 * 슬라이스 32 — 콕 로그 파일 (ADR-84. ADR-82 의 CSV 내보내기를 걷어냈다)
 *
 * **찌름과 되돌림이 한 줄씩 R2 파일에 쌓인다.** 앱에는 그 파일을 꺼내는 길이 없다 —
 * 운영자가 Cloudflare 에서 직접 받는다. 되돌림은 콕 표에서 줄을 지우므로, 이 파일이 아니면
 * 누가 무엇을 되돌렸는지 어디에도 남지 않는다.
 *
 * 전화번호·인스타는 **칸 자체가 없다.** 이 파일은 회차를 지워도 남는다 — 새면 돌이킬 수 없다.
 *
 * 재료는 `helpers/party.ts`.
 */
import { fetchApp } from "./helpers/app.ts";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { EventMeta, MyPokeState } from "../src/shared/types.ts";
import { signInMaster, api, freshEvent, join, master, setPhase } from "./helpers/party.ts";

beforeAll(signInMaster);

const LOGS = (env as unknown as { LOGS: R2Bucket }).LOGS;

const poke = (cookie: string | null, toId: string) =>
  api<MyPokeState>("/api/poke", { method: "POST", cookie, body: { toId } });
const unpoke = (cookie: string | null, toId: string) =>
  api<MyPokeState>("/api/unpoke", { method: "POST", cookie, body: { toId } });

/** 파일을 줄과 칸으로 푼다. 테스트 자료에는 쉼표·따옴표가 없어 단순 분리로 충분하다 */
async function readLog(ev: EventMeta): Promise<{ raw: string; header: string[]; body: string[][] }> {
  const obj = await LOGS.get(`poke-logs/${ev.id}.csv`);
  const raw = obj ? await obj.text() : "";
  const [header = [], ...body] = raw
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(","));
  return { raw, header, body };
}

/** 칸 이름으로 값을 꺼낸다 — 칸 순서를 테스트가 외우지 않게 */
const col = (header: string[], row: string[], name: string) => row[header.indexOf(name)];

async function party() {
  const ev = await freshEvent();
  const a = await join(ev, { gender: "M", nickname: "철수", realName: "김철수", age: 31 });
  const b = await join(ev, { gender: "F", nickname: "영희", realName: "이영희", age: 29 });
  const c = await join(ev, { gender: "F", nickname: "민지", realName: "박민지", age: 27 });
  return { ev, a, b, c };
}

describe("콕 로그 파일 (ADR-84)", () => {
  it("★ 찌름과 되돌림이 일어난 순서대로 한 줄씩 쌓인다 — 양쪽 닉네임·실명·나이와 라운드", async () => {
    const { ev, a, b, c } = await party();
    await setPhase(ev.id, "prevote");
    expect((await poke(a.cookie, b.id)).status).toBe(200);
    await setPhase(ev.id, "party");
    expect((await poke(a.cookie, c.id)).status).toBe(200);
    expect((await unpoke(a.cookie, c.id)).status).toBe(200);
    expect((await poke(c.cookie, a.id)).status).toBe(200);

    const { header, body } = await readLog(ev);
    expect(body).toHaveLength(4);
    const kinds = body.map((r) => col(header, r, "구분"));
    expect(kinds).toEqual(["찌름", "찌름", "되돌림", "찌름"]);

    const [pre, , undo, back] = body;
    expect(col(header, pre, "라운드")).toBe("프로필 투표");
    expect(col(header, pre, "보낸 사람")).toBe("철수");
    expect(col(header, pre, "보낸 사람 실명")).toBe("김철수");
    expect(col(header, pre, "보낸 나이")).toBe("31");
    expect(col(header, pre, "받은 사람")).toBe("영희");
    expect(col(header, pre, "받은 사람 실명")).toBe("이영희");
    expect(col(header, pre, "받은 나이")).toBe("29");

    expect(col(header, undo, "라운드")).toBe("파티");
    expect(col(header, undo, "보낸 사람 실명")).toBe("김철수");
    expect(col(header, undo, "받은 사람 실명")).toBe("박민지");
    expect(col(header, back, "보낸 사람 실명")).toBe("박민지");
    expect(col(header, back, "시각(KST)")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("★ 동시에 몰린 콕도 줄을 잃지 않는다 — 나란히 쓰면 뒤엣것이 앞의 줄을 덮는다", async () => {
    const { ev, a, b, c } = await party();
    await setPhase(ev.id, "party");
    const all = await Promise.all([poke(a.cookie, b.id), poke(a.cookie, c.id), poke(b.cookie, a.id), poke(c.cookie, a.id)]);
    expect(all.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect((await readLog(ev)).body).toHaveLength(4);
  });

  it("★ 서버가 거절한 콕은 적히지 않는다 — 일어난 일만 남는다", async () => {
    const { ev, a, b } = await party();
    // 등록 단계에서는 콕이 닫혀 있다
    expect((await poke(a.cookie, b.id)).status).not.toBe(200);
    await setPhase(ev.id, "party");
    // 찌른 적 없는 사람을 되돌릴 수는 없다
    expect((await unpoke(a.cookie, b.id)).status).not.toBe(200);
    expect((await readLog(ev)).body).toHaveLength(0);
  });

  it("★ 전화번호·인스타는 칸 자체가 없다", async () => {
    const { ev, a, b } = await party();
    await setPhase(ev.id, "party");
    await poke(a.cookie, b.id);
    await unpoke(a.cookie, b.id);
    const { raw } = await readLog(ev);
    expect(raw).toContain("김철수");
    expect(raw).not.toContain(a.phone);
    expect(raw).not.toContain(b.phone);
    expect(raw).not.toContain(a.input.instagram);
    expect(raw).not.toMatch(/전화|인스타/);
  });

  it("★ 앱에는 꺼내는 길이 없다 — 옛 CSV 주소는 운영자에게도 없다", async () => {
    const { ev, a, b } = await party();
    await setPhase(ev.id, "party");
    await poke(a.cookie, b.id);
    const res = await fetchApp(`https://tone-pick.test/api/host/events/${ev.id}/pokes.csv`, {
      headers: { cookie: master ?? "" },
    });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("김철수");
  });

  it("★ 회차를 삭제해도 로그 파일은 남는다 — 지우는 건 사람이 한다", async () => {
    const { ev, a, b } = await party();
    await setPhase(ev.id, "party");
    await poke(a.cookie, b.id);
    const gone = await api(`/api/host/events/${ev.id}`, { method: "DELETE", cookie: master });
    expect(gone.status).toBe(200);
    expect((await readLog(ev)).body).toHaveLength(1);
  });

  it("참가자를 내보내도 이미 적힌 줄은 그대로다 — 파일은 덧붙이기만 한다", async () => {
    const { ev, a, b, c } = await party();
    await setPhase(ev.id, "party");
    await poke(a.cookie, c.id);
    await poke(c.cookie, b.id);
    expect((await api(`/api/host/events/${ev.id}/players/${c.id}`, { method: "DELETE", cookie: master })).status).toBe(200);
    const { header, body } = await readLog(ev);
    expect(body).toHaveLength(2);
    expect(body.map((r) => col(header, r, "받은 사람 실명"))).toEqual(["박민지", "이영희"]);
  });

  it("★ 참가자 응답에는 여전히 발신자가 없다", async () => {
    const { ev, a, b } = await party();
    await setPhase(ev.id, "party");
    await poke(a.cookie, b.id);
    const state = await api("/api/me", { cookie: b.cookie });
    const text = JSON.stringify(state.body);
    expect(text).not.toContain("fromId");
    expect(text).not.toContain("김철수");
  });
});

/**
 * R2 가 잠깐 안 받거나 느릴 때. 이 회차 DO 의 `env.LOGS` 만 바꿔 끼운다 — 콕도 로그도 공개 API 로 본다.
 */
describe("R2 가 흔들릴 때", () => {
  type Inst = { env: Record<string, unknown> };
  const stubOf = (ev: EventMeta) => {
    const ns = (env as unknown as { EVENT: DurableObjectNamespace }).EVENT;
    return ns.get(ns.idFromName(ev.id));
  };
  async function swapLogs(ev: EventMeta, logs: unknown) {
    await runInDurableObject(stubOf(ev), (inst) => {
      const i = inst as unknown as Inst;
      i.env = { ...i.env, LOGS: logs };
    });
  }

  it("★ 쓰기가 실패한 줄은 버리지 않는다 — 다음 쓰기에 앞의 순서 그대로 실린다", async () => {
    /*
     * 되돌림은 콕 표에서 줄을 지우므로 이 파일 말고는 어디에도 안 남는다 (ADR-84).
     * 쓰기 한 번이 실패했다고 그 사이의 줄을 버리면 운영자가 받는 파일에 구멍이 난다.
     */
    const { ev, a, b, c } = await party();
    await setPhase(ev.id, "prevote");
    const down = () => Promise.reject(new Error("r2 down"));
    await swapLogs(ev, { get: down, put: down });
    expect((await poke(a.cookie, b.id)).status, "로그 때문에 콕이 깨졌다").toBe(200);

    await swapLogs(ev, LOGS);
    expect((await poke(a.cookie, c.id)).status).toBe(200);
    const { header, body } = await readLog(ev);
    expect(body.map((r) => col(header, r, "받은 사람"))).toEqual(["영희", "민지"]);
  });

  it("★ R2 가 느려도 콕 응답은 기다리지 않는다 — 화면의 시간 제한에 닿으면 저장된 콕이 실패로 보인다", async () => {
    /*
     * 콕 응답은 제 줄이 파일에 실리기를 기다린다. R2 가 10초를 넘기면 화면(`api.ts`)이 먼저 끊고
     * `연결이 끊겼어요` 로 콕을 되돌려 놓는다 — 서버에는 저장됐는데. 사람은 다시 누르고 한 번을 더 쓴다.
     */
    const { ev, a, b } = await party();
    await setPhase(ev.id, "prevote");
    const slow = (value: unknown) => () => new Promise((r) => setTimeout(() => r(value), 6_000));
    await swapLogs(ev, { get: slow(null), put: slow(undefined) });

    const t0 = Date.now();
    expect((await poke(a.cookie, b.id)).status).toBe(200);
    expect(Date.now() - t0, "콕 응답이 R2 를 끝까지 기다렸다").toBeLessThan(4_000);
    await swapLogs(ev, LOGS);
  });
});
