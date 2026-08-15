/**
 * MBTI 배지 — 네 기질 계열로 색을 입힌다.
 *
 * 16가지에 16색을 주면 아무 색도 기억되지 않는다. 통용되는 네 묶음으로 접는다.
 *   NT 분석(보라) · NF 외교(초록) · SJ 관리(파랑) · SP 탐험(노랑)
 * — 16personalities 의 색 관행이라, 아는 사람에게는 설명 없이 읽힌다.
 *
 * 묶는 규칙은 운세의 `matchTypes` 와 같은 기준이다:
 * N/S 가 첫 갈림, N 이면 T/F 로, S 면 J/P 로 갈린다.
 */
const groupOf = (mbti: string): "nt" | "nf" | "sj" | "sp" | null => {
  if (!/^[EI][NS][TF][JP]$/.test(mbti)) return null;
  if (mbti[1] === "N") return mbti[2] === "T" ? "nt" : "nf";
  return mbti[3] === "J" ? "sj" : "sp";
};

export default function Mbti({ value }: { value: string }) {
  const group = groupOf(value);
  // 모양이 어긋난 값이면 색 없이 그대로 — 잘못된 색을 입히느니 안 입힌다
  return <span className={["badge", group && `mbti-${group}`].filter(Boolean).join(" ")}>{value}</span>;
}
