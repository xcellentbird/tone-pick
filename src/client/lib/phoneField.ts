/**
 * 전화번호 칸에 미리 들어가 있는 `010` 을 지킨다.
 *
 * 칸이 `010` 만 들고 포커스를 받으면 브라우저가 그 세 글자를 **통째로 선택한** 채로 준다.
 * 다음에 누르는 숫자 하나가 `010` 을 덮어써서, 운영자는 `010` 이 있는 줄 알고
 * 여덟 자리만 치고 `추가` 를 누른다 — 명단에 **여덟 자리짜리 번호**가 들어간다.
 * 그 줄에도 토큰과 링크가 생기므로 화면에는 아무 티가 안 나고, 파티 당일에야 드러난다.
 *
 * **씨앗만 있을 때만** 커서를 끝으로 민다. 이미 친 번호가 있을 때의 전체 선택은
 * "다 지우고 다시 치겠다" 라서 건드리지 않는다.
 *
 * 한 프레임 뒤에 민다 — 탭으로 들어온 포커스는 선택이 `focus` **뒤에** 잡히는 브라우저가
 * 있어서, 그 자리에서 밀면 도로 덮인다. 씨앗만 있는 칸이라 밀 때 잃을 위치도 없다.
 */
import { PHONE_SEED } from "../../shared/constants.ts";

export function keepPhoneSeed(e: { currentTarget: HTMLInputElement }) {
  const el = e.currentTarget;
  requestAnimationFrame(() => {
    if (el.value !== PHONE_SEED) return;
    el.setSelectionRange(el.value.length, el.value.length);
  });
}
