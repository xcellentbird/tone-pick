/**
 * 슬라이스 34 — 단계가 열릴 때의 안내 화면 (ADR-96). **서버 쪽 규칙만** 본다 —
 * 언제 뜨고 무엇이 적혀 있는지는 `test/client/stage.test.tsx` 가 본다.
 *
 * 봤다는 표시는 **서버가** 안다 (ADR-4 의 예외 — 자리 `acks` 와 같은 이유).
 * 사건에 붙일 수 없어서다: 매력 투표는 예약 시각에 열리고 파티도 예약이 연다 (ADR-93) —
 * 그 순간 앱을 켜둔 사람이 없다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { HostState, ParticipantState } from "../src/shared/types.ts";
import { api, enter, freshEvent, join, master, setPhase, signInMaster } from "./helpers/party.ts";

beforeAll(signInMaster);

const me = (cookie: string | null, code: string) => api<ParticipantState>(`/api/me?code=${code}`, { cookie });
const seen = (cookie: string | null, stage: unknown) =>
  api(`/api/stage/seen`, { method: "POST", cookie, body: { stage } });

describe("봤다는 표시는 서버가 안다 (ADR-96)", () => {
  it("★ 누르면 저장되고 내 정보에 실린다 — 새로 읽어도, 다시 들어와도 그대로다", async () => {
    const ev = await freshEvent();
    const p = await join(ev);
    await setPhase(ev.id, "prevote");
    expect((await me(p.cookie, ev.code)).body.me.seenStage).toBeUndefined();

    expect((await seen(p.cookie, "prevote")).status).toBe(200);
    expect((await me(p.cookie, ev.code)).body.me.seenStage).toBe("prevote");

    // 다른 세션으로 다시 들어와도 사람은 하나다 (ADR-44) — 한 번만 뜬다
    const again = await enter(ev.id, p.phone, p.pin);
    expect(again.status).toBe(200);
    expect((await me(again.cookie, ev.code)).body.me.seenStage).toBe("prevote");
  });

  it("★ 클라이언트가 어느 단계를 봤는지 보낸다 — 파티 안내는 따로 남는다", async () => {
    const ev = await freshEvent();
    const p = await join(ev);
    await setPhase(ev.id, "prevote");
    await seen(p.cookie, "prevote");
    await setPhase(ev.id, "party");
    // 매력 투표 안내를 봤다는 값이 파티 안내를 본 것으로 읽히면 안 된다
    expect((await me(p.cookie, ev.code)).body.me.seenStage).toBe("prevote");
    expect((await seen(p.cookie, "party")).status).toBe(200);
    expect((await me(p.cookie, ev.code)).body.me.seenStage).toBe("party");
  });

  it("★ 값은 둘뿐이다 — 다른 건 거절하고 아무것도 안 바뀐다", async () => {
    const ev = await freshEvent();
    const p = await join(ev);
    for (const bad of ["reg", "done", "PREVOTE", "", 1, null]) {
      expect((await seen(p.cookie, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await me(p.cookie, ev.code)).body.me.seenStage).toBeUndefined();
  });

  it("★ 세션 없이는 안 된다", async () => {
    expect((await seen(null, "prevote")).status).toBe(401);
  });

  it("★ 본인에게만 간다 — 명단에도 운영자 응답에도 없다", async () => {
    const ev = await freshEvent();
    const a = await join(ev);
    const b = await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");
    await seen(a.cookie, "prevote");

    const other = (await me(b.cookie, ev.code)).body;
    expect(other.roster.length).toBeGreaterThan(0);
    for (const r of other.roster) expect(r).not.toHaveProperty("seenStage");

    const host = await api<HostState>(`/api/host/events/${ev.id}/state`, { cookie: master });
    expect(host.status).toBe(200);
    for (const pl of host.body.players) expect(pl).not.toHaveProperty("seenStage");
  });
});
