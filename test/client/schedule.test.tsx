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
  function stubDefaults(over: Record<string, unknown> = {}) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ maxPre: 3, maxParty: 3, place: "", prevoteBeforeH: 24, voteEndBeforeH: 1, revealAfterH: 3, ...over }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
  }

  const step2 = () =>
    createMemoryRouter([{ path: "/host/new/:step", element: <HostWizard /> }], {
      initialEntries: ["/host/new/2"],
    });

  beforeEach(() => stubDefaults());

  it("★ 시각 입력이 30분 단위로 열린다", async () => {
    // 라우트 정의가 있어야 :step 이 실제로 넘어온다
    render(<RouterProvider router={step2()} />);
    await screen.findByText(HOST_UI.fields.partyAt);

    /*
     * 등록 시작 칸은 없어졌다 (ADR-38) — 남은 시각 입력은 넷이다:
     * 파티 일시 · 매력 투표 시작 · 매력 투표 마감 (ADR-39) · 커플 발표 (ADR-43).
     * 등록 시작 자리에는 "등록은 회차를 만들면 바로 열려요" 한 줄이 대신 선다.
     */
    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    expect(inputs.length).toBe(4);
    expect(screen.getByText(HOST_UI.regOpensNow)).toBeTruthy();
    for (const input of inputs) {
      expect(input.getAttribute("step")).toBe(String(SCHEDULE_STEP_MIN * 60));
      // 기본값도 맞아 있어야 한다 — 분 자리가 00 이나 30
      expect((input as HTMLInputElement).value.slice(-2)).toMatch(/^(00|30)$/);
    }
  });

  /**
   * 서버가 `withDefaults` 로 채워 보내지만, **새 칸이 붙은 직후에는 그렇지 않은 응답이 올 수 있다.**
   * 그때 `undefined * HOUR` 가 `NaN` 이 되고 시각 칸이 빈 채로 뜬다 — 그 빈 칸은
   * 만들기 버튼을 누를 때에야 막힌다. 위저드가 코드의 기본값으로 메워야 한다.
   */
  it("★ 기본 설정에 빠진 칸이 있어도 시각이 빈 채로 뜨지 않는다", async () => {
    /*
     * 새 칸(`revealAfterH`)이 없는 옛 응답. `prevoteBeforeH` 는 코드 기본값(20)과 **다르게** 준다 —
     * 그 칸이 바뀌는 것이 곧 "응답이 반영됐다" 는 신호다.
     *
     * ⚠️ 그냥 `waitFor` 로 값만 재면 **반영되기 전에** 통과한다 (그때는 코드 기본값이라 멀쩡하다).
     * 반영을 먼저 기다린 뒤에 재야 이 테스트가 무언가를 지킨다.
     */
    stubDefaults({ prevoteBeforeH: 48, revealAfterH: undefined });
    render(<RouterProvider router={step2()} />);
    await screen.findByText(HOST_UI.fields.partyAt);

    const at = (i: number) =>
      (document.querySelectorAll('input[type="datetime-local"]')[i] as HTMLInputElement).value;
    const party = at(0);
    // 매력 투표 시작이 파티 48시간 전으로 바뀌면 응답이 반영된 것이다
    await waitFor(() =>
      expect(new Date(party).getTime() - new Date(at(1)).getTime()).toBe(48 * 60 * 60 * 1000),
    );

    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    expect(inputs.length).toBe(4);
    for (const [i, input] of [...inputs].entries()) {
      expect((input as HTMLInputElement).value, `${i}번 칸이 비었다`).not.toBe("");
    }
  });

  /**
   * **위저드가 실제로 보내는지는 여기서만 잡힌다.**
   *
   * 서버 테스트는 API 를 직접 두드리므로 위저드가 그 값을 payload 에 안 실어도 초록이다.
   * 그런데 굳는 규칙 다섯은 **콕이 오가면 못 고친다** (ADR-35) — 만들 때가 사실상 유일한
   * 기회라, 화면에서 고른 것이 그대로 나가는지가 곧 규칙이다.
   */
  it("★ 3스텝에서 고른 규칙이 만들기 요청에 그대로 실린다", async () => {
    let sent: { config: Record<string, unknown> } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST" && String(url).includes("/host/events")) {
          sent = JSON.parse(String(init.body));
          return new Response(JSON.stringify({ id: "e1" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ maxPre: 3, maxParty: 3, place: "", prevoteBeforeH: 24, voteEndBeforeH: 1, revealAfterH: 3 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const router = createMemoryRouter([{ path: "/host/new/:step", element: <HostWizard /> }], {
      initialEntries: ["/host/new/3"],
    });
    render(<RouterProvider router={router} />);

    // 대상을 '이성에게만' 으로 좁히고, 매력 투표 알림을 켠다
    await screen.findByText(HOST_UI.fields.pokeTarget);
    fireEvent.click(screen.getByText(HOST_UI.fields.pokeTargetOpposite));
    const preRow = screen.getByText(HOST_UI.fields.preNotify).closest(".field")!;
    fireEvent.click(within(preRow as HTMLElement).getByText(HOST_UI.fields.pokeNotifyOn));

    // 머리글 h1 도 같은 말이라 버튼만 골라낸다
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === HOST_UI.newEvent)!);

    await waitFor(() => expect(sent).not.toBeNull());
    const { config } = sent!;
    expect(config.allowSameGender, "고른 대상이 안 실렸다").toBe(false);
    expect(config.preNotify, "고른 알림이 안 실렸다").toBe(true);
    // 안 건드린 것은 기본값 그대로 나간다
    expect(config.allowUndo).toBe(true);
    expect(config.pokeNotify).toBe(false);
  });

  it("★ 장소 기본값을 들고 시작한다 (ADR-38)", async () => {
    // 늘 같은 곳에서 여는 모임이면 한 번 적어두고 쓴다. 회차마다 고칠 수 있다
    stubDefaults({ place: "테스트 장소" });
    render(<RouterProvider router={step2()} />);

    const input = (await screen.findByLabelText(HOST_UI.fields.place)) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("테스트 장소"));
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
