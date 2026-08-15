/**
 * DO 의 실패 사유 → 사용자에게 보여줄 문장.
 *
 * 문장은 전부 `copy.ts` 에서 온다. 여기서 새로 짓지 않는다.
 * 운영자 대리 호출(데모 뷰)과 참가자 호출이 같은 문장을 쓰게 하려고 한 곳에 모았다.
 */
import { ENTRY, HOST, POKE, REGISTER } from "../shared/copy.ts";

export function pokeMessage(error: string, detail?: number): string | undefined {
  if (error === "closed") return POKE.blocked.closed;
  if (error === "same_gender") return POKE.blocked.sameGender;
  if (error === "no_budget") return POKE.blocked.noBudget(detail ?? 0);
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

export function seatingMessage(error: string): string | undefined {
  return error === "closed" ? HOST.seating.closed : undefined;
}
