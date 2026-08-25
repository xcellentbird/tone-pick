/**
 * DO 의 실패 사유 → 사용자에게 보여줄 문장.
 *
 * 문장은 전부 `copy.ts` 에서 온다. 여기서 새로 짓지 않는다.
 * 같은 실패에는 어디서 오든 같은 문장이 나가야 해서 한 곳에 모았다.
 */
import { ENTRY, HOST, HOST_UI, POKE, REGISTER } from "../shared/copy.ts";

export function pokeMessage(error: string, detail?: number): string | undefined {
  // 서버는 라운드를 모른다. 중립 문구를 쓴다 (ADR-34)
  if (error === "closed") return POKE.blocked.anyClosed;
  if (error === "same_gender") return POKE.blocked.sameGender;
  if (error === "no_budget") return POKE.blocked.anyNoBudget(detail ?? 0);
  return undefined;
}

/**
 * 명단에 없는 번호에는 **왜 없는지 말하지 않는다.**
 * "초대되지 않았습니다" 와 "그런 회차가 없습니다" 를 구분해 주면
 * 그 자체가 "이 파티에 이 번호가 있나"를 알려주는 창구가 된다.
 */
export function enterMessage(error: string): string | undefined {
  if (error === "not_invited") return ENTRY.notInvited;
  if (error === "too_many") return ENTRY.tooMany;
  return undefined;
}

export function registerMessage(nickname: string) {
  return (error: string): string | undefined =>
    error === "nick_taken" ? REGISTER.err.nickTaken(nickname) : undefined;
}

/**
 * 설정·일정 저장이 막혔을 때.
 *
 * `conflict` — 이미 쓴 횟수보다 낮게 내리려 했다. `detail` 은 지금 가장 많이 쓴 횟수다
 * `locked`   — 콕이 오가기 시작해 굳은 항목이다 (ADR-35)
 */
export function settingsMessage(error: string, detail?: number): string | undefined {
  if (error === "conflict") return HOST_UI.pokeFloor(detail ?? 0);
  if (error === "locked") return HOST_UI.frozen;
  return undefined;
}

/** 발표가 끝나면 자리를 더 바꾸지 않는다. 그 밖에는 막을 일이 없다 */
export function seatingMessage(error: string): string | undefined {
  return error === "closed" ? HOST.seating.afterReveal : undefined;
}
