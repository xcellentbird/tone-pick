/**
 * 재미 탭의 **두 번째 카드** — 이상형 찾기로 들어가는 문 (슬라이스 19).
 *
 * 등록부터 열린다 (S-A2). 남의 자료를 전혀 쓰지 않으니 단계를 볼 이유가 없다 —
 * 운세 카드처럼 문을 따로 두지 않는다.
 *
 * ⚠️ **이 카드는 고르는 화면(`Ideal.tsx`)과 다른 파일이다.** 그쪽은 따로 싣는 조각이라,
 *    같은 파일에 두고 여기서 불러 쓰면 그 조각이 재미 탭과 함께 딸려 온다.
 *    그리고 카드는 **얼굴 자료를 받지 않는다** — 안 여는 사람은 1바이트도 안 받는다.
 */
import { IDEAL } from "../../shared/copy.ts";
import type { Ideal } from "../../shared/ideal.ts";

export default function IdealCard({ ideal, onOpen }: { ideal?: Ideal; onOpen: () => void }) {
  return (
    <div className="card stack">
      <h2 className="cardTitle">{IDEAL.title}</h2>
      {/* '연예인' 이라는 말은 여기 없다 — 결과 화면의 것이다 (S-B5) */}
      <p className="dim small idealLead">{IDEAL.cardBody}</p>
      {/* 결과가 있으면 같은 문이 결과로 간다 — 다시 고르는 길은 없다 (S-C3) */}
      <button className="btn primary block" onClick={onOpen}>
        {ideal ? IDEAL.cardResult : IDEAL.cardStart}
      </button>
    </div>
  );
}
