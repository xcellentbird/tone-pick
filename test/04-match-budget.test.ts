/**
 * 슬라이스 03·05·06 — 여러 매칭 · 자리 섞기 · 콕 상한 · 오늘의 연애운 · 되돌리기
 *
 * 여기 붙는 규칙 둘이 특히 비싸다.
 *   · **짝은 한 사람에 하나가 아니다** (ADR-24) — A–B 와 A–C 가 동시에 성립한다
 *   · **콕 상한은 이미 쓴 횟수 아래로 못 내린다** — 남은 횟수가 음수가 된다
 *
 * 재료는 `helpers/party.ts`. 파일이 커지면 나눈다 (그 파일 머리말).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type {
  EventMeta,
  ParticipantState,
} from "../src/shared/types.ts";
import { signInMaster, api, freshEvent, join, master, setPhase } from "./helpers/party.ts";

beforeAll(signInMaster);

// ─────────────────────────────────────────── 한 사람이 여러 명과 이어질 때

/**
 * 콕은 1인당 여러 번이라 A–B, A–C 가 동시에 성립한다 (ADR-24).
 * 여기서 지켜야 할 건 둘이다.
 *   · B 는 A 와 이어졌다는 것만 안다. **A 가 C 와도 이어진 건 모른다**
 *   · 쌍은 사라지지 않는다 — 짝을 하나만 들고 있으면 나중 것이 앞의 것을 덮는다
 */
describe("한 사람이 여러 명과 이어질 때", () => {
  async function triangle() {
    const ev = await freshEvent();
    const a = await join(ev, { gender: "M", nickname: "에이" });
    const b = await join(ev, { gender: "F", nickname: "비이", realName: "박비이" });
    const c = await join(ev, { gender: "F", nickname: "씨이", realName: "박씨이" });
    // 매칭은 **파티 콕만** 센다 (ADR-34)
    await setPhase(ev.id, "party");

    // A 가 둘을 찌르고, 둘 다 A 를 찌른다
    for (const target of [b, c]) {
      await api("/api/poke", { method: "POST", cookie: a.cookie, body: { toId: target.id } });
      await api("/api/poke", { method: "POST", cookie: target.cookie, body: { toId: a.id } });
    }
    return { ev, a, b, c };
  }

  it("★ 쌍이 둘 다 남는다 — 하나가 다른 하나를 덮지 않는다", async () => {
    const { ev, a, b, c } = await triangle();
    const state = await api<{ mutual: Array<[string, string]> }>(`/api/host/events/${ev.id}/state`, {
      cookie: master,
    });
    const pairs = state.body.mutual.map(([x, y]) => [x, y].sort().join("+")).sort();
    expect(pairs).toEqual([[a.id, b.id].sort().join("+"), [a.id, c.id].sort().join("+")].sort());
  });

  it("★ B 는 A 가 C 와도 이어진 걸 모른다", async () => {
    const { ev, a, b, c } = await triangle();
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    const mine = await api<ParticipantState>("/api/me", { cookie: b.cookie });
    expect(mine.body.poke.matches.length).toBe(1);
    expect(mine.body.poke.matches[0].player.id).toBe(a.id);
    // C 의 흔적이 응답 어디에도 없다
    const raw = JSON.stringify(mine.body.poke);
    expect(raw).not.toContain(c.id);
    expect(raw).not.toContain("박씨이");
  });

  it("A 에게는 둘 다 보이고, 각자의 연락처가 온다", async () => {
    const { ev, a, b, c } = await triangle();
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    const mine = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    expect(mine.body.poke.matches.map((m) => m.player.id).sort()).toEqual([b.id, c.id].sort());
    // 셋 다 `전체 공개` 로 등록했으니 번호까지 온다 (ADR-37) — 좁히는 쪽은 29 가 따로 본다
    for (const m of mine.body.poke.matches) expect(m.contact?.phone?.length).toBeGreaterThan(0);
  });

  it("★ 커플 자리에서 셋이 같은 테이블이면 두 쌍 다 성공이다", async () => {
    const { ev, a, b, c } = await triangle();
    // 한 테이블이면 A·B·C 가 모두 함께 앉는다
    const made = await api<{ seats: Array<{ playerId: string; table: number }> }>(
      `/api/host/events/${ev.id}/seating`,
      { method: "POST", cookie: master, body: { tableCount: 1, final: true } },
    );
    expect(made.status).toBe(200);
    const table = new Map(made.body.seats.map((s) => [s.playerId, s.table]));
    expect(table.get(a.id)).toBe(table.get(b.id));
    expect(table.get(a.id)).toBe(table.get(c.id));
  });
});

// ─────────────────────────────────────────── 자리 섞기

describe("자리 섞기", () => {
  it("★ 남녀 비율은 그대로 두고 사람만 바뀐다", async () => {
    const ev = await freshEvent();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      ids.push((await join(ev, { gender: i % 2 === 0 ? "M" : "F" })).id);
    }
    const made = await api<{ seats: Array<{ playerId: string; table: number }> }>(
      `/api/host/events/${ev.id}/seating`,
      { method: "POST", cookie: master, body: { tableCount: 2, final: false } },
    );
    expect(made.status).toBe(200);

    const shaped = (seats: Array<{ playerId: string; table: number }>, byGender: Map<string, string>) => {
      const out = new Map<number, { m: number; f: number }>();
      for (const s of seats) {
        const cell = out.get(s.table) ?? { m: 0, f: 0 };
        byGender.get(s.playerId) === "M" ? cell.m++ : cell.f++;
        out.set(s.table, cell);
      }
      return [...out.entries()].sort().map(([t, c]) => `${t}:${c.m}/${c.f}`).join(" ");
    };
    const genders = new Map(ids.map((id, i) => [id, i % 2 === 0 ? "M" : "F"]));
    const before = shaped(made.body.seats, genders);

    const after = await api<{ seats: Array<{ playerId: string; table: number }> }>(
      `/api/host/events/${ev.id}/seating/shuffle`,
      { method: "POST", cookie: master },
    );
    expect(after.status).toBe(200);

    // 테이블마다 남 몇·여 몇인지가 그대로다
    expect(shaped(after.body.seats, genders)).toBe(before);
    // 사람이 사라지거나 늘지 않는다
    expect(after.body.seats.map((s) => s.playerId).sort()).toEqual(ids.slice().sort());
  });

  it("★ 커플 자리에서는 이어진 쌍이 자리를 지킨다", async () => {
    // 그 배정의 목적이 쌍을 같은 테이블에 앉히는 것인데, 섞기가 흩어놓으면
    // 버튼 하나로 그 라운드가 무의미해진다 (ADR-23)
    const ev = await freshEvent();
    const men = [await join(ev, { gender: "M" }), await join(ev, { gender: "M" })];
    const women = [await join(ev, { gender: "F" }), await join(ev, { gender: "F" })];
    await setPhase(ev.id, "party");

    // 첫 남자와 첫 여자가 서로 찌른다
    await api("/api/poke", { method: "POST", cookie: men[0].cookie, body: { toId: women[0].id } });
    await api("/api/poke", { method: "POST", cookie: women[0].cookie, body: { toId: men[0].id } });

    const made = await api<{ seats: Array<{ playerId: string; table: number }> }>(
      `/api/host/events/${ev.id}/seating`,
      { method: "POST", cookie: master, body: { tableCount: 2, final: true } },
    );
    expect(made.status).toBe(200);
    const tableOf = (seats: Array<{ playerId: string; table: number }>, id: string) =>
      seats.find((s) => s.playerId === id)?.table;
    // 커플 자리는 쌍을 같은 테이블에 앉힌다
    expect(tableOf(made.body.seats, men[0].id)).toBe(tableOf(made.body.seats, women[0].id));

    // 열 번을 섞어도 쌍은 붙어 있다
    for (let i = 0; i < 10; i++) {
      const after = await api<{ seats: Array<{ playerId: string; table: number }> }>(
        `/api/host/events/${ev.id}/seating/shuffle`,
        { method: "POST", cookie: master },
      );
      expect(tableOf(after.body.seats, men[0].id)).toBe(tableOf(after.body.seats, women[0].id));
    }
  });

  it("★ 커플 자리를 확정해도 배정이 닫히지 않는다", async () => {
    // 한 번 더 자리를 바꿀 일이 있다. '다시 열기' 같은 단계를 사이에 두지 않는다
    const ev = await freshEvent();
    for (let i = 0; i < 4; i++) await join(ev, { gender: i % 2 === 0 ? "M" : "F" });

    await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2, final: true },
    });
    const published = await api(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });
    expect(published.status).toBe(200);

    // 곧바로 다시 배정할 수 있다
    const again = await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2, final: false },
    });
    expect(again.status).toBe(200);
  });

  it("만든 자리가 없으면 섞을 것도 없다", async () => {
    const ev = await freshEvent();
    const res = await api(`/api/host/events/${ev.id}/seating/shuffle`, { method: "POST", cookie: master });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────── 콕 상한

describe("콕 상한", () => {
  it("★ 이미 쓴 횟수보다 낮게 내릴 수 없다", async () => {
    const ev = await freshEvent();   // maxPre 2
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });
    const other = await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");

    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: other.id } });

    // 2회 쓴 사람이 있는데 1회로 내리면, 그 사람의 남은 횟수가 음수가 된다
    const res = await api<{ error: string; message: string }>(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { config: { maxPre: 1, maxParty: 3 } },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("2");

    // 같은 횟수나 그 위로는 된다
    const ok = await api(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { config: { maxPre: 2, maxParty: 3 } },
    });
    expect(ok.status).toBe(200);
  });

  it("★ 입장 코드는 바꿀 수 없다 — 보내와도 무시한다", async () => {
    const ev = await freshEvent();
    const res = await api<EventMeta>(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { name: "이름만 바뀐다", code: "ZZZZZZ", config: { maxPre: 2, maxParty: 3 } },
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("이름만 바뀐다");
    expect(res.body.code).toBe(ev.code);
  });

  it("★ 받은 콕은 현황 탭 순위로만 쓴다", async () => {
    // 운영자에게 아예 감췄다가(ADR-22), 현황 탭의 순위로만 되살렸다 (ADR-30).
    // 참가자 탭의 개인 행에는 여전히 넣지 않는다 — 명단을 훑으며 한 사람씩 볼 숫자가 아니다
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");
    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });

    const state = await api<{ received: Record<string, number>; prevoteRank: unknown }>(
      `/api/host/events/${ev.id}/state`,
      { cookie: master },
    );
    expect(state.body.received[her.id]).toBe(1);
    expect(state.body.received[me.id]).toBe(0);
    expect(state.body.prevoteRank).toBeTruthy();

    // 참가자에게는 여전히 남의 받은 콕이 가지 않는다
    const mine = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(JSON.stringify(mine.body.roster)).not.toContain("received");
  });
});

// ─────────────────────────────────────────── 오늘의 연애운

describe("오늘의 연애운", () => {
  it("★ 매력 투표가 시작돼야 열린다 — 미션은 파티부터", async () => {
    /*
     * 운세는 읽는 것이라 미리 열려도 잃을 게 없다. **미션은 다르다** —
     * 파티장에서만 할 수 있는 것이라 그 전에 뒤집으면 못 할 미션이 그대로 굳는다 (ADR-20 후기).
     */
    const ev = await freshEvent();
    const me = await join(ev);

    const early = await api("/api/fortune", { method: "POST", cookie: me.cookie });
    expect(early.status).toBe(409);

    await setPhase(ev.id, "prevote");
    expect((await api("/api/fortune", { method: "POST", cookie: me.cookie })).status).toBe(200);
    // 운세는 열렸지만 미션은 아직이다
    expect((await api("/api/fortune/mission", { method: "POST", cookie: me.cookie })).status).toBe(409);

    await setPhase(ev.id, "party");
    expect((await api("/api/fortune/mission", { method: "POST", cookie: me.cookie })).status).toBe(200);
  });

  it("★ 한 번 연 운세는 다시 열어도 그대로다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    const first = await api<{ headline: string; mission: string; color: string }>("/api/fortune", {
      method: "POST",
      cookie: me.cookie,
    });
    const again = await api<{ headline: string; mission: string; color: string }>("/api/fortune", {
      method: "POST",
      cookie: me.cookie,
    });
    expect(again.body).toEqual(first.body);

    // 화면을 새로 열어도 같은 것이 실려 온다
    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.fortune?.headline).toBe(first.body.headline);
  });

  it("★ 키가 없어도 화면에 들어갈 것이 다 온다", async () => {
    // 테스트 환경에는 LLM_API_KEY 가 없다. 규칙 문구로 떨어져야 한다
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    const res = await api<{ headline: string; body: string; mission?: string; fallback?: boolean }>(
      "/api/fortune",
      { method: "POST", cookie: me.cookie },
    );
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
    for (const line of [res.body.headline, res.body.body]) {
      expect(line.length).toBeGreaterThan(0);
    }
    // 오늘의 기운은 세 문단이다
    expect(res.body.body.split(/\n\s*\n/).length).toBe(3);
    // **미션은 아직 없다.** 참가자가 그 카드를 뒤집을 때 만들어진다
    expect(res.body.mission).toBeUndefined();
  });

  it("★ 미션은 뒤집을 때 만들어지고, 두 번 눌러도 같은 문장이다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");
    await api("/api/fortune", { method: "POST", cookie: me.cookie });

    type Mission = { mission: string; lead?: string };
    const first = await api<Mission>("/api/fortune/mission", { method: "POST", cookie: me.cookie });
    expect(first.status).toBe(200);
    expect(first.body.mission.length).toBeGreaterThan(0);
    // 왜 오늘 이것인지가 미션과 **함께** 온다. 미션만 오면 남이 준 숙제로 읽힌다
    expect(first.body.lead?.length).toBeGreaterThan(0);

    // 한 번 연 것은 다시 만들지 않는다 (ADR-20). 이유도 함께 잠긴다
    const again = await api<Mission>("/api/fortune/mission", { method: "POST", cookie: me.cookie });
    expect(again.body.mission).toBe(first.body.mission);
    expect(again.body.lead).toBe(first.body.lead);
  });

  it("★ 운세·미션 응답에는 실명이 없다", async () => {
    /*
     * 두 경로는 이제 `fortuneContext()` 라는 **좁은 읽기**를 쓴다 (명단·콕을 빚지 않는다).
     * 그 반환값에는 LLM 입력을 만들 실명이 들어 있다 — 라우트가 그걸 그대로 돌려주면
     * 참가자 응답에 이름이 실린다. 돌려주는 건 `Fortune` 하나여야 한다 (ADR-20).
     */
    const ev = await freshEvent();
    const me = await join(ev, { realName: "홍길동" });
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    for (const path of ["/api/fortune", "/api/fortune/mission"]) {
      const res = await api(path, { method: "POST", cookie: me.cookie });
      const body = JSON.stringify(res.body);
      expect(body, path).not.toContain("홍길동");
      expect(body, path).not.toContain(me.phone);
      expect(Object.keys(res.body as object).sort(), path).not.toContain("me");
    }
  });

  it("★ 운세를 열기 전에는 미션을 만들 수 없다 — 재료가 그 운세다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    const res = await api("/api/fortune/mission", { method: "POST", cookie: me.cookie });
    expect(res.status).toBe(409);
  });

  it("남의 운세는 볼 수 없다", async () => {
    const ev = await freshEvent();
    await join(ev);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    const res = await api("/api/fortune", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────── 되돌리기

describe("되돌리기", () => {
  it("★ 되돌려도 예약 때문에 즉시 다시 앞으로 밀리지 않는다", async () => {
    const ev = await freshEvent();

    // 사전 투표 시작을 이미 지난 시각으로 걸어둔 채, 시작했다가 등록으로 되돌린다
    const past = Date.now() - 60_000;
    const sched = await api(`/api/host/events/${ev.id}/schedule`, {
      method: "PUT",
      cookie: master,
      body: { prevoteAt: past },
    });
    expect(sched.status).toBe(200);
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "reg");

    const after = await api<EventMeta>(`/api/host/events/${ev.id}`, { cookie: master });
    // 예약 시각이 지났는데도 다시 사전 투표로 끌려가지 않는다 (ADR-2)
    expect(after.body.phase).toBe("reg");
    // 예약 값은 지우지 않는다 — 기록으로 남아야 한다
    expect(after.body.schedule.prevoteAt).toBe(past);
    expect(after.body.fired.prevote).toBeGreaterThan(0);
  });

  it("발표를 되돌리면 파티 진행으로 돌아간다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");
    await setPhase(ev.id, "party");

    const after = await api<EventMeta>(`/api/host/events/${ev.id}`, { cookie: master });
    expect(after.body.phase).toBe("party");
    // 되돌려도 "발표했었다"는 사실은 남는다
    expect(after.body.fired.done).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────── 자리가 보이는 때 (슬라이스 12)

/**
 * 운영자가 자리를 **미리 짤 수 있어야** 한다. 예전에는 짜는 순간 참가자에게 나가서,
 * 파티가 시작된 뒤에 급히 배정하게 됐다 — 피하려던 바로 그 상황이다.
 */
