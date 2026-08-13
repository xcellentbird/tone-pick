/**
 * 일정은 30분 단위로만 고른다.
 *
 * 브라우저의 `step` 은 피커만 붙잡아 준다 — 직접 타이핑한 값은 그대로 들어온다.
 * 그래서 받은 값을 코드에서 맞추고, 그게 지켜지는지 여기서 본다.
 *
 * 실제 전환 시각(`fired`)은 대상이 아니다. 그건 사람이 고른 값이 아니라 일어난 일이라서
 * 초 단위 그대로 남아야 한다.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { SCHEDULE_STEP_MIN, snapSchedule, toLocalInput } from "../../src/shared/time.ts";
import { HOST_UI } from "../../src/shared/copy.ts";
import HostWizard from "../../src/client/routes/host/HostWizard.tsx";

afterEach(cleanup);

const MIN = 60_000;
const at = (hhmm: string) => new Date(`2026-08-20T${hhmm}:00`).getTime();

describe("30분 단위로 맞추기", () => {
  it("가까운 쪽으로 붙인다", () => {
    expect(toLocalInput(snapSchedule(at("21:07")))).toBe(toLocalInput(at("21:00")));
    expect(toLocalInput(snapSchedule(at("21:16")))).toBe(toLocalInput(at("21:30")));
    expect(toLocalInput(snapSchedule(at("21:44")))).toBe(toLocalInput(at("21:30")));
    expect(toLocalInput(snapSchedule(at("21:52")))).toBe(toLocalInput(at("22:00")));
  });

  it("이미 맞은 값은 그대로 둔다", () => {
    for (const t of ["21:00", "21:30", "00:00"]) {
      expect(snapSchedule(at(t))).toBe(at(t));
    }
  });

  it("★ 올림은 뒤로만 간다 — '1시간 뒤'가 55분 뒤가 되면 안 된다", () => {
    const base = at("20:05");
    expect(snapSchedule(base + 60 * MIN, "up")).toBe(at("21:30"));
    expect(snapSchedule(base + 60 * MIN, "up")).toBeGreaterThan(base + 60 * MIN);
  });

  it("초는 버린다", () => {
    expect(snapSchedule(at("21:00") + 42_000) % (SCHEDULE_STEP_MIN * MIN)).toBe(0);
  });
});

describe("위저드", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ maxPre: 3, maxParty: 3, regOpenAfterH: 1, voteWindowH: 24 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  });

  it("★ 시각 입력이 30분 단위로 열린다", async () => {
    // 라우트 정의가 있어야 :step 이 실제로 넘어온다
    const router = createMemoryRouter([{ path: "/host/new/:step", element: <HostWizard /> }], {
      initialEntries: ["/host/new/2"],
    });
    render(<RouterProvider router={router} />);
    // '지금 바로'를 끄면 시각 입력이 나온다
    const pick = await screen.findByText(HOST_UI.pickTime);
    pick.click();

    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input.getAttribute("step")).toBe(String(SCHEDULE_STEP_MIN * 60));
      // 기본값도 맞아 있어야 한다 — 분 자리가 00 이나 30
      expect((input as HTMLInputElement).value.slice(-2)).toMatch(/^(00|30)$/);
    }
  });
});
