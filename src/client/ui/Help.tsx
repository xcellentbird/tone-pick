/**
 * 파티 룰 도움말. **물음표 하나로 어디서든 열리고, 등록을 마치면 한 번 저절로 열린다.**
 *
 * 한동안 이건 *묻는 사람에게 가리킬 곳* 이었다 — "앱에서 물음표 눌러보세요" 가
 * 통하게 하는 것이 값어치라고 봤다. **그 방향을 뒤집었다** (슬라이스 20):
 * 목표가 "운영자에게 묻는 일을 줄이는 것" 이면 물음표는 **이미 질문이 생긴 사람**의 장치라
 * 늦다. 질문이 생기기 전에 한 번은 읽혀야 한다.
 *
 * 단계 그림이 먼저다. 가장 많이 나오는 질문이 "언제 뭐가 일어나나" 인데
 * 그건 글보다 그림이 빠르다. 지금이 어디쯤인지 표시하되 **색으로만 말하지 않는다** —
 * `지금` 이라고 글자로도 적는다.
 *
 * **`등록` 칸을 빼지 마라.** 셋(사전·파티·발표)뿐이던 시절에는 등록 중에 어디에도
 * `지금` 이 안 붙었는데, 자동으로 열리게 된 뒤로 **처음 읽는 사람이 정확히 그때 읽는다.**
 * 자기 위치를 못 찾는 그림은 그림이 아니다.
 *
 * 회차마다 다른 진행 룰(라운드 몇 번·자리 언제 옮김)은 여기 없다.
 * 그건 운영자가 그날 쓰는 것이다 (슬라이스 14). 회차 설정에서 가져오는 것은 **값뿐이다.**
 */
import { HELP } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";

export default function Help({ state }: { state: ParticipantState }) {
  const { phase, config } = state.event;
  const qa = HELP.qa;
  /*
   * 동성에게 못 찌르는 회차에서만 그 줄이 붙는다. 기본값은 모두에게라(ADR-17)
   * **줄 자체를 만들지 않는다** — 안 묻는 답을 적는 만큼 묻는 답이 뒤로 밀린다.
   *
   * 이게 없을 때는 눌러봐야 알았다 (`POKE.blocked.sameGender` 토스트).
   * 판정을 `People.tsx` 와 같은 모양으로 둔다 — 한쪽만 바뀌면 화면과 설명이 어긋난다.
   */
  const sameGenderOk = config.allowSameGender !== false;

  return (
    <div className="stack">
      <ol className="helpSteps">
        {HELP.steps.map((step) => {
          // `준비 중` 에만 아무 데도 안 붙는다 — 그때는 참가자가 아직 들어와 있지 않다
          const here = step.key === phase;
          return (
            <li key={step.key} className={here ? "on" : ""}>
              <span className="name">
                {step.title}
                {here && <span className="nowTag">{HELP.nowHere}</span>}
              </span>
              <span className="small dim">{step.body}</span>
            </li>
          );
        })}
      </ol>

      <div className="stack">
        {[
          { q: qa.secret.q, a: qa.secret.a },
          { q: qa.count.q, a: qa.count.a(config.maxPre, config.maxParty) },
          ...(sameGenderOk ? [] : [{ q: qa.sameGender.q, a: qa.sameGender.a }]),
          { q: qa.where.q, a: qa.where.a },
          { q: qa.ages.q, a: qa.ages.a },
        ].map((item) => (
          <div className="helpQa" key={item.q}>
            <div className="q">{item.q}</div>
            <div className="small dim">{item.a}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
