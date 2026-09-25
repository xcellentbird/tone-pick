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
 * 알림은 한동안 하나가 두 라운드를 다 덮었다. 둘은 성격이 다르다 —
 * 매력 투표는 **며칠에 걸쳐** 쌓이고, 그동안 순위가 굳는다.
 *
 * ⚠️ 알림을 끄는 건 **화면에서 감추는 일이 아니다.** `received` 에서 빠져야 한다 —
 * 그 숫자 하나가 곧 "지금까지 몇 명이 나를 골랐나" 다 (ADR-34).
 */
import { env, runInDurableObject } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { EventConfig, EventMeta, ParticipantState } from "../src/shared/types.ts";
import { HOST_UI } from "../src/shared/copy.ts";
import { dueTransition } from "../src/shared/phase.ts";
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

// ─────────────────────────────────────────── 파티 시작 예약

/**
 * **파티 일시가 파티를 연다** (ADR-93). 예전에는 운영자가 눌러야만 열렸다 (ADR-14) —
 * 사람이 다 모였는지는 시계가 모른다는 이유였는데, 운영자가 **시각을 적어두고도 그 시각에
 * 폰을 꺼내야 하는** 것이 실제로 더 자주 걸렸다.
 *
 * 버튼은 그대로 있다. 예약을 **앞당기는** 자리로 남고, 미룰 일이면 `partyAt` 을 고친다.
 */
describe("파티 시작 예약", () => {
  it("★ 매력 투표 중에 파티 일시가 지나면 저절로 시작된다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");
    expect((await putSchedule(ev.id, { partyAt: Date.now() - 1000 })).status).toBe(200);

    expect(await phaseNow(ev.id), "시각이 지났는데 아직 매력 투표다").toBe("party");

    /*
     * **손으로 연 파티와 같아야 한다.** 단계만 넘어가고 나이·MBTI 가 안 열리면
     * 예약으로 시작한 회차만 반쪽이 된다 (ADR-21).
     */
    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.roster[0]?.age, "나이가 안 열렸다").toBeGreaterThan(0);
    expect(state.body.roster[0]?.mbti, "MBTI 가 안 열렸다").toBeTruthy();
  });

  /**
   * **매력 투표를 건너뛰지 않는다.** 다른 전환들과 같은 규율이다 — 예약은 저마다
   * *바로 앞 단계*에서만 울린다. 등록 중에 파티 일시가 지났다고 표 한 장 없이
   * 파티로 뛰면 매력 투표가 통째로 사라진다.
   */
  it("★ 등록 중에는 파티 일시가 지나도 시작되지 않는다", () => {
    /*
     * 순서 검사(아래 `순서`)가 파티를 매력 투표 앞으로 못 옮기게 하므로 API 로는 이 일정을 만들 수 없다.
     * 그래도 판정은 지킨다 — 되돌린 회차처럼 지난 시각이 남아 있어도 예약은 바로 앞 단계에서만 운다.
     */
    const now = Date.now();
    const meta = {
      phase: "reg",
      fired: { reg: now - 2 * HOUR },
      schedule: { regOpenAt: now - 2 * HOUR, prevoteAt: now + HOUR, partyAt: now - 1000, revealAt: now + 5 * HOUR },
    } as unknown as EventMeta;
    expect(dueTransition(meta, now), "등록 중에 시계가 파티를 열었다").toBeNull();
  });

  /** 예약은 한 번만 울린다 (ADR-2). `fired.party` 가 남아 있어 되돌려도 다시 안 민다 */
  it("★ 되돌리면 예약이 다시 시작시키지 않는다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    expect((await putSchedule(ev.id, { partyAt: Date.now() - 1000 })).status).toBe(200);
    expect(await phaseNow(ev.id)).toBe("party");

    await setPhase(ev.id, "prevote");
    expect(await phaseNow(ev.id), "되돌리자마자 예약이 다시 밀었다").toBe("prevote");
  });

  /**
   * **이제 아무 버튼도 안 눌러도 발표까지 간다.** 발표 예약이 `phase === "party"` 를
   * 보는데(ADR-43), 그 `party` 를 시계가 놓을 수 있게 됐다 — 두 예약이 이어진다.
   */
  it("★ 파티도 발표도 예약만으로 이어진다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    const past = Date.now() - 1000;
    expect((await putSchedule(ev.id, { partyAt: past - HOUR, revealAt: past })).status).toBe(200);

    expect(await phaseNow(ev.id), "두 예약이 이어지지 않았다").toBe("done");
  });

  /**
   * **옛 버전에서 매력 투표로 넘어온 회차.** ADR-93 전에는 매력 투표 단계에 알람이 없었다
   * (`dueAt` 이 null 이라 들어서는 순간 지웠다). 그대로 두면 파티 일시에 **아무 일도 안 일어난다** —
   * 화면은 안 바뀌고, 그 뒤 첫 요청이 단계를 넘기는데 그게 매력 투표였으면 조용히 파티 콕으로 들어간다.
   * DO 가 다시 뜰 때(배포 뒤 첫 요청 — 회차 목록이 모든 회차를 깨운다) 빠진 알람을 건다.
   */
  it("★ 알람 없이 매력 투표에 있던 회차도 DO 가 다시 뜨면 파티 시작 알람이 걸린다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    const ns = (env as unknown as { EVENT: DurableObjectNamespace }).EVENT;
    const stub = () => ns.get(ns.idFromName(ev.id));
    // 옛 버전이 남긴 모양 — 매력 투표인데 알람이 없다. 그리고 DO 를 내린다 (배포)
    await runInDurableObject(stub(), (_i, ctx) => ctx.storage.deleteAlarm());
    await runInDurableObject(stub(), (_i, ctx) => ctx.abort("배포")).catch(() => {});

    expect(await phaseNow(ev.id)).toBe("prevote");
    const alarm = await runInDurableObject(stub(), (_i, ctx) => ctx.storage.getAlarm());
    expect(alarm, "파티 일시에 울릴 알람이 없다").toBe(ev.schedule.partyAt);
  });
});

// ─────────────────────────────────────────── 순서가 어긋난 옛 일정

/**
 * **설정 탭은 2026-09-18 전까지 일정의 순서를 보지 않았다** (ADR-93 후기). 그 사이 파티를 미루고 발표를 그대로 두었거나
 * 파티를 당기고 매력 투표를 그대로 둔 회차가 남아 있을 수 있다 — 지금의 API 로는 만들 수 없는 모양이라 저장소에 직접 넣는다.
 * 그대로 두면 시계가 따라간다: 발표가 앞이면 **파티가 열리는 순간 매칭 확인까지 가고**, 파티가 앞이면 매력 투표가 사라진다.
 * DO 가 뜰 때 파티 시작을 기준으로 바로잡는다.
 */
describe("순서가 어긋난 옛 일정", () => {
  const ns = () => (env as unknown as { EVENT: DurableObjectNamespace }).EVENT;
  const stubOf = (id: string) => ns().get(ns().idFromName(id));

  /** 옛 설정 탭이 남긴 일정을 저장소에 그대로 넣고 DO 를 내린다 (배포). 다음 요청이 새로 띄운다 */
  async function legacy(id: string, patch: Record<string, number>) {
    await runInDurableObject(stubOf(id), async (_i, ctx) => {
      const meta = (await ctx.storage.get<EventMeta>("meta"))!;
      meta.schedule = { ...meta.schedule, ...patch };
      await ctx.storage.put("meta", meta);
    });
    await runInDurableObject(stubOf(id), (_i, ctx) => ctx.abort("배포")).catch(() => {});
  }

  it("★ 발표가 파티보다 앞인 옛 회차 — 파티가 열려도 매칭 확인까지 가지 않는다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    // 파티를 미뤘고 발표는 두었다. 그리고 둘 다 지났다 — 이 요청이 파티를 연다
    const past = Date.now() - 1000;
    await legacy(ev.id, { partyAt: past, revealAt: past - HOUR });

    expect(await phaseNow(ev.id), "파티가 열리자마자 매칭 확인까지 갔다").toBe("party");
    const { schedule } = (await api<EventMeta>(`/api/host/events/${ev.id}`, { cookie: master })).body;
    expect(schedule.revealAt!, "매칭 확인은 파티 시작 뒤여야 한다").toBeGreaterThan(schedule.partyAt!);
  });

  it("★ 파티가 매력 투표보다 앞인 옛 회차 — 바로잡히고, 설정 저장이 순서에 걸리지 않는다", async () => {
    const ev = await freshEvent();
    // 파티를 당겼고 매력 투표 시작은 두었다
    await legacy(ev.id, { prevoteAt: ev.schedule.partyAt! + HOUR });

    const { schedule } = (await api<EventMeta>(`/api/host/events/${ev.id}`, { cookie: master })).body;
    expect(schedule.prevoteAt!, "매력 투표 시작은 파티 시작 앞이어야 한다").toBeLessThan(schedule.partyAt!);
    expect(schedule.partyAt, "기준인 파티 시작은 옮기지 않는다").toBe(ev.schedule.partyAt);
    // 설정 탭은 저장할 때마다 일정을 통째로 보낸다 — 어긋난 채였으면 이름 하나 고치는 저장도 `순서` 로 막혔다
    expect((await putSchedule(ev.id, {})).status).toBe(200);
  });
});

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
  it("★ 파티를 시작하지 않았으면 시각이 지나도 아무 일이 없다", () => {
    /*
     * 순서 검사(`순서`)가 발표를 파티 앞으로 못 옮기게 하므로 API 로는 이 일정을 만들 수 없다.
     * 그래도 판정은 지킨다 — 되돌린 회차처럼 지난 시각이 남아 있어도 발표는 파티 뒤에만 운다.
     */
    const now = Date.now();
    for (const before of ["reg", "prevote"] as const) {
      const meta = {
        phase: before,
        fired: { reg: now - 2 * HOUR, ...(before === "prevote" ? { prevote: now - HOUR } : {}) },
        schedule: {
          regOpenAt: now - 2 * HOUR,
          prevoteAt: before === "prevote" ? now - HOUR : now + HOUR,
          partyAt: now + 5 * HOUR,
          revealAt: now - 1000,
        },
      } as unknown as EventMeta;
      expect(dueTransition(meta, now), `${before} 에서 시계가 혼자 발표했다`).toBeNull();
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
        // 파티보다 한 시간 **앞**
        revealAt: now + 3 * 24 * HOUR - HOUR,
        config: { maxPre: 2, maxParty: 3 },
        requestId: `rev-${now}`,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
  });

  /**
   * **예약 전환 셋은 순서대로여야 한다** — 매력 투표 시작 → 파티 시작 → 커플 발표 (ADR-93 후기).
   * 셋 다 시계가 따라가는 예약이라 어긋난 채 저장되면 그대로 일어난다: 파티가 매력 투표보다 앞이면
   * 매력 투표가 열리는 그 시각에 등록→투표→파티가 한 번에 넘어가 **투표가 통째로 사라지고**, 발표가 파티보다
   * 앞이면 파티가 열리는 순간 발표까지 간다. 마감은 전환이 아니라 검사하지 않는다 (ADR-39).
   */
  it("★ 순서가 어긋난 일정으로는 회차를 못 만든다 — 어디가 틀렸는지 말한다", async () => {
    const now = Date.now();
    const good = {
      prevoteAt: now + 24 * HOUR,
      partyAt: now + 3 * 24 * HOUR,
      revealAt: now + 3 * 24 * HOUR + 3 * HOUR,
    };
    const bad = [
      { partyAt: good.prevoteAt - HOUR }, // 파티가 매력 투표 시작보다 앞
      { partyAt: good.prevoteAt }, // 같은 시각도 안 된다 — 한 번의 판정에서 둘이 이어진다
      { prevoteAt: good.revealAt + HOUR }, // 매력 투표가 발표보다 뒤
    ];
    for (const patch of bad) {
      const res = await api<{ message?: string }>("/api/host/events", {
        method: "POST",
        cookie: master,
        body: { name: "거꾸로", ...good, ...patch, config: { maxPre: 2, maxParty: 3 }, requestId: `ord-${now}-${Math.random()}` },
      });
      expect(res.status, JSON.stringify(patch)).toBe(400);
      expect(res.body.message).toBe(HOST_UI.scheduleOrder);
    }
  });

  it("★ 고칠 때도 순서를 지킨다 — 발표를 파티 앞으로, 파티를 매력 투표 앞으로 옮길 수 없다", async () => {
    const ev = await freshEvent();
    const s = ev.schedule;
    const late = await putSchedule(ev.id, { revealAt: s.partyAt! - HOUR });
    expect(late.status, JSON.stringify(late.body)).toBe(400);
    expect((late.body as { message?: string }).message).toBe(HOST_UI.scheduleOrder);
    expect((await putSchedule(ev.id, { partyAt: s.prevoteAt! - HOUR })).status).toBe(400);
    // 그대로 보내면 통과한다 — 설정 탭은 저장할 때마다 일정을 통째로 보낸다
    expect((await putSchedule(ev.id, { prevoteAt: s.prevoteAt!, partyAt: s.partyAt!, revealAt: s.revealAt! })).status).toBe(200);
  });

  /**
   * **지난 것은 견주지 않는다.** 매력 투표를 앞당겨 열었으면 그 예약 시각은 기록일 뿐이라,
   * 파티를 그보다 앞으로 옮기는 건 정당하다 — 이걸 막으면 순서 검사가 옳은 조작을 거절한다.
   */
  it("★ 앞당겨 연 예약 앞으로는 옮길 수 있다 — 기록과 예약을 견주지 않는다", async () => {
    const ev = await freshEvent(); // 매력 투표 예약은 내일이다
    await setPhase(ev.id, "prevote"); // 지금 연다
    const res = await putSchedule(ev.id, { partyAt: Date.now() + 2 * HOUR });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  /**
   * **발표 시각만 파티가 시작된 뒤에도 고칠 수 있다** — 파티가 길어지면 미뤄야 한다.
   * 파티 일시가 파티 전까지 열려 있는 것과 같은 자리다.
   */
  it("★ 파티 중에는 미룰 수 있고, 발표된 뒤에는 잠긴다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    const later = Date.now() + 6 * HOUR;
    expect((await putSchedule(ev.id, { revealAt: later })).status, "파티 중에 못 미뤘다").toBe(200);
    // 다른 일정은 파티가 시작되면 잠긴다 — 발표만 예외라는 게 요점이다
    expect((await putSchedule(ev.id, { partyAt: Date.now() + HOUR })).status).toBe(409);

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

  /**
   * **발표가 끝이 아니다** (ADR-85, ADR-43 의 한 줄을 뒤집는다). 예전에는 발표되면 끈 라운드까지
   * 전부 세어서, 알림을 꺼 둔 회차에서 발표 순간 받은 줄이 한꺼번에 쏟아졌다.
   * 운영자가 끈 것은 "파티 중에만" 이 아니라 **몇 번 받았는지 알리지 않는 것**이다.
   */
  it("★ 알림을 끈 라운드는 발표 뒤에도 세지 않는다", async () => {
    const s = await received({ preNotify: false, pokeNotify: false }, "pre");
    expect(s.now).toBe(0);

    await setPhase(s.ev.id, "party");
    await api("/api/poke", { method: "POST", cookie: s.a.cookie, body: { toId: s.b.id } });
    expect(await s.seen(), "발표 전인데 세어졌다").toBe(0);

    await setPhase(s.ev.id, "done");
    expect(await s.seen(), "발표와 함께 끈 라운드가 드러났다").toBe(0);
  });

  it("★ 발표 뒤에도 켠 라운드만 센다 — 한쪽만 끈 회차", async () => {
    // 매력 투표 알림만 켰다. 파티 콕은 끝까지 안 보여야 한다
    const s = await received({ preNotify: true, pokeNotify: false }, "pre");
    expect(s.now).toBe(1);

    await setPhase(s.ev.id, "party");
    await api("/api/poke", { method: "POST", cookie: s.a.cookie, body: { toId: s.b.id } });
    await setPhase(s.ev.id, "done");

    const res = await api<ParticipantState>("/api/me", { cookie: s.b.cookie });
    expect(res.body.poke.received).toEqual({ pre: 1, party: 0 });
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
