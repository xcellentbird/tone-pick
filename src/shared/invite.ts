/**
 * 안내문을 완성한다 (ADR-32).
 *
 * **순수 함수다** — DO·요청·현재시각을 모르고, 화면과 테스트가 같은 함수를 본다.
 *
 * **안내문은 링크를 모른다.** 전원이 같은 글을 받고, 사람마다 다른 링크는 따로 복사해
 * 따로 보낸다 — 한 덩어리로 보내면 참가자가 링크만 집어내야 하고, 장소에 지도 링크를 넣은
 * 회차에서는 한 메시지에 링크가 둘이 된다. 그래서 이 함수는 **한 사람분이 아니라 한 회차분**이다.
 *
 * 채널을 가리지 않는다. 인스타 DM·문자·카톡 어디든 붙여넣는 글이라
 * 마크업을 넣지 않고 줄바꿈만 쓴다.
 */
export interface InviteVars {
  /** 회차의 장소. 없으면 자리만 비운다 — 보내는 걸 막지는 않는다 */
  place: string;
  /** 사람이 읽는 파티 일시 */
  when: string;
}

/** 템플릿에서 알아보는 자리들. 늘리면 화면 안내 문구(`templateHint`)도 같이 고친다 */
const SLOTS: Array<[string, keyof InviteVars]> = [
  // copy-ok — 치환 자리 이름이지 화면에 나가는 문구가 아니다
  ["{장소}", "place"],
  // copy-ok
  ["{일시}", "when"],
];

/**
 * 링크가 안내문에 들어가던 시절의 자리.
 *
 * 저장해 둔 문구에 남아 있으면 **지운다.** 그대로 두면 참가자에게 `{링크}` 라는 글자가
 * 그대로 가고, 채워 넣으면 전원이 같은 글을 받는다는 전제가 깨진다 —
 * 한 사람의 링크가 모두에게 나가는 사고가 거기서 나온다.
 */
// copy-ok — 치환 자리 이름이다
const GONE_LINK = "{링크}";

export function renderInvite(template: string, v: InviteVars): string {
  return template
    .split("\n")
    // `{링크}` 만 있던 줄은 줄째로 없앤다. 남기면 빈 줄이 뜬금없이 생긴다
    .filter((line) => line.trim() === "" || line.split(GONE_LINK).join("").trim() !== "")
    .map((line) => {
      const without = line.split(GONE_LINK).join("");
      return SLOTS.reduce((text, [slot, key]) => text.split(slot).join(v[key]), without).trimEnd();
    })
    .join("\n")
    .trimEnd();
}
