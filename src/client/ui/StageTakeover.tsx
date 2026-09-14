/**
 * 단계가 열릴 때 **그 단계 하나만** 전체 화면으로 말한다 (ADR-95, 슬라이스 34).
 * 자리 확인 화면(`SeatTakeover`)과 같은 틀(`.takeover`)이다.
 *
 * **버튼이 아래 있다고 읽지 않는다** — 자리 화면이 겪었다 (*반사적으로 누르고 테이블 번호를 못 읽는다*).
 * 그래서 셋으로 그 반사를 이긴다: 스크롤이 없고(버튼까지 한 화면), 카드 하나가 내용이고,
 * 버튼은 `확인` 이 아니라 **다음 할 일**이다.
 *
 * **움직임이 없다** (ADR-64). 남이 일으킨 화면이다 — 예약이 열고, 운영자가 연다.
 * **다음 단계를 말하지 않는다.** 그 단계는 그 단계가 열릴 때 말한다.
 * 이모지는 콕 버튼과 같은 것을 쓴다 (`ACT.emoji`) — 참가자가 곧 누를 버튼과 같은 그림이어야
 * *저걸 누르라는 말이구나* 가 글자 없이 읽힌다 (UI.md 의 소식 줄과 같은 규칙).
 */
import { ACT, STAGE } from "../../shared/copy.ts";
import type { StageKey } from "../../shared/types.ts";

export default function StageTakeover({
  stage,
  count,
  notify,
  onDone,
}: {
  stage: StageKey;
  /** 파티 콕 횟수 (`maxParty`). 매력 투표 화면에서는 안 쓴다 — 참가자 탭이 크게 보여준다 */
  count: number;
  /** `pokeNotify`. 마지막 줄이 이걸 보고 갈린다 (ADR-43) */
  notify: boolean;
  onDone: () => void;
}) {
  const c = STAGE[stage];
  return (
    <div className="takeover">
      <div className="kicker">{c.title}</div>
      <div className="stageCard">
        <div className="emoji" aria-hidden>
          {ACT.emoji(stage === "prevote" ? "pre" : "party")}
        </div>
        <div className="what">{c.what}</div>
        <div className="effect">{c.why}</div>
      </div>
      {stage === "party" && (
        <div>
          <div>{STAGE.party.fresh(count)}</div>
          <div className="dim">{STAGE.party.notify(notify)}</div>
        </div>
      )}
      <button className="btn primary block" onClick={onDone}>
        {STAGE.go}
      </button>
    </div>
  );
}
