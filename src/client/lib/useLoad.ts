import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api.ts";

interface Load<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  set: (value: T) => void;
}

/**
 * 한 화면이 쓰는 자료 한 벌을 불러온다.
 *
 * 되불러오기(reload)를 밖으로 내주는 이유: 실시간 이벤트가 오면 다시 읽어야 하는데,
 * 이벤트마다 부분 갱신을 만들면 화면과 서버가 조용히 어긋난다. 진실은 서버에 한 벌만 둔다.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): Load<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  const fn = useRef(load);
  fn.current = load;

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    fn.current()
      .then((value) => {
        if (!alive.current) return;
        setData(value);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!alive.current) return;
        setError(e instanceof ApiError ? e : new ApiError(0, "network"));
      })
      .finally(() => alive.current && setLoading(false));
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return {
    data,
    error,
    loading,
    reload: useCallback(() => setTick((t) => t + 1), []),
    set: setData,
  };
}

/** 1초마다 다시 그린다. 카운트다운처럼 시간이 흘러야 하는 화면에서만 쓴다 */
export function useTicker(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}
