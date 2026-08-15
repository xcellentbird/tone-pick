/**
 * 사람 아바타 — 동물 한 마리를 성별 색 원에 담는다.
 *
 * 역할이 둘로 나뉜다.
 *   동물  **사람**을 구분한다. 닉네임 해시로 골라 어디서 보든 같은 동물이다
 *   배경  **성별**을 구분한다. 남 파랑 · 여 분홍 — 목록에서 남녀가 한눈에 갈린다
 *
 * 처음에는 배경도 해시 색이었다. 색이 사람을 구분해야 했기 때문인데,
 * 동물이 그 역할을 가져간 뒤로는 색이 다른 정보를 실을 수 있다 (ADR-30 보완).
 * 자리 탭의 성별 색과 같은 계열이라 화면 사이에서 뜻이 흔들리지 않는다.
 *
 * **목록·프로필·자리·현황이 같은 아바타를 쓴다.** "이 사람 어디 앉았지" 가 눈으로 풀린다.
 */
import { ANIMALS } from "../../shared/constants.ts";
import type { Gender } from "../../shared/types.ts";
import { seedOf } from "../../shared/fortune.ts";

export default function Avatar({
  nickname,
  gender,
  size = "md",
}: {
  nickname: string;
  gender: Gender;
  /** sm 자리 칩·순위 · md 목록 · lg 프로필 */
  size?: "sm" | "md" | "lg";
}) {
  const animal = ANIMALS[seedOf(nickname) % ANIMALS.length];
  return (
    <span className={`avatar ${size} ${gender === "M" ? "m" : "f"}`} aria-hidden>
      {animal}
    </span>
  );
}
