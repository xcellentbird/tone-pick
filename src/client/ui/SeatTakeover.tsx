/**
 * 자리가 발행되면 전체 화면으로 알리고 확인을 받는다.
 * 운영자는 이 확인율을 보고 다음 단계로 넘어갈지 판단한다 (FLOWS.md).
 *
 * 발표가 끝났으면 아예 띄우지 않는다 — 그 판단은 부르는 쪽에서 한다.
 *
 * **다시 열 때는 확인을 받지 않는다** (슬라이스 12). 늦게 도착해 앱을 처음 켠 사람에게
 * 전체 화면이 덮치면 반사적으로 누르기 쉬운데, 그때 테이블 번호를 못 읽고 사라진다 —
 * 그래서 홈에서 다시 열 수 있게 했다. 이미 센 사람을 또 세면 `acks` 가 뜻을 잃는다.
 */
import { BTN, SEAT } from "../../shared/copy.ts";
import type { MySeat } from "../../shared/types.ts";

export default function SeatTakeover({
  seat,
  onAck,
  onClose,
}: {
  seat: MySeat;
  /** 아직 확인 안 한 사람에게만 온다 */
  onAck?: () => void;
  /** 다시 연 경우. 닫기만 있다 */
  onClose?: () => void;
}) {
  return (
    <div className="takeover">
      {/* 마지막 자리라는 사실은 참가자에게 알리지 않는다 — kicker 가 알아서 문장을 고른다 */}
      <div className="kicker">{SEAT.ack.kicker(seat.round)}</div>
      <div className="table">{SEAT.ack.headline(seat.table)}</div>
      <div className="dim">{SEAT.ack.mates(seat.mates, seat.men)}</div>
      {onAck ? (
        <>
          <button className="btn primary block" onClick={onAck}>
            {SEAT.ack.submit}
          </button>
          <div className="tiny dim">{SEAT.ack.watching}</div>
        </>
      ) : (
        <button className="btn block" onClick={onClose}>
          {BTN.close}
        </button>
      )}
    </div>
  );
}
