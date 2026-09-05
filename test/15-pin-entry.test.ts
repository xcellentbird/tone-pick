/**
 * 슬라이스 15 — 링크는 하나, 열쇠는 번호와 PIN 번호 (ADR-75)
 *
 * 시나리오: docs/scenarios/15-pin-entry.md · 표면: docs/scenarios/15-surface.md
 *
 * ADR-32(개인별 링크)가 닫았던 구멍 — **번호를 아는 사람이 그 사람이 되는 것** — 을
 * 다른 방법으로 다시 막는다. 여기 붙는 것은 그 규칙들이 지켜지는가뿐이다. 공개 표면에만 붙인다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ENTRY } from "../src/shared/copy.ts";
import { ENTRY_TRIES, PIN as PIN_RULE } from "../src/shared/constants.ts";
import type { HostState, ParticipantState, PublicEvent, RegisterInput, RegisterResult } from "../src/shared/types.ts";
import { PIN, api, enter, freshEvent, invite, join, master, nextPhone, person, signInMaster } from "./helpers/party.ts";

beforeAll(signInMaster);

const hostState = async (eventId: string) => {
  const res = await api<HostState>(`/api/host/events/${eventId}/state`, { cookie: master });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

/** 다섯 번 틀려 잠근다. 잠긴 응답(423)이 나올 때까지 두드린다 */
async function lock(eventId: string, phone: string) {
  let last = 0;
  for (let i = 0; i < PIN_RULE.maxFails; i++) last = (await enter(eventId, phone, "0000")).status;
  expect(last).toBe(423);
}

// ─────────────────────────────────────────── A. 문

describe("A. 문", () => {
  it("S-A1 ★ 링크만으로는 아무것도 못 한다 — 회차 이름은 열리고, 그뿐이다", async () => {
    const ev = await freshEvent();
    await join(ev);

    // When  토큰 없이 회차를 연다
    const info = await api<PublicEvent & Record<string, unknown>>(`/api/events/by-id/${ev.id}`);
    // Then  회차 이름·단계·일시가 보인다
    expect(info.status, JSON.stringify(info.body)).toBe(200);
    expect(info.body.name).toBe(ev.name);
    // And   그뿐이다 — 명단도 참가자도, "이 링크의 주인" 도 없다
    const raw = JSON.stringify(info.body);
    expect(raw).not.toContain("players");
    expect(raw).not.toContain("invites");
    expect(info.body.registered).toBeUndefined();

    // And   번호 없이는 문이 안 열린다
    const gate = await api(`/api/events/${ev.id}/enter`, { method: "POST", body: {} });
    expect(gate.status).not.toBe(200);
    expect(gate.cookie).toBeNull();
  });

  it("S-A2 ★ 초대 명단에 없는 번호는 못 들어온다 — PIN 번호 칸도 열리지 않는다", async () => {
    const ev = await freshEvent();
    await invite(ev.id, nextPhone());

    const res = await enter(ev.id, "01000001111");
    expect(res.status).toBe(403);
    expect(res.cookie).toBeNull();
    expect(res.body.pin).toBeUndefined();
    expect((res.body as unknown as { message: string }).message).toBe(ENTRY.notInvited);
  });

  it("S-A3 ★ 초대된 번호 + 맞는 PIN 번호면 들어온다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    const back = await enter(ev.id, me.phone, me.pin);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.registered).toBe(true);
    expect(back.body.code).toBe(ev.code);
    expect(back.body.ref, "이 탭의 이름표가 있어야 한다").toBeTruthy();

    const state = await api<ParticipantState>(`/api/me?event=${ev.id}`, { cookie: back.cookie });
    expect(state.status).toBe(200);
    expect(state.body.me.id).toBe(me.id);
  });

  it("S-A4 ★ PIN 번호가 틀리면 못 들어온다 — 세션도 안 나간다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    const res = await enter(ev.id, me.phone, "9999");
    expect(res.status).toBe(403);
    expect(res.cookie).toBeNull();
    expect((res.body as unknown as { error: string }).error).toBe("pin_wrong");
  });

  it("S-A5 ★ 다섯 번 틀리면 잠긴다 — 시간이 지나도 안 풀린다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await lock(ev.id, me.phone);

    // 다시 두드려도 잠겨 있다. 자동으로 풀리는 길이 없다
    const again = await enter(ev.id, me.phone, "0000");
    expect(again.status).toBe(423);
    expect((again.body as unknown as { message: string }).message).toBe(ENTRY.pinLocked);

    // 운영자 눈에 `잠김` 으로 보인다 — 참가자가 말하기 전에 먼저 보는 편이 낫다
    const st = await hostState(ev.id);
    expect(st.players.find((p) => p.id === me.id)?.pin).toBe("locked");
  });

  it("S-A6 ★ 잠긴 번호는 맞는 PIN 번호로도 못 들어온다 — 잠금이 대조보다 먼저다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await lock(ev.id, me.phone);

    const right = await enter(ev.id, me.phone, me.pin);
    expect(right.status).toBe(423);
    expect(right.cookie).toBeNull();
    // 번호만 넣어도 잠겼다고 답한다 — 칸을 열어줄 이유가 없다
    const probe = await enter(ev.id, me.phone);
    expect(probe.status).toBe(423);
  });

  it("S-A7 ★ 접속지별 제한은 그대로다 — 틀린 PIN 번호도 접속지 시도로 센다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);

    // 명단에 없는 번호를 훑는다
    let blocked = 0;
    for (let i = 0; i < ENTRY_TRIES.max + 2; i++) {
      if ((await enter(ev.id, `0100000${String(2000 + i)}`)).status === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);

    // 접속지가 막혔으면 맞는 번호·PIN 번호도 429 다. 번호 단계만 세면 통과한 뒤 만 번을 두드린다
    expect((await enter(ev.id, me.phone, me.pin)).status).toBe(429);
  });

  it("S-A8 ★ 세 가지 실패는 세 가지 문구다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const msg = (r: { body: unknown }) => (r.body as { message?: string }).message;

    const noEvent = await enter("ffffffffffffffff", me.phone, me.pin);
    const noInvite = await enter(ev.id, "01000002222");
    const wrongPin = await enter(ev.id, me.phone, "9999");

    expect(noEvent.status).toBe(404);
    expect(msg(noEvent)).toBe(ENTRY.notFound);
    expect(msg(noInvite)).toBe(ENTRY.notInvited);
    expect(msg(wrongPin)).toBe(ENTRY.pinWrong(PIN_RULE.maxFails - 1));
    expect(new Set([msg(noEvent), msg(noInvite), msg(wrongPin)]).size, "셋이 갈려야 한다 — 뭉개면 번호 오타가 잠금으로 간다").toBe(3);
  });

  it("S-A8b 남은 횟수는 두 번 남았을 때부터 말한다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const msg = async () => ((await enter(ev.id, me.phone, "0000")).body as unknown as { message: string }).message;

    // 1·2회째 — 아직 세어 보이지 않는다
    const first = await msg();
    expect(first).toBe(ENTRY.pinWrong(4));
    expect(first).not.toContain("번 더");
    expect(await msg()).toBe(ENTRY.pinWrong(3));
    // 3·4회째 — 두 번 남았을 때부터 `N번 더 틀리면 잠겨요`
    const third = await msg();
    expect(third).toBe(ENTRY.pinWrong(2));
    expect(third).toContain("2번 더");
    expect(await msg()).toContain("1번 더");
  });

  it("S-A10 ★ 링크를 다시 열면 이 브라우저의 마지막 세션으로 들어간다 — 다른 회차면 아니다", async () => {
    const a = await freshEvent();
    const b = await freshEvent();
    const me = await join(a);

    // 화면이 `/j/:id` 에서 묻는 것이 이것이다 — 이 세션이 이 회차의 것인가
    expect((await api(`/api/me?event=${a.id}`, { cookie: me.cookie })).status).toBe(200);
    expect((await api(`/api/me?event=${b.id}`, { cookie: me.cookie })).status).toBe(401);
  });

  it("★ 등록한 사람은 명단에서 빠져도 번호 + PIN 번호로 들어온다 — 명단은 문이지 자격이 아니다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const out = await api(`/api/host/events/${ev.id}/invites/${me.phone}`, { method: "DELETE", cookie: master });
    expect(out.status).toBe(200);

    const back = await enter(ev.id, me.phone, me.pin);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.registered).toBe(true);
  });
});

// ─────────────────────────────────────────── B. 등록

describe("B. 등록", () => {
  it("S-B1 ★ 아직 등록 안 한 번호는 PIN 번호를 묻지 않는다 — 초대 쿠키를 주고 등록 폼으로", async () => {
    const ev = await freshEvent();
    const phone = await invite(ev.id, nextPhone());

    const probe = await enter(ev.id, phone);
    expect(probe.status, JSON.stringify(probe.body)).toBe(200);
    expect(probe.body.registered).toBe(false);
    expect(probe.body.pin).toBeUndefined();
    expect(probe.body.ref).toBeTruthy();
    expect(probe.cookie, "등록 폼을 여는 초대 쿠키").toMatch(/^tp_inv=/);
  });

  it("S-B2 ★ PIN 번호는 등록을 마쳐야 저장된다 — 중간에 나가면 아무것도 안 걸린다", async () => {
    const ev = await freshEvent();
    const phone = await invite(ev.id, nextPhone());

    // 번호 + PIN 번호를 함께 넣어도, 미등록이면 PIN 번호는 정해지지 않는다
    const first = await enter(ev.id, phone, "1111");
    expect(first.status).toBe(200);
    expect(first.body.registered).toBe(false);

    // 등록 폼에 들어갔다가 나갔다. 다시 오면 여전히 미등록이고 PIN 번호도 없다
    const again = await enter(ev.id, phone);
    expect(again.body.registered).toBe(false);
    expect(again.body.pin).toBeUndefined();
    // 운영자 명단에도 아무 일이 없다
    const st = await hostState(ev.id);
    expect(st.invites.find((i) => i.phone === phone)?.nickname).toBeUndefined();
  });

  it("S-B3 ★ PIN 번호가 숫자 4자리가 아니면 등록이 안 된다", async () => {
    const ev = await freshEvent();
    const phone = await invite(ev.id, nextPhone());
    const gate = await enter(ev.id, phone);

    for (const pin of ["12", "12345", "abcd", "", undefined]) {
      const res = await api("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: { ...person(), pin } as RegisterInput,
      });
      expect(res.status, `pin=${String(pin)}`).toBe(400);
    }
    // 아직 등록되지 않았다
    expect((await enter(ev.id, phone)).body.registered).toBe(false);
  });

  it("S-B4 ★ 등록 폼은 전화번호를 받지 않는다 — 밀어넣어도 초대 쿠키의 번호가 이긴다", async () => {
    const ev = await freshEvent();
    const mine = await invite(ev.id, nextPhone());
    const other = await invite(ev.id, nextPhone());

    const gate = await enter(ev.id, mine);
    const reg = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: { ...person(), phone: other } as RegisterInput,
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);

    const st = await hostState(ev.id);
    expect(st.invites.find((i) => i.phone === mine)?.nickname).toBe(reg.body.state.me.nickname);
    expect(st.invites.find((i) => i.phone === other)?.nickname).toBeUndefined();
  });

  it("S-B5 ★ PIN 번호 값은 어느 응답에도 없다 — 운영자 응답에도, 본인 응답에도", async () => {
    const ev = await freshEvent();
    const me = await join(ev, { pin: "7391" });

    const host = await hostState(ev.id);
    expect(JSON.stringify(host)).not.toContain("7391");
    expect(host.players.find((p) => p.id === me.id)?.pin).toBe("set");

    const mine = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(JSON.stringify(mine.body)).not.toContain("7391");
    expect(JSON.stringify(mine.body)).not.toContain("pin");
  });

  it("S-B6 ★ 세션 쿠키 어디에도 전화번호가 없다 — 번호를 쳤는데도", async () => {
    /*
     * 세션은 **서명만 하고 암호화하지 않는다** (auth.ts). 개발자 도구 Application 탭에서
     * 페이로드가 그대로 읽힌다. 번호는 회차 DO 안에서만 푼다.
     */
    const ev = await freshEvent();
    const phone = await invite(ev.id, nextPhone());
    const read = (cookie: string | null) => {
      expect(cookie).toBeTruthy();
      const value = cookie!.slice(cookie!.indexOf("=") + 1);
      return atob(value.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"));
    };

    const gate = await enter(ev.id, phone);
    expect(read(gate.cookie)).not.toContain(phone);
    const reg = await api<RegisterResult>("/api/register", { method: "POST", cookie: gate.cookie, body: person() });
    expect(reg.status).toBe(200);
    expect(read(reg.cookie)).not.toContain(phone);
    const back = await enter(ev.id, phone, PIN);
    expect(read(back.cookie)).not.toContain(phone);
  });
});

// ─────────────────────────────────────────── C. 잠금과 재설정

describe("C. 잠금과 재설정", () => {
  it("S-C1 ★ 초기화하면 잠금이 풀리고, 다음 입장에서 PIN 번호를 새로 정한다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await lock(ev.id, me.phone);

    const reset = await api(`/api/host/events/${ev.id}/players/${me.id}/pin/reset`, { method: "POST", cookie: master });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect((await hostState(ev.id)).players.find((p) => p.id === me.id)?.pin).toBe("none");

    // 번호를 넣으면 **칸 둘**을 펼 차례라고 답한다
    const probe = await enter(ev.id, me.phone);
    expect(probe.status).toBe(200);
    expect(probe.body.pin).toBe("set");

    // 옛 PIN 번호는 죽었다. 새로 정하는 첫 값이 곧 PIN 번호가 된다
    const set = await enter(ev.id, me.phone, "5555");
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.registered).toBe(true);
    expect((await enter(ev.id, me.phone, "5555")).status).toBe(200);
    expect((await enter(ev.id, me.phone, me.pin)).status).toBe(403);
    expect((await hostState(ev.id)).players.find((p) => p.id === me.id)?.pin).toBe("set");
  });

  it("S-C1b 초기화는 실패 횟수도 함께 지운다 — 안 그러면 새로 정하자마자 다시 잠긴다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await lock(ev.id, me.phone);
    await api(`/api/host/events/${ev.id}/players/${me.id}/pin/reset`, { method: "POST", cookie: master });
    await enter(ev.id, me.phone, "5555");

    // 새 PIN 번호로 한 번 틀려도 아직 네 번 남았다
    const wrong = await enter(ev.id, me.phone, "0000");
    expect(wrong.status).toBe(403);
    expect((wrong.body as unknown as { message: string }).message).toBe(ENTRY.pinWrong(PIN_RULE.maxFails - 1));
  });

  it("S-C2 ★ 초기화는 삭제가 아니다 — 같은 사람이고, 보낸 것도 자리도 그대로다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const other = await join(ev, { gender: "F" });
    await api(`/api/host/events/${ev.id}/phase`, { method: "POST", cookie: master, body: { to: "prevote" } });
    const poke = await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: other.id } });
    expect(poke.status, JSON.stringify(poke.body)).toBe(200);

    await api(`/api/host/events/${ev.id}/players/${me.id}/pin/reset`, { method: "POST", cookie: master });
    const back = await enter(ev.id, me.phone, "5555");
    const state = await api<ParticipantState>("/api/me", { cookie: back.cookie });
    expect(state.body.me.id).toBe(me.id);

    const host = await hostState(ev.id);
    expect(host.players.map((p) => p.id)).toContain(me.id);
    expect(host.sent.pre[me.id]).toBe(1);
  });

  it("S-C3 ★ 운영자도 남의 PIN 번호를 볼 수 없다 — 상태 하나뿐이다", async () => {
    const ev = await freshEvent();
    const me = await join(ev, { pin: "8642" });
    const host = await hostState(ev.id);
    const row = host.players.find((p) => p.id === me.id)!;
    expect(["set", "none", "locked"]).toContain(row.pin);
    expect(Object.keys(row).filter((k) => /pin|hash|salt/i.test(k))).toEqual(["pin"]);
    expect(JSON.stringify(host)).not.toContain("8642");
  });

  it("초기화할 사람이 없으면 404 다", async () => {
    const ev = await freshEvent();
    const res = await api(`/api/host/events/${ev.id}/players/nobody/pin/reset`, { method: "POST", cookie: master });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────── D. 안내문 · 응답 경계

describe("D. 안내문 · 응답 경계", () => {
  it("★ 명단 행에 토큰이 없다 — 참가자에게 보낼 링크가 회차마다 하나라 실을 것이 없다", async () => {
    const ev = await freshEvent();
    const phone = await invite(ev.id, nextPhone());
    const host = await hostState(ev.id);
    const row = host.invites.find((i) => i.phone === phone)!;
    expect(Object.keys(row).sort()).toEqual(["addedAt", "phone"]);
  });

  it("★ 참가자 응답 어디에도 장소가 없다", async () => {
    const place = "홍대 어느가게";
    const ev = await freshEvent();
    await api(`/api/host/events/${ev.id}`, { method: "PUT", cookie: master, body: { place } });
    const me = await join(ev);

    const info = await api<PublicEvent>(`/api/events/by-id/${ev.id}`);
    expect(JSON.stringify(info.body)).not.toContain(place);
    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(JSON.stringify(state.body)).not.toContain(place);
  });
});
