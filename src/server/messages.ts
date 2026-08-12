/**
 * DO 의 실패 사유 → 사용자에게 보여줄 문장.
 *
 * 문장은 전부 `copy.ts` 에서 온다. 여기서 새로 짓지 않는다.
 * 운영자 대리 호출(데모 뷰)과 참가자 호출이 같은 문장을 쓰게 하려고 한 곳에 모았다.
 */
import { HOST, POKE, REGISTER } from "../shared/copy.ts";

export function pokeMessage(error: string, detail?: number): string | undefined {
  if (error === "closed") return POKE.blocked.closed;
  if (error === "same_gender") return POKE.blocked.sameGender;
  if (error === "no_budget") return POKE.blocked.noBudget(detail ?? 0);
  return undefined;
}

export function registerMessage(nickname: string) {
  return (error: string): string | undefined =>
    error === "nick_taken" ? REGISTER.err.nickTaken(nickname) : undefined;
}

export function seatingMessage(error: string): string | undefined {
  return error === "closed" ? HOST.seating.closed : undefined;
}
