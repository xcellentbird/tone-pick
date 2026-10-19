// 속성 낱말(attrs.mjs) → 앱의 특징 부호(`animal.cat` 꼴, ideal.ts 의 IDEAL_TRAITS) (ADR-127)
//
// 읽는 것: 없음 (src/shared/ideal.ts 의 IDEAL_TRAITS · traitToken)
// 쓰는 것: 없음
// 순서: 공용 — emit-traits.mjs(v3) 와 emit-face.mjs(v4~)가 쓴다. 결과 화면의 `끌린 얼굴` 글은 이 부호로 센다
import { IDEAL_TRAITS, traitToken } from "../../src/shared/ideal.ts";

/** attrs.mjs 의 낱말 → 앱의 부호. 칸 순서 · 낱말 순서가 IDEAL_TRAITS 와 같다 — 어긋나면 아래에서 멈춘다 */
export const WORDS = {
  animal: ["강아지상", "고양이상", "여우상", "토끼상", "사슴상", "곰상", "늑대상", "공룡상", "다람쥐상", "햄스터상", "말상", "뱀상", "두부상", "병아리상"],
  vibe: ["청순한", "귀여운", "발랄한", "시크한", "도도한", "우아한", "섹시한", "지적인", "따뜻한", "부드러운", "차가운", "강인한", "남성적인", "중성적인", "소년 같은", "이국적인", "수수한", "화려한", "성숙한", "장난스러운"],
  gaze: ["순한 눈매", "또렷한 눈매", "날카로운 눈매", "나른한 눈매", "웃는 듯한 눈매"],
  jaw: ["갸름하고 뾰족한 턱", "부드러운 곡선 턱", "각지고 뚜렷한 턱", "둥근 턱"],
  features: ["순하고 흐린 이목구비", "균형 잡힌 이목구비", "진하고 뚜렷한 이목구비"],
};
for (const [k, words] of Object.entries(WORDS))
  if (words.length !== IDEAL_TRAITS[k].length) throw new Error(`${k}: 낱말 ${words.length} · 부호 ${IDEAL_TRAITS[k].length} — 어휘가 어긋났다`);

/** 한 사람의 합의 속성(attrs.mjs 의 consensus) → 부호 목록. 모르는 낱말이면 멈춘다 — 어휘가 바뀐 것이다 */
export function traitTokens(attrs, who = "") {
  const out = [];
  for (const [k, words] of Object.entries(WORDS))
    for (const w of Array.isArray(attrs[k]) ? attrs[k] : [attrs[k]]) {
      const i = words.indexOf(w);
      if (i < 0) throw new Error(`${who}: ${k} 의 모르는 낱말 ${w}`);
      out.push(traitToken(k, IDEAL_TRAITS[k][i]));
    }
  return out;
}
