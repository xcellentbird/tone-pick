/**
 * 토스트는 화면을 덮지 않는다 (ADR-121).
 *
 * 등록 중에 꺼진 쪽지함을 연달아 누르면 `프로필 투표가 시작되면 익명 쪽지를 쓸 수 있어요` 가 누른 만큼 쌓여
 * 참가자 화면의 절반을 덮었다 — 운영자가 폰에서 실제로 만났다.
 *
 *   · 같은 말은 한 줄이다 — 다시 누르면 새로 서고 시간을 다시 잰다
 *   · 다른 말이 몰려도 `TOAST_MAX` 줄까지다. 넘치면 가장 오래된 것이 빠진다
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { TOAST_MAX, Overlays, useOverlay } from "../../src/client/ui/Overlays.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Buttons() {
  const { toast } = useOverlay();
  return (
    <>
      <button onClick={() => toast("같은 말")}>same</button>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} onClick={() => toast(`말 ${n}`)}>
          {`other ${n}`}
        </button>
      ))}
    </>
  );
}

function mount() {
  return render(
    <MemoryRouter>
      <Overlays>
        <Buttons />
      </Overlays>
    </MemoryRouter>,
  );
}

const toasts = () => [...document.querySelectorAll(".toast")].map((el) => el.textContent);

describe("토스트는 화면을 덮지 않는다 (ADR-121)", () => {
  it("★ 같은 말을 아홉 번 눌러도 한 줄이다", () => {
    const { getByText } = mount();
    for (let i = 0; i < 9; i++) fireEvent.click(getByText("same"));
    expect(toasts()).toEqual(["같은 말"]);
  });

  it("★ 다시 누르면 시간을 다시 잰다 — 누른 것이 닿았다는 표시가 남는다", () => {
    vi.useFakeTimers();
    const { getByText } = mount();
    fireEvent.click(getByText("same"));
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(getByText("same"));
    act(() => vi.advanceTimersByTime(2000));
    expect(toasts(), "앞 것의 타이머가 새로 선 줄을 걷었다").toEqual(["같은 말"]);
    act(() => vi.advanceTimersByTime(1000));
    expect(toasts()).toEqual([]);
  });

  it(`★ 다른 말이 몰려도 ${TOAST_MAX}줄까지다 — 가장 오래된 것이 빠진다`, () => {
    const { getByText } = mount();
    for (const n of [1, 2, 3, 4, 5]) fireEvent.click(getByText(`other ${n}`));
    expect(toasts()).toEqual(["말 3", "말 4", "말 5"].slice(-TOAST_MAX));
  });
});
