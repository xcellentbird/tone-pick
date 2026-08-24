/**
 * 매칭됐을 때 상대에게 무엇까지 열지 고르는 자리 (ADR-37).
 *
 * **이름은 고르지 않는다 — 늘 열린다.** 그래서 이 컨트롤이 묻는 건 연락 수단 둘뿐이고,
 * 둘은 **서로 독립**이다. 사다리 3단(`전화번호까지`·`인스타까지`·`안 열기`)이던 시절에는
 * "인스타는 열고 번호는 닫는다" 는 되는데 그 반대가 안 됐다 — 사다리가 순서를 강요했다.
 *
 * 칸마다 `열기`/`안 열기` 알약 한 줄을 둔다. 성별 토글과 같은 꼴이라 새로 배울 게 없고,
 * 둘 중 하나를 고르는 자리에는 알약이 맞다 — 답이 짧아서 잘릴 일도 없다.
 *
 * **못 고르는 것을 먼저 말한다** (`share.always`). 안 그러면 둘 다 `안 열기` 로 두면
 * 이름조차 안 간다고 읽는다.
 *
 * 등록 폼과 내 정보 수정 폼이 **같은 것을 쓴다.** 두 곳에 따로 적으면 한쪽만 고쳐진다 —
 * `profileForm.ts` 가 검증을 하나로 묶은 것과 같은 이유다.
 *
 * ⚠️ **어느 쪽도 미리 눌러두지 마라.** 기본값이 없는 게 이 화면의 요점이다 (ADR-37).
 * 안 고른 것을 허락으로 읽으면 그건 동의가 아니라 동의를 지어낸 것이다.
 */
import { ME, REGISTER } from "../../shared/copy.ts";
import { SHARE_KEYS } from "../../shared/constants.ts";
import type { ContactShare } from "../../shared/types.ts";

/** 아직 안 고른 칸은 `null` 이다 — `false`(안 열기)와 **다르다** */
export type ShareDraft = { [K in keyof ContactShare]: boolean | null };

export default function ShareChoice({
  value,
  onChange,
}: {
  value: ShareDraft;
  onChange: (key: keyof ContactShare, on: boolean) => void;
}) {
  return (
    <div className="field" id="contactShare">
      <label>{REGISTER.share.label}</label>
      {/* 고를 수 없는 것이 먼저다. 이름이 늘 간다는 걸 알아야 나머지 둘이 무슨 뜻인지 안다 */}
      <p className="tiny dim">{REGISTER.share.always}</p>

      {SHARE_KEYS.map((key) => (
        <div className="shareRow" key={key}>
          {/* 라벨은 `ME.labels` 것을 그대로 — 내 정보 탭과 같은 낱말이어야 같은 것으로 읽힌다 */}
          <span className="small dim">{ME.labels[key]}</span>
          <div className="choice" role="radiogroup" aria-label={`${ME.labels[key]} ${REGISTER.share.label}`}>
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                type="button"
                role="radio"
                aria-checked={value[key] === on}
                onClick={() => onChange(key, on)}
              >
                {on ? REGISTER.share.on : REGISTER.share.off}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/*
        서로 다르게 고른 쌍을 어떻게 맞추는지. 이 줄이 없으면 `열기` 를 고른 사람이
        상대의 번호를 늘 받는 줄로 안다 — 그 오해는 발표 때 실망으로 돌아온다
      */}
      <p className="tiny dim">{REGISTER.share.pairNote}</p>
    </div>
  );
}
