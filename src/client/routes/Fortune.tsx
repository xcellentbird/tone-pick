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
import { APPEAL, FORTUNE } from "../../shared/copy.ts";
import { paragraphs, validBirth, type Fortune } from "../../shared/fortune.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { ApiError, post } from "../lib/api.ts";
import { useOverlay } from "../ui/Overlays.tsx";

export default function FortuneTab({ state, reload }: { state: ParticipantState; reload: () => void }) {
  const [opening, setOpening] = useState(false);
  const [card, setCard] = useState<Fortune | undefined>(state.fortune);
  const [birth, setBirth] = useState("");
  const [birthErr, setBirthErr] = useState(false);
  const { toast } = useOverlay();

  // 표시는 1993.12.07 — 자기가 맞게 쳤는지 한눈에 보인다. 상태와 전송은 숫자 8자리 그대로다
  const fmtBirth = (b: string) =>
    b.slice(0, 4) + (b.length > 4 ? `.${b.slice(4, 6)}` : "") + (b.length > 6 ? `.${b.slice(6, 8)}` : "");

  // 생년월일은 몸에 실어 보내고 **어디에도 저장하지 않는다** (ADR-20)
  const birthOk =
    /^[0-9]{8}$/.test(birth) &&
    validBirth(Number(birth.slice(0, 4)), Number(birth.slice(4, 6)), Number(birth.slice(6, 8)));

  async function open() {
    if (opening || card) return;
    if (!birthOk) return setBirthErr(true);
    setOpening(true);
    try {
      setCard(await post<Fortune>("/fortune", { birth }));
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
        <div className={`fortuneBack ${opening ? "opening" : ""}`}>
          <span className="sparkles" aria-hidden>
            ✦ ✧ ✦
          </span>
          <span className="orb">🔮</span>
          {/* 진짜 운세 보는 순서다 — 생년월일을 내밀고, 카드를 연다 */}
          <div className="field birthField">
            <label htmlFor="birth">{FORTUNE.birthLabel}</label>
            <input
              id="birth"
              inputMode="numeric"
              placeholder={FORTUNE.birthPh}
              maxLength={10}
              value={fmtBirth(birth)}
              onChange={(e) => {
                setBirth(e.target.value.replace(/[^0-9]/g, "").slice(0, 8));
                setBirthErr(false);
              }}
              aria-invalid={birthErr || undefined}
              aria-describedby={birthErr ? "birth-err" : "birth-note"}
            />
            {birthErr ? (
              <span className="err" id="birth-err" role="alert">
                {FORTUNE.birthBad}
              </span>
            ) : (
              <span className="tiny dim" id="birth-note">
                {FORTUNE.birthNote}
              </span>
            )}
          </div>
          <button className="btn primary" onClick={open} disabled={opening}>
            {opening ? FORTUNE.opening : FORTUNE.open}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack fortuneFill">
      <div className={`card stack fortuneCard tone-${card.color}`}>
        {/* 운세를 읽어준 사람. 카드가 길어도 글의 머리가 어디인지 한눈에 잡힌다 */}
        <span className="fortuneMage" aria-hidden>
          🧙‍♀️
        </span>
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

        {/* 색 메타 — 미션과 같은 내부 카드. 본문(읽는 것)과 정보(찾아보는 것)가 형태로 갈린다 */}
        <div className="fortuneMeta">
          <div className="row between">
            <span className="small dim">🎨 {FORTUNE.colorTitle}</span>
            <span className="small">{FORTUNE.colorName[card.color]}</span>
          </div>
        </div>
      </div>

      {/*
        오늘의 어필 — **운세 아래에 별도 카드**로 선다.
        운세가 "오늘 나는 어떤 결인가" 라면 이건 "그래서 뭘 어떻게 보여주나" 다.
        한 카드에 이어 붙이면 읽을 것이 너무 길어지고, 둘의 성격이 형태로 갈리지 않는다.
        옛 저장본에는 없다 — 그때는 이 카드가 통째로 없다.
      */}
      {card.appeal && (
        <div className="card stack appealCard">
          <div className="kicker">💬 {APPEAL.title}</div>
          <h2 className="fortuneHeadline">{card.appeal.headline}</h2>
          <div className="stack appealTips">
            {card.appeal.tips.map((tip, i) => (
              <p className="appealTip" key={i}>
                {tip}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
