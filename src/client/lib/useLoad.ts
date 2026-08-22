import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ApiError } from "./api.ts";

interface Load<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  /** 불러온 자료를 화면 쪽에서 갈아끼운다. 갱신 함수도 받는다 — 되돌리려면 이전 값이 필요하다 */
  set: Dispatch<SetStateAction<T | null>>;
}

/**
 * 한 화면이 쓰는 자료 한 벌을 불러온다.
 *
 * 되불러오기(reload)를 밖으로 내주는 이유: 실시간 이벤트가 오면 다시 읽어야 하는데,
 * 이벤트마다 부분 갱신을 만들면 화면과 서버가 조용히 어긋난다. 진실은 서버에 한 벌만 둔다.
 */
/** 닿지 못했을 때 다시 시도하기까지. 두 배씩 늘리되 이만큼에서 멈춘다 */
const RETRY_CAP_MS = 8_000;

/**
 * 이만큼 못 붙고 나서야 오류 화면을 올린다. 1초 + 2초 = **약 3초**다.
 *
 * 폰을 다시 켤 때의 실패는 대개 1초짜리다 — 그걸 오류로 올리면 사람은
 * 스스로 나은 것을 보지 못하고 **고장 난 앱을 본다.** 그래서 그 사이에는
 * 평소의 불러오는 화면을 그대로 둔다. 반대로 영영 감추지도 않는다 —
 * 정말 망이 없는 사람은 자기가 왜 못 들어가는지 알아야 한다.
 */
const QUIET_TRIES = 3;

export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): Load<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  /** 몇 번째 실행인가. 되불러오기가 겹쳤을 때 늦게 온 옛 응답이 새 것을 덮지 않게 한다 */
  const run = useRef(0);
  /** 연달아 몇 번 못 붙었나. 닿지 못한 실패만 센다 */
  const [misses, setMisses] = useState(0);
  const fn = useRef(load);
  fn.current = load;

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    alive.current = true;
    const mine = ++run.current;
    const latest = () => alive.current && run.current === mine;
    setLoading(true);
    fn.current()
      .then((value) => {
        if (!latest()) return;
        setData(value);
        setError(null);
        setMisses(0);
      })
      .catch((e: unknown) => {
        if (!latest()) return;
        const err = e instanceof ApiError ? e : new ApiError(0, "network");
        setError(err);
        setMisses((n) => (err.status === 0 ? n + 1 : 0));
      })
      .finally(() => latest() && setLoading(false));
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  /**
   * **서버에 닿지도 못한 실패는 스스로 다시 붙는다.**
   *
   * 안드로이드는 화면을 끄면 탭을 얼리고 데이터 무선을 내린다. 화면을 켜면 앱이
   * 그 자리에서 다시 읽는데(ADR-26) **무선이 아직 안 올라와 있어서** `fetch` 가
   * 즉시 거부된다. 망은 1초 뒤에 멀쩡해지는데 화면은 오류에 머물러 있었다 —
   * 참가자가 새로고침을 눌러야만 빠져나오는 막다른 길이었다.
   *
   * 그래서 여기서만 다시 시도한다. 서버가 **거절한** 실패(401·404)는 다시 물어도
   * 같은 답이라 건드리지 않는다. 닿지 못한 것(`status 0`)만이 시간이 답이다.
   *
   * 멈추지 않고 계속 시도한다 — 지하 주차장을 지나 파티장에 들어선 사람은
   * 아무것도 누르지 않아도 화면이 돌아와 있어야 한다. 대신 간격을 늘려서
   * 정말 망이 없는 폰이 배터리를 태우지 않게 한다.
   */
  useEffect(() => {
    if (error?.status !== 0) return;
    const wait = Math.min(RETRY_CAP_MS, 1000 * 2 ** (misses - 1));
    const timer = setTimeout(reload, wait);
    /*
     * **타이머만 믿으면 안 된다.** 안드로이드는 화면을 끌 때 탭을 얼리는데, 얼어 있는 동안
     * 예약해둔 타이머는 멈추고 깨어날 때 살아 돌아온다는 보장이 없다. 그러면 다시 붙을
     * 길이 하나도 없는 채로 오류 화면에 남는다 — 이게 "가끔 넘어가서 안 돌아온다" 였다.
     *
     * 그래서 **앱으로 돌아오는 순간을 직접 듣는다.** 소켓도 같은 일을 하지만
     * (`realtime.ts`) 소켓이 죽어 있거나 아직 안 붙었으면 그 길도 없다.
     * 다시 붙는 길을 하나에 걸지 않는다.
     */
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      reload();
    };
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [error, misses, reload]);

  /**
   * **닿지 못한 실패는 "실패"가 아니라 "아직"이다.** 화면에 올리기 전에 두 번 더 붙어본다.
   *
   * 두 경우를 다르게 다룬다.
   *
   *   보던 화면이 있다   버리지 않는다. 뒤에서 조용히 다시 붙는다
   *   아직 아무것도 없다  평소의 불러오는 화면으로 두다가, 계속 안 되면 그제야 오류
   *
   * 앞 칸이 중요하다 — 폰을 켜는 순간의 1초짜리 실패에 **보고 있던 탭과 자리를 통째로
   * 빼앗을** 이유가 없다. 스스로 낫는 걸 사람이 볼 필요는 더더욱 없다.
   *
   * 서버가 **거절한** 실패(401·404)는 그대로 올린다. 그건 기다린다고 달라지지 않는다.
   */
  const shown = error?.status !== 0 ? error : data === null && misses >= QUIET_TRIES ? error : null;

  return { data, error: shown, loading, reload, set: setData };
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
