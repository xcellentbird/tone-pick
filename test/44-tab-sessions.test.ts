/**
 * 탭마다 다른 참가자 (ADR-44).
 *
 * 개인 링크는 사람마다 다른데(ADR-32) **세션은 브라우저에 하나뿐이었다.** 쿠키가 탭이 아니라
 * 브라우저 단위라, 두 번째 탭에서 다른 사람의 링크를 열면 **첫 번째 탭이 조용히 그 사람이 됐다.**
 * 링크를 아무리 잘 나눠도 소용이 없었다.
 *
 * 그래서 쿠키를 사람마다 따로 두고(`tp_play_<이름표>`), 요청이 `x-tp-ref` 로 어느 것을 읽을지
 * 고른다. 이 파일이 지키는 것은 셋이다 —
 *   · 한 브라우저에서 탭 둘이 서로 다른 참가자로 **동시에** 산다
 *   · 나중 탭이 먼저 탭을 **덮지 않는다**
 *   · **이름표는 비밀이 아니다** — 그것만으로는 아무 문도 열리지 않는다
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { EventMeta, ParticipantState, RegisterResult } from "../src/shared/types.ts";
import { api, enter, invite, join, nextPhone, person, signInMaster } from "./helpers/party.ts";
import { freshEvent } from "./helpers/party.ts";

beforeAll(signInMaster);

/**
 * 브라우저 하나의 쿠키 항아리. **탭이 갈려도 항아리는 하나다** —
 * 그게 이 문제의 전부이고, 그래서 이름표로 어느 세션을 읽을지 고른다.
 */
function jar() {
  const store = new Map<string, string>();
  return {
    take(res: { setCookies: string[] }) {
      for (const pair of res.setCookies) {
        const at = pair.indexOf("=");
        const [name, value] = [pair.slice(0, at), pair.slice(at + 1)];
        if (value) store.set(name, value);
        else store.delete(name);
      }
    },
    get header() {
      return [...store].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    names: () => [...store.keys()],
  };
}

type Jar = ReturnType<typeof jar>;

/** 한 탭이 링크를 열고 등록까지 마친다. 실제 참가자가 지나는 길 그대로다 */
async function tabJoin(ev: EventMeta, box: Jar, nickname: string) {
  const token = await invite(ev.id, nextPhone());
  const gate = await api<{ registered: boolean; code?: string; ref: string }>(
    `/api/events/${ev.id}/enter`,
    { method: "POST", cookie: box.header, body: { token } },
  );
  expect(gate.status, JSON.stringify(gate.body)).toBe(200);
  expect(gate.body.ref, "입장 응답에 이름표가 있어야 한다").toBeTruthy();
  box.take(gate);

  const done = await api<RegisterResult>("/api/register", {
    method: "POST",
    cookie: box.header,
    ref: gate.body.ref,
    body: person({ nickname }),
  });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  box.take(done);
  return { ref: gate.body.ref, id: done.body.state.me.id, token };
}

describe("탭마다 다른 참가자", () => {
  it("★ 한 브라우저에서 탭 둘이 서로 다른 참가자로 산다", async () => {
    const ev = await freshEvent();
    const box = jar();

    const one = await tabJoin(ev, box, "첫째탭");
    const two = await tabJoin(ev, box, "둘째탭");
    expect(one.ref).not.toBe(two.ref);

    const asOne = await api<ParticipantState>("/api/me", { cookie: box.header, ref: one.ref });
    const asTwo = await api<ParticipantState>("/api/me", { cookie: box.header, ref: two.ref });
    expect(asOne.status).toBe(200);
    expect(asTwo.status).toBe(200);
    expect(asOne.body.me.id).toBe(one.id);
    expect(asTwo.body.me.id).toBe(two.id);
    expect(asOne.body.me.nickname).toBe("첫째탭");
    expect(asTwo.body.me.nickname).toBe("둘째탭");
  });

  /**
   * **이게 실제로 겪은 증상이다.** 두 번째 링크를 여는 순간 첫 번째 탭이 그 사람이 됐고,
   * 주소창이 `/e/<코드>` 로 바뀌면서 남의 화면이 떴다.
   */
  it("★ 나중 탭이 먼저 탭의 세션을 덮지 않는다", async () => {
    const ev = await freshEvent();
    const box = jar();
    const one = await tabJoin(ev, box, "안덮여요");
    await tabJoin(ev, box, "나중사람");

    const still = await api<ParticipantState>("/api/me", { cookie: box.header, ref: one.ref });
    expect(still.status).toBe(200);
    expect(still.body.me.nickname).toBe("안덮여요");
  });

  /** 등록 전(초대 세션)에도 갈려 있어야 한다 — 두 탭이 나란히 등록 폼을 채운다 */
  it("★ 아직 등록하지 않은 두 탭도 서로 다른 사람으로 등록된다", async () => {
    const ev = await freshEvent();
    const box = jar();

    const a = await enterTab(ev, box);
    const b = await enterTab(ev, box);
    expect(a.ref).not.toBe(b.ref);

    // 두 초대 세션이 함께 살아 있다. 먼저 연 탭이 나중 탭에 밀리지 않는다
    const first = await register(box, a.ref, "먼저채운탭");
    const second = await register(box, b.ref, "나중채운탭");
    expect(first.body.state.me.nickname).toBe("먼저채운탭");
    expect(second.body.state.me.nickname).toBe("나중채운탭");
    expect(first.body.state.me.id).not.toBe(second.body.state.me.id);
  });

  it("이름표 없이 오면 마지막으로 들어온 사람이다 — 링크를 닫고 앱 주소만 연 사람의 길", async () => {
    const ev = await freshEvent();
    const box = jar();
    await tabJoin(ev, box, "앞사람");
    const last = await tabJoin(ev, box, "마지막사람");

    const plain = await api<ParticipantState>("/api/me", { cookie: box.header });
    expect(plain.status).toBe(200);
    expect(plain.body.me.id).toBe(last.id);
  });

  // ─────────────────────── 이름표는 비밀이 아니다

  /**
   * ★ 이름표는 **어느 쿠키를 읽을지 고르는 값**일 뿐이다.
   * 남의 이름표를 알아도 그 HttpOnly 쿠키가 없으면 그 사람으로 살 수 없다.
   */
  it("★ 이름표만 알고 쿠키가 없으면 들어갈 수 없다", async () => {
    const ev = await freshEvent();
    const box = jar();
    const one = await tabJoin(ev, box, "훔쳐볼사람");

    const naked = await api<ParticipantState>("/api/me", { ref: one.ref });
    expect(naked.status).toBe(401);
  });

  /** 아무 이름표나 적어 보내도 **남의 세션으로 떨어지지 않는다** */
  it("★ 이상한 이름표는 기본 세션으로 되돌아갈 뿐이다", async () => {
    const ev = await freshEvent();
    const box = jar();
    const only = await tabJoin(ev, box, "정상세션");

    for (const junk of ["../tp_play", "; Path=/", "ZZZZ", "", "0".repeat(64)]) {
      const res = await api<ParticipantState>("/api/me", { cookie: box.header, ref: junk });
      // 기본 세션(마지막으로 들어온 사람)이 나오거나 401 이다. 남의 것이 나오지는 않는다
      if (res.status === 200) expect(res.body.me.id).toBe(only.id);
    }
  });

  /** 쿠키 이름에 붙는 값이라, 걸러내지 않으면 `;` 하나로 남의 속성을 붙일 수 있다 */
  it("★ 이름표로 쿠키 속성을 밀어 넣을 수 없다", async () => {
    const ev = await freshEvent();
    const token = await invite(ev.id, nextPhone());
    const res = await api(`/api/events/${ev.id}/enter`, {
      method: "POST",
      ref: "abcd; Domain=evil.test",
      body: { token },
    });
    for (const c of res.setCookies) expect(c).not.toContain("evil.test");
  });

  // ─────────────────────── 입장 응답

  it("★ 입장 응답에 이름표는 있고, 번호와 참가자 아이디는 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const back = await enter(ev.id, me.token);

    const raw = JSON.stringify(back.body);
    expect(raw).toContain("ref");
    expect(raw).not.toContain(me.phone);
    expect(raw).not.toContain(me.id);
  });

  /** 기본 쿠키가 함께 나가야 링크를 닫고 앱 주소만 연 사람이 로그인을 잃지 않는다 */
  it("★ 세션 쿠키는 이름표 붙은 것과 기본, 두 벌이 나간다", async () => {
    const ev = await freshEvent();
    const box = jar();
    await tabJoin(ev, box, "두벌확인");

    const names = box.names();
    expect(names).toContain("tp_play");
    expect(names.some((n) => /^tp_play_[0-9a-f]+$/.test(n))).toBe(true);
  });

  async function enterTab(ev: EventMeta, box: Jar) {
    const token = await invite(ev.id, nextPhone());
    const gate = await api<{ ref: string }>(`/api/events/${ev.id}/enter`, {
      method: "POST",
      cookie: box.header,
      body: { token },
    });
    expect(gate.status, JSON.stringify(gate.body)).toBe(200);
    box.take(gate);
    return { ref: gate.body.ref };
  }

  async function register(box: Jar, ref: string, nickname: string) {
    const res = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: box.header,
      ref,
      body: person({ nickname }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    box.take(res);
    return res;
  }
});
