/**
 * DO 의 실패 사유 → 사용자에게 보여줄 문장.
 *
 * 문장은 전부 `copy.ts` 에서 온다. 여기서 새로 짓지 않는다.
 * 같은 실패에는 어디서 오든 같은 문장이 나가야 해서 한 곳에 모았다.
 */
import { ENTRY, HOST, HOST_UI, NOTE, POKE, REGISTER } from "../shared/copy.ts";
import { HOST_PIN_TRIES } from "../shared/constants.ts";

export function pokeMessage(error: string, detail?: number): string | undefined {
  // 서버는 라운드를 모른다. 중립 문구를 쓴다 (ADR-34)
  if (error === "closed") return POKE.blocked.anyClosed;
  if (error === "same_gender") return POKE.blocked.sameGender;
  if (error === "no_budget") return POKE.blocked.anyNoBudget(detail ?? 0);
  return undefined;
}

/**
 * 익명 쪽지 (ADR-98). **`pokeMessage` 를 돌려쓰지 마라** — 단위가 다르다(`회` 와 `장`).
 * 두 줄이 나란히 서는 자리가 있어서, 같은 단위로 부르면 한 가지 값으로 읽힌다.
 *
 * `bad_request` 에는 문구가 없다 — 빈 글도 120자 초과도 **화면이 먼저 막는다**
 * (`maxLength` 가 조용히 막고, 빈 글이면 버튼이 안 눌린다). 여기까지 오는 건 화면 밖에서
 * 두드린 경우라, 설명해 줄 사람이 없다.
 */
export function noteMessage(error: string, detail?: number): string | undefined {
  if (error === "closed") return NOTE.blocked.closed;
  if (error === "no_budget") return NOTE.blocked.noBudget(detail ?? 0);
  return undefined;
}

/**
 * 명단에 없는 토큰에는 **왜 없는지 말하지 않는다** (ADR-32).
 * "초대되지 않았습니다" 와 "그런 회차가 없습니다" 를 구분해 주면
 * 그 자체가 "이 사람이 이 파티에 있나"를 알려주는 창구가 된다.
 */
/**
 * 문 앞의 실패 문구 (ADR-75). **셋을 일부러 가른다** — 회차 없음 · 명단에 없음 · PIN 번호 틀림.
 * 뭉개면 번호를 잘못 친 사람이 PIN 번호를 계속 다시 쳐서 잠금에 걸린다.
 * `detail` 은 PIN 번호가 틀렸을 때 남은 횟수다.
 */
export function enterMessage(error: string, detail?: number): string | undefined {
  if (error === "not_found") return ENTRY.notFound;
  if (error === "not_invited") return ENTRY.notInvited;
  if (error === "too_many") return ENTRY.tooMany;
  if (error === "pin_wrong") return ENTRY.pinWrong(detail ?? 0);
  if (error === "pin_locked") return ENTRY.pinLocked;
  if (error === "bad_request") return ENTRY.pinFormat;
  return undefined;
}

export function registerMessage(error: string): string | undefined {
  if (error === "nick_taken") return REGISTER.err.nickTaken;
  // 이미 등록한 번호다 (ADR-75). 초대 쿠키가 만료된 것과 같은 말 — 문 앞에서 번호 + PIN 번호로 들어온다
  if (error === "unauthorized") return ENTRY.enterAgain;
  return undefined;
}

/**
 * 운영자 PIN 이 틀렸을 때 (ADR-94). 남은 횟수는 `warnAt` 이하부터 말한다 — 참가자의 `enterMessage` 와 같은 자리다.
 * **다 쓴 순간은 `tooMany` 다.** `0번 더 틀리면 막혀요` 는 말이 안 되고 사실도 아니다 — 이미 막혔다.
 */
export function hostPinMessage(left: number): string {
  if (left === 0) return HOST.pin.tooMany(HOST_PIN_TRIES.windowMs / 60_000);
  return left <= HOST_PIN_TRIES.warnAt ? HOST.pin.wrongLeft(left) : HOST.pin.wrong;
}

/**
 * 설정·일정 저장이 막혔을 때.
 *
 * `conflict`   — 콕 상한을 이미 쓴 횟수보다 낮게 내리려 했다. `detail` 은 지금 가장 많이 쓴 횟수다
 * `note_floor` — 익명 쪽지 장 수를 이미 보낸 장 수보다 낮게 내리려 했다 (0 은 언제나 된다). `detail` 도 같다
 * `locked`   — 콕이 오가기 시작해 굳은 항목이다 (ADR-35)
 * `order`    — 아직 오지 않은 예약 전환의 순서가 어긋났다 (ADR-93 후기)
 */
export function settingsMessage(error: string, detail?: number): string | undefined {
  if (error === "conflict") return HOST_UI.pokeFloor(detail ?? 0);
  if (error === "note_floor") return HOST_UI.noteFloor(detail ?? 0);
  if (error === "locked") return HOST_UI.frozen;
  if (error === "order") return HOST_UI.scheduleOrder;
  return undefined;
}

/** 발표가 자리를 끝내면 새 쌍을 넣지 못한다 (ADR-90). 빼기는 언제나 된다 */
export function apartMessage(error: string): string | undefined {
  return error === "closed" ? HOST_UI.seats.apart.afterReveal : undefined;
}

/** 발표가 끝나면 자리를 더 바꾸지 않는다. 그 밖에는 막을 일이 없다 */
export function seatingMessage(error: string): string | undefined {
  return error === "closed" ? HOST.seating.afterReveal : undefined;
}
