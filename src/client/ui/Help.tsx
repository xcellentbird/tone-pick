/**
 * 파티 룰 도움말. **물음표 하나로 어디서든 열리고, 등록을 마치면 한 번 저절로 열린다.**
 *
 * 한동안 이건 *묻는 사람에게 가리킬 곳* 이었다 — "앱에서 물음표 눌러보세요" 가
 * 통하게 하는 것이 값어치라고 봤다. **그 방향을 뒤집었다** (슬라이스 21):
 * 목표가 "운영자에게 묻는 일을 줄이는 것" 이면 물음표는 **이미 질문이 생긴 사람**의 장치라
 * 늦다. 질문이 생기기 전에 한 번은 읽혀야 한다.
 *
 * 단계 그림이 먼저다. 가장 많이 나오는 질문이 "언제 뭐가 일어나나" 인데
 * 그건 글보다 그림이 빠르다. 지금이 어디쯤인지 표시하되 **색으로만 말하지 않는다** —
 * `지금` 이라고 글자로도 적는다.
 *
 * **`등록` 칸은 없다** (ADR-102). 한동안 있었다 — 자동으로 열리는 순간이 곧 등록 직후라
 * 거기에 `지금` 이 붙어야 자기 위치를 찾는다는 이유였다. 짧게 쥐여주는 쪽을 골라 걷었다:
 * 등록 중에는 어디에도 `지금` 이 안 붙는다. **되살릴 거라면 무엇을 뺄지 먼저 정하라.**
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
  /*
   * 알림은 **라운드마다 따로다** (ADR-43) — 없으면 안 알린다(`!!`).
   * 판정을 `visibleReceived` 와 같은 모양으로 둔다. 한쪽만 바뀌면 설명이 거짓이 된다.
   *
   * **하나라도 켜져 있으면 켠 쪽으로 말한다.** 넷으로 갈라 쓰면 그 답이 문단이 되고,
   * 덜 알리는 것보다 **더 알리는 쪽이 안전하다** — 상대가 알게 되는 걸 안 알리면 그게 거짓이다.
   */
  const notify = !!config.preNotify || !!config.pokeNotify;
  /**
   * 익명 쪽지 문답이 서나 (슬라이스 36).
   *
   * ⚠️ **조건이 `maxNotes > 0` 이 아니다.** 운영자가 0 으로 내린 회차가 곧 괴롭힘이 있었던
   * 회차인데(ADR-98 의 유일한 레버), 거기서도 이미 온 쪽지는 소식에 남고 읽음도 계속 돈다.
   * 설정값만 보면 **고지가 통째로 사라져서**, 피해자가 앱을 열 때마다 상대 화면에 `읽음` 이
   * 서는데 그 말이 앱 어디에도 없게 된다. 그래서 **내가 주고받은 것이 하나라도 있으면** 함께 본다.
   */
  /**
   * 매력 투표 1위 보너스를 말하나 (ADR-102 가 ADR-100 을 뒤집었다).
   *
   * ⚠️ **`> 0` 이다.** 기본값이 `안 줌`(0)이라 고정으로 적으면 대부분의 회차에서 거짓이 된다 —
   * 회차마다 갈리는 답은 그 회차에서만 세운다 (ADR-52, `sameGenderOk` 와 같은 모양).
   */
  const topVoteOn = (config.topVoteBonus ?? 0) > 0;
  const noteOn =
    (config.maxNotes ?? 0) > 0 ||
    state.note.received.length > 0 ||
    state.note.budget.used > 0;

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
          /*
           * **1위 보너스가 맨 앞이다** — 매력 투표를 왜 하는지에 답하는 유일한 줄이라,
           * 서는 회차에서는 이것부터 읽혀야 한다. 안 서는 회차에서는 줄 자체가 없다.
           */
          ...(topVoteOn ? [{ q: qa.topVote.q, a: qa.topVote.a }] : []),
          { q: qa.secret.q, a: qa.secret.a(notify) },
          /*
           * 익명 쪽지는 **같은 질문(익명)의 자리**라 `상대가 아나요` 바로 아래다.
           * 둘째 문장이 읽음 표시의 유일한 고지다 — 작성 시트에서 하단 문구를 뺐으므로
           * 여기가 그 자리이고, 안 적으면 **앱이 문구보다 넓게 하는 일**이 생긴다.
           */
          ...(noteOn ? [{ q: qa.note.q, a: qa.note.a }] : []),
          /*
           * **회차 설정으로 갈리는 칸이 셋이 됐다.** 못 고르는 상대가 있다는 건 눌러봐야
           * 알던 것이라(`POKE.blocked.sameGender` 토스트) 미리 말할 값어치가 있다.
           */
          ...(sameGenderOk ? [] : [{ q: qa.sameGender.q, a: qa.sameGender.a }]),
        ].map((item) => (
          <div className="helpQa" key={item.q}>
            <div className="q">{item.q}</div>
            <div className="small dim">{item.a}</div>
          </div>
        ))}
        {/*
          **횟수는 문답이 아니라 한 줄이다** (ADR-102). 물음표를 붙일 만큼 헷갈리는 것이 아니라
          그냥 알아야 하는 숫자라, 카드 하나를 쓰지 않고 맨 아래에 적는다.
        */}
        <p className="small dim">{qa.count(config.maxPre, config.maxParty)}</p>
      </div>
    </div>
  );
}
