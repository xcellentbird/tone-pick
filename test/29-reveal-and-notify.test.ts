/**
 * 슬라이스 29 — **커플 발표 예약**과 **라운드별 알림** (ADR-43).
 *
 * ## 발표 예약
 *
 * ADR-14 는 마감·파티·발표를 예약하지 않기로 했다. 막으려던 건 **현장이 시계를 따라가는 것**이고,
 * 그중 가장 나쁜 건 **아무도 안 온 자리에서 발표가 뜨는 것**이다.
 *
 * 그래서 예약을 붙이되 **파티가 시작된 뒤에만 울린다.** 운영자가 `파티 시작` 을 안 눌렀으면
 * 시각이 지나도 아무 일이 없다 — 시계가 혼자 파티를 끝내지 못한다. 이 파일의 절반이 그 한 줄을 지킨다.
 *
 * ## 라운드별 알림
 *
 * 되돌리기는 이미 라운드마다 따로였는데(`allowUndoPre`·`allowUndo`) 알림만 하나였다.
 * 둘은 성격이 다르다 — 매력 투표는 **며칠에 걸쳐** 쌓이고, 그동안 순위가 굳는다.
 *
 * ⚠️ 알림을 끄는 건 **화면에서 감추는 일이 아니다.** `received` 에서 빠져야 한다 —
 * 그 숫자 하나가 곧 "지금까지 몇 명이 나를 골랐나" 다 (ADR-34).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { EventConfig, EventMeta, ParticipantState } from "../src/shared/types.ts";
import { signInMaster, api, freshEvent, join, master, setPhase } from "./helpers/party.ts";

beforeAll(signInMaster);

const HOUR = 3600_000;

const putSchedule = (id: string, patch: Record<string, number>) =>
  api<EventMeta>(`/api/host/events/${id}/schedule`, { method: "PUT", cookie: master, body: patch });

/** 지금 단계를 다시 읽는다. 예약은 **요청이 들어올 때** 판정되므로 한 번 두드려야 한다 */
async function phaseNow(id: string): Promise<string> {
  const res = await api<EventMeta>(`/api/host/events/${id}`, { cookie: master });
  return res.body.phase;
}

// ─────────────────────────────────────────── 커플 발표 예약

describe("커플 발표 예약", () => {
  it("★ 파티가 시작된 뒤라면 시각이 지날 때 발표된다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");
    // 이미 지난 시각으로 옮긴다 — 다음 요청에서 판정된다
    expect((await putSchedule(ev.id, { revealAt: Date.now() - 1000 })).status).toBe(200);

    expect(await phaseNow(ev.id), "발표로 넘어가야 한다").toBe("done");
  });

  /**
   * **이 테스트가 ADR-14 와의 약속이다.**
   *
   * 파티를 안 시작했는데 발표 시각이 지나도 아무 일이 없어야 한다.
   * 여기가 깨지면 아직 아무도 안 온 자리에서 결과가 뜬다 —
   * 콕은 열린 적도 없으니 매칭이 0인 채로 파티가 끝난 것이 된다.
   */
  it("★ 파티를 시작하지 않았으면 시각이 지나도 아무 일이 없다", async () => {
    for (const before of ["reg", "prevote"] as const) {
      const ev = await freshEvent();
      if (before === "prevote") await setPhase(ev.id, "prevote");
      expect((await putSchedule(ev.id, { revealAt: Date.now() - 1000 })).status).toBe(200);

      expect(await phaseNow(ev.id), `${before} 에서 시계가 혼자 발표했다`).toBe(before);
    }
  });

  /**
   * **예약이 울려 발표된 회차도 되돌릴 수 없다** (ADR-50). 손으로 누른 발표와 다를 이유가
   * 없고, 한쪽만 물릴 수 있으면 이 결정은 절반만 지켜진다.
   *
   * 예전에는 이 자리가 *한 번 울린 알람은 되돌려도 다시 울지 않는다*(ADR-2)를 지켰다.
   * 이제 `done` 밖으로 나갈 수 없어 발표에서는 그 길로 확인할 수 없다 —
   * 뒤로 가는 전환은 `04-match-budget` 의 `단계 되돌리기` 가 그대로 지킨다.
   */
  it("★ 예약이 울려 발표된 회차도 되돌릴 수 없다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");
    expect((await putSchedule(ev.id, { revealAt: Date.now() - 1000 })).status).toBe(200);
    expect(await phaseNow(ev.id)).toBe("done");

    const res = await api(`/api/host/events/${ev.id}/phase`, { method: "POST", cookie: master, body: { to: "party" } });
    expect(res.status, "예약으로 발표된 회차가 되돌아갔다").toBe(400);
    expect(await phaseNow(ev.id)).toBe("done");
  });

  it("★ 발표가 파티보다 앞이면 회차를 못 만든다", async () => {
    const now = Date.now();
    const res = await api("/api/host/events", {
      method: "POST",
      cookie: master,
      body: {
        name: "거꾸로",
        partyAt: now + 3 * 24 * HOUR,
        prevoteAt: now + 24 * HOUR,
        voteEndAt: now + 3 * 24 * HOUR - HOUR,
        // 파티보다 한 시간 **앞**
        revealAt: now + 3 * 24 * HOUR - HOUR,
        config: { maxPre: 2, maxParty: 3 },
        requestId: `rev-${now}`,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  /**
   * **발표 시각만 파티가 시작된 뒤에도 고칠 수 있다** — 파티가 길어지면 미뤄야 한다.
   * ADR-39 가 `voteEndAt` 에서 겪은 것과 같은 자리다.
   */
  it("★ 파티 중에는 미룰 수 있고, 발표된 뒤에는 잠긴다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    const later = Date.now() + 6 * HOUR;
    expect((await putSchedule(ev.id, { revealAt: later })).status, "파티 중에 못 미뤘다").toBe(200);
    // 다른 일정은 파티가 시작되면 잠긴다 — 발표만 예외라는 게 요점이다
    expect((await putSchedule(ev.id, { voteEndAt: Date.now() + HOUR })).status).toBe(409);

    await setPhase(ev.id, "done");
    expect((await putSchedule(ev.id, { revealAt: later + HOUR })).status, "발표 뒤에도 열려 있다").toBe(409);
  });
});

// ─────────────────────────────────────────── 라운드별 알림

describe("알림은 라운드마다 따로다", () => {
  /** 두 사람을 만들고, 준 라운드에서 한 번 찌른 뒤 **받은 쪽**이 보는 수를 돌려준다 */
  async function received(config: Partial<EventConfig>, round: "pre" | "party") {
    const ev = await freshEvent(config);
    const a = await join(ev, { gender: "M", nickname: "에이" });
    const b = await join(ev, { gender: "F", nickname: "비이" });
    await setPhase(ev.id, "prevote");
    if (round === "party") await setPhase(ev.id, "party");

    const poked = await api("/api/poke", { method: "POST", cookie: a.cookie, body: { toId: b.id } });
    expect(poked.status, JSON.stringify(poked.body)).toBe(200);

    const seen = async () => {
      const res = await api<ParticipantState>("/api/me", { cookie: b.cookie });
      return res.body.poke.received.pre + res.body.poke.received.party;
    };
    return { ev, a, b, now: await seen(), seen };
  }

  it("★ 매력 투표 알림을 끄면 그 표는 세지 않는다", async () => {
    const off = await received({ preNotify: false, pokeNotify: true }, "pre");
    expect(off.now, "끈 라운드의 표가 세어졌다").toBe(0);

    const on = await received({ preNotify: true, pokeNotify: false }, "pre");
    expect(on.now).toBe(1);
  });

  it("★ 콕 알림을 끄면 그 콕은 세지 않는다", async () => {
    const off = await received({ preNotify: true, pokeNotify: false }, "party");
    expect(off.now, "끈 라운드의 콕이 세어졌다").toBe(0);

    const on = await received({ preNotify: false, pokeNotify: true }, "party");
    expect(on.now).toBe(1);
  });

  /**
   * **총합을 그대로 내려보내면 안 된다.** 매력 투표 알림을 끈 회차에서 파티가 시작되는 순간
   * 그때까지 쌓인 표가 숫자에 얹히면, 꺼둔 것이 아무 의미가 없어진다.
   */
  it("★ 끈 라운드의 표는 파티가 시작돼도 얹히지 않는다", async () => {
    const s = await received({ preNotify: false, pokeNotify: true }, "pre");
    expect(s.now).toBe(0);

    await setPhase(s.ev.id, "party");
    // 파티 콕을 하나 보낸다 — 보이는 건 이것 하나뿐이어야 한다
    await api("/api/poke", { method: "POST", cookie: s.a.cookie, body: { toId: s.b.id } });
    expect(await s.seen(), "매력 투표 표가 파티에서 얹혔다").toBe(1);
  });

  it("★ 발표 뒤에는 끈 라운드까지 전부 센다", async () => {
    const s = await received({ preNotify: false, pokeNotify: false }, "pre");
    expect(s.now).toBe(0);

    await setPhase(s.ev.id, "party");
    await api("/api/poke", { method: "POST", cookie: s.a.cookie, body: { toId: s.b.id } });
    expect(await s.seen(), "발표 전인데 세어졌다").toBe(0);

    // 발표되면 매칭까지 열리므로 감출 것이 없다
    await setPhase(s.ev.id, "done");
    expect(await s.seen()).toBe(2);
  });

  it("★ 콕이 오가기 시작하면 알림 설정이 굳는다", async () => {
    const ev = await freshEvent({ preNotify: false });
    const a = await join(ev, { gender: "M" });
    const b = await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");
    await api("/api/poke", { method: "POST", cookie: a.cookie, body: { toId: b.id } });

    /*
     * 파티 도중에 켜면 그때까지 쌓인 표가 **한꺼번에** 나타난다 (ADR-35).
     * "받은 콕은 한 번에 하나씩" 이 그 순간 통째로 깨진다.
     */
    const res = await api(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { name: ev.name, config: { ...ev.config, preNotify: true } },
    });
    expect(res.status, "굳었는데 알림 설정이 바뀌었다").not.toBe(200);
  });
});
