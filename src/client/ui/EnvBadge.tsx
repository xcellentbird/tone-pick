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

  useEffect(() => {
    api<{ label?: string }>("/health")
      .then((h) => setLabel(h.label ?? null))
      .catch(() => setLabel(null));
  }, []);

  if (!label) return null;
  return (
    <div className="envBadge" role="status">
      {ENV_BANNER(label)}
    </div>
  );
}
