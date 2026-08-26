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
import { DEFAULTS } from "../../src/shared/constants.ts";
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

  const stepAt = (n: number) =>
    createMemoryRouter([{ path: "/host/new/:step", element: <HostWizard /> }], {
      initialEntries: [`/host/new/${n}`],
    });
  const step2 = () => stepAt(2);

  beforeEach(() => stubDefaults());

  it("★ 시각 입력이 30분 단위로 열린다", async () => {
    // 라우트 정의가 있어야 :step 이 실제로 넘어온다
    render(<RouterProvider router={step2()} />);
    await screen.findByText(HOST_UI.fields.prevoteAt);

    /*
     * **2스텝에 남은 것은 예약 셋이다** (ADR-54) —
     * 매력 투표 시작 · 마감 (ADR-39) · 커플 발표 (ADR-43).
     * 파티 시작은 예약이 아니라 1스텝(기본 정보)으로 갔고, 등록 시작은 묻지 않는다 (ADR-38).
     */
    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    expect(inputs.length).toBe(3);
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
    /*
     * `voteEndBeforeH` 를 코드 기본값(1)과 **다르게** 준다 — 그 칸이 움직이는 것이
     * 곧 "응답이 반영됐다" 는 신호다. 파티 시작은 이제 1스텝이라 여기서 못 재므로,
     * **2스텝 안의 두 칸 사이**로 잰다.
     *
     * 마감 → 발표 사이는 `voteEndBeforeH + revealAfterH` 다. 반영되면 5+3 시간이어야 하고,
     * `revealAfterH` 가 `NaN` 이 되면 이 값이 `NaN` 이라 여기서 걸린다.
     */
    stubDefaults({ voteEndBeforeH: 5, revealAfterH: undefined });
    render(<RouterProvider router={step2()} />);
    await screen.findByText(HOST_UI.fields.prevoteAt);

    // **인덱스가 아니라 id 로 잡는다** — 칸 순서는 바뀔 수 있고, 이 테스트가 재는 건 순서가 아니다
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    await waitFor(() =>
      expect(new Date(val("reveal")).getTime() - new Date(val("voteEnd")).getTime()).toBe(
        (5 + DEFAULTS.revealAfterH) * 60 * 60 * 1000,
      ),
    );

    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    expect(inputs.length).toBe(3);
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
  /**
   * **2스텝의 네 시각은 시간 순으로 선다** — 매력 투표 시작 → 마감 → 파티 시작 → 커플 발표.
   * 그래야 읽는 사람이 어느 것이 먼저인지 다시 계산하지 않는다.
   *
   * ⚠️ 넷 중 **파티 시작만 예약이 아니다** (ADR-14). 그 한 줄이 **그 칸에** 붙어 있어야 한다 —
   * 목록 아래에 떠 있으면 어느 칸 이야기인지 알 수 없고, 넷 다 저절로 넘어가는 줄로 읽으면
   * 운영자가 아무것도 안 눌러서 파티가 영영 안 열린다.
   */
  it("★ 2스텝은 예약만, 시간 순으로 세운다", async () => {
    render(<RouterProvider router={step2()} />);
    await screen.findByText(HOST_UI.fields.prevoteAt);

    /*
     * ⚠️ **파티 시작이 여기 있으면 안 된다** (ADR-54). 그것만 예약이 아니라(ADR-14)
     * 예약 목록에 끼어 있으면 셋 다 저절로 넘어가는 줄로 읽히고,
     * 그러면 운영자가 아무것도 안 눌러서 파티가 영영 안 열린다.
     */
    const ids = [...document.querySelectorAll('input[type="datetime-local"]')].map((i) => i.id);
    expect(ids, "2스텝에 예약 아닌 칸이 있다").toEqual(["prevote", "voteEnd", "reveal"]);

    // 값도 그 순서대로 흘러야 한다 — 라벨만 시간 순이고 기본값이 뒤엉키면 소용없다
    const ms = ids.map((id) => new Date((document.getElementById(id) as HTMLInputElement).value).getTime());
    expect(ms, `${ms.join(" < ")} 가 시간 순이 아니다`).toEqual([...ms].sort((a, b) => a - b));

    // 시각이 아닌 칸은 여기 없다 — 장소는 1스텝으로 갔다
    expect(screen.queryByLabelText(HOST_UI.fields.place), "장소가 2스텝에 남아 있다").toBeNull();
  });

  /**
   * ★ **파티 시작은 1스텝이다** (ADR-54).
   *
   * 예약이 아니라 운영자가 누르는 것이고(ADR-14), 나머지 일정 기본값이 여기서
   * 거꾸로 계산되는 **기준점**이라 가장 먼저 정한다.
   */
  it("★ 파티 시작은 기본 정보 스텝에 있다", async () => {
    render(<RouterProvider router={stepAt(1)} />);
    await screen.findByLabelText(HOST_UI.fields.name);

    const party = document.getElementById("party") as HTMLInputElement | null;
    expect(party, "1스텝에 파티 시작이 없다").toBeTruthy();
    expect(party!.type).toBe("datetime-local");
    expect(party!.value, "파티 시작이 빈 채로 뜬다").not.toBe("");
  });

  /**
   * ★ **위저드에 설명 줄은 하나뿐이다** (ADR-54, 후기).
   *
   * 이 화면은 대부분 **기본값 그대로 `다음` 을 누르는** 자리인데 칸마다 설명이 붙어
   * 화면의 절반이 글이었다. 고른 것이 무엇을 뜻하는지는 **설정 탭에 그대로 남아 있다** —
   * 고치러 갈 때 읽으면 된다.
   *
   * 남긴 하나는 장소다. 참가자에게 보인다고 믿으면 안내문에 장소를 안 적고,
   * 그러면 아무도 어디로 갈지 모른다 — 그건 라벨이 말해주지 않는다.
   */
  it("★ 위저드에는 설명 줄이 장소 하나뿐이다", async () => {
    const hints = () => [...document.querySelectorAll(".tiny.dim")].map((e) => e.textContent);

    render(<RouterProvider router={stepAt(1)} />);
    await screen.findByLabelText(HOST_UI.fields.name);
    expect(hints(), "1스텝 설명이 장소 하나가 아니다").toEqual([HOST_UI.fields.placeHint]);
    cleanup();

    for (const step of [2, 3]) {
      render(<RouterProvider router={stepAt(step)} />);
      await screen.findByText(step === 2 ? HOST_UI.fields.prevoteAt : HOST_UI.fields.pokeTarget);
      expect(hints(), `${step}스텝에 설명 줄이 남아 있다`).toEqual([]);
      cleanup();
    }
  });

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
    // 늘 같은 곳에서 여는 모임이면 한 번 적어두고 쓴다. 회차마다 고칠 수 있다.
    // **장소는 1스텝(기본 정보)이다** — 2스텝은 시각만 다룬다
    stubDefaults({ place: "테스트 장소" });
    render(<RouterProvider router={stepAt(1)} />);

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
