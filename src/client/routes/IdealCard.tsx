/**
 * 재미 탭의 **첫 카드** — 이상형 찾기로 들어가는 문 (슬라이스 19). 운세 카드 위다 (ADR-124).
 *
 * **재미는 한 번에 열린다 — 프로필 투표부터** (ADR-125). 그 전에는 단추 없이 무엇이 오는지만 말한다.
 * 찾은 결과가 있으면 `결과 보기` 와 `다시 찾기` 가 선다 — 다시 찾기는 열려 있는 동안만이다.
 *
 * ⚠️ **결과를 이 카드에 싣지 마라** (ADR-125) — 연예인의 얼굴과 이름이라 탭을 열 때마다 옆 사람에게 취향이 보인다.
 *    결과는 결과 화면에만 있다.
 * ⚠️ **이 카드는 고르는 화면(`Ideal.tsx`)과 다른 파일이다.** 그쪽은 따로 싣는 조각이라,
 *    같은 파일에 두고 여기서 불러 쓰면 그 조각이 재미 탭과 함께 딸려 온다.
 *    그리고 카드는 **얼굴 자료를 받지 않는다** — 안 여는 사람은 1바이트도 안 받는다.
 */
import { IDEAL } from "../../shared/copy.ts";
import type { Ideal } from "../../shared/ideal.ts";
import FunCard from "../ui/FunCard.tsx";

/** 3×3 격자 그림 — 이 기능이 하는 일(아홉 중에서 고르기)이다. 이모지를 새로 고르지 않는다 */
function Grid9() {
  return (
    <span className="funGrid9">
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={i === 1 || i === 5 || i === 6 ? "on" : undefined} />
      ))}
    </span>
  );
}

export default function IdealCard({
  ideal,
  open,
  onOpen,
  onAgain,
}: {
  ideal?: Ideal;
  /** 재미가 열렸나 (`canOpenFun`) */
  open: boolean;
  onOpen: () => void;
  onAgain: () => void;
}) {
  return (
    <FunCard
      visual={<Grid9 />}
      title={IDEAL.title}
      locked={!open && !ideal}
      actions={
        ideal ? (
          // 다시 보는 것이라 테두리 단추다. 열려 있는 동안에만 다시 찾는다 — 단계가 되돌아가도 결과는 본다
          <div className="funActions">
            <button className="btn ghost" onClick={onOpen}>
              {IDEAL.cardResult}
            </button>
            {open && (
              <button className="btn ghost" onClick={onAgain}>
                {IDEAL.again}
              </button>
            )}
          </div>
        ) : open ? (
          <button className="btn primary block" onClick={onOpen}>
            {IDEAL.cardStart}
          </button>
        ) : null
      }
    >
      {/* '연예인' 이라는 말은 여기 없다 — 결과 화면의 것이다 (S-B5) */}
      <p className="dim small idealLead">{IDEAL.cardBody}</p>
    </FunCard>
  );
}
