/**
 * 렌더 중에 컴포넌트가 던졌을 때의 마지막 화면.
 *
 * React 는 컴포넌트가 던지면 **트리를 통째로 걷어낸다.** 그게 하얀 화면이다 —
 * 아무것도 안 남고, 사용자는 무엇이 잘못됐는지도 다음에 뭘 해야 하는지도 모른다.
 * 경계가 있으면 그 자리에 화면을 그릴 수 있다.
 *
 * **아직 못 찾은 버그를 위한 안전망이다.** 이게 뜨는 건 우리가 놓친 것이 있다는 뜻이라,
 * 이 화면이 예쁠 필요는 없고 **다음 할 일을 말해주면 된다.**
 *
 * 라우터 **바깥**에 둔다 — 라우팅 자체가 터진 경우도 덮어야 해서다.
 * 그래서 `navigate` 를 못 쓰고 `location` 을 직접 쓴다.
 *
 * 오류 내용을 화면에 찍지 않는다. 참가자에게는 읽을 수 없는 글자이고,
 * 스택에 무엇이 섞여 나올지는 우리가 통제하지 못한다.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { FAIL } from "../../shared/copy.ts";
import type { ApiError } from "../lib/api.ts";

/**
 * 불러오지 못했을 때의 화면. **빈 화면을 남기지 않는다.**
 *
 * 운영자 콘솔이 이걸 안 쓰고 `<div className="screen" />` 을 돌려주고 있었다 —
 * 401·403 은 PIN 화면으로 되돌리지만(`useAuthRedirect`) 그 밖의 실패는 아무 데도 안 갔고,
 * **파티 중에 콘솔이 통째로 비어버렸다.** 단계도 못 넘기고 자리도 못 본다.
 */
export function LoadFailed({ error }: { error: ApiError | null }) {
  return (
    <div className="screen">
      <div className="body stack center" style={{ justifyContent: "center" }}>
        <p className="dim pre">{error?.userMessage ?? FAIL.title}</p>
        <button className="btn primary" onClick={() => location.reload()}>
          {FAIL.retry}
        </button>
      </div>
    </div>
  );
}

export default class Boom extends Component<{ children: ReactNode }, { dead: boolean }> {
  state = { dead: false };

  static getDerivedStateFromError() {
    return { dead: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 콘솔에만 남긴다. 밖으로 보내면 참가자 개인정보가 회차 DO 밖으로 나간다
    console.error("render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.dead) return this.props.children;
    return (
      <div className="screen">
        <div className="body stack center" style={{ justifyContent: "center" }}>
          <p className="pre">{FAIL.title}</p>
          <button className="btn primary" onClick={() => location.reload()}>
            {FAIL.retry}
          </button>
          {/* 파티장에는 운영자가 눈앞에 있다. 실패를 사람에게 넘길 수 있다 */}
          <p className="tiny dim">{FAIL.askHost}</p>
        </div>
      </div>
    );
  }
}
