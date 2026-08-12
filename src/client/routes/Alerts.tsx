/**
 * 알림 탭. 목록은 저장된 게 아니라 `fired` 에서 매번 파생된다 (ADR-4).
 * 그래서 운영자가 발표를 되돌리면 이 목록도 그 자리에서 "되돌렸어요"로 바뀐다.
 */
import { POKE } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { formatWhen } from "../../shared/time.ts";
import { noticesOf } from "../lib/notices.ts";

export default function Alerts({ state }: { state: ParticipantState }) {
  const list = noticesOf(state);
  if (list.length === 0) return <p className="dim center">{POKE.none}</p>;

  return (
    <div className="stack">
      {list.map((n) => (
        <div className={`banner ${n.warn ? "warn" : ""}`} key={n.key}>
          <span className="icon">{n.icon}</span>
          <span className="grow">
            <span className="name">{n.title}</span>
            <div className="small dim pre">{n.body}</div>
            {n.at > 0 && <div className="tiny dim">{formatWhen(n.at)}</div>}
          </span>
        </div>
      ))}
    </div>
  );
}
