/**
 * 재미 탭의 입구 카드 한 장 (ADR-125). 이상형 찾기와 파티 운세 보기가 **같은 틀**을 쓴다 — 쓰는 곳이 둘이다.
 *
 * 그림 · 제목 · 몸 · 단추 줄. 기능은 탭 안의 제 페이지에서 돌고, 여기는 들어가는 문만 선다.
 * 단추가 상태를 모양으로 말한다 — 할 일이 있으면 채운 단추, 다시 보는 것이면 테두리 단추,
 * **아직 못 쓰면 단추가 없다**(그림이 흐려진다). 열기 전이라는 말은 카드가 아니라 탭 맨 위 한 줄이 한다 —
 * 여는 때가 하나라 카드마다 되풀이하지 않는다.
 *
 * 움직임을 넣지 않는다 — 열리는 순간은 남이(예약이) 일으킨 변화다 (ADR-64). 카드 자리도 그대로다.
 */
import { useId, type ReactNode } from "react";

export default function FunCard({
  visual,
  title,
  locked,
  actions,
  children,
}: {
  /** 40px 그림. 앱에서 이미 다른 뜻으로 쓰는 이모지(💘 매칭 · ✨ 프로필 투표 · 👉 콕)는 쓰지 않는다 */
  visual: ReactNode;
  title: string;
  /** 열기 전이고 결과도 없다 — 단추 없이 무엇이 오는지만 말한다 */
  locked?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={`card stack funCard${locked ? " locked" : ""}`} aria-labelledby={id}>
      <div className="funHead">
        <span className="funVis" aria-hidden>
          {visual}
        </span>
        <div className="funMain">
          <h2 className="cardTitle" id={id}>
            {title}
          </h2>
          {children}
        </div>
      </div>
      {actions}
    </section>
  );
}
