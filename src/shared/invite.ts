/**
 * 안내문을 완성한다 (ADR-32).
 *
 * **순수 함수다** — DO·요청·현재시각을 모르고, 화면과 테스트가 같은 함수를 본다.
 * 링크가 사람마다 다르므로 이 함수는 **한 사람분**을 만든다.
 *
 * 채널을 가리지 않는다. 인스타 DM·문자·카톡 어디든 붙여넣는 글이라
 * 마크업을 넣지 않고 줄바꿈만 쓴다.
 */
export interface InviteVars {
  /** 회차의 장소. 없으면 자리만 비운다 — 보내는 걸 막지는 않는다 */
  place: string;
  /** 사람이 읽는 파티 일시 */
  when: string;
  /** 그 사람의 참가 링크 */
  link: string;
}

/** 템플릿에서 알아보는 자리들. 늘리면 화면 안내 문구(`templateHint`)도 같이 고친다 */
const SLOTS: Array<[string, keyof InviteVars]> = [
  // copy-ok — 치환 자리 이름이지 화면에 나가는 문구가 아니다
  ["{장소}", "place"],
  // copy-ok
  ["{일시}", "when"],
  // copy-ok
  ["{링크}", "link"],
];

export function renderInvite(template: string, v: InviteVars): string {
  return SLOTS.reduce((text, [slot, key]) => text.split(slot).join(v[key]), template);
}
