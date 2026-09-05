/**
 * 안내문을 완성한다 (ADR-32 · ADR-75).
 *
 * **순수 함수다** — DO·요청·현재시각을 모르고, 화면과 테스트가 같은 함수를 본다.
 *
 * **안내문 하나가 완결된 초대장이다.** 링크가 회차마다 하나라(ADR-75) 전원이 같은 글을 받고,
 * 그래서 `{링크}` 를 안내문 안에 둘 수 있다 — 한 사람의 링크가 남에게 나갈 수가 없다.
 * ADR-32 후기 ① 이 링크를 빼냈던 이유가 그 사고였는데, 사람마다 다른 링크가 없어지며 함께 사라졌다.
 * 이 함수는 **한 사람분이 아니라 한 회차분**이다.
 *
 * 채널을 가리지 않는다. 인스타 DM·문자·카톡 어디든 붙여넣는 글이라
 * 마크업을 넣지 않고 줄바꿈만 쓴다.
 */
export interface InviteVars {
  /** 회차의 장소. 없으면 자리만 비운다 — 보내는 걸 막지는 않는다 */
  place: string;
  /** 사람이 읽는 파티 일시 */
  when: string;
  /** 이 회차의 참가 링크. 전원이 같은 것이다 */
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

/** 안내문에 링크 자리가 있나. 없으면 `renderInvite` 가 맨 끝에 붙인다 */
// copy-ok
export const hasLinkSlot = (template: string): boolean => template.includes("{링크}");

export function renderInvite(template: string, v: InviteVars): string {
  const body = template
    .split("\n")
    .map((line) => SLOTS.reduce((text, [slot, key]) => text.split(slot).join(v[key]), line).trimEnd())
    .join("\n")
    .trimEnd();
  /*
   * **`{링크}` 가 없으면 맨 끝 줄에 붙인다.** 링크 없는 안내문은 초대장이 아니다 — 받은 사람이
   * 갈 곳이 없다. ADR-32 시절의 문구(`함께 보내드린 링크로…`)가 운영자 기본값에 저장돼 있는
   * 회차가 있고, 운영자가 자리를 빼먹을 수도 있다. 어느 쪽이든 조용히 링크가 빠지는 것보다
   * 한 줄 더 붙는 편이 낫다. 자리를 쓰면 그 자리에만 들어간다.
   */
  return hasLinkSlot(template) || !v.link ? body : `${body}\n${v.link}`;
}
