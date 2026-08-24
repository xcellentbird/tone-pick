/**
 * 일정은 30분 단위로만 고른다.
 *
 * 브라우저의 `step` 은 피커만 붙잡아 준다 — 직접 타이핑한 값은 그대로 들어온다.
 * 그래서 받은 값을 코드에서 맞추고, 그게 지켜지는지 여기서 본다.
 *
 * 실제 전환 시각(`fired`)은 대상이 아니다. 그건 사람이 고른 값이 아니라 일어난 일이라서
 * 초 단위 그대로 남아야 한다.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouterProvider, createMemoryRouter } from "react-router";
import { SCHEDULE_STEP_MIN, formatCountdown, snapSchedule, toLocalInput } from "../../src/shared/time.ts";
import { HOST_UI } from "../../src/shared/copy.ts";
import { RETENTION_DAYS } from "../../src/shared/constants.ts";
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
        new Response(JSON.stringify({ maxPre: 3, maxParty: 3, regOpenBeforeD: 6, prevoteBeforeH: 24 }), {
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

  /**
   * 3스텝에서 고른 값이 **실제로 회차 생성에 실린다.**
   *
   * 칸이 화면에 있는 것과 그 값이 서버로 나가는 것은 다른 일이다. 상태에만 담고 안 보내면
   * 운영자는 골랐다고 믿는데 회차는 기본값으로 만들어지고, 파기 대기 일수는
   * **회차가 사라진 뒤에야** 어긋난 게 드러난다.
   */
  it("★ 3스텝에서 고른 콕 대상·파기 대기 일수가 회차 생성에 실린다", async () => {
    const calls: Array<{ url: string; body: { config?: Record<string, unknown> } }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
        const payload = String(url).includes("/host/defaults")
          ? { maxPre: 3, maxParty: 3, regOpenBeforeD: 6, prevoteBeforeH: 24 }
          : { id: "e1" };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const router = createMemoryRouter(
      [
        { path: "/host/new/:step", element: <HostWizard /> },
        // 만들고 나면 콘솔로 간다. 갈 곳이 없으면 라우터가 경고를 뱉는다
        { path: "/host/:id", element: <div /> },
      ],
      { initialEntries: ["/host/new/3"] },
    );
    render(<RouterProvider router={router} />);

    // 콕 대상을 '이성에게만' 으로 좁히고, 파기 대기 일수를 하루 늘린다
    fireEvent.click(await screen.findByText(HOST_UI.fields.pokeTargetOpposite));
    const retention = screen.getByText(HOST_UI.fields.retentionDays).closest(".field")!;
    fireEvent.click(within(retention as HTMLElement).getByText("+"));

    // 제목과 버튼이 같은 문구다 — 누를 것은 버튼이다
    fireEvent.click(screen.getByRole("button", { name: HOST_UI.newEvent }));

    await waitFor(() => {
      const made = calls.find((c) => c.url.includes("/host/events"));
      expect(made?.body.config).toMatchObject({
        allowSameGender: false,
        retentionDays: RETENTION_DAYS + 1,
      });
    });
  });
});

describe("카운트다운", () => {
  /** 초가 움직여야 마감이 다가오는 게 보인다. "13시간 42분"은 1분에 한 번만 바뀐다 */
  it("01:10:45 꼴로 보여준다", () => {
    expect(formatCountdown((1 * 3600 + 10 * 60 + 45) * 1000)).toBe("01:10:45");
    expect(formatCountdown(9 * 1000)).toBe("00:00:09");
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(-5000)).toBe("00:00:00");
  });

  it("24시간이 넘어도 시간으로 센다 — 날짜로 접으면 다시 계산하게 만든다", () => {
    expect(formatCountdown((37 * 3600 + 12 * 60 + 4) * 1000)).toBe("37:12:04");
  });
});
