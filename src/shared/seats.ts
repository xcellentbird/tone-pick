import type { Gender } from "./types.ts";

/**
 * 자리 없는 사람을 **어느 테이블에 넣을지** 고른다 (`SEATING.md` 의 앉히기 규칙).
 *
 * 자기 성별이 가장 적은 테이블 → 같으면 사람이 적은 쪽 → 그것도 같으면 낮은 번호.
 * **난수를 쓰지 않는다.** 같은 상태면 같은 답이라, 시트가 *3번에 앉혀요* 라고 미리 말한 뒤
 * 서버가 다른 번호에 앉히는 일이 없다 — 그 어긋남은 화면이 하는 거짓말이 된다.
 *
 * 서버(`seatPlayer`)와 화면(앉힐 자리 고르기 시트)이 **같은 함수**를 쓴다.
 * 규칙을 두 곳에 적으면 한쪽만 고쳐지고, 그때 틀리는 쪽은 언제나 화면이다.
 */
export function autoTable(
  seats: readonly { playerId: string; table: number }[],
  tableCount: number,
  genderOf: (playerId: string) => Gender | undefined,
  mine: Gender,
): number {
  let best = 1;
  let bestKey: [number, number] = [Infinity, Infinity];
  for (let t = 1; t <= tableCount; t++) {
    const here = seats.filter((s) => s.table === t);
    const key: [number, number] = [here.filter((s) => genderOf(s.playerId) === mine).length, here.length];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      best = t;
      bestKey = key;
    }
  }
  return best;
}
