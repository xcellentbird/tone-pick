/**
 * ADR-94 — 운영자 PIN 은 접속지마다 다섯 번까지, 세션은 일주일
 *
 * 둘은 한 몸이다. 세션을 일주일로 늘려 PIN 을 자주 안 치게 만든 대신,
 * 치는 자리를 좁혔다. 이 파일은 그 둘만 본다 — 공개 표면에만 붙는다.
 */
import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { HOST } from "../src/shared/copy.ts";
import { HOST_PIN_TRIES } from "../src/shared/constants.ts";

const ORIGIN = "https://tone-pick.test";
/** `vitest.config.ts` 가 넣어주는 값 */
const MASTER_PIN = "1234";
const WINDOW_MIN = HOST_PIN_TRIES.windowMs / 60_000;

/** `from` 은 접속지다. 헤더로 넣어야 접속지별로 센다는 것을 밖에서 잴 수 있다 */
async function login(pin: string, from: string) {
  const res = await SELF.fetch(`${ORIGIN}/api/host/pin`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": from },
    body: JSON.stringify({ pin }),
  });
  const text = await res.text();
  return {
    status: res.status,
    message: (JSON.parse(text || "{}") as { message?: string }).message,
    setCookie: res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie"),
  };
}

async function wrong(n: number, from: string) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await login("9999", from));
  return out;
}

/**
 * **테스트마다 다른 접속지를 쓴다.** 실패 기록은 이 파일 안에서 테스트를 건너 남는다 —
 * 같은 자리를 쓰면 앞 테스트가 다 써버린 횟수를 뒤 테스트가 물려받는다.
 * 접속지를 가르는 것은 편법이 아니라 이 규칙이 접속지별이라는 뜻 그대로다.
 */
let seq = 0;
const somewhere = () => `10.0.0.${++seq}`;

/** 테스트 전용 시간 이동. 끝나면 반드시 제자리로 돌린다 */
async function travelTo(at: number) {
  const res = await SELF.fetch(`${ORIGIN}/api/__test__/now`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ at }),
  });
  expect(res.status).toBe(200);
}
afterEach(() => travelTo(Date.now()));

describe("운영자 PIN 시도 제한", () => {
  it("★ 다섯 번 틀리면 그 다음은 막힌다", async () => {
    const at = somewhere();
    const tries = await wrong(HOST_PIN_TRIES.max, at);
    // 다섯 번은 전부 401 이다 — 막히는 건 그 다음부터다
    expect(tries.map((t) => t.status)).toEqual(Array(HOST_PIN_TRIES.max).fill(401));

    const blocked = await login("9999", at);
    expect(blocked.status).toBe(429);
    expect(blocked.message).toBe(HOST.pin.tooMany(WINDOW_MIN));
  });

  it("★ 막힌 뒤에는 맞는 PIN 도 열리지 않는다 — 비교까지 가면 제한이 하는 일이 없다", async () => {
    const at = somewhere();
    await wrong(HOST_PIN_TRIES.max, at);

    const right = await login(MASTER_PIN, at);
    expect(right.status).toBe(429);
    expect(right.setCookie).toBeFalsy();
  });

  it("★ 맞히면 기록이 지워진다 — 손 떨린 것을 들고 있지 않는다", async () => {
    const at = somewhere();
    await wrong(HOST_PIN_TRIES.max - 1, at);
    expect((await login(MASTER_PIN, at)).status).toBe(200);

    // 다시 네 번 틀려도 막히지 않는다. 앞의 실패가 남아 있었다면 여기서 429 가 난다
    const again = await wrong(HOST_PIN_TRIES.max - 1, at);
    expect(again.every((t) => t.status === 401)).toBe(true);
  });

  it("★ 창이 지나면 저절로 풀린다 — 운영자 위에는 잠금을 풀어줄 사람이 없다", async () => {
    const at = somewhere();
    await wrong(HOST_PIN_TRIES.max, at);
    expect((await login(MASTER_PIN, at)).status).toBe(429);

    await travelTo(Date.now() + HOST_PIN_TRIES.windowMs + 60_000);
    expect((await login(MASTER_PIN, at)).status).toBe(200);
  });

  it("★ 접속지마다 따로 센다 — 한 사람이 두드렸다고 운영자가 잠기면 안 된다", async () => {
    const attacker = somewhere();
    await wrong(HOST_PIN_TRIES.max, attacker);
    expect((await login("9999", attacker)).status).toBe(429);

    // 운영자는 다른 자리에서 들어온다
    expect((await login(MASTER_PIN, somewhere())).status).toBe(200);
  });

  it("남은 횟수는 얼마 안 남았을 때만 말한다", async () => {
    const tries = await wrong(HOST_PIN_TRIES.max, somewhere());
    // 앞쪽은 숫자를 세어 보이지 않는다
    expect(tries[0].message).toBe(HOST.pin.wrong);
    // 남은 게 둘일 때부터 센다
    expect(tries[HOST_PIN_TRIES.max - 1 - HOST_PIN_TRIES.warnAt].message).toBe(
      HOST.pin.wrongLeft(HOST_PIN_TRIES.warnAt),
    );
    // 다 쓴 마지막 한 번은 `0번 더 틀리면` 이 아니라 이미 막혔다고 말한다
    expect(tries[HOST_PIN_TRIES.max - 1].message).toBe(HOST.pin.tooMany(WINDOW_MIN));
    expect(tries[HOST_PIN_TRIES.max - 1].status).toBe(401);
    // 응답 어디에도 올바른 PIN 이 없다
    expect(JSON.stringify(tries)).not.toContain(MASTER_PIN);
  });
});

describe("운영자 세션", () => {
  it("★ 일주일 간다 — 회차를 만든 날과 파티 당일 사이에 다시 로그인하지 않는다", async () => {
    const res = await login(MASTER_PIN, somewhere());
    expect(res.status).toBe(200);

    const maxAge = Number(/Max-Age=(\d+)/.exec(res.setCookie ?? "")?.[1]);
    expect(maxAge).toBe(7 * 24 * 3600);
    // 훔친 쿠키가 오래 사는 것이 대가다. 그래서 HttpOnly 는 그대로여야 한다
    expect(res.setCookie).toContain("HttpOnly");
  });
});
