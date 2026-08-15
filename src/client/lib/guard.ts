import { useEffect } from "react";
import { useNavigate } from "react-router";
import type { ApiError } from "./api.ts";

/**
 * 세션이 없거나(401) 권한 밖(403)이면 PIN 화면으로 되돌린다.
 * `to` 로 보던 회차를 넘겨주면 다시 로그인한 뒤 그 회차로 돌아온다.
 */
export function useAuthRedirect(error: ApiError | null, to = "/host") {
  const navigate = useNavigate();
  useEffect(() => {
    if (error && (error.status === 401 || error.status === 403)) navigate(to, { replace: true });
  }, [error, navigate, to]);
}
