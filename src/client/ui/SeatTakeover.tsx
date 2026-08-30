/**
 * 자리가 발행되면 전체 화면으로 알리고 확인을 받는다.
 * 운영자는 이 확인율을 보고 다음 단계로 넘어갈지 판단한다 (FLOWS.md).
 *
 * 발표가 끝났으면 아예 띄우지 않는다 — 그 판단은 부르는 쪽에서 한다.
 *
 * **다시 열 때는 확인을 받지 않는다** (슬라이스 12). 늦게 도착해 앱을 처음 켠 사람에게
 * 전체 화면이 덮치면 반사적으로 누르기 쉬운데, 그때 테이블 번호를 못 읽고 사라진다 —
 * 그래서 홈에서 다시 열 수 있게 했다. 이미 센 사람을 또 세면 `acks` 가 뜻을 잃는다.
 *
 * **파티 전에도 뜬다** (ADR-39). 그때 이 화면을 받는 사람은 아직 오는 중일 수 있어서
 * 문장이 달라진다 — 옮기라는 말도, 지켜본다는 말도 그 사람에게는 재촉이다.
 */
import { useEffect } from "react";
import { BTN, SEAT } from "../../shared/copy.ts";
import type { MySeat } from "../../shared/types.ts";

/**
 * 확인을 기다리는 동안 **화면이 저절로 꺼지지 않게 잡는다** (Screen Wake Lock).
 *
 * 참가자는 테이블에서 이야기하느라 폰을 잘 안 본다. 자리 카드가 떠도 30초면 화면이
 * 까매지고, 그 뒤로는 곁눈에도 안 들어온다. 켜져 있게만 해두면 폰이 위를 보고 놓인
 * 사람에게는 카드가 계속 보인다.
 *
 * ⚠️ **꺼진 화면을 켜지는 못한다.** 이미 꺼졌거나 주머니 속이면 요청 자체가 거절된다 —
 * 이건 못 보게 된 사람을 부르는 수단이 아니라, 보고 있던 사람이 놓치지 않게 하는 것뿐이다.
 * 못 부르는 사람은 운영자가 찾는다 (`NotAcked`).
 *
 * ⚠️ **확인을 기다리는 동안만 잡는다.** 다시 열어 읽는 사람은 지금 보고 있는 중이라
 * 필요 없고, 파티 내내 켜두면 배터리를 먹는다.
 *
 * 화면이 가려지면 브라우저가 알아서 놓아버리므로, 돌아왔을 때 **다시 잡아야 한다.**
 * 지원하지 않는 브라우저에서는 아무 일도 하지 않는다 — 카드는 그대로 뜬다.
 */
function useScreenAwake(on: boolean) {
  useEffect(() => {
    if (!on || !navigator.wakeLock) return;
    let held: WakeLockSentinel | null = null;
    let gone = false;
    const grab = () => {
      // 화면이 안 보이면 요청이 거절된다. 돌아왔을 때 이 함수가 다시 불린다
      if (gone || document.visibilityState !== "visible") return;
      void navigator.wakeLock.request("screen").then(
        (s) => {
          if (gone) void s.release().catch(() => {});
          else held = s;
        },
        // 거절돼도 할 일이 없다. 화면이 조금 일찍 꺼질 뿐이다
        () => {},
      );
    };
    grab();
    document.addEventListener("visibilitychange", grab);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", grab);
      void held?.release().catch(() => {});
    };
  }, [on]);
}

export default function SeatTakeover({
  seat,
  started,
  onAck,
  onClose,
}: {
  seat: MySeat;
  /** 파티가 시작됐나. 첫 자리는 시작 전에 나간다 (ADR-39) */
  started: boolean;
  /** 아직 확인 안 한 사람에게만 온다 */
  onAck?: () => void;
  /** 다시 연 경우. 닫기만 있다 */
  onClose?: () => void;
}) {
  // 확인을 받아야 하는 동안만. 다시 열어 읽는 경우(`onClose`)는 잡지 않는다
  useScreenAwake(!!onAck);

  return (
    <div className="takeover">
      {/* 마지막 자리라는 사실은 참가자에게 알리지 않는다 — kicker 가 알아서 문장을 고른다 */}
      <div className="kicker">{SEAT.ack.kicker(seat.round)}</div>
      <div className="table">{SEAT.ack.headline(seat.table, started)}</div>
      <div className="dim">{SEAT.ack.mates(seat.mates, seat.men)}</div>
      {!started && <div className="dim">{SEAT.ack.beforeParty}</div>}
      {onAck ? (
        <>
          <button className="btn primary block" onClick={onAck}>
            {SEAT.ack.submit(started)}
          </button>
          {/* 파티 전에는 띄우지 않는다 — 오는 중인 사람에게 "지켜보고 있다" 는 재촉이다 */}
          {started && <div className="tiny dim">{SEAT.ack.watching}</div>}
        </>
      ) : (
        <button className="btn block" onClick={onClose}>
          {BTN.close}
        </button>
      )}
    </div>
  );
}
