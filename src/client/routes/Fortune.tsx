/**
 * 재미 탭의 **첫 카드** — 매력 투표와 함께 열리는 운세 카드 (ADR-20).
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
import { canOpenMission } from "../../shared/phase.ts";
import { paragraphs, validBirth, type Fortune } from "../../shared/fortune.ts";
import type { ParticipantState } from "../../shared/types.ts";
import { ApiError, post } from "../lib/api.ts";
import { useOverlay } from "../ui/Overlays.tsx";

export default function FortuneTab({ state, reload }: { state: ParticipantState; reload: () => void }) {
  const [opening, setOpening] = useState(false);
  const [card, setCard] = useState<Fortune | undefined>(state.fortune);
  const [missionOpening, setMissionOpening] = useState(false);
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

  /** 미션은 **누르는 그 순간에** 만든다. 한 번 연 것은 서버가 그대로 돌려준다 */
  /** 미션의 문은 운세보다 하나 늦다 — 파티장에서만 할 수 있는 것이다 (ADR-20 후기) */
  const missionOpen = canOpenMission(state.event.phase);

  async function openMission() {
    if (missionOpening || card?.mission) return;
    if (!missionOpen) return toast(FORTUNE.missionClosed);
    setMissionOpening(true);
    try {
      setCard(await post<Fortune>("/fortune/mission", {}));
      reload();
    } catch (e) {
      toast(e instanceof ApiError && e.userMessage ? e.userMessage : FORTUNE.missionClosed);
    } finally {
      setMissionOpening(false);
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

        {/*
          미션도 **뒤집어서** 연다 — 이미 만들어 둔 걸 감췄다 보여주는 게 아니라,
          누르는 그 순간에 만든다. 여는 동작이 있어야 그 한 줄이 오늘 것처럼 읽힌다 (ADR-20).
          뒷면은 **미션이 들어설 그 자리**에 있다. 열려도 화면이 튀지 않는다.
        */}
        {card.mission ? (
          <div className="fortuneMission opened">
            <div className="kicker">🎯 {FORTUNE.missionTitle}</div>
            {/*
              **왜 오늘 이것인지가 먼저다.** 한 줄만 던지면 남이 준 숙제로 읽히고,
              숙제는 미뤄진다. 운세에서 이어지는 이유가 앞에 서야 내 것이 된다.

              옛 저장본에는 `lead` 가 없다 — 그때는 미션 한 줄만 그린다.
              빈 자리를 만들거나 대신할 문장을 지어내지 마라. 없는 건 없는 것이다.
            */}
            {card.lead && <p className="missionLead">{card.lead}</p>}
            <p className="missionLine pre">{card.mission}</p>
          </div>
        ) : (
          /*
            **아직 파티가 아니면 뒤집히지 않는다** (ADR-20 후기). 미션 문장에는 언제 할지가
            들어가는데("자리를 옮기고 막 앉았을 때") 그 순간이 아직 없고,
            한 번 연 미션은 그대로 굳는다. 그래서 못 여는 게 아니라 **아직 안 열린 것**이라고 말한다.
          */
          <button
            className={`fortuneMission missionBack ${missionOpening ? "opening" : ""}`}
            aria-disabled={!missionOpen || undefined}
            onClick={openMission}
            disabled={missionOpening}
          >
            <span className="orb" aria-hidden>
              🎯
            </span>
            <span className="small">
              {missionOpening
                ? FORTUNE.missionOpening
                : missionOpen
                  ? FORTUNE.missionOpen
                  : FORTUNE.missionClosed}
            </span>
          </button>
        )}

        {/* 색 메타 — 미션과 같은 내부 카드. 본문(읽는 것)과 정보(찾아보는 것)가 형태로 갈린다 */}
        <div className="fortuneMeta">
          <div className="row between">
            <span className="small dim">🎨 {FORTUNE.colorTitle}</span>
            <span className="small">{FORTUNE.colorName[card.color]}</span>
          </div>
        </div>
      </div>

    </div>
  );
}
