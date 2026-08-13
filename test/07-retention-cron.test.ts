/**
 * 파기 Cron 이 실제로 도는가.
 *
 * 계산이 맞는지는 07-retention 이 본다. 여기서는 **경로가 이어져 있는지**를 본다 —
 * 하루 한 번 깨어나 회차를 훑고, 지운 뒤 입장 코드까지 사라지는가.
 */
import { SELF, env } from "cloudflare:test";
import worker from "../src/server/index.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RETENTION_DAYS } from "../src/shared/constants.ts";
import type { EventMeta } from "../src/shared/types.ts";

const DAY = 86400_000;

async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; cookie?: string | null } = {}) {
  const res = await SELF.fetch(`https://tone-pick.test${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? null };
}

let master: string | null = null;

/**
 * 시계를 앞으로 돌리면 운영자 세션(12시간)이 만료된다. 테스트가 스스로 판 함정이라
 * 매번 시계를 되돌리고 새로 로그인한다.
 */
const login = async () => {
  master = (await api("/api/host/pin", { method: "POST", body: { pin: "1234" } })).cookie;
};

beforeEach(login);
afterEach(async () => {
  await travelTo(Date.now());
});

async function makeEvent(over: Record<string, unknown> = {}) {
  const now = Date.now();
  const res = await api<EventMeta>("/api/host/events", {
    method: "POST",
    cookie: master,
    body: {
      name: "파기 대상",
      pin: String(4000 + Math.floor(Math.random() * 900)),
      regOpenAt: "now",
      voteCloseAt: now + DAY,
      config: { maxPre: 3, maxParty: 3 },
      requestId: `purge-${now}-${Math.random()}`,
      ...over,
    },
  });
  expect(res.status).toBe(200);
  return res.body;
}

/** 테스트 전용 시간 이동. 프로덕션에는 없는 라우트다 */
const travelTo = (at: number) => api("/api/__test__/now", { method: "POST", body: { at } });

/** Cron 이 깨어난 것과 같다. 핸들러를 그대로 부른다 */
const wake = () =>
  worker.scheduled({ cron: "0 19 * * *", scheduledTime: Date.now(), noRetry() {} }, env as never);

describe("파기 Cron", () => {
  it("★ 보관 기간이 지난 회차는 입장 코드까지 사라진다", async () => {
    const ev = await makeEvent();
    expect((await api(`/api/events/by-code/${ev.code}`)).status).toBe(200);

    // 아직은 지울 때가 아니다
    await wake();
    expect((await api(`/api/events/by-code/${ev.code}`)).status).toBe(200);

    // 보관 기간을 넘긴 뒤 다시 깨어나면
    await travelTo(Date.now() + (RETENTION_DAYS + 2) * DAY);
    await wake();
    await login();   // 앞으로 돌린 시계 때문에 만료된 세션을 새로 받는다

    expect((await api(`/api/events/by-code/${ev.code}`)).status).toBe(404);
    expect((await api(`/api/host/events/${ev.id}`, { cookie: master })).status).toBe(404);
  });

  it("★ 한참 뒤로 예약한 파티는 살아남는다", async () => {
    const far = Date.now() + 20 * DAY;
    const ev = await makeEvent({ regOpenAt: far, voteCloseAt: far + DAY });

    // 만든 지 오래된 것처럼 시계를 밀어도, 예약이 앞에 있으면 지우지 않는다
    await travelTo(Date.now() + (RETENTION_DAYS + 2) * DAY);
    await wake();
    expect((await api(`/api/events/by-code/${ev.code}`)).status).toBe(200);
  });
});
