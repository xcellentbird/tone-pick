import { useEffect } from "react";
import { useBlocker, useNavigate } from "react-router";

/**
 * 확인 다이얼로그는 실행 **전에** 히스토리를 정리해야 한다.
 * 안 그러면 실행 후 뒤로 가기를 눌렀을 때 이미 처리된 다이얼로그가 다시 뜬다.
 */
export function useConfirmRunner() {
  const navigate = useNavigate();
  return async function confirmAndRun(action: () => Promise<void> | void) {
    navigate(-1);
    await action();
  };
}

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
    if (window.confirm("작성 중인 내용이 사라집니다. 나갈까요?")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
}
