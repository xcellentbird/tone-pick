/**
 * 연습용 환경이면 화면 맨 위에 띠를 띄운다.
 *
 * 주소만 보고 구분하지 않는다 — 배포된 설정(ENV_LABEL)이 진실이다.
 * 주소는 나중에 커스텀 도메인이 붙으면 바뀌지만 설정은 그대로 따라온다.
 */
import { useEffect, useState } from "react";
import { ENV_BANNER } from "../../shared/copy.ts";
import { api } from "../lib/api.ts";

export default function EnvBadge() {
  const [label, setLabel] = useState<string | null>(null);

  /*
   * **첫 화면이 그려진 뒤에 묻는다.**
   *
   * 이 띠는 연습용 환경에서만 뜨고 프로덕션에서는 `null` 을 그린다. 그런데 물어보는 일은
   * 두 곳 다 하고 있었다 — 참가자가 링크를 열 때마다 회차 조회와 나란히 한 번을 더 썼다.
   * 첫 화면에 필요한 정보가 아니므로 한가할 때로 미룬다.
   */
  useEffect(() => {
    const ask = () =>
      api<{ label?: string }>("/health")
        .then((h) => setLabel(h.label ?? null))
        .catch(() => setLabel(null));
    /*
     * `requestIdleCallback` 이 없는 사파리(17 미만)에서는 넉넉히 미룬 타이머로 대신한다.
     * **`window` 를 직접 좁히지 않는다** — `"x" in window` 로 쓰면 타입스크립트가
     * 반대 갈래의 `window` 를 `never` 로 만들어 `setTimeout` 조차 못 찾는다.
     */
    const idle = window.requestIdleCallback as typeof window.requestIdleCallback | undefined;
    if (idle) {
      const h = idle(ask, { timeout: 3000 });
      return () => window.cancelIdleCallback(h);
    }
    const h = window.setTimeout(ask, 800);
    return () => window.clearTimeout(h);
  }, []);

  if (!label) return null;
  return (
    <div className="envBadge" role="status">
      {ENV_BANNER(label)}
    </div>
  );
}
