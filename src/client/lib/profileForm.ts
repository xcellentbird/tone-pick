/**
 * 등록 폼과 내 정보 수정 폼이 함께 쓰는 초안·검증.
 *
 * 두 화면이 **같은 것을 받는다** — 등록에서 낸 것을 나중에 고치는 일이라
 * 검증이 갈리면 등록은 통과한 값이 수정에서 막히거나 그 반대가 된다.
 * 서버도 같은 규칙을 다시 본다 (`cleanProfile`). 여기는 사람이 고치기 쉬우라고 있는 것이다.
 *
 * **전화번호는 여기 없다.** 입장할 때 확인한 값이라 폼에서 받지 않는다 (ADR-15).
 */
import { MBTI_AXES, REGISTER } from "../../shared/copy.ts";
import type { MyProfile, RegisterInput } from "../../shared/types.ts";
import { LIMITS, nicknameProblem, normalizeInstagram, realNameProblem } from "../../shared/constants.ts";

export interface ProfileDraft {
  nickname: string;
  realName: string;
  /** 문자열로 든다 — 숫자로 들면 지웠을 때 0 이 남는다 */
  age: string;
  gender: "M" | "F" | "";
  instagram: string;
  mbti: Record<number, string>;
  charms: [string, string, string];
}

export const EMPTY_DRAFT: ProfileDraft = {
  nickname: "",
  realName: "",
  age: "",
  gender: "",
  instagram: "",
  mbti: {},
  charms: ["", "", ""],
};

/** 저장된 내 정보를 폼 초안으로. 수정 폼의 출발점이다 */
export function draftOf(me: MyProfile): ProfileDraft {
  return {
    nickname: me.nickname,
    realName: me.realName,
    age: String(me.age),
    gender: me.gender,
    instagram: me.instagram ?? "",
    // MBTI 는 네 글자를 4문항 토글로 되돌린다 — 저장은 "ENFP", 화면은 문항별 선택이다
    mbti: Object.fromEntries(MBTI_AXES.map((_, i) => [i, me.mbti[i] ?? ""])),
    charms: [...me.charms] as [string, string, string],
  };
}

/** 폼 초안을 서버 입력으로. 등록도 수정도 이 모양 하나를 보낸다 */
export function toInput(d: ProfileDraft): RegisterInput {
  return {
    nickname: d.nickname.trim(),
    realName: d.realName.trim(),
    age: Number(d.age),
    gender: d.gender as "M" | "F",
    instagram: normalizeInstagram(d.instagram),
    mbti: MBTI_AXES.map((_, i) => d.mbti[i]).join(""),
    charms: d.charms.map((c) => c.trim()) as [string, string, string],
  };
}

/**
 * 검증은 화면 순서대로. `step` 을 주면 그 스텝만, 없으면 전부 본다 —
 * 등록은 스텝마다 막고, 수정은 한 화면이라 한 번에 본다.
 *
 * 돌려주는 `field` 는 곧 **요소 id** 다. 그래야 오류가 난 칸으로 스크롤·포커스가 따라간다 —
 * 키보드가 올라온 폰에서는 화면 밖 오류가 "아무 일도 없음" 으로 보인다.
 */
export function validateProfile(d: ProfileDraft, step?: number): { field: string; text: string } | null {
  if (step === undefined || step === 1) {
    // switch 는 전수 분기다 — 검증 코드가 늘면 여기가 컴파일 에러로 알려준다
    const nick = nicknameProblem(d.nickname);
    switch (nick) {
      case null:
        break;
      case "empty":
        return { field: "nickname", text: REGISTER.err.nick };
      case "short":
      case "long":
        return { field: "nickname", text: REGISTER.err.nickLen(LIMITS.nicknameMin, LIMITS.nicknameMax) };
      case "chars":
        return { field: "nickname", text: REGISTER.err.nickChars };
      default:
        return nick satisfies never;
    }
    const name = realNameProblem(d.realName);
    switch (name) {
      case null:
        break;
      case "empty":
        return { field: "realName", text: REGISTER.err.name };
      case "digit":
        return { field: "realName", text: REGISTER.err.nameDigit };
      case "long":
        return { field: "realName", text: REGISTER.err.nameLen(LIMITS.realNameMax) };
      default:
        return name satisfies never;
    }
    const age = Number(d.age);
    if (!Number.isInteger(age) || age < 18 || age > 99) return { field: "age", text: REGISTER.err.age };
    if (!d.gender) return { field: "gender", text: REGISTER.err.gender };
  }
  if (step === undefined || step === 2) {
    if (!d.instagram.trim()) return { field: "instagram", text: REGISTER.err.instaRequired };
    if (!/^[A-Za-z0-9._]+$/.test(d.instagram.trim())) {
      return { field: "instagram", text: REGISTER.err.insta };
    }
    // 상한은 서버와 같은 상수다 — 여기서 안 막으면 3스텝을 다 쓴 뒤에야 실패를 만난다
    if (d.instagram.trim().length > LIMITS.instagramMax) {
      return { field: "instagram", text: REGISTER.err.instaLen(LIMITS.instagramMax) };
    }
  }
  if (step === undefined || step === 3) {
    // 답 안 한 첫 문항·비어 있는 첫 칸을 가리킨다
    const blank = MBTI_AXES.findIndex((_, i) => !d.mbti[i]);
    if (blank >= 0) return { field: `mbti${blank}`, text: REGISTER.err.mbti };
    const missing = d.charms.findIndex((c) => !c.trim());
    if (missing >= 0) return { field: `charm${missing}`, text: REGISTER.err.charm(missing + 1) };
  }
  return null;
}
