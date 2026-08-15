/**
 * 개인정보 파기.
 *
 * 참가자에게 실명과 전화번호를 받아놓고 언제까지 들고 있을지 정하지 않는 건 그 자체가 사고다.
 * 보관 기간이 지나면 회차를 통째로 지운다 — 회차 1개 = DO 1개라서 지울 것이 한 곳에 다 있다.
 *
 * 여기서 가장 중요한 건 **지우면 안 되는 것을 지우지 않는가**다.
 * 3주 뒤로 예약한 파티가 파티 전에 사라지면 그날 현장에서 알게 된다.
 */
import { describe, expect, it } from "vitest";
import { purgeDueAt } from "../src/shared/phase.ts";
import { RETENTION_DAYS } from "../src/shared/constants.ts";
import type { EventMeta } from "../src/shared/types.ts";

const DAY = 86400_000;
const NOW = Date.UTC(2026, 7, 13, 3, 0, 0);

type Lifecycle = Pick<EventMeta, "createdAt" | "fired" | "schedule">;

const event = (over: Partial<Lifecycle> = {}): Lifecycle => ({
  createdAt: NOW,
  fired: {},
  schedule: {},
  ...over,
});

const expired = (ev: Lifecycle, at: number) => at >= purgeDueAt(ev, RETENTION_DAYS);

describe("지워도 되는 때", () => {
  it("발표까지 끝나고 보관 기간이 지나면 지운다", () => {
    const ev = event({
      createdAt: NOW - 10 * DAY,
      fired: { reg: NOW - 9 * DAY, prevote: NOW - 8 * DAY, party: NOW - 8 * DAY, done: NOW - 8 * DAY },
      schedule: { regOpenAt: NOW - 9 * DAY, prevoteAt: NOW - 8 * DAY },
    });
    expect(expired(ev, NOW)).toBe(true);
  });

  it("발표 직후에는 지우지 않는다 — 참가자가 결과를 다시 본다", () => {
    const ev = event({
      createdAt: NOW - 2 * DAY,
      fired: { reg: NOW - DAY, done: NOW - DAY },
      schedule: { regOpenAt: NOW - DAY },
    });
    expect(expired(ev, NOW)).toBe(false);
    // 7일째 되는 날 지워진다
    expect(expired(ev, NOW + RETENTION_DAYS * DAY)).toBe(true);
  });
});

describe("지우면 안 되는 것", () => {
  it("★ 한참 뒤로 예약한 파티는 만든 지 오래돼도 남는다", () => {
    // 3주 뒤 파티를 오늘 만들었다. 만든 날만 보면 파티 전에 지워진다
    const ev = event({
      createdAt: NOW - 30 * DAY,
      fired: {},
      schedule: { regOpenAt: NOW + 20 * DAY, prevoteAt: NOW + 21 * DAY },
    });
    expect(expired(ev, NOW)).toBe(false);
    // 파티 당일에도 남아 있다
    expect(expired(ev, NOW + 21 * DAY)).toBe(false);
    // 끝나고 보관 기간이 지나야 지워진다
    expect(expired(ev, NOW + 21 * DAY + RETENTION_DAYS * DAY)).toBe(true);
  });

  it("★ 오늘 진행 중인 파티는 절대 지우지 않는다", () => {
    const ev = event({
      createdAt: NOW - DAY,
      fired: { reg: NOW - 2 * 3600_000, prevote: NOW - 3600_000 },
      schedule: { regOpenAt: NOW - 2 * 3600_000, partyAt: NOW + 3600_000 },
    });
    expect(expired(ev, NOW)).toBe(false);
  });

  it("발표를 되돌려 다시 진행 중이면 그 시각부터 다시 센다", () => {
    const ev = event({
      createdAt: NOW - 8 * DAY,
      // 되돌려도 fired.done 은 남는다 (ADR-2). 그래도 기준은 가장 나중 시각이다
      fired: { reg: NOW - 8 * DAY, done: NOW - 8 * DAY, party: NOW - 3600_000 },
      schedule: {},
    });
    expect(expired(ev, NOW)).toBe(false);
  });
});

describe("기준 시각", () => {
  it("가장 나중 자국을 기준으로 센다", () => {
    const ev = event({
      createdAt: NOW - 5 * DAY,
      fired: { reg: NOW - 4 * DAY },
      schedule: { partyAt: NOW - DAY },
    });
    expect(purgeDueAt(ev, RETENTION_DAYS)).toBe(NOW - DAY + RETENTION_DAYS * DAY);
  });

  it("아무 자국이 없어도 만든 날로는 잰다", () => {
    expect(purgeDueAt(event(), RETENTION_DAYS)).toBe(NOW + RETENTION_DAYS * DAY);
  });
});
