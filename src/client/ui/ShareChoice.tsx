/**
 * 매칭됐을 때 상대에게 무엇까지 열지 고르는 자리 (ADR-39).
 *
 * **세로로 펼친다.** 성별·MBTI 처럼 알약 한 줄(`.choice`)에 넣지 않은 이유가 둘 있다.
 *
 *   1. 이건 **동의를 받는 자리**다. 탭해봐야 뜻을 아는 컨트롤로는 동의를 받을 수 없다 —
 *      셋의 뜻이 한눈에 같이 보여야 고른 것이 고른 것이 된다
 *   2. 알약 한 줄에 셋을 넣으면 390px 폰에서 `전화번호까지` 가 잘린다.
 *      줄여서 맞출 수도 있지만, 줄인 낱말이 무엇을 여는지 덜 말한다
 *
 * 등록 폼과 내 정보 수정 폼이 **같은 것을 쓴다.** 두 곳에 따로 적으면 한쪽만 고쳐진다 —
 * `profileForm.ts` 가 검증을 하나로 묶은 것과 같은 이유다.
 *
 * ⚠️ **셋 중 하나를 미리 눌러두지 마라.** 기본값이 없는 게 이 화면의 요점이다 (ADR-37).
 * 안 고른 것을 허락으로 읽으면 그건 동의가 아니라 동의를 지어낸 것이다.
 */
import { REGISTER } from "../../shared/copy.ts";
import { CONTACT_SHARE } from "../../shared/constants.ts";
import type { ContactShare } from "../../shared/types.ts";

export default function ShareChoice({
  value,
  onChange,
}: {
  value: ContactShare | "";
  onChange: (v: ContactShare) => void;
}) {
  return (
    <div className="field" id="contactShare">
      <label>{REGISTER.share.label}</label>

      {/*
        `radiogroup` 이다. 셋 중 하나만 고르는 자리라, 보조기기에도 그렇게 읽혀야
        "여러 개 켤 수 있나" 를 되짚지 않는다. 순서는 `CONTACT_SHARE` 가 정한다
      */}
      <div className="shareChoice" role="radiogroup" aria-label={REGISTER.share.label}>
        {CONTACT_SHARE.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
          >
            {/* 무엇을 여는지는 **고르기 전에** 보인다 — 셋 다 늘 펼쳐 둔다 */}
            <b>{REGISTER.share[v].title}</b>
            <span className="tiny dim">{REGISTER.share[v].body}</span>
          </button>
        ))}
      </div>

      {/*
        서로 다르게 고른 쌍을 어떻게 맞추는지. 이 줄이 없으면 `전화번호까지` 를 고른 사람이
        상대의 번호를 늘 받는 줄로 안다 — 그 오해는 발표 때 실망으로 돌아온다
      */}
      <p className="tiny dim">{REGISTER.share.pairNote}</p>
    </div>
  );
}
