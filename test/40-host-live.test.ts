/**
 * 운영자 콘솔은 참가자가 한 일도 실시간으로 받는다 (ADR-107).
 *
 * 콕, 되돌리기, 자리 이동 확인, PIN 번호 — 참가자가 한 일인데 운영자 화면의 숫자만 바꾸는 것들이
 * 운영자에게 신호를 안 보내서, 운영자는 새로고침을 눌러야 현황을 봤다.
 *
 * **신호는 로그인한 운영자 소켓에만 간다.** 회차 코드만 알면 누구나 소켓을 열 수 있고,
 * 콕 신호가 그런 소켓에 가면 *방금 누가 찔렀다* 는 시점이 샌다 — 파티장에서 누가 폰을 만졌는지와 맞추면
 * 보낸 사람이 좁혀진다. 그래서 운영자 콘솔은 `?host=1` 로 스스로 밝히고 운영자 쿠키로 증명한다.
 *
 * 재료는 `helpers/party.ts`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { signInMaster, api, enter, freshEvent, join, listen, master, setPhase, settle, PIN } from "./helpers/party.ts";

beforeAll(signInMaster);

const poke = (cookie: string | null, toId: string) => api("/api/poke", { method: "POST", cookie, body: { toId } });
const unpoke = (cookie: string | null, toId: string) => api("/api/unpoke", { method: "POST", cookie, body: { toId } });
const types = (got: string[]) => got.map((m) => (JSON.parse(m) as { type: string }).type);

async function prevote() {
  const ev = await freshEvent();
  const m = await join(ev, { gender: "M" });
  const w = await join(ev, { gender: "F" });
  const x = await join(ev, { gender: "F" });
  await setPhase(ev.id, "prevote");
  return { ev, m, w, x };
}

describe("운영자 콘솔은 참가자가 한 일을 실시간으로 받는다", () => {
  it("★ 콕을 찌르고 되돌리면 운영자 소켓이 신호를 받는다", async () => {
    const { ev, m, w } = await prevote();
    const host = await listen(ev, { cookie: master, host: true });
    await settle();

    expect((await poke(m.cookie, w.id)).status).toBe(200);
    await settle();
    expect(types(host), "콕을 찔렀는데 운영자에게 신호가 안 갔다").toContain("counts");

    const seen = host.length;
    expect((await unpoke(m.cookie, w.id)).status).toBe(200);
    await settle();
    expect(host.length, "되돌렸는데 운영자에게 신호가 안 갔다").toBeGreaterThan(seen);
  });

  it("★ 로그인한 운영자 소켓이 아니면 콕 신호를 받지 않는다 — 찌른 시점이 새지 않는다", async () => {
    const { ev, m, w, x } = await prevote();
    const socks = {
      "회차 코드만 아는 사람": await listen(ev),
      "운영자라고 밝혔지만 쿠키가 없다": await listen(ev, { host: true }),
      "헤더를 속였다": await listen(ev, { host: true, headers: { "x-host": "1" } }),
      "다른 참가자": await listen(ev, { cookie: x.cookie }),
      "운영자라고 밝힌 참가자": await listen(ev, { cookie: x.cookie, host: true }),
    };
    await settle();

    await poke(m.cookie, w.id);
    await settle();
    for (const [who, got] of Object.entries(socks)) expect(got, who).toEqual([]);
  });

  it("★ 운영자 쿠키가 있어도 밝히지 않은 소켓은 운영자 신호를 받지 않는다", async () => {
    /*
     * 스테이지의 참가자 틀은 운영자 틀과 **쿠키를 같이 쓴다** (한 탭, 한 도메인). 쿠키만 보고 운영자로 치면
     * 참가자 틀이 콕마다 전부 다시 읽는다 — 참가자 화면은 신호가 오면 무엇이든 다시 읽는다.
     */
    const { ev, m, w } = await prevote();
    const tab = await listen(ev, { cookie: master });
    await settle();
    await poke(m.cookie, w.id);
    await settle();
    expect(types(tab)).not.toContain("counts");
  });

  it("★ 자리 이동 확인도 운영자에게 간다", async () => {
    const { ev, m } = await prevote();
    await api(`/api/host/events/${ev.id}/seating`, { method: "POST", cookie: master, body: { tableCount: 1 } });
    await api(`/api/host/events/${ev.id}/seating/publish`, { method: "POST", cookie: master });
    const host = await listen(ev, { cookie: master, host: true });
    await settle();

    expect((await api("/api/seat/ack", { method: "POST", cookie: m.cookie, body: { round: 1 } })).status).toBe(200);
    await settle();
    expect(types(host), "자리 이동 확인이 운영자에게 안 갔다").toContain("counts");
  });

  it("★ PIN 번호가 잠기거나 새로 정해지면 운영자에게 간다", async () => {
    const { ev, m } = await prevote();
    const host = await listen(ev, { cookie: master, host: true });
    await settle();

    // 다섯 번 틀려 잠긴다 — 운영자 명단의 `잠김` 이 바뀐다
    // 테스트 참가자의 PIN 번호는 `PIN`(2468)이다 — 0000 은 늘 틀린다
    for (let i = 0; i < 5; i++) await enter(ev.id, m.phone, "0000");
    await settle();
    expect(types(host), "잠겼는데 운영자에게 신호가 안 갔다").toContain("counts");

    // 운영자가 초기화하고, 참가자가 다음 입장에서 새로 정한다 — `안 정함` 이 `정함` 으로 바뀐다
    await api(`/api/host/events/${ev.id}/players/${m.id}/pin/reset`, { method: "POST", cookie: master });
    await settle();
    const seen = host.length;
    expect((await enter(ev.id, m.phone, PIN)).status).toBe(200);
    await settle();
    expect(host.length, "PIN 번호를 새로 정했는데 운영자에게 신호가 안 갔다").toBeGreaterThan(seen);
  });
});
