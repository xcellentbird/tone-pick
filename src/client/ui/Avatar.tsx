/**
 * 사람 아바타 — 동물 한 마리를 색 사각형에 담는다.
 *
 * 성별 이모지(🙋‍♀️)를 쓰던 자리다. 성별만 알려주고 **사람은 구분해주지 못했다** —
 * 스무 명 목록에서 같은 이모지가 열두 번 반복되면 눈이 미끄러진다.
 *
 * 동물과 색을 **둘 다** 닉네임 해시로 고른다. 40마리 × 6색이라 겹칠 일이 드물고,
 * 겹쳐도 색이 다르면 갈린다.
 *
 * 성별로 칠하지 않는 이유는 둘이다.
 *   · 같은 성별끼리 색이 같아지면 구분이라는 목적을 잃는다
 *   · 성별은 '이성만' 필터와 자리 탭의 ♂♀ 로 이미 드러난다
 * 성별 색(`--male`/`--female`)은 자리 배정 화면 전용으로 남겨둔다 (CLAUDE.md).
 *
 * **목록·프로필·자리·현황이 같은 색을 쓴다.** 그래야 "이 사람 어디 앉았지" 가 눈으로 풀린다.
 */
import { ANIMALS } from "../../shared/constants.ts";
import { seedOf } from "../../shared/fortune.ts";

/** 테마에 정의된 아바타 색 수. 여기만 바꾸면 색이 늘어난다 */
const TONES = 6;

export default function Avatar({
  nickname,
  size = "md",
}: {
  nickname: string;
  /** sm 자리 칩 · md 목록 · lg 프로필 */
  size?: "sm" | "md" | "lg";
}) {
  const seed = seedOf(nickname);
  // 동물과 색을 서로 다른 자리에서 뽑는다. 같은 씨앗을 그대로 쓰면 둘이 함께 움직인다
  const animal = ANIMALS[seed % ANIMALS.length];
  const tone = ((seed >> 5) % TONES) + 1;
  return (
    <span className={`avatar ${size} c${tone}`} aria-hidden>
      {animal}
    </span>
  );
}
