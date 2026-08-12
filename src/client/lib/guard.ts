import { useEffect } from "react";
import { useNavigate } from "react-router";
import type { ApiError } from "./api.ts";

/**
 * 세션이 없거나(401) 권한 밖(403)이면 PIN 화면으로 되돌린다.
 * 회차 PIN 보유자가 회차 목록에 닿으면 자기 회차로 돌아가는 것도 같은 규칙이다 (FLOWS.md).
 */
export function useAuthRedirect(error: ApiError | null, to = "/host") {
  const navigate = useNavigate();
  useEffect(() => {
    if (error && (error.status === 401 || error.status === 403)) navigate(to, { replace: true });
  }, [error, navigate, to]);
}
