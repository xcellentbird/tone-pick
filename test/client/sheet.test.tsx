/**
 * 시트를 끌어서 닫았을 때 — 닫히지 않고 **앞 화면으로 돌아가는** 시트.
 *
 * 자리 배정 시트는 한 시트가 주소에 따라 내용을 바꾼다 (ADR-112). 뺄 사람에서 끌어 내리면 `onClose` 가
 * `navigate(-1)` 이라 이번 배정으로 돌아갈 뿐 시트는 열린 채다. 그때 내려보낸 변형이 남아서
 * **시트가 화면 밖에 걸린 채 제목 한 줄만 보였다** — 운영자가 폰에서 실제로 만났다.
 */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sheet from "../../src/client/ui/Sheet.tsx";

/* happy-dom 은 높이를 0 으로 잰다 — 그러면 내려보낸 자리도 0 이라 걸린 시트가 제자리처럼 보인다 */
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 두 걸음짜리 시트 — 앞 걸음에서 닫으면 첫 걸음으로, 첫 걸음에서 닫으면 정말 닫힌다 */
function TwoStep() {
  const [step, setStep] = useState<"main" | "sub" | null>("sub");
  return (
    <Sheet
      open={step !== null}
      onClose={() => setStep((s) => (s === "sub" ? "main" : null))}
      title={step === "sub" ? "뺄 사람" : "자리 재배정"}
    >
      <p>{step}</p>
    </Sheet>
  );
}

const sheet = () => document.querySelector('[role="dialog"]') as HTMLElement;

/* 스크롤 잠금(react-remove-scroll)도 같은 손가락을 읽는다 — `changedTouches` 까지 채워야 한다 */
const at = (y: number) => {
  const t = [{ clientX: 0, clientY: y }];
  return { touches: t, targetTouches: t, changedTouches: t };
};

function dragDown(el: HTMLElement, by: number) {
  fireEvent.touchStart(el, at(0));
  for (let y = 10; y <= by; y += 10) fireEvent.touchMove(el, at(y));
  fireEvent.touchEnd(el, { ...at(by), touches: [], targetTouches: [] });
}

describe("시트 · 끌어서 닫기", () => {
  it("★ 끌어 내려 앞 화면으로 돌아간 시트는 제자리로 올라온다", async () => {
    render(<TwoStep />);
    const el = sheet();

    await act(async () => dragDown(el, 200));
    expect(el.textContent).toContain("main");
    expect(sheet(), "같은 시트가 열린 채다").toBe(el);

    await waitFor(() => expect(el.style.getPropertyValue("transform"), "내려보낸 변형이 남았다").toBe(""));
  });

  it("다시 끌어 내리면 정말 닫힌다", async () => {
    render(<TwoStep />);
    const el = sheet();

    await act(async () => dragDown(el, 200));
    await waitFor(() => expect(el.style.getPropertyValue("transform")).toBe(""));

    await act(async () => dragDown(el, 200));
    await waitFor(() => expect(sheet()).toBeNull());
  });
});
