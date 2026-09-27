// 얼굴 속성 — 고정 어휘에서 고르게 한다(자유 서술은 같은 사진도 부를 때마다 달라져 얼굴 차이만큼 흔들렸다).
// 벡터 = Σ 가중치 × (고른 값 구절의 text-embedding-3-large 임베딩) 을 속성마다 이어 붙인 것 → PCA → 256
//
// 읽는 것: 없음 (어휘 · 스키마 · 벡터 계산만)
// 쓰는 것: 없음
// 순서: 공용 — build-attrs.mjs 와 stability.mjs 가 쓴다. 어휘·무게를 바꾸면 build-attrs 부터 다시 돈다 (ADR-122 결정 ⑥)
export const ATTRS = [
  { key: "animal", label: "동물상", multi: 2, w: 1.6, values: ["강아지상", "고양이상", "여우상", "토끼상", "사슴상", "곰상", "늑대상", "공룡상", "다람쥐상", "햄스터상", "말상", "뱀상", "두부상", "병아리상"] },
  { key: "vibe", label: "분위기", multi: 3, w: 1.6, values: ["청순한", "귀여운", "발랄한", "시크한", "도도한", "우아한", "섹시한", "지적인", "따뜻한", "부드러운", "차가운", "강인한", "남성적인", "중성적인", "소년 같은", "이국적인", "수수한", "화려한", "성숙한", "장난스러운"] },
  { key: "shape", label: "얼굴형", multi: 1, w: 1.0, values: ["달걀형", "둥근형", "긴형", "각진형", "역삼각형(V라인)", "하트형"] },
  { key: "eyeSize", label: "눈 크기", multi: 1, w: 0.8, values: ["작은 눈", "보통 눈", "큰 눈"] },
  { key: "lid", label: "쌍꺼풀", multi: 1, w: 0.9, values: ["무쌍(쌍꺼풀 없음)", "속쌍꺼풀", "얇은 쌍꺼풀", "뚜렷한 쌍꺼풀"] },
  { key: "tail", label: "눈꼬리", multi: 1, w: 0.9, values: ["올라간 눈꼬리", "수평인 눈꼬리", "처진 눈꼬리"] },
  { key: "gaze", label: "눈매", multi: 1, w: 1.0, values: ["순한 눈매", "또렷한 눈매", "날카로운 눈매", "나른한 눈매", "웃는 듯한 눈매"] },
  { key: "brow", label: "눈썹", multi: 1, w: 0.5, values: ["옅은 눈썹", "짙은 일자 눈썹", "짙은 아치형 눈썹", "각진 눈썹", "자연스러운 보통 눈썹"] },
  { key: "nose", label: "코", multi: 1, w: 0.6, values: ["작고 둥근 코", "오똑한 코", "높고 긴 코", "넓고 뭉툭한 코"] },
  { key: "lips", label: "입술", multi: 1, w: 0.6, values: ["얇은 입술", "보통 입술", "도톰한 입술"] },
  { key: "jaw", label: "턱선", multi: 1, w: 0.8, values: ["갸름하고 뾰족한 턱", "부드러운 곡선 턱", "각지고 뚜렷한 턱", "둥근 턱"] },
  { key: "cheek", label: "광대", multi: 1, w: 0.4, values: ["도드라진 광대", "보통 광대", "평평한 광대"] },
  { key: "features", label: "이목구비", multi: 1, w: 1.0, values: ["순하고 흐린 이목구비", "균형 잡힌 이목구비", "진하고 뚜렷한 이목구비"] },
  { key: "skin", label: "피부 톤", multi: 1, w: 0.4, values: ["밝은 피부", "중간 피부", "구릿빛 피부"] },
  { key: "age", label: "나이 느낌", multi: 1, w: 0.8, values: ["앳된 동안", "또래 같은", "성숙한"] },
];

export const ATTR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ATTRS.map((a) => a.key),
  properties: Object.fromEntries(
    ATTRS.map((a) => [
      a.key,
      a.multi > 1
        ? { type: "array", items: { type: "string", enum: a.values }, description: `${a.label} — ${a.multi}개까지, 가장 맞는 순서로` }
        : { type: "string", enum: a.values, description: a.label },
    ]),
  ),
};

export const ATTR_PROMPT = `이 얼굴 사진의 외모를 정해진 어휘에서 골라 적는다. 목적: 사람들이 '끌리는 얼굴' 을 고르면 비슷한 인상의 얼굴을 찾아 주는 것.
- 누구인지 알아보거나 이름을 말하지 않는다. 보이는 얼굴만 본다
- 평가하지 않는다. 모양과 인상만 고른다
- 표정·조명·각도처럼 사진마다 달라지는 것보다, 그 얼굴에 늘 있는 특징으로 판단한다
- 여럿을 고르는 칸(동물상·분위기)은 가장 맞는 것부터. 억지로 채우지 말고 분명한 것만`;

/** 여러 번 고른 것을 합친다 — 한 칸짜리는 최빈값(동률이면 먼저 나온 것), 여러 칸짜리는 과반이 고른 것(없으면 가장 많이 고른 하나) */
export function consensus(runs) {
  const out = {};
  for (const a of ATTRS) {
    const cnt = new Map();
    for (const r of runs) for (const v of a.multi > 1 ? r[a.key] : [r[a.key]]) cnt.set(v, (cnt.get(v) || 0) + 1);
    const sorted = [...cnt.entries()].sort((x, y) => y[1] - x[1]);
    if (a.multi > 1) {
      const maj = sorted.filter(([, c]) => c * 2 > runs.length).map(([v]) => v).slice(0, a.multi);
      out[a.key] = maj.length ? maj : [sorted[0][0]];
    } else out[a.key] = sorted[0][0];
  }
  return out;
}

export function attrText(r) {
  return ATTRS.map((a) => `${a.label}: ${a.multi > 1 ? r[a.key].join(", ") : r[a.key]}`).join("\n");
}

/** 값 구절 → 임베딩 표. 어휘가 작아서 한 번에 받는다 */
export async function valueTable(embed) {
  const phrases = [];
  for (const a of ATTRS) for (const v of a.values) phrases.push({ k: `${a.key}|${v}`, text: `얼굴 인상 — ${a.label}: ${v}` });
  const vecs = await embed(phrases.map((p) => p.text), 3072);
  return Object.fromEntries(phrases.map((p, i) => [p.k, vecs[i]]));
}

/** 속성 → 이어 붙인 벡터(속성마다 3072, 가중치·다중값은 평균). 길이는 정규화하지 않는다 — PCA 뒤에 한다 */
export function concatVec(r, table) {
  const parts = [];
  for (const a of ATTRS) {
    const vals = a.multi > 1 ? r[a.key] : [r[a.key]];
    const m = new Array(3072).fill(0);
    // 여러 칸짜리는 앞에 쓴 것(더 맞는 것)에 조금 더
    let wsum = 0;
    vals.forEach((v, i) => {
      const w = a.multi > 1 ? 1 / (1 + 0.35 * i) : 1;
      wsum += w;
      const e = table[`${a.key}|${v}`];
      for (let j = 0; j < 3072; j++) m[j] += w * e[j];
    });
    const s = Math.sqrt(a.w) / wsum;
    for (let j = 0; j < 3072; j++) parts.push(m[j] * s);
  }
  return parts;
}

/** 속성마다 값 임베딩을 가운데로 옮기고(공통 머리 제거) 그 값들이 펼치는 정규직교 기저를 만든다 — 차원 = Σ(값 수 − 1) */
export function bases(table) {
  const out = {};
  for (const a of ATTRS) {
    const vs = a.values.map((v) => table[`${a.key}|${v}`]);
    const mean = new Array(3072).fill(0);
    for (const v of vs) for (let j = 0; j < 3072; j++) mean[j] += v[j] / vs.length;
    const cen = vs.map((v) => v.map((x, j) => x - mean[j]));
    const basis = [];
    for (const c of cen) {
      const r = c.slice();
      for (const b of basis) { const d = r.reduce((s, x, j) => s + x * b[j], 0); for (let j = 0; j < 3072; j++) r[j] -= d * b[j]; }
      const n = Math.sqrt(r.reduce((s, x) => s + x * x, 0));
      if (n > 1e-6 && basis.length < vs.length - 1) basis.push(r.map((x) => x / n));
    }
    out[a.key] = { mean, basis };
  }
  return out;
}

/** 속성 → 짧은 벡터(Σ(값−1) 차원). 두 얼굴의 내적 = Σ 가중치 × (가운데로 옮긴 값 임베딩끼리의 내적) 이 정확히 보존된다 */
export function attrVec(r, table, B) {
  const out = [];
  for (const a of ATTRS) {
    const vals = a.multi > 1 ? r[a.key] : [r[a.key]];
    const { mean, basis } = B[a.key];
    const m = new Array(3072).fill(0);
    let wsum = 0;
    vals.forEach((v, i) => {
      const w = a.multi > 1 ? 1 / (1 + 0.35 * i) : 1;
      wsum += w;
      const e = table[`${a.key}|${v}`];
      for (let j = 0; j < 3072; j++) m[j] += w * (e[j] - mean[j]);
    });
    const s = Math.sqrt(a.w) / wsum;
    for (const b of basis) out.push(s * m.reduce((acc, x, j) => acc + x * b[j], 0));
  }
  const n = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1;
  return out.map((x) => x / n);
}
