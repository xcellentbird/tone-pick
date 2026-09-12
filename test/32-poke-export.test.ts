/**
 * 슬라이스 32 — 콕 이력 내보내기 (ADR-82)
 *
 * **운영자만 받는 파일이다.** 한 줄이 콕 하나고, 보낸 사람과 받은 사람의 실명이 실린다 —
 * 운영자의 공개 범위는 `발신자까지` 다 (`docs/DOMAIN.md`). 참가자에게는 어떤 길로도 안 간다.
 *
 * 전화번호·인스타는 **칸 자체가 없다.** 이 파일은 DO 밖으로 나가는 물건이라 새면 돌이킬 수 없다.
 *
 * 재료는 `helpers/party.ts`.
 */
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { MyPokeState } from "../src/shared/types.ts";
import { signInMaster, api, freshEvent, join, master, setPhase } from "./helpers/party.ts";

beforeAll(signInMaster);

const poke = (cookie: string | null, toId: string) =>
  api<MyPokeState>("/api/poke", { method: "POST", cookie, body: { toId } });

/** CSV 를 줄과 칸으로 푼다. 테스트 자료에는 쉼표·따옴표가 없어 단순 분리로 충분하다 */
function parse(text: string): string[][] {
  return text
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(","));
}

async function exportCsv(eventId: string, cookie: string | null) {
  const res = await SELF.fetch(`https://tone-pick.test/api/host/events/${eventId}/pokes.csv`, {
    headers: cookie ? { cookie } : {},
  });
  return { status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text() };
}

/** 사전 투표에서 하나, 파티에서 서로 찌른 쌍 하나 */
async function partyWithPokes() {
  const ev = await freshEvent();
  const a = await join(ev, { gender: "M", nickname: "철수", realName: "김철수" });
  const b = await join(ev, { gender: "F", nickname: "영희", realName: "이영희" });
  const c = await join(ev, { gender: "F", nickname: "민지", realName: "박민지" });
  await setPhase(ev.id, "prevote");
  expect((await poke(a.cookie, b.id)).status).toBe(200);
  await setPhase(ev.id, "party");
  expect((await poke(a.cookie, c.id)).status).toBe(200);
  expect((await poke(c.cookie, a.id)).status).toBe(200);
  return { ev, a, b, c };
}

describe("콕 이력 내보내기 (ADR-82)", () => {
  it("★ 운영자만 받는다 — 참가자 세션도, 세션 없이도 401", async () => {
    const { ev, a } = await partyWithPokes();
    expect((await exportCsv(ev.id, null)).status).toBe(401);
    expect((await exportCsv(ev.id, a.cookie)).status).toBe(401);
    const mine = await exportCsv(ev.id, master);
    expect(mine.status).toBe(200);
    expect(mine.type).toContain("text/csv");
  });

  it("★ 한 줄에 콕 하나 — 보낸 사람·받은 사람 실명과 라운드가 실린다", async () => {
    const { ev } = await partyWithPokes();
    const rows = parse((await exportCsv(ev.id, master)).text);
    const [header, ...body] = rows;
    expect(header[0]).toBe("라운드");
    expect(body).toHaveLength(3);

    const line = (from: string, to: string) => body.find((r) => r[3] === from && r[7] === to);
    // 사전 투표의 콕 — 상대는 안 찔렀다
    expect(line("김철수", "이영희")?.[0]).toBe("사전 투표");
    expect(line("김철수", "이영희")?.at(-1)).toBe("아니요");
    // 파티에서 서로 찌른 쌍 — 양쪽 줄 다 '예'
    expect(line("김철수", "박민지")?.[0]).toBe("파티");
    expect(line("김철수", "박민지")?.at(-1)).toBe("예");
    expect(line("박민지", "김철수")?.at(-1)).toBe("예");
  });

  it("★ 전화번호·인스타는 칸 자체가 없다", async () => {
    const { ev } = await partyWithPokes();
    const { text } = await exportCsv(ev.id, master);
    expect(text).not.toContain("0101234");   // helpers 가 주는 번호의 앞자리
    expect(text).not.toContain("insta_");    // helpers 가 주는 인스타
    expect(text).not.toMatch(/전화|인스타/);
  });

  it("나간 사람이 보낸 콕은 남고 받은 콕은 사라진다 (ADR-29) — 보낸 줄은 이름 자리만 빈다", async () => {
    const { ev, c } = await partyWithPokes();
    const gone = await api(`/api/host/events/${ev.id}/players/${c.id}`, { method: "DELETE", cookie: master });
    expect(gone.status).toBe(200);
    const [, ...body] = parse((await exportCsv(ev.id, master)).text);
    // 김철수→이영희(사전) · 박민지→김철수(파티) 둘. 박민지가 **받은** 김철수→박민지는 삭제와 함께 지워졌다
    expect(body).toHaveLength(2);
    expect(body.find((r) => r[7] === "박민지")).toBeUndefined();
    const sentByGone = body.find((r) => r[7] === "김철수" && r[0] === "파티");
    expect(sentByGone?.[2]).toBe("(나간 사람)");
    expect(sentByGone?.[3]).toBe("");
  });

  it("★ 참가자 응답에는 여전히 발신자가 없다", async () => {
    const { ev, b } = await partyWithPokes();
    const state = await api("/api/me", { cookie: b.cookie });
    const text = JSON.stringify(state.body);
    expect(text).not.toContain("fromId");
    expect(text).not.toContain("김철수");
    void ev;
  });
});
