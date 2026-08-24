/**
 * 슬라이스 02·03 — 등록 · 초대 명단 · 공개 범위 · 콕
 *
 * 이 파일은 **규칙이 지켜지는가**만 본다. 함수 하나하나가 아니라
 * "참가자에게 나가는 응답에 무엇이 들어 있는가"를 공개 표면에서 확인한다.
 *
 * 이 앱이 없애려는 건 거절당하는 경험이다. 그래서 아래 셋은 기능이 아니라 정체성이다.
 *   · 일방적으로 받은 콕은 끝까지 익명이다
 *   · 실명·전화번호·인스타는 매칭돼도 상대에게 가지 않는다
 *   · 발표 전에는 발신자(fromId)가 응답에 아예 없다
 *
 * ⚠️ **이 파일을 다시 100개까지 불리지 마라.** 워커 테스트는 한 파일 안에서
 * 앞 테스트가 쌓아놓은 것이 뒤 테스트에 붙어 초선형으로 느려진다 — 예전엔 이 파일 하나가
 * 198초였고 끝쪽 테스트는 11초씩 걸렸다. 재료는 `helpers/party.ts` 에 있으니 나누면 된다.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ENTRY, POKE, REGISTER } from "../src/shared/copy.ts";
import { ENTRY_TRIES, formatPhone, typedPhone } from "../src/shared/constants.ts";
import type {
  ParticipantState,
  RegisterResult,
} from "../src/shared/types.ts";
import { signInMaster, api, enter, freshEvent, invite, join, master, nextPhone, person, setPhase } from "./helpers/party.ts";

beforeAll(signInMaster);

const HOUR = 3600_000;

// ─────────────────────────────────────────── 등록

describe("등록", () => {
  it("닉네임은 회차 안에서 유일하다", async () => {
    const ev = await freshEvent();
    await join(ev, { nickname: "겹치는닉" });
    const phone = nextPhone();
    const gate = await enter(ev.id, await invite(ev.id, phone));
    const res = await api<{ error: string; message: string }>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person({ nickname: "겹치는닉", gender: "F" }),
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("nick_taken");
    // 에러는 그 값을 입력한 자리로 되돌릴 수 있게 닉네임을 담아 알려준다
    expect(res.body.message).toBe(REGISTER.err.nickTaken("겹치는닉"));
  });

  it("다른 회차의 같은 닉네임은 상관없다", async () => {
    const a = await freshEvent();
    const b = await freshEvent();
    await join(a, { nickname: "같은닉" });
    const second = await join(b, { nickname: "같은닉" });
    expect(second.id).toBeTruthy();
  });

  it("★ 인스타 없이는 등록되지 않는다", async () => {
    // 매칭되면 서로에게 공개되는 연락 수단이라 (ADR-19) 없이는 매칭이 반쪽이 된다
    const ev = await freshEvent();
    const phone = nextPhone();
    const gate = await enter(ev.id, await invite(ev.id, phone));

    for (const instagram of [undefined, "", "  ", "한글아이디", "no spaces!"]) {
      const res = await api("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: { ...person(), instagram },
      });
      expect(res.status, `instagram=${JSON.stringify(instagram)}`).toBe(400);
    }
  });

  it("붙여넣은 @아이디·프로필 URL 은 오류가 아니다 — 벗겨서 받는다", async () => {
    // 가장 흔한 '유효하지 않은 값'은 오타가 아니라 붙여넣기다. 의도가 명백하면 고쳐준다
    const ev = await freshEvent();
    for (const pasted of ["@my.id", "https://www.instagram.com/my.id?igsh=abc", "instagram.com/my.id/"]) {
      const phone = nextPhone();
      const gate = await enter(ev.id, await invite(ev.id, phone));
      const res = await api<RegisterResult>("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: { ...person(), instagram: pasted },
      });
      expect(res.status, `instagram=${pasted} → ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.state.me.instagram).toBe("my.id");
    }
  });

  it("★ 게시물·릴스 URL 의 예약 경로는 아이디로 저장되지 않는다", async () => {
    // instagram.com/p/... 에서 "p" 를 아이디로 저장하면, 발표 때 매칭 상대의
    // 연락 카드에 존재하지 않는 계정이 뜬다 — 조용히 틀리느니 오류가 낫다
    const ev = await freshEvent();
    const phone = nextPhone();
    const gate = await enter(ev.id, await invite(ev.id, phone));
    for (const pasted of [
      "https://www.instagram.com/p/DAbC123xyz/",
      "https://www.instagram.com/reel/xyz987/",
      "instagram.com/stories/my.id/123456",
    ]) {
      const res = await api("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: { ...person(), instagram: pasted },
      });
      expect(res.status, `instagram=${pasted}`).toBe(400);
    }
  });

  it("인스타 30자·실명 20자·매력 100자 상한을 서버가 지킨다", async () => {
    // 화면 검증을 우회해 API 로 바로 쏘는 참가자가 있다
    const ev = await freshEvent();
    const over = [
      { instagram: "a".repeat(31) },
      { realName: "가".repeat(21) },
      { charms: ["요리를 잘해요", "잘 웃어요", "가".repeat(101)] as [string, string, string] },
    ];
    for (const bad of over) {
      const phone = nextPhone();
      const gate = await enter(ev.id, await invite(ev.id, phone));
      const res = await api("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: { ...person(), ...bad },
      });
      expect(res.status, JSON.stringify(Object.keys(bad))).toBe(400);
    }
  });

  it("닉네임은 한 글자부터, 한글·영문만 받는다", async () => {
    const ev = await freshEvent();
    const phone = nextPhone();
    const gate = await enter(ev.id, await invite(ev.id, phone));

    for (const nickname of ["", "닉!네임", "닉 네임", "nick_name", "★별빛", "달빛3", "2세"]) {
      const res = await api("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: person({ nickname }),
      });
      expect(res.status, `nickname=${JSON.stringify(nickname)}`).toBe(400);
    }

    // 한 글자도 통과한다
    const one = await api("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person({ nickname: "나" }),
    });
    expect(one.status, JSON.stringify(one.body)).toBe(200);

    // 한글·영문을 섞은 건 통과한다
    const ok = await api("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person({ nickname: "달빛moon" }),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("실명에는 숫자를 넣을 수 없다", async () => {
    const ev = await freshEvent();
    const phone = nextPhone();
    const gate = await enter(ev.id, await invite(ev.id, phone));

    const res = await api("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person({ realName: "김실명2" }),
    });
    expect(res.status).toBe(400);
  });

  it("자소 분리형(NFD) 한글도 받는다", async () => {
    // macOS·iOS 의 일부 경로는 한글을 NFD 로 준다 — 눈에는 같은 "달빛"인데 코드포인트가 다르다
    const ev = await freshEvent();
    const phone = nextPhone();
    const gate = await enter(ev.id, await invite(ev.id, phone));

    const res = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person({ nickname: "달빛".normalize("NFD"), realName: "김달빛".normalize("NFD") }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // 저장은 NFC 한 벌로 — 나중에 NFC 로 온 같은 닉네임과 유일성 비교가 어긋나면 안 된다
    expect(res.body.state.me.nickname).toBe("달빛");
  });

  it("문자열이 아닌 값을 보내면 500이 아니라 400이다", async () => {
    // 폼을 우회해 API 로 바로 쏘는 참가자 — 검증이 크래시 통로가 되면 안 된다
    const ev = await freshEvent();
    const phone = nextPhone();
    const gate = await enter(ev.id, await invite(ev.id, phone));

    for (const bad of [
      { nickname: ["달빛"] },
      { realName: true },
      { charms: "셋 아님" },
      { charms: ["하나", "둘", 3] },
      { mbti: ["E", "N", "F", "P"] },
    ]) {
      const res = await api("/api/register", {
        method: "POST",
        cookie: gate.cookie,
        body: { ...person(), ...bad },
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("같은 전화번호로 다시 오면 그 사람으로 재접속한다", async () => {
    const ev = await freshEvent();
    const first = await join(ev, { nickname: "처음닉" });
    // 같은 번호로 문을 다시 두드리면 곧바로 참가자 세션이 나온다 — 등록 폼을 다시 채우지 않는다
    const back = await enter(ev.id, first.token);
    expect(back.status).toBe(200);
    expect(back.body.registered).toBe(true);
    expect(back.body.code).toBe(ev.code);

    const again = await api<ParticipantState>("/api/me", { cookie: back.cookie });
    expect(again.status).toBe(200);
    expect(again.body.me.id).toBe(first.id);
    expect(again.body.me.nickname).toBe("처음닉");
    // 인원이 늘지 않는다 — 참가자 응답에는 수가 없으므로 운영자 쪽에서 센다
    const host = await api<{ players: unknown[] }>(`/api/host/events/${ev.id}/state`, { cookie: master });
    expect(host.body.players.length).toBe(1);
  });
});

// ─────────────────────────────────────────── 초대 명단

/**
 * 파티에 들어오는 문은 **운영자가 미리 넣어둔 전화번호**다 (ADR-15).
 *
 * 코드 여섯 자리는 옮겨 적을 수 있지만 남의 번호로는 들어올 수 없다.
 * 그리고 이 문은 인증 없이 열려 있어서, 제한이 없으면
 * "이 번호가 이 파티에 있나"를 되묻는 창구가 된다.
 */

// ─────────────────────────────────────────── 초대 명단

/**
 * 파티에 들어오는 문은 **운영자가 미리 넣어둔 전화번호**다 (ADR-15).
 *
 * 코드 여섯 자리는 옮겨 적을 수 있지만 남의 번호로는 들어올 수 없다.
 * 그리고 이 문은 인증 없이 열려 있어서, 제한이 없으면
 * "이 번호가 이 파티에 있나"를 되묻는 창구가 된다.
 */
describe("초대 명단", () => {
  /*
   * 운영자가 명단에 넣는 번호와 참가자가 문 앞에서 치는 번호가 **같아야** 문이 열린다.
   * 그래서 두 칸이 같은 모양이다 — `010` 이 미리 들어가 있고 하이픈으로 끊겨 보인다.
   * 두 칸의 규칙이 갈라지면 같은 번호가 다르게 저장되고, 그건 파티 당일 문 앞에서야 드러난다.
   */
  it("★ 사람이 번호를 넣는 여러 길이 모두 같은 번호가 된다", () => {
    /*
     * 치는 것만이 아니다. 붙여넣고, 자동완성을 쓰고, 연락처에서 가져온다.
     * **어느 길로 와도 같은 번호가 저장돼야** 운영자가 넣은 것과 참가자가 친 것이 맞는다.
     * 조용히 틀리면 파티 당일 문 앞에서야 드러난다.
     */
    for (const raw of [
      "01012345678",
      "010-1234-5678",
      // iPhone 연락처는 국가번호를 붙여 저장한다. 안드로이드는 안 그래서 오래 안 보였다
      "+82 10-1234-5678",
      "+821012345678",
      "+82 010-1234-5678",
      "+82 (10) 1234 5678",
      // 미리 든 `010` 뒤에 커서를 두고 붙여넣은 경우 — 국가번호가 함께 와도
      "010" + "010-1234-5678",
      "010" + "+82 10-1234-5678",
    ]) {
      expect(typedPhone(raw), raw).toBe("01012345678");
    }

    // 열한 자리짜리 진짜 번호는 건드리지 않는다
    expect(typedPhone("010-0104-5678")).toBe("01001045678");
    // 옛 열 자리 번호도 명단에 들어간다 (서버 문턱은 아홉 자리다)
    expect(typedPhone("011-234-5678")).toBe("0112345678");
    // 씨앗만 있는 상태
    expect(typedPhone("010")).toBe("010");
  });

  it("끊는 자리는 언제나 3-4-4 다 — 마지막 글자에서 칸이 흔들리지 않게", () => {
    expect(formatPhone("010")).toBe("010");
    expect(formatPhone("0101234")).toBe("010-1234");
    expect(formatPhone("01012345678")).toBe("010-1234-5678");
  });

  it("★ 명단에 없는 토큰으로는 들어올 수 없다", async () => {
    const ev = await freshEvent();
    await invite(ev.id, "01011112222");

    // 번호를 아는 것은 이제 아무 힘이 없다. 문을 여는 건 그에게 배달된 토큰뿐이다 (ADR-32)
    const res = await enter(ev.id, "f".repeat(32));
    expect(res.status).toBe(403);
    expect(res.cookie).toBeNull();
    expect((res.body as unknown as { message: string }).message).toBe(ENTRY.notInvited);

    // 쿠키가 없으니 등록도 되지 않는다
    const reg = await api("/api/register", { method: "POST", body: person() });
    expect(reg.status).toBe(401);
  });

  it("★ 자기 토큰이면 통과하고, 등록 폼은 번호를 묻지 않는다", async () => {
    const ev = await freshEvent();
    const phone = nextPhone();
    const token = await invite(ev.id, phone);

    const gate = await enter(ev.id, token);
    expect(gate.status).toBe(200);
    expect(gate.body.registered).toBe(false);

    // 폼에 번호가 없어도 등록된다 — 서버가 통과한 번호를 들고 있다
    const reg = await api<RegisterResult>("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      body: person({ nickname: "번호없이" }),
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    expect(reg.body.state.me.nickname).toBe("번호없이");
  });

  it("★ 폼으로 다른 번호를 밀어 넣어도 통과한 번호로 등록된다", async () => {
    const ev = await freshEvent();
    const phone = nextPhone();
    const gate = await enter(ev.id, await invite(ev.id, phone));

    await api("/api/register", {
      method: "POST",
      cookie: gate.cookie,
      // 명단에 없는 번호를 폼에 실어 보낸다
      body: { ...person({ nickname: "바꿔치기" }), phone: "01099998888" },
    });

    // 운영자 눈에는 통과한 번호로 보인다
    const state = await api<{ players: Array<{ nickname: string; phone: string }> }>(
      `/api/host/events/${ev.id}/state`,
      { cookie: master },
    );
    const made = state.body.players.find((p) => p.nickname === "바꿔치기");
    expect(made?.phone).toBe(phone);
  });

  it("★ 이미 등록한 사람은 명단에서 빠져도 다시 들어온다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    // 운영자가 명단에서 그 사람을 뺀다
    const out = await api(`/api/host/events/${ev.id}/invites/${me.phone}`, { method: "DELETE", cookie: master });
    expect(out.status).toBe(200);

    const back = await enter(ev.id, me.token);
    expect(back.status).toBe(200);
    expect(back.body.registered).toBe(true);
  });

  it("★ 문을 계속 두드리면 막힌다 — 문은 여전히 인증 없이 열려 있다", async () => {
    const ev = await freshEvent();
    await invite(ev.id, nextPhone());

    let blocked = 0;
    for (let i = 0; i < ENTRY_TRIES.max + 2; i++) {
      const res = await enter(ev.id, String(i).padStart(32, "a"));
      if (res.status === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
  });

  it("★ 명단은 참가자 응답 어디에도 없다", async () => {
    const ev = await freshEvent();
    const secret = "01077776666";
    await invite(ev.id, secret);
    const me = await join(ev);

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.status).toBe(200);
    expect(JSON.stringify(state.body)).not.toContain(secret);
    expect(Object.keys(state.body)).not.toContain("invites");
  });

  it("★ 명단을 통째로 갈아치우는 길은 없다 — 더하기만 있다", async () => {
    const ev = await freshEvent();
    await invite(ev.id, "01011112222");
    await invite(ev.id, "01033334444");

    // 한 명을 더해도 앞의 둘이 남아 있어야 한다
    const res = await api<Array<{ phone: string }>>(`/api/host/events/${ev.id}/invites`, {
      method: "POST",
      cookie: master,
      body: { phones: ["01055556666"] },
    });
    expect(res.status).toBe(200);
    expect(res.body.map((i) => i.phone).sort()).toEqual(["01011112222", "01033334444", "01055556666"]);

    // 같은 번호를 다시 넣어도 늘지 않는다
    const again = await api<Array<{ phone: string }>>(`/api/host/events/${ev.id}/invites`, {
      method: "POST",
      cookie: master,
      body: { phones: ["01011112222"] },
    });
    expect(again.body.length).toBe(3);
  });

  it("명단 조회·수정은 운영자만 한다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    for (const cookie of [null, me.cookie]) {
      const res = await api(`/api/host/events/${ev.id}/invites`, {
        method: "POST",
        cookie,
        body: { phones: ["01011112222"] },
      });
      expect(res.status).toBe(401);
    }
  });
});

// ─────────────────────────────────────────── 공개 범위

describe("공개 범위", () => {
  it("★ 참가자 명단에 실명·전화번호·인스타가 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F", realName: "박비밀", instagram: "secret_gram" });
    await setPhase(ev.id, "prevote");   // 명단은 사전 투표부터 열린다 (ADR-21)

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.status).toBe(200);
    expect(state.body.roster.length).toBe(1);

    const raw = JSON.stringify(state.body.roster);
    expect(raw).not.toContain("박비밀");
    expect(raw).not.toContain(her.phone);
    expect(raw).not.toContain("secret_gram");
    for (const leak of ["realName", "phone", "instagram"]) {
      expect(Object.keys(state.body.roster[0])).not.toContain(leak);
    }
  });

  it("★ 발표 전에는 누가 찔렀는지 응답에 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");

    await api("/api/poke", { method: "POST", cookie: her.cookie, body: { toId: me.id } });

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.poke.receivedCount).toBe(1);
    // 받은 콕은 횟수만 있다. 명단에는 그녀가 있지만(찌를 수 있어야 하니까),
    // 콕 쪽에는 발신자로 이어질 값이 하나도 없어야 한다
    const raw = JSON.stringify(state.body.poke);
    expect(raw).not.toContain("fromId");
    expect(raw).not.toContain(her.id);
    expect(state.body.poke.matches).toEqual([]);
  });

  it("★ 발표 후에도 일방적인 콕은 익명이다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });
    const other = await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");

    // her → me 만. 나는 아무도 찌르지 않았다
    await api("/api/poke", { method: "POST", cookie: her.cookie, body: { toId: me.id } });
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.poke.receivedCount).toBe(1);
    expect(state.body.poke.matches).toEqual([]);
    const raw = JSON.stringify(state.body.poke);
    expect(raw).not.toContain(her.id);
    expect(raw).not.toContain(other.id);
  });

  /**
   * 발표 후 서로 찌른 상대에게 나가는 것은 **실명 하나뿐이다** (ADR-42).
   *
   * 한동안 전화번호와 인스타도 함께 나갔다 (ADR-19). 그 통로를 닫았다 —
   * 앱이 하는 일은 *누구와 마음이 맞았는지*까지고, 연락은 그 자리에서 두 사람이 직접 한다.
   * **`MatchInfo` 에 그 값이 담길 자리 자체가 없다**는 게 지금의 방어다.
   */
  it("★ 발표 후 서로 찌른 상대의 실명이 열린다 — 연락처는 아니다", async () => {
    const ev = await freshEvent();
    const me = await join(ev, { nickname: "나야나" });
    const her = await join(ev, { gender: "F", nickname: "그녀", realName: "이실명", instagram: "her_gram" });
    await setPhase(ev.id, "party");

    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    await api("/api/poke", { method: "POST", cookie: her.cookie, body: { toId: me.id } });
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.poke.matches.length).toBe(1);
    expect(state.body.poke.matches[0].player.nickname).toBe("그녀");
    expect(state.body.poke.matches[0].realName).toBe("이실명");

    /*
     * **매칭 안에도 연락처가 없다.** 화면에서 감추는 걸로는 부족하다 —
     * 개발자 도구로 응답을 여는 참가자가 반드시 있고, 그 사람에게도 없어야 한다.
     */
    const raw = JSON.stringify(state.body);
    for (const [what, needle] of [
      ["전화번호", her.phone],
      ["인스타", "her_gram"],
    ] as const) {
      expect(raw, `${what} 가 응답에 남아 있다`).not.toContain(needle);
    }

    // 명단(roster)은 여전히 깨끗하다. 실명은 매칭 안에만 있다
    expect(JSON.stringify(state.body.roster)).not.toContain("이실명");
  });

  it("★ 발표 전에는 서로 찔렀어도 연락처가 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev, { nickname: "나야" });
    const her = await join(ev, { gender: "F", realName: "박비밀", instagram: "her_gram" });
    await setPhase(ev.id, "prevote");

    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    await api("/api/poke", { method: "POST", cookie: her.cookie, body: { toId: me.id } });

    // 아직 사전 투표 중이다
    const during = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(during.body.poke.matches).toEqual([]);
    const raw = JSON.stringify(during.body);
    expect(raw).not.toContain("박비밀");
    expect(raw).not.toContain(her.phone);
  });

  it("★ 한쪽만 찌른 상대의 연락처는 발표 뒤에도 나가지 않는다", async () => {
    const ev = await freshEvent();
    const me = await join(ev, { nickname: "나야" });
    const her = await join(ev, { gender: "F", realName: "박비밀", instagram: "one_way" });
    await setPhase(ev.id, "prevote");

    // 나만 찔렀다
    await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.poke.matches).toEqual([]);
    const raw = JSON.stringify(state.body);
    expect(raw).not.toContain("박비밀");
    expect(raw).not.toContain("one_way");
    expect(raw).not.toContain(her.phone);
  });

  it("★ 다른 회차의 세션으로는 이 회차 화면을 볼 수 없다", async () => {
    // 한 브라우저에 참가자 세션은 하나뿐이라, 다른 회차에 등록하면 앞의 세션이 덮인다.
    // 그때 앞 회차 주소를 열면 **다른 회차 자료가 그 주소로** 보이면 안 된다
    const first = await freshEvent();
    const second = await freshEvent();
    await join(first, { nickname: "앞회차" });
    const later = await join(second, { nickname: "뒷회차" });

    const wrong = await api(`/api/me?code=${first.code}`, { cookie: later.cookie });
    expect(wrong.status).toBe(401);

    const right = await api<ParticipantState>(`/api/me?code=${second.code}`, { cookie: later.cookie });
    expect(right.status).toBe(200);
    expect(right.body.event.code).toBe(second.code);
  });

  it("세션 없이는 참가자 API 에 닿을 수 없다", async () => {
    const ev = await freshEvent();
    const her = await join(ev, { gender: "F" });
    expect((await api("/api/me")).status).toBe(401);
    expect((await api("/api/poke", { method: "POST", body: { toId: her.id } })).status).toBe(401);
  });
});

// ─────────────────────────────────────────── 콕

describe("콕", () => {
  it("예산은 라운드별로 나뉘고, 같은 사람에게 중복해서 찌를 수 있다", async () => {
    const ev = await freshEvent();   // maxPre 2 · maxParty 3
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");

    const first = await api<{ budget: Record<string, { max: number; used: number }> }>("/api/poke", {
      method: "POST",
      cookie: me.cookie,
      body: { toId: her.id },
    });
    expect(first.status).toBe(200);
    // 같은 사람에게 한 번 더
    const second = await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    expect(second.status).toBe(200);

    // 세 번째는 사전 투표 예산을 넘는다
    const third = await api<{ error: string; message: string }>("/api/poke", {
      method: "POST",
      cookie: me.cookie,
      body: { toId: her.id },
    });
    expect(third.status).toBe(409);
    expect(third.body.error).toBe("no_budget");
    expect(third.body.message).toBe(POKE.blocked.anyNoBudget(2));

    /*
     * 파티 라운드로 넘어가면 새 예산이 지급된다. 매력 투표에서 쓴 것은 **예산에는 남고**
     * (`budget.pre.used`), **사람 옆 숫자에는 안 남는다** (`sentTo`) —
     * 그 숫자는 "이번 라운드에 이 사람에게 몇 번" 이라서다 (ADR-34).
     */
    await setPhase(ev.id, "party");
    const afterPhase = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(afterPhase.body.poke.budget.pre.used).toBe(2);
    expect(afterPhase.body.poke.budget.party.used).toBe(0);
    expect(afterPhase.body.poke.sentTo[her.id] ?? 0).toBe(0);

    const inParty = await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    expect(inParty.status).toBe(200);
  });

  it("★ 기본은 성별을 가리지 않는다", async () => {
    // 누구에게 마음이 가는지는 앱이 정할 일이 아니다 (ADR-17)
    const ev = await freshEvent();
    const me = await join(ev);
    const him = await join(ev);
    await setPhase(ev.id, "prevote");

    const res = await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: him.id } });
    expect(res.status).toBe(200);
  });

  it("운영자가 좁히면 이성에게만 찌를 수 있다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const him = await join(ev);

    const narrowed = await api(`/api/host/events/${ev.id}`, {
      method: "PUT",
      cookie: master,
      body: { config: { maxPre: 2, maxParty: 3, allowSameGender: false } },
    });
    expect(narrowed.status).toBe(200);
    await setPhase(ev.id, "prevote");

    const res = await api<{ error: string; message: string }>("/api/poke", {
      method: "POST",
      cookie: me.cookie,
      body: { toId: him.id },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(POKE.blocked.sameGender);
  });

  /**
   * **회차를 만들 때 고른 값이 그대로 적용돼야 한다** (위저드 3스텝).
   *
   * 위 테스트는 만든 **뒤에** 설정 탭에서 좁히는 길을 본다. 그런데 이 값은
   * 콕이 오가기 시작하면 굳어서(ADR-35) 나중에는 못 고친다 — 즉 **만들 때가 사실상 유일한 기회**다.
   * 그 자리에서 새면 운영자는 좁힌 줄 알고 파티를 연다.
   */
  it("★ 만들 때 '이성에게만' 으로 좁히면 그대로 적용된다", async () => {
    const ev = await freshEvent({ allowSameGender: false });
    expect(ev.config.allowSameGender, "고른 값이 회차에 안 실렸다").toBe(false);

    const me = await join(ev);
    const him = await join(ev);
    await setPhase(ev.id, "prevote");

    // 설정 탭을 한 번도 거치지 않았는데 막혀야 한다
    const res = await api<{ message: string }>("/api/poke", {
      method: "POST",
      cookie: me.cookie,
      body: { toId: him.id },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(POKE.blocked.sameGender);
  });

  it("★ 굳는 규칙에 이상한 값이 들어오면 회차를 못 만든다", async () => {
    /*
     * `"false"` 라는 **글자**가 들어오면 `=== false` 가 아니라서 조용히 '모두에게' 가 된다.
     * 운영자는 좁힌 줄 알고 파티를 연다 — 그래서 접지 말고 **거절**한다.
     * 굳는 규칙 다섯이 다 `validConfig` 에 있어야 하는 이유다 (ADR-35).
     */
    const now = Date.now();
    for (const bad of [
      { allowSameGender: "false" },
      { allowUndo: 0 },
      { preNotify: "true" },
    ]) {
      const res = await api("/api/host/events", {
        method: "POST",
        cookie: master,
        body: {
          name: "이상한 설정",
          partyAt: now + 3 * 24 * HOUR,
          prevoteAt: now + 24 * HOUR,
          voteEndAt: now + 3 * 24 * HOUR - HOUR,
          revealAt: now + 3 * 24 * HOUR + 3 * HOUR,
          config: { maxPre: 2, maxParty: 3, ...bad },
          requestId: `bad-${JSON.stringify(bad)}-${now}`,
        },
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("★ 자기 자신은 어떤 설정에서도 찌를 수 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await join(ev, { gender: "F" });
    await setPhase(ev.id, "prevote");

    const res = await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: me.id } });
    expect(res.status).toBe(409);
  });

  it("등록 중에는 아직, 발표 후에는 더 이상 찌를 수 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F" });

    const early = await api<{ message: string }>("/api/poke", {
      method: "POST",
      cookie: me.cookie,
      body: { toId: her.id },
    });
    expect(early.status).toBe(409);
    expect(early.body.message).toBe(POKE.blocked.anyClosed);

    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");
    await setPhase(ev.id, "done");

    // 결과를 보고 나서 뒤늦게 찌르는 일이 없어야 한다
    const late = await api("/api/poke", { method: "POST", cookie: me.cookie, body: { toId: her.id } });
    expect(late.status).toBe(409);
  });
});

// ─────────────────────────────────────────── 명단 공개 범위

/**
 * 명단은 **한 번에 다 열리지 않는다** (ADR-21).
 *
 *   등록 중       명단도 인원 수도 없다
 *   사전 투표     닉네임과 매력. 사람을 고를 때 필요한 건 그 둘이다
 *   파티 시작 후  나이와 MBTI 까지
 */

// ─────────────────────────────────────────── 명단 공개 범위

/**
 * 명단은 **한 번에 다 열리지 않는다** (ADR-21).
 *
 *   등록 중       명단도 인원 수도 없다
 *   사전 투표     닉네임과 매력. 사람을 고를 때 필요한 건 그 둘이다
 *   파티 시작 후  나이와 MBTI 까지
 */
describe("명단 공개 범위", () => {
  it("★ 등록 중에는 명단도 인원 수도 없다", async () => {
    /*
     * 한동안 인원 수는 내려줬다 — "기다리는 사람에게 필요한 정보" 라고 봤다.
     * 그런데 **인원이 적을수록 그 숫자 하나가 명단만큼 많은 것을 말한다.**
     * 둘이 등록한 회차에서 `2명` 은 "나 말고 한 명" 이고, 그 한 명이 누구인지는
     * 단톡방에서 금방 좁혀진다. 명단을 사전 투표까지 닫아두는 이유와 같다 (ADR-21).
     *
     * **화면에서 감추는 것으로는 부족하다** — 개발자 도구를 여는 참가자가 있다.
     */
    const ev = await freshEvent();
    const me = await join(ev);
    await join(ev, { gender: "F" });

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(state.body.roster).toEqual([]);
    // 응답 어디에도 수가 없다. 단계가 지나도 마찬가지다 — 사전 투표부터는 명단이 대신 말한다
    expect(JSON.stringify(state.body.event)).not.toContain("playerCount");

    await setPhase(ev.id, "prevote");
    const later = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    expect(JSON.stringify(later.body.event)).not.toContain("playerCount");
    expect(later.body.roster.length).toBe(1);
  });

  it("★ 사전 투표에서는 닉네임과 매력만 — 나이·MBTI 는 아직이다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await join(ev, { gender: "F", nickname: "그녀" });
    await setPhase(ev.id, "prevote");

    const state = await api<ParticipantState>("/api/me", { cookie: me.cookie });
    const her = state.body.roster[0];
    expect(her.nickname).toBe("그녀");
    expect(her.charms.length).toBe(3);
    expect(her.age).toBeUndefined();
    expect(her.mbti).toBeUndefined();
    // 나이가 응답 어디에도 없다 — 화면에서만 감추는 게 아니다
    expect(Object.keys(her)).not.toContain("age");
    expect(Object.keys(her)).not.toContain("mbti");
  });

  it("★ 파티가 시작되면 나이와 MBTI 가 열린다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    await join(ev, { gender: "F", nickname: "그녀" });
    await setPhase(ev.id, "prevote");
    await setPhase(ev.id, "party");

    const her = (await api<ParticipantState>("/api/me", { cookie: me.cookie })).body.roster[0];
    expect(her.age).toBe(28);
    expect(her.mbti).toBe("ENFP");
  });

  it("어느 단계에서도 실명·전화번호·인스타는 없다", async () => {
    const ev = await freshEvent();
    const me = await join(ev);
    const her = await join(ev, { gender: "F", realName: "박비밀", instagram: "secret_gram" });

    for (const to of ["prevote", "party"]) {
      await setPhase(ev.id, to);
      const raw = JSON.stringify((await api<ParticipantState>("/api/me", { cookie: me.cookie })).body.roster);
      expect(raw).not.toContain("박비밀");
      expect(raw).not.toContain("secret_gram");
      expect(raw).not.toContain(her.phone);
    }
  });
});

// ─────────────────────────────────────────── 참가자를 지웠을 때

/**
 * 라운드 중에 참가자를 지우는 일이 있다. 그때 **남는 것과 사라지는 것**이 분명해야 한다.
 */
