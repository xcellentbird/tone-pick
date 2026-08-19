/**
 * 소프트 키보드가 가린 높이를 CSS 변수 `--kb` 로 내보낸다.
 *
 * **왜 필요한가** — `position: fixed; bottom: 0` 은 **레이아웃 뷰포트** 기준이다.
 * 키보드가 올라와도 레이아웃 뷰포트는 그대로라서, 아래에 붙은 시트가 키보드 뒤로 들어간다.
 * 운영자가 입장 명단에 번호를 넣을 때 입력칸이 통째로 가려지던 게 이것이다.
 *
 * **왜 CSS 만으로 안 되나** — 안드로이드 크롬은 뷰포트 메타의 `interactive-widget=resizes-content`
 * 로 레이아웃 뷰포트 자체가 줄어 `dvh` 와 `bottom` 이 따라온다. 하지만 **iOS 사파리는 그 속성을
 * 모른다** — 거기서는 시각 뷰포트(visualViewport)만 줄어들고 레이아웃은 그대로다.
 * 그래서 두 가지를 함께 쓴다: 메타로 되는 곳은 메타가, 안 되는 곳은 이 값이 맡는다.
 *
 * 둘이 겹쳐 두 번 밀지는 않는다 — 레이아웃이 줄어든 브라우저에서는 `innerHeight` 도 함께 줄어
 * 아래 계산이 자연히 0 에 가까워진다.
 */
import { useEffect } from "react";

/** 1px 미만의 떨림으로 매번 다시 그리지 않는다 */
const round = (n: number) => Math.max(0, Math.round(n));

export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    // 오래된 브라우저에는 없다. 그때는 키보드가 가리는 채로 두되 화면이 죽지는 않는다
    if (!vv) return;

    const apply = () => {
      /*
       * 아래쪽으로 가려진 높이. `offsetTop` 을 빼는 이유 —
       * iOS 는 키보드가 뜰 때 시각 뷰포트를 위로 밀어 올리기도 하는데,
       * 그만큼은 이미 화면이 스크롤된 것이라 두 번 세면 시트가 필요 이상으로 뜬다.
       */
      const hidden = window.innerHeight - vv.height - vv.offsetTop;
      document.documentElement.style.setProperty("--kb", `${round(hidden)}px`);
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--kb");
    };
  }, []);
}
