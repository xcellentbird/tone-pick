/**
 * 파티 룰 도움말. **물음표 하나로 어디서든 열린다.**
 *
 * 운영자가 "앱에서 물음표 눌러보세요" 라고 말할 수 있는 게 이 화면의 값어치다 —
 * 안 묻는 사람은 어차피 안 읽는다. **묻는 사람에게 가리킬 곳**을 만드는 것이 목적이다.
 *
 * 세 단계 그림이 먼저다. 가장 많이 나오는 질문이 "언제 뭐가 일어나나" 인데
 * 그건 글보다 그림이 빠르다. 지금이 어디쯤인지 표시하되 **색으로만 말하지 않는다** —
 * `지금` 이라고 글자로도 적는다.
 *
 * 회차마다 다른 진행 룰(라운드 몇 번·자리 언제 옮김)은 여기 없다.
 * 그건 운영자가 그날 쓰는 것이다 (슬라이스 14).
 */
import { HELP } from "../../shared/copy.ts";
import type { ParticipantState } from "../../shared/types.ts";

export default function Help({ state }: { state: ParticipantState }) {
  const { phase, config } = state.event;
  const qa = HELP.qa;

  return (
    <div className="stack">
      <ol className="helpSteps">
        {HELP.steps.map((step) => {
          // 등록 중에는 아직 아무 단계도 아니다. 그때는 어디에도 `지금` 이 붙지 않는다
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
