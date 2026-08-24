/**
 * 슬라이스 02·09 — 참가자를 지웠을 때 · 오늘의 연애운 · 내 정보 고치기
 *
 * 지우는 일이 무엇을 데려가고 무엇을 남기는지가 여기 있다 (ADR-29) —
 * **그가 보낸 콕은 남기고 운세는 지운다.** 받은 쪽 숫자가 줄면 발신자가 드러나고,
 * 운세 문장에는 닉네임이 들어 있다.
 *
 * 재료는 `helpers/party.ts`. 파일이 커지면 나눈다 (그 파일 머리말).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ENTRY, ME, REGISTER } from "../src/shared/copy.ts";
import type {
  ParticipantState,
  Player,
  RegisterInput,
} from "../src/shared/types.ts";
import { signInMaster, api, enter, freshEvent, join, master, setPhase } from "./helpers/party.ts";

beforeAll(signInMaster);

// ─────────────────────────────────────────── 참가자를 지웠을 때

/**
 * 라운드 중에 참가자를 지우는 일이 있다. 그때 **남는 것과 사라지는 것**이 분명해야 한다.
 */
describe("참가자를 지웠을 때", () => {
  async function pair() {
    const ev = await freshEvent();
    const a = await join(ev, { gender: "M", nickname: "남을이" });
    const b = await join(ev, { gender: "F", nickname: "지워질이" });
    await setPhase(ev.id, "prevote");
    await api("/api/poke", { method: "POST", cookie: a.cookie, body: { toId: b.id } });
    await api("/api/poke", { method: "POST", cookie: b.cookie, body: { toId: a.id } });
    return { ev, a, b };
  }

  it("★ 지워진 사람에게는 '회차가 없다' 가 아니라 '참가가 취소됐다' 고 말한다", async () => {
    const { ev, b } = await pair();
    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });

    const res = await api<{ message: string }>("/api/me", { cookie: b.cookie });
    expect(res.status).toBe(404);
    // 회차는 멀쩡하다. 링크를 의심하게 만들면 운영자에게 엉뚱한 걸 묻는다
    expect(res.body.message).toBe(ENTRY.removed);
    expect(res.body.message).not.toBe(ENTRY.notFound);
  });

  it("★ 지운 사람의 운세가 남지 않는다 — 그 문장에 닉네임이 들어 있다", async () => {
    const { ev, b } = await pair();
    await setPhase(ev.id, "party");
    const made = await api<{ headline: string }>("/api/fortune", { method: "POST", cookie: b.cookie });
    expect(made.status).toBe(200);

    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });
    // 같은 번호로 다시 들어오면 새 사람이다. 앞사람의 운세를 물려받지 않는다
    const back = await enter(ev.id, b.token);
    expect(back.body.registered).toBe(false);
  });

  it("★ 명단에는 남아 있어서 같은 번호로 다시 들어올 수 있다", async () => {
    const { ev, b } = await pair();
    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });

    const back = await enter(ev.id, b.token);
    expect(back.status).toBe(200);
    expect(back.body.registered).toBe(false);   // 등록 폼부터 다시
  });

  it("명단에서도 빼면 그때는 못 들어온다", async () => {
    const { ev, b } = await pair();
    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });
    await api(`/api/host/events/${ev.id}/invites/${b.phone}`, { method: "DELETE", cookie: master });

    expect((await enter(ev.id, b.token)).status).toBe(403);
  });

  it("★ 남은 사람의 받은 콕이 줄지 않는다 — 줄면 누가 찔렀는지 드러난다", async () => {
    // 참가자 탭에서 누가 사라졌는지가 동시에 보인다.
    // 받은 콕이 함께 줄면 그 둘을 맞춰 발신자를 특정할 수 있다 (ADR-29)
    const { ev, a, b } = await pair();
    const before = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    expect(before.body.poke.received.pre + before.body.poke.received.party).toBe(1);

    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });
    const after = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    expect(after.body.poke.received.pre + after.body.poke.received.party).toBe(1);
    // 명단에서는 사라진다. 남는 건 아무것도 가리키지 않는 숫자뿐이다
    expect(after.body.roster).toEqual([]);
    expect(JSON.stringify(after.body.poke)).not.toContain(b.id);
  });

  it("★ 지운 사람에게 쓴 콕은 예산이 돌아온다", async () => {
    const { ev, a, b } = await pair();
    const before = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    expect(before.body.poke.budget.pre.used).toBe(1);

    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });
    const after = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    // 없는 사람에게 쓴 횟수를 물릴 이유가 없다
    expect(after.body.poke.budget.pre.used).toBe(0);
  });

  it("★ 운영자 화면에는 지워진 사람이 남지 않는다", async () => {
    const { ev, a, b } = await pair();
    await api(`/api/host/events/${ev.id}/players/${b.id}`, { method: "DELETE", cookie: master });

    const state = await api<{
      mutual: Array<[string, string]>;
      // 보낸 수도 라운드마다 따로다 (ADR-46) — 합치면 콕을 안 찌른 사람이 찌른 것으로 적힌다
      sent: Record<"pre" | "party", Record<string, number>>;
      pokeUsedMax: Record<string, number>;
    }>(`/api/host/events/${ev.id}/state`, { cookie: master });
    // 빈 이름의 커플이 뜨거나, 없는 사람 때문에 콕 상한이 묶이면 안 된다
    expect(state.body.mutual).toEqual([]);
    // **어느 라운드에도** 지워진 사람이 남지 않는다
    expect(Object.keys(state.body.sent.pre)).toEqual([a.id]);
    expect(Object.keys(state.body.sent.party)).toEqual([a.id]);
    expect(state.body.pokeUsedMax.pre).toBe(0);
  });

  it("★ 발행한 자리에서도 빠진다", async () => {
    const ev = await freshEvent();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await join(ev, { gender: i % 2 === 0 ? "M" : "F" })).id);
    await api(`/api/host/events/${ev.id}/seating`, {
      method: "POST", cookie: master, body: { tableCount: 2 },
    });
    await api(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });

    await api(`/api/host/events/${ev.id}/players/${ids[0]}`, { method: "DELETE", cookie: master });
    const state = await api<{ seatings: Array<{ seats: Array<{ playerId: string }> }> }>(
      `/api/host/events/${ev.id}/state`,
      { cookie: master },
    );
    const seated = state.body.seatings.flatMap((r) => r.seats.map((s) => s.playerId));
    expect(seated).not.toContain(ids[0]);
    expect(seated.length).toBe(3);
  });
});

// ─────────────────────────────────────────── 매력 고치기

/**
 * 등록 폼에서 급히 쓴 세 줄을 다듬을 시간은 준다.
 * 다만 **사전 투표가 열리면 닫힌다** (ADR-27) — 그 뒤에는 사람들이 이 세 줄을 보고 콕을 찌르고,
 * 바꾸면 누군가 나를 고른 근거가 조용히 사라진다.
 */

// ─────────────────────────────────────────── 매력 고치기

/**
 * 등록 폼에서 급히 쓴 세 줄을 다듬을 시간은 준다.
 * 다만 **사전 투표가 열리면 닫힌다** (ADR-27) — 그 뒤에는 사람들이 이 세 줄을 보고 콕을 찌르고,
 * 바꾸면 누군가 나를 고른 근거가 조용히 사라진다.
 */
describe("오늘의 연애운", () => {
  it("★ 생년월일은 운세를 여는 데만 쓰이고 어디에도 저장되지 않는다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "party");

    const opened = await api("/api/fortune", { method: "POST", cookie: me.cookie, body: { birth: "19960314" } });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    // 응답에도, 이후의 내 상태에도, 운영자 화면에도 생년월일이 없다
    expect(JSON.stringify(opened.body)).not.toContain("19960314");
    const mine = await api("/api/me", { cookie: me.cookie });
    expect(JSON.stringify(mine.body)).not.toContain("19960314");
    const host = await api(`/api/host/events/${ev.id}`, { cookie: master });
    expect(JSON.stringify(host.body)).not.toContain("19960314");

    // 한 번 연 운세는 생년월일 없이 다시 물어도 같은 것이 온다
    const again = await api("/api/fortune", { method: "POST", cookie: me.cookie, body: {} });
    expect(again.body).toEqual(opened.body);
  });

  it("달력에 없는 생년월일은 열리지 않는다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "party");
    const res = await api("/api/fortune", { method: "POST", cookie: me.cookie, body: { birth: "19960230" } });
    expect(res.status).toBe(400);
  });
});

/**
 * 내 정보 고치기 (ADR-31).
 *
 * 등록할 때 낸 것을 **사전 투표가 열리기 전까지** 스스로 고친다.
 * 고치는 길은 하나뿐이고(매력만 따로 고치지 않는다), 전화번호는 그 길에 없다.
 */

/**
 * 내 정보 고치기 (ADR-31).
 *
 * 등록할 때 낸 것을 **사전 투표가 열리기 전까지** 스스로 고친다.
 * 고치는 길은 하나뿐이고(매력만 따로 고치지 않는다), 전화번호는 그 길에 없다.
 */
describe("내 정보 고치기", () => {
  it("★ 등록 중에는 낸 것을 고칠 수 있다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    const res = await api<Player>("/api/me", {
      method: "PUT",
      cookie: me.cookie,
      body: {
        ...me.input,
        nickname: "고친닉",
        realName: "박고침",
        age: 33,
        gender: "F",
        mbti: "ISTJ",
        instagram: "fixed_id",
        charms: ["새 매력 하나", "새 매력 둘", "새 매력 셋"],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // 다시 읽어도 바뀐 채로 온다
    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.me.nickname).toBe("고친닉");
    expect(state.body.me.realName).toBe("박고침");
    expect(state.body.me.age).toBe(33);
    expect(state.body.me.gender).toBe("F");
    expect(state.body.me.mbti).toBe("ISTJ");
    expect(state.body.me.instagram).toBe("fixed_id");
    expect(state.body.me.charms).toEqual(["새 매력 하나", "새 매력 둘", "새 매력 셋"]);
  });

  it("★ 전화번호는 고칠 수 없다 — 파티의 문이라서", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    const res = await api<Player>("/api/me", {
      method: "PUT",
      cookie: me.cookie,
      body: { ...me.input, phone: "01099998888" },
    });
    expect(res.status).toBe(200);

    /*
     * 번호는 초대 명단에서 확인한 그대로다. 입력에 담아도 자리가 없다 (ADR-15).
     * **참가자 응답으로는 확인할 수 없다** — 번호가 거기 없기 때문이다 (ADR-47).
     * 그래서 운영자 쪽에서 본다. 그게 번호를 볼 수 있는 유일한 자리다 (ADR-42).
     */
    const host = await api<{ players: Player[] }>(`/api/host/events/${ev.id}/state`, { cookie: master });
    expect(host.body.players.find((p) => p.id === me.id)?.phone).toBe(me.phone);
  });

  /**
   * ★ **참가자 응답에는 전화번호가 아예 없다** (ADR-47).
   *
   * 화면에서 감추는 것과 응답에 없는 것은 다르다 — 개발자 도구를 여는 참가자가 있다.
   * 본인의 번호라 해도 참가자가 낸 값이 아니고(초대 명단에서 온다 — ADR-32),
   * 자리가 없는 것이 곧 방어다.
   */
  it("★ 참가자 응답 어디에도 전화번호가 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });

    const clean = (what: string, body: unknown) => {
      const text = JSON.stringify(body);
      expect(text, `${what} 응답에 내 번호가 있다`).not.toContain(me.phone);
      expect(text, `${what} 응답에 남의 번호가 있다`).not.toContain(her.phone);
      expect(text, `${what} 응답에 phone 키가 있다`).not.toContain('"phone"');
    };

    // 수정은 등록 중에만 열려 있다 (ADR-31) — 그 응답이 곧 내 정보라 여기서 본다
    const saved = await api<ParticipantState>("/api/me", { method: "PUT", cookie: me.cookie, body: me.input });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    clean("수정", saved.body);

    // 단계마다 담기는 것이 다르다. 발표에서는 매칭까지 열려 가장 많이 내려간다
    await setPhase(ev.id, "prevote");
    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    await setPhase(ev.id, "party");
    await api("/api/poke", { method: "POST", cookie: her.cookie, body: { toId: me.id } });

    for (const phase of ["party", "done"] as const) {
      await setPhase(ev.id, phase);
      const res = await api<ParticipantState>("/api/me", { cookie: me.cookie });
      expect(res.status).toBe(200);
      clean(phase, res.body);
    }
  });

  it("등록과 같은 검증을 지난다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    const bad: Partial<RegisterInput>[] = [
      { nickname: "" },
      { nickname: "가".repeat(16) },
      { nickname: "닉!네임" },
      { nickname: "달빛3" },
      { realName: "" },
      { realName: "김실명3" },
      { age: 17 },
      { age: 100 },
      { age: 28.5 },
      { gender: "X" as RegisterInput["gender"] },
      { mbti: "XXXX" },
      { instagram: "" },
      { instagram: "인스타" },
      { charms: ["가", "나"] as unknown as RegisterInput["charms"] },
      { charms: ["가", "나", "  "] },
      { charms: ["가", "나", "다", "라"] as unknown as RegisterInput["charms"] },
    ];
    for (const over of bad) {
      const res = await api("/api/me", { method: "PUT", cookie: me.cookie, body: { ...me.input, ...over } });
      expect(res.status, JSON.stringify(over)).toBe(400);
    }

    // 하나도 바뀌지 않았다
    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.me.nickname).toBe(me.input.nickname);
    expect(state.body.me.age).toBe(me.input.age);
  });

  it("닉네임 유일성은 고칠 때도 같다", async () => {
    const ev = await freshEvent();
    await join(ev, { nickname: "달빛" });
    const me = await join(ev, { gender: "F" });

    const res = await api<{ error: string; message: string }>("/api/me", {
      method: "PUT",
      cookie: me.cookie,
      body: { ...me.input, nickname: "달빛" },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("nick_taken");
    expect(res.body.message).toBe(REGISTER.err.nickTaken("달빛"));
  });

  it("내 닉네임을 그대로 두고 다른 것만 고칠 수 있다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    // 자기 자신과 겹쳤다고 막으면 나이 하나 고치는 데 닉네임까지 바꿔야 한다
    const res = await api("/api/me", { method: "PUT", cookie: me.cookie, body: { ...me.input, age: 30 } });
    expect(res.status).toBe(200);
  });

  it("저장은 전부 되거나 전부 안 된다", async () => {
    const ev = await freshEvent();
    await join(ev, { nickname: "먼저찜" });
    const me = await join(ev, { gender: "F" });

    const res = await api("/api/me", {
      method: "PUT",
      cookie: me.cookie,
      body: { ...me.input, nickname: "먼저찜", age: 30 },
    });
    expect(res.status).toBe(409);

    // 닉네임이 막혔으면 같이 보낸 나이도 그대로여야 한다
    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.me.age).toBe(me.input.age);
  });

  it("★ 사전 투표가 시작되면 닫힌다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await setPhase(ev.id, "prevote");

    const res = await api<{ message: string }>("/api/me", {
      method: "PUT",
      cookie: me.cookie,
      body: { ...me.input, nickname: "늦은닉" },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(ME.locked);
  });

  it("파티 중·발표 후에도 닫혀 있다", async () => {
    for (const phase of ["party", "done"]) {
      const ev = await freshEvent();
      const me = await join(ev);
      await setPhase(ev.id, phase);

      const res = await api("/api/me", { method: "PUT", cookie: me.cookie, body: { ...me.input, age: 30 } });
      expect(res.status, phase).toBe(409);
    }
  });

  it("늦게 등록한 사람에게는 처음부터 열리지 않는다", async () => {
    const ev = await freshEvent();
    await setPhase(ev.id, "party");
    // 등록은 발표 전까지 열려 있다 — 파티 중에 합류한 사람
    const late = await join(ev);

    const res = await api("/api/me", { method: "PUT", cookie: late.cookie, body: { ...late.input, age: 30 } });
    expect(res.status).toBe(409);
  });

  it("★ 세션 없이는 고칠 수 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const res = await api("/api/me", { method: "PUT", body: { ...me.input, nickname: "몰래" } });
    expect(res.status).toBe(401);
  });

  it("★ 고치는 대상은 언제나 자기 자신이다", async () => {
    const ev = await freshEvent();
    const a = await join(ev);
    const b = await join(ev, { gender: "F" });

    // 입력에 남의 id 를 담아도 대상은 쿠키에서만 온다
    const res = await api("/api/me", {
      method: "PUT",
      cookie: a.cookie,
      body: { ...a.input, id: b.id, nickname: "에이가고침" },
    });
    expect(res.status).toBe(200);

    const mine = await api<ParticipantState>("/api/me", { cookie: a.cookie });
    const hers = await api<ParticipantState>("/api/me", { cookie: b.cookie });
    expect(mine.body.me.nickname).toBe("에이가고침");
    expect(hers.body.me.nickname).toBe(b.input.nickname);
  });

  it("★ 고쳐도 공개 범위는 그대로다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F", nickname: "그녀" });

    await api("/api/me", {
      method: "PUT",
      cookie: her.cookie,
      body: { ...her.input, nickname: "고친그녀", realName: "이비밀", instagram: "secret_id" },
    });
    await setPhase(ev.id, "prevote");

    const seen = (await api<ParticipantState>("/api/me", { cookie: me.cookie })).body.roster[0];
    expect(seen.nickname).toBe("고친그녀");
    for (const leak of ["realName", "phone", "instagram", "age", "mbti"]) {
      expect(Object.keys(seen), leak).not.toContain(leak);
    }
  });
});

// ─────────────────────────────────────────── 한 사람이 여러 명과 이어질 때

/**
 * 콕은 1인당 여러 번이라 A–B, A–C 가 동시에 성립한다 (ADR-24).
 * 여기서 지켜야 할 건 둘이다.
 *   · B 는 A 와 이어졌다는 것만 안다. **A 가 C 와도 이어진 건 모른다**
 *   · 쌍은 사라지지 않는다 — 짝을 하나만 들고 있으면 나중 것이 앞의 것을 덮는다
 */
