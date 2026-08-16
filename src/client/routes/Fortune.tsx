/**
 * 오늘 탭 — 파티가 시작되면 열리는 운세 카드 (ADR-20).
 *
 * 이 앱에서 유일하게 기능이 아니라 **재미**인 자리다. 그래도 규칙은 같다.
 *
 *  · 점수를 매기지 않는다. `연애운 34점` 은 이 앱이 없애려던 경험을 앱이 직접 만든다
 *  · **한 번 열면 그대로 남는다.** 다시 열 때마다 달라지면 그 순간 전부 거짓말이 된다
 *  · 뒤집기는 의식이다 — 여는 동작이 있어야 그 한 줄이 오늘 것처럼 읽힌다.
 *    그리고 그 0.6초가 LLM 을 기다리는 시간을 자연스럽게 덮는다
 *  · 움직임을 원치 않는 사람에게는 뒤집지 않고 바로 보여준다 (prefers-reduced-motion)
 *  · 카드 하나뿐인 화면이다 — 화면을 채운다 (fortuneFill). 내용이 길면 그대로 스크롤된다
 */
import { useState } from "react";
import { FORTUNE } from "../../shared/copy.ts";
import { paragraphs, type Fortune } from "../../shared/fortune.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { ApiError, post } from "../lib/api.ts";
import { useOverlay } from "../ui/Overlays.tsx";

export default function FortuneTab({ state, reload }: { state: ParticipantState; reload: () => void }) {
  const [opening, setOpening] = useState(false);
  const [card, setCard] = useState<Fortune | undefined>(state.fortune);
  const { toast } = useOverlay();

  async function open() {
    if (opening || card) return;
    setOpening(true);
    try {
      setCard(await post<Fortune>("/fortune"));
      // 다음에 이 화면을 열 때는 이미 열린 채로 시작한다
      reload();
    } catch (e) {
      toast(e instanceof ApiError && e.userMessage ? e.userMessage : FORTUNE.closed);
    } finally {
      setOpening(false);
    }
  }

  if (!card) {
    return (
      <div className="stack fortuneFill">
        <button className={`fortuneBack ${opening ? "opening" : ""}`} onClick={open} disabled={opening}>
          <span className="sparkles" aria-hidden>
            ✦ ✧ ✦
          </span>
          <span className="orb">🔮</span>
          <span className="small">{opening ? FORTUNE.opening : FORTUNE.open}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="stack fortuneFill">
      <div className={`card stack fortuneCard tone-${card.color}`}>
        <div className="kicker">{FORTUNE.title}</div>
        <h2 className="fortuneHeadline">{card.headline}</h2>
        {/* 세 문단. 한 덩어리로 붙여 놓으면 폰에서 읽다가 놓친다 */}
        {paragraphs(card.body).map((para, i) => (
          <p className="fortuneBody" key={i}>
            {para}
          </p>
        ))}

        <div className="fortuneMission">
          <div className="kicker">🎯 {FORTUNE.missionTitle}</div>
          <p className="pre" style={{ margin: 0 }}>
            {card.mission}
          </p>
        </div>

        {/* 본문은 위에서 읽히고 메타가 바닥을 잡는다 — 남는 공간이 디자인된 여백으로 읽히게 */}
        <div className="stack fortuneMeta">
          <div className="row between">
            <span className="small dim">🎨 {FORTUNE.colorTitle}</span>
            <span className="small">{FORTUNE.colorName[card.color]}</span>
          </div>
          <div className="row between">
            <span className="small dim">🤝 {FORTUNE.matchTitle}</span>
            <span className="small">{card.matchTypes.join(" · ")}</span>
          </div>
        </div>
      </div>

      {/* 다시 열어도 같은 운세라는 걸 미리 말해둔다 — 새로고침하며 다른 걸 기대하지 않게 */}
      <p className="tiny dim center">{FORTUNE.again}</p>
    </div>
  );
}
