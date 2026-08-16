import { useEffect } from "react";
import { useBlocker } from "react-router";
import { REGISTER } from "../../shared/copy.ts";

/**
 * 등록 폼에서 뒤로 가면 입력이 전부 날아간다.
 * SPA 내부 이동에는 beforeunload 가 걸리지 않으므로 라우터 blocker 를 쓴다.
 */
export function useDraftGuard(hasDraft: boolean, prefix: string) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasDraft &&
      currentLocation.pathname.startsWith(prefix) &&
      !nextLocation.pathname.startsWith(prefix),
  );

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    // TODO: 커스텀 확인 UI 로 교체 (window.confirm 은 브라우저 모달이라 스타일이 안 맞는다)
    if (window.confirm(REGISTER.draftGuard)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
}
