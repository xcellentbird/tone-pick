/**
 * 참가자 화면 한 벌. 네 탭(홈·참가자·내 정보·재미)이 이 컴포넌트 하나를 나눠 쓴다.
 *
 * 자료는 통로(source)로 받는다 — 화면은 세션도 요청 경로도 모른다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { BTN, ENTRY, FAIL, FORTUNE, HELP, NOTE, TABS_PARTICIPANT } from "../../shared/copy.ts";
import type { MyNoteState, MyPokeState, PublicAnnouncement, ParticipantState, StageKey } from "../../shared/types.ts";
import type { Fortune } from "../../shared/fortune.ts";
import { connect } from "../lib/realtime.ts";
import { canNote, canPoke } from "../../shared/phase.ts";
import { bannerOf, noticesOf } from "../lib/notices.ts";
import { now } from "../lib/serverTime.ts";
import { sessionSource, type ParticipantSource } from "../lib/participant.ts";
import { useCovered } from "../lib/covered.ts";
import { useLoad } from "../lib/useLoad.ts";
import { ApiError } from "../lib/api.ts";
import { nav, startPulse } from "../lib/pulse.ts";
import type { NavKey } from "../../shared/pulse.ts";
import { Overlays, useOverlay } from "../ui/Overlays.tsx";
import People from "./People.tsx";
import Me from "./Me.tsx";
import Home from "./Home.tsx";
import SeatTakeover from "../ui/SeatTakeover.tsx";
import StageTakeover from "../ui/StageTakeover.tsx";
import Sheet from "../ui/Sheet.tsx";
import Help from "../ui/Help.tsx";
import NoteBox, { type InboxSeg } from "../ui/NoteBox.tsx";
import { canOpenFortune } from "../../shared/phase.ts";
import FortuneTab from "./Fortune.tsx";
import StatusBar from "../ui/StatusBar.tsx";

export type Tab = "home" | "fun" | "people" | "me";

interface ViewProps {
  source: ParticipantSource;
  /** URL 이 가리키는 회차. 세션이 끊겼을 때 어디로 되돌릴지 판단에 쓴다 */
  code?: string;
  tab: Tab;
  onTab: (tab: Tab) => void;
  /** 프로필 시트도 라우트다 — 뒤로 가기로 닫힌다 */
  profileId?: string;
  onProfile: (playerId: string | null) => void;
  /**
   * 익명 쪽지 작성 시트 (슬라이스 36). **프로필 시트 위에 쌓이지 않고 대신 선다** —
   * 이 저장소의 시트는 겹치지 않는다 (운영자 콘솔의 떨어뜨리기 시트와 같다).
   */
  noteOpen?: boolean;
  onNote: (on: boolean, opts?: { replace?: boolean }) => void;
  /**
   * 내 정보 편집도 라우트다 — 뒤로 가기가 곧 취소다 (ADR-31).
   *
   * 닫을 때 `replace` 는 **취소가 아니라 되돌림**이다. 잠긴 뒤에 편집 주소를 직접 연 경우
   * 뒤로 갈 자리가 없어서 앱을 벗어난다 — 그때는 내 정보로 갈아끼운다.
   */
  editing?: boolean;
  onEdit: (on: boolean, opts?: { replace?: boolean }) => void;
  /**
   * 자리 확인 화면을 **다시 연** 상태 (슬라이스 12). 뒤로 가기로 닫힌다.
   *
   * 자동으로 뜨는 쪽(`needsSeatAck`)은 라우트가 아니다 — 참가자가 연 게 아니라
   * 아직 안 본 것이라서 주소를 바꿀 일이 아니다.
   */
  seatOpen?: boolean;
  onSeat: (on: boolean, opts?: { replace?: boolean }) => void;
  /**
   * 파티 룰 도움말. 라우트라 뒤로 가기로 닫힌다.
   *
   * 자리 확인창과 달리 **되돌릴 자리가 없는 경우를 걱정하지 않아도 된다** —
   * 주소를 직접 열 일이 없고, 열더라도 볼 것이 늘 있다.
   */
  helpOpen?: boolean;
  onHelp: (on: boolean) => void;
  /**
   * 익명 쪽지함 (ADR-98 후기 3). 도움말처럼 **상단 바에서 어느 탭에서든 열리는 시트**다.
   * 뒤로 가기로 닫힌다. 이 회차에 쪽지가 없는데 주소를 직접 열면 갈아끼운다 (`/seat` 와 같다).
   */
  notesOpen?: boolean;
  onNotes?: (on: boolean, opts?: { replace?: boolean }) => void;
}

/**
 * 하단 탭.
 *
 * **'재미' 는 없다가 생기지 않는다** (ADR-20 후기). 처음부터 자리를 지키고,
 * 매력 투표와 함께 켜진다 — 탭이 도중에 생기면 넷이 나눠 쓰던 폭이 통째로 다시 나뉘어
 * 손가락이 기억한 자리가 어긋난다.
 *
 * 꺼진 탭은 **죽은 버튼이 아니다.** 누르면 언제 열리는지 말한다 —
 * 눌러도 아무 일이 없으면 고장으로 읽힌다. (`Overlays` 안이라 토스트를 쓸 수 있다)
 */
function Tabs({ tab, onTab, funOpen }: { tab: Tab; onTab: (t: Tab) => void; funOpen: boolean }) {
  const { toast } = useOverlay();
  return (
    <nav className="tabbar">
      {TABS_PARTICIPANT.map((t) => {
        const off = t.key === "fun" && !funOpen;
        return (
          <button
            key={t.key}
            className={tab === t.key ? "active" : ""}
            /* `disabled` 로 두면 누른 것 자체가 안 와서 왜 안 되는지 말할 수 없다 */
            aria-disabled={off || undefined}
            onClick={() => (off ? toast(FORTUNE.closed) : onTab(t.key as Tab))}
            aria-current={tab === t.key}
          >
            <span className="icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** URL 이 상태를 들고 있는 진짜 참가자 화면 */
export default function Participant() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const base = `/e/${code}`;

  const source = useMemo(() => sessionSource(code), [code]);
  // 프로필 시트(/p/:id)는 참가자 탭 위에, 편집(/me/edit)은 내 정보 탭 위에 뜬 것이다 —
  // 탭 표시는 그 아래 탭 그대로 둔다
  const editing = location.pathname.endsWith("/me/edit");
  const tab: Tab = location.pathname.endsWith("/me") || editing
    ? "me"
    : location.pathname.endsWith("/fun")
      ? "fun"
      : location.pathname.endsWith("/people") || location.pathname.includes("/p/")
        ? "people"
        : "home";
  /*
   * ⚠️ **뒤 조각을 갈라야 한다.** `/p/:pid` 뒤에 `/note` 가 붙을 수 있어서(슬라이스 36),
   * `split("/p/")[1]` 을 통째로 아이디로 쓰면 `abc/note` 가 되어 **프로필을 못 찾는다.**
   */
  const afterP = location.pathname.includes("/p/") ? location.pathname.split("/p/")[1] : undefined;
  const profileId = afterP ? decodeURIComponent(afterP.replace(/\/note$/, "")) : undefined;
  /** 익명 쪽지 작성 시트. 조건이 안 맞으면 `People` 이 프로필 시트로 갈아끼운다 */
  const noteOpen = !!afterP && afterP.endsWith("/note");
  // 자리 화면을 **다시 여는** 길. 자동으로 뜨는 쪽은 라우트가 아니다 — 참가자가 연 게 아니다
  const seatOpen = location.pathname.endsWith("/seat");
  // 도움말도 라우트다. 뒤로 가기로 닫힌다 (ROUTES.md)
  const helpOpen = location.pathname.endsWith("/help");
  // 익명 쪽지함도 같다 (ADR-98 후기 3)
  const notesOpen = location.pathname.endsWith("/notes");

  /*
   * 어느 화면까지 왔나를 **집계로만** 남긴다 (ADR-56).
   *
   * 여기 한 곳에서 보는 이유는 화면 상태가 전부 주소에 있기 때문이다 (ROUTES.md) —
   * 탭마다 흩어 놓으면 새 탭이 생길 때 빠뜨리고, 빠뜨린 걸 아무도 모른다.
   * ⚠️ **주소를 그대로 보내지 마라.** `/e/:code` 의 코드가 실린다 — 화면 **이름**만 보낸다.
   */
  const screen: NavKey = helpOpen ? "help" : notesOpen ? "notes" : seatOpen ? "seat" : profileId ? "profile" : tab;
  useEffect(() => nav(screen), [screen]);
  useEffect(() => startPulse(), []);

  return (
    <ParticipantView
      source={source}
      code={code}
      tab={tab}
      onTab={(next) => {
        /**
         * 홈 탭이 스택의 **바닥**이다. 어느 탭에 있든 뒤로 가기 한 번이면 여기로 온다.
         *
         * 예전에는 탭 이동이 전부 push 라, 탭을 오갈수록 히스토리가 쌓이고 뒤로 가기가
         * "내 발자국 되감기"가 됐다. 사람은 뒤로 가기를 "목록으로 돌아가기"로 기대한다.
         */
        const to = next === "home" ? base : `${base}/${next}`;
        navigate(to, { replace: tab !== "home" });
      }}
      profileId={profileId}
      // 시트 열기는 push, 닫기는 뒤로 가기 — 안드로이드 백 버튼으로 닫혀야 한다
      onProfile={(id) => (id ? navigate(`${base}/p/${id}`) : navigate(-1))}
      noteOpen={noteOpen}
      /*
       * 작성 시트도 push 다 — 뒤로 가기가 곧 취소이고 쓰던 글은 버려진다 (내 정보 고치기와 같다).
       * 닫을 때 `replace` 는 **갈아끼움**이다: 조건이 안 맞는 주소를 직접 연 사람에게는
       * 뒤로 갈 자리가 없다 (`/seat` 와 같은 규칙).
       */
      onNote={(on, opts) =>
        on
          ? navigate(`${base}/p/${profileId}/note`)
          : opts?.replace
            ? navigate(`${base}/p/${profileId}`, { replace: true })
            : navigate(-1)
      }
      seatOpen={seatOpen}
      helpOpen={helpOpen}
      onHelp={(on) => (on ? navigate(`${base}/help`) : navigate(-1))}
      notesOpen={notesOpen}
      // 도움말과 같다 — 열기는 push, 닫기는 뒤로 가기. 직접 연 주소가 헛것이면 홈으로 갈아끼운다
      onNotes={(on, opts) =>
        on ? navigate(`${base}/notes`) : opts?.replace ? navigate(base, { replace: true }) : navigate(-1)
      }
      /*
       * 편집과 같다 — **닫기는 뒤로 가기**이되, 주소를 직접 연 사람에게는 뒤로 갈 자리가 없다.
       * 그때 `navigate(-1)` 은 앱을 벗어난다. iOS 는 가장자리 스와이프가 뒤로 가기라 더 쉽게 걸린다.
       */
      onSeat={(on, opts) =>
        on ? navigate(`${base}/seat`) : opts?.replace ? navigate(base, { replace: true }) : navigate(-1)
      }
      editing={editing}
      // 편집도 같다. 뒤로 가기가 곧 취소이고, 고치던 입력은 버려진다 (취소 버튼과 같은 동작)
      onEdit={(on, opts) =>
        on
          ? navigate(`${base}/me/edit`)
          : opts?.replace
            ? navigate(`${base}/me`, { replace: true })
            : navigate(-1)
      }
    />
  );
}

export function ParticipantView(props: ViewProps) {
  const { source, code } = props;
  const state = useLoad(() => source.load(), [source.key]);

  /*
   * 실시간은 "다시 읽어라"는 신호로만 쓴다. 부분 갱신을 만들면 화면과 서버가 조용히 어긋난다.
   *
   * 실패한 화면에서는 붙들지 않는다 — 다른 회차 주소를 열어둔 폰이 그 회차 소켓을 쥔 채
   * 신호가 올 때마다 다시 읽고 또 401 을 받는다. 여기서 다시 읽어봐야 나올 게 없다.
   *
   * **닿지 못한 실패(`status 0`)는 그 실패가 아니다.** 서버가 거절한 게 아니라 망이
   * 흔들린 것이라, 여기서 소켓까지 놓으면 스스로 돌아올 길이 함께 끊긴다 —
   * 안드로이드에서 화면을 껐다 켠 참가자가 오류 화면에 갇힌 게 이것이었다.
   * 소켓은 알아서 다시 붙고(`realtime.ts`), 붙는 순간 화면을 따라잡게 한다.
   */
  const failed = !!state.error && state.error.status !== 0;

  /*
   * **내 콕 한 칸만** 갈아끼우는 통로 (슬라이스 17). 화면이 서버 답을 기다리지 않고
   * 그 자리에서 바뀌게 한다.
   *
   * `set` 을 통째로 내려보내지 않는 이유가 여기 있다 — 그러면 받은 쪽에서 무엇이든
   * 갈아끼울 수 있고, ADR-26 의 예외가 조용히 넓어진다. 통로가 좁으면 넓힐 때
   * 이 줄을 고쳐야 해서 눈에 띈다.
   */
  const setPoke = useCallback(
    (poke: MyPokeState) => state.set((cur) => (cur ? { ...cur, poke } : cur)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.set],
  );
  /** 익명 쪽지 한 칸만 갈아끼운다 (슬라이스 36). `setPoke` 와 같은 이유로 통로가 좁다 */
  const setNote = useCallback(
    (note: MyNoteState) => state.set((cur) => (cur ? { ...cur, note } : cur)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.set],
  );
  /** 설문 답 한 칸만 갈아끼운다 (슬라이스 27). `setPoke` 와 같은 이유로 통로가 좁다 */
  const setAnnouncement = useCallback(
    (a: PublicAnnouncement) =>
      state.set((cur) => (cur ? { ...cur, announcements: cur.announcements.map((x) => (x.id === a.id ? a : x)) } : cur)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.set],
  );
  /** 연 운세 한 칸만 갈아끼운다. 서버가 돌려준 그 카드다 — `setPoke` 와 같은 이유로 통로가 좁다 */
  const setFortune = useCallback(
    (fortune: Fortune) => state.set((cur) => (cur ? { ...cur, fortune } : cur)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.set],
  );
  useEffect(() => {
    if (!source.liveCode || failed) return;
    const socket = connect(source.liveCode, () => state.reload());
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.liveCode, failed]);

  if (state.error) return <Failed error={state.error} code={code} onRetry={state.reload} busy={state.loading} />;
  if (!state.data) return <div className="screen" />;
  return (
    <Loaded
      {...props}
      state={state.data}
      reload={state.reload}
      setPoke={setPoke}
      setNote={setNote}
      setAnnouncement={setAnnouncement}
      setFortune={setFortune}
    />
  );
}

function Loaded({
  source,
  tab,
  onTab,
  profileId,
  onProfile,
  noteOpen,
  onNote,
  editing,
  onEdit,
  seatOpen,
  onSeat,
  state,
  reload,
  setPoke,
  setNote,
  setAnnouncement,
  setFortune,
  helpOpen,
  onHelp,
  notesOpen,
  onNotes,
}: ViewProps & {
  state: ParticipantState;
  reload: () => void;
  setPoke: (poke: MyPokeState) => void;
  setNote: (note: MyNoteState) => void;
  setAnnouncement: (a: PublicAnnouncement) => void;
  setFortune: (f: Fortune) => void;
}) {
  const [acked, setAcked] = useState<number[]>([]);
  const banner = bannerOf(noticesOf(state), now());

  const ack = useCallback(async () => {
    if (!state.seat) return;
    const round = state.seat.round;
    setAcked((list) => [...list, round]);
    try {
      await source.ackSeat(round);
      reload();
    } catch {
      /*
       * 저장에 실패했으면 **확인을 없던 일로 되돌린다.** 그냥 삼키면 화면에서는 사라지고
       * 서버에는 미확인으로 남아, 앱을 다시 열 때 전체 화면이 또 덮친다.
       * 되돌리면 안내가 그대로 남아 한 번 더 누를 수 있다.
       */
      setAcked((list) => list.filter((r) => r !== round));
    }
  }, [source, state.seat, reload]);

  /*
   * 자리 화면 주소를 열었는데 보여줄 자리가 없다 (파티 전이거나 아직 안 앉았다).
   * 빈 주소에 남겨두지 않고 홈으로 **갈아끼운다** — 뒤로 가기가 아니다.
   * 주소를 직접 연 사람에게는 뒤로 갈 자리가 없어서 앱을 벗어난다 (편집과 같은 이유).
   */
  useEffect(() => {
    if (seatOpen && !state.seat) onSeat(false, { replace: true });
  }, [seatOpen, state.seat, onSeat]);

  /**
   * 파티가 시작됐나. 자리 확인 화면의 문장이 여기서 갈린다 (ADR-39) —
   * 첫 자리는 파티 전에 나가고, 그때 받는 사람은 **아직 오는 중**일 수 있다.
   */
  const started = state.event.phase === "party" || state.event.phase === "done";

  /*
   * 아직 안 열린 '재미' 주소를 직접 연 경우. 탭이 꺼져 있어도 주소는 칠 수 있다 —
   * 자리 화면과 같이 홈으로 **갈아끼운다** (`onTab` 이 replace 한다).
   *
   * 탭의 문은 **가장 먼저 열리는 카드의 문**이다. 지금은 그게 운세라 `canOpenFortune` 이
   * 그대로 탭의 문이고, 더 일찍 열리는 카드가 들어오면 이 줄이 바뀔 자리다.
   */
  const funOpen = canOpenFortune(state.event.phase);
  useEffect(() => {
    if (tab === "fun" && !funOpen) onTab("home");
  }, [tab, funOpen, onTab]);

  // 발표가 끝났으면 자리 이동 확인을 띄우지 않는다 (FLOWS.md)
  const needsSeatAck =
    !!state.seat && !state.seat.acked && !acked.includes(state.seat.round) && state.event.phase !== "done";

  /**
   * 단계가 열릴 때의 안내 (ADR-96, 슬라이스 34). 새 행동이 열리는 순간이 둘뿐이라 매력 투표와 파티만이다 —
   * 등록 직후는 도움말이, 마감은 자리 화면이, 발표는 결과 카드가 이미 그 자리다.
   *
   * **자리 확인이 먼저다** — 몸을 옮기는 지시가 설명보다 앞이다. 둘 다 뜰 자리면 자리를 확인한 뒤에 온다.
   * 봤다는 건 서버가 안다(`me.seenStage`, 사건이 아니라 상태다 — 예약이 여는 순간 앱을 켜둔 사람이 없다).
   * 누른 즉시 감추고, 저장이 실패하면 되돌린다 — 자리 확인과 같다.
   *
   * 문은 참가자 탭의 버튼과 **같은 판정**(`canPoke`)이다 — 닫는 길이 하나 더 생겨도 여기와 거기가 따로 갈 수 없다.
   */
  const stage: StageKey | null = !canPoke(state.event.phase)
    ? null
    : state.event.phase === "party"
      ? "party"
      : "prevote";
  const [seenLocal, setSeenLocal] = useState<StageKey | null>(null);
  const needsStage = !!stage && state.me.seenStage !== stage && seenLocal !== stage && !needsSeatAck;

  /**
   * 어깨너머 가리기 (슬라이스 16). **여기서 한 번만 읽는다.**
   *
   * 예전에는 참가자 탭이 혼자 `useCovered()` 를 불렀다. 익명 쪽지가 생기면서 쪽지함에도 같은 토글이
   * 서고 읽음 판정까지 이 값을 보므로, 각자 부르면 **한 화면에서 켠 것이 다른 화면에 안 보인다** —
   * 두 집 살림이 된다. 저장은 여전히 localStorage 하나다 (서버로 보내지 않는다).
   */
  const [covered, setCovered] = useCovered();

  /**
   * 익명 쪽지함이 이 회차에 있나 (ADR-98 후기 3). **파티가 시작돼야 생기고**, 쪽지를 0장으로 둔 회차에는 없다.
   * 다만 **주고받은 것이 하나라도 있으면 남는다** — 운영자가 0 으로 내린 회차가 곧 괴롭힘이 있었던
   * 회차이고, 거기서 이미 온 쪽지는 지울 수 있어야 한다 (도움말 문답과 같은 조건).
   */
  const note = state.note;
  const inboxOn =
    (started && (state.event.config.maxNotes ?? 0) > 0) ||
    note.received.length > 0 ||
    Object.keys(note.sent).length > 0;
  useEffect(() => {
    if (notesOpen && !inboxOn) onNotes?.(false, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesOpen, inboxOn]);

  /**
   * **덮개(자리 확인 · 단계 안내)와 시트는 겹치지 않는다.**
   *
   * 시트와 확인창은 Radix 모달이라, 열려 있는 동안 그 밖의 모든 것에서 손가락을 뺏는다
   * (`body` 에 `pointer-events: none`). 덮개는 그 위에 **그려지기만 하고 눌리지 않았다** — 누른 손가락은
   * 뒤에 가려진 시트의 글자에 닿았다. 등록을 마치면 도움말이 저절로 열려서(슬라이스 21) 매력 투표·파티 중에
   * 온 사람은 모두 `참가자 보러 가기` 가 아무 일도 안 하는 화면에 갇혔고, 파티 중 자리가 나올 때마다
   * 프로필·쪽지를 보던 사람의 `자리 확인` 이 같은 일을 겪었다.
   *
   * · **자리 확인은 바로 선다** — 몸을 옮기는 지시다. 그동안 시트는 닫혀 있고, 라우트는 그대로라 확인하면 돌아온다
   * · **단계 안내는 기다린다** — 설명이다. 시트가 열려 있으면 닫힌 뒤에 선다. 등록을 마친 사람의 도움말이 먼저다
   * · 확인창은 자리·단계가 **바뀌는 순간** 취소된다 — 돌려놓지 않는다 (`Overlays` 의 `suspend`)
   */
  const seatUp = needsSeatAck && !!state.seat;
  const sheetOpen = !!helpOpen || (!!notesOpen && inboxOn) || (tab === "people" && (!!profileId || !!noteOpen));
  const stageUp = needsStage && !!stage && !sheetOpen;

  /**
   * 받은 익명 쪽지를 **읽음으로 찍는다.** 여기 있는 이유는 셋을 한자리에서 보기 때문이다 —
   * 쪽지함이 열려 있나, 덮개가 덮고 있나(`needsSeatAck`·`needsStage`), 어깨너머 가리기가 켜져 있나.
   *
   * **읽음은 쪽지함을 열 때다** (ADR-98 후기 3). 한동안 홈이 그려지면 찍었는데, 쪽지 줄이 홈 맨 아래라
   * **스크롤하지 않아도 읽음이 섰다** — 배지가 말하는 것보다 코드가 넓게 재고 있었다.
   * 쪽지함은 열면 받은 쪽지가 맨 위에 있다.
   *
   * ⚠️ **덮개 아래에서는 찍지 않는다.** 자리 확인·단계 안내는 시트 위에 선다 — 본문을 볼 수 없는
   * 사람이 읽은 것으로 찍히면 `문구가 코드보다 넓게 말하면 거짓말` 에 걸린다.
   *
   * ⚠️ **가리기 중에도 찍지 않는다.** 가리면 줄만 보이는데, 본문을 안 본 것은 읽은 것이 아니다.
   * 이것이 **안 읽고 지우는 길**을 실제로 열어 둔다 (ADR-98) — 그 길이 없으면 괴롭히는 쪽은
   * 언제나 `읽음` 을 받고, 읽음이 거절 신호가 되지 않게 하는 장치가 글로만 남는다.
   *
   * ⚠️ **보낸 쪽지를 보는 동안에도 찍지 않는다.** 쪽지함이 열려 있어도 화면은 다른 신호로 계속 다시 읽히고,
   * 그때 새 쪽지가 오면 본문을 본 적 없는 사람에게 읽음이 찍혔다. 받은 쪽지로 돌아오는 순간 찍힌다.
   */
  const [inboxSeg, setInboxSeg] = useState<InboxSeg>("received");
  // 열면 늘 받은 쪽지부터다 — 닫힐 때 되돌려 두면 여는 순간부터 받은 쪽지가 보인다
  useEffect(() => {
    if (!notesOpen) setInboxSeg("received");
  }, [notesOpen]);
  /*
   * **안 읽은 것이 있을 때만 찍는다** (`note.unread`). 한동안 줄 수(`received.length`)로 정했는데 둘이 샜다 —
   * 다 읽은 쪽지함을 열 때마다 서버에 쓰는 요청이 나갔고, 지운 한 장과 새로 온 한 장이 한 응답에 겹치면
   * 줄 수가 그대로라 **화면에 뜬 새 쪽지가 읽음으로 안 찍혔다.**
   */
  const notesShown =
    !!notesOpen && inboxOn && !seatUp && !stageUp && !covered && inboxSeg === "received" && note.unread > 0;
  useEffect(() => {
    if (!notesShown) return;
    let alive = true;
    // 못 찍었으면(망) 그대로 둔다 — 배지가 남고, 다음에 열 때 다시 찍는다. 읽는 사람에게 말할 일은 아니다
    source.seeNotes().then(
      (next) => {
        if (alive) setNote(next);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesShown, note.unread]);
  const seeStage = useCallback(async () => {
    if (!stage) return;
    setSeenLocal(stage);
    try {
      await source.markStage(stage);
      reload();
      // 버튼이 곧 다음 할 일이다 — 누르면 참가자 탭이다
      onTab("people");
    } catch {
      setSeenLocal(null);
    }
  }, [stage, source, reload, onTab]);

  return (
    <Overlays suspend={seatUp || (needsStage && !!stage)}>
      {/*
        바탕은 단계를 말하지 않는다 (ADR-67). `data-phase` 를 되살리지 마라 —
        옆 사람이 화면 색만 보고 이 사람이 어디쯤인지 읽는다.
      */}
      <div className="screen">
        {/* 스크롤해도 남는 자리다. 여기엔 반복해서 볼 것만 둔다 */}
        <header className="bar">
          <StatusBar
            state={state}
            /*
             * 회차 이름이 홈으로 가는 지름길이다. **홈 탭에서는 주지 않는다** —
             * 갈 곳이 없는데 눌리면 히스토리에 같은 주소가 한 칸 더 쌓이고,
             * 뒤로 가기가 "아무 일도 안 일어나는 한 번"이 된다.
             */
            onHome={tab === "home" ? undefined : () => onTab("home")}
            onHelp={() => onHelp(true)}
            inbox={inboxOn ? { unread: note.unread, onOpen: () => onNotes?.(true) } : undefined}
          />
        </header>

        <div className="body stack">
          {banner && tab !== "home" && tab !== banner.tab && (
            /*
             * 최근 3분 안의 변화만 배너로. **이미 볼 수 있는 화면에서는 띄우지 않는다** —
             * 홈에는 소식 목록이 있고, 목적지 탭에는 소식 그 자체가 있다.
             * 누르면 그 알림의 목적지로 간다. 발표는 홈이 아니라 참가자 탭이다.
             */
            <button className="banner" onClick={() => onTab(banner.tab)}>
              <span className="icon">{banner.icon}</span>
              <span className="grow">
                <span className="name">{banner.title}</span>
                {banner.body && <div className="small dim">{banner.body}</div>}
              </span>
            </button>
          )}
          {tab === "home" && (
            <Home
              state={state}
              onTab={onTab}
              onSeat={() => onSeat(true)}
              onHelp={() => onHelp(true)}
              // 서버가 방금 준 답을 버리고 다시 묻지 않는다 (슬라이스 17 과 같은 이유)
              onVote={async (id, choice) => setAnnouncement(await source.vote(id, choice))}
            />
          )}
          {tab === "people" && (
            <People
              state={state}
              source={source}
              reload={reload}
              setPoke={setPoke}
              setNote={setNote}
              profileId={profileId}
              onProfile={onProfile}
              noteOpen={noteOpen}
              onNote={onNote}
              onTab={onTab}
              covered={covered}
              setCovered={setCovered}
              underTakeover={seatUp}
            />
          )}
          {/* 재미 탭. 지금은 운세 카드 하나뿐이다 — 이상형 찾기가 여기 두 번째로 붙는다 */}
          {tab === "fun" && <FortuneTab state={state} onFortune={setFortune} />}
          {tab === "me" && (
            <Me state={state} source={source} reload={reload} editing={!!editing} onEdit={onEdit} />
          )}
        </div>

        <Tabs tab={tab} onTab={onTab} funOpen={funOpen} />

        {/*
          아직 안 본 사람에게는 **자동으로** 덮치고 확인을 받는다.
          이미 본 사람이 홈에서 다시 연 경우(`/seat`)에는 닫기만 있다 —
          이미 센 사람을 또 세면 `acks` 가 뜻을 잃는다.
        */}
        {seatUp && state.seat && <SeatTakeover seat={state.seat} started={started} onAck={ack} />}
        {!needsSeatAck && seatOpen && state.seat && (
          <SeatTakeover seat={state.seat} started={started} onClose={() => onSeat(false)} />
        )}

        {/* 단계가 열릴 때의 안내 — 자리 확인 뒤, 그리고 열린 시트가 닫힌 뒤에 선다 (ADR-96, 위 `stageUp`) */}
        {stageUp && stage && (
          <StageTakeover
            stage={stage}
            count={state.poke.budget.party.max}
            notify={!!state.event.config.pokeNotify}
            onDone={seeStage}
          />
        )}

        {/*
          익명 쪽지함 (ADR-98 후기 3). 어느 탭에서 열든 같은 것이 뜬다.
          **열릴 때마다 새로 붙는다** — 보낸 쪽지의 읽음 배지가 그 순간의 값으로 굳는 것이 여기서 나온다.
        */}
        <Sheet open={!!notesOpen && inboxOn && !seatUp} onClose={() => onNotes?.(false)} title={NOTE.inbox.title}>
          {notesOpen && inboxOn && (
            <NoteBox
              note={note}
              roster={state.roster}
              seg={inboxSeg}
              onSeg={setInboxSeg}
              open={canNote(state.event.phase) && (state.event.config.maxNotes ?? 0) > 0}
              covered={covered}
              setCovered={setCovered}
              onRemove={async (id) => setNote(await source.removeNote(id))}
              onClose={() => onNotes?.(false)}
            />
          )}
        </Sheet>

        {/* 파티 룰 도움말. 어느 탭에서 열든 같은 것이 뜬다 */}
        <Sheet open={!!helpOpen && !seatUp} onClose={() => onHelp(false)} title={HELP.title}>
          <Help state={state} />
          {/*
            **읽기를 마친 손가락이 그 자리에서 닫는다.** 도움말은 화면을 거의 덮고
            등록을 마치면 저절로 열리는데, 그때까지 닫는 길은 뒤로 가기와 바깥 누르기뿐이라
            **처음 들어온 사람이 나갈 곳을 찾아 헤맸다** — 하필 그 사람이 이 글의 독자다.
            프로필 시트가 이미 같은 자리에 같은 버튼을 둔다 (`People.tsx`).

            닫기는 여전히 **뒤로 가기**다 (ROUTES.md) — 이 버튼도 `navigate(-1)` 로 간다.
            여기서 주소를 직접 갈아끼우면 히스토리에 도움말이 남아 뒤로 가기가 다시 연다.
          */}
          <button className="btn block ghost" onClick={() => onHelp(false)}>
            {BTN.close}
          </button>
        </Sheet>
      </div>
    </Overlays>
  );
}

/**
 * 참가자 화면이 열리지 않는 세 경우.
 *
 *   401  세션이 없다 → 문 앞으로 돌려보낸다
 *   404  회차는 있는데 **내가 없다** — 운영자가 지웠다. 그렇다고 말한다
 *   그 밖  서버가 준 문장을 그대로
 *
 * 404 를 "그런 파티가 없어요" 로 뭉뚱그리면 참가자는 링크를 의심하고 운영자에게
 * 엉뚱한 걸 묻는다. 지워진 사람은 명단에 남아 있으면 다시 들어올 수 있으니 그 길을 준다.
 */
function Failed({
  error,
  code,
  onRetry,
  busy,
}: {
  error: ApiError;
  code?: string;
  /** 앱 안에서 요청만 다시 보낸다. 페이지를 다시 받지 않는다 */
  onRetry: () => void;
  busy: boolean;
}) {
  /*
   * 세션이 이 회차의 것이 아니면(401) 예전에는 코드로 회차를 되찾아 문 앞으로 보냈다.
   * 그 길을 닫았다 — **코드로 회차를 찾는 창구가 곧 링크를 내주는 창구**였기 때문이다
   * (`by-code` 응답에 회차 아이디가 들어 있어서, 30비트 코드를 뚫으면 64비트 링크가 나왔다).
   *
   * 이제는 참가 링크로 다시 들어오면 된다. 링크는 운영자가 뿌린 그대로 남아 있다.
   */
  const removed = error.status === 404;
  /*
   * 서버에 닿지도 못한 경우(status 0). **처음으로 보내면 안 된다** —
   * 회차를 잘못 찾아온 게 아니라 망이 흔들린 것이라, 할 일은 다시 시도하는 것이다.
   */
  const offline = error.status === 0;
  /** 세션이 이 회차의 것이 아니다. 참가 링크로 다시 들어오면 된다 */
  const sessionGone = error.status === 401 || error.status === 403;
  /*
   * 서버가 답은 했는데 우리 것이 아니다 — 500 이거나, 설명 없이 온 무엇이든.
   *
   * **이 전부가 "그런 파티가 없어요" 로 떨어지고 있었다.** `apiError()` 는 `message` 를
   * 선택으로 두므로 설명 없이 나가는 실패가 흔한데, 화면은 그때 링크를 탓했다.
   * 참가자는 멀쩡한 링크를 의심하고 운영자에게 엉뚱한 걸 묻는다 —
   * `status 0` 에서 이미 한 번 고친 실수인데 **이 경로가 남아 있었다.**
   *
   * 그래서 되묻는 순서를 뒤집었다. 기본값은 "회차가 없다" 가 아니라
   * **"우리가 못 불러왔다"** 이고, 링크를 탓하는 건 **404 하나뿐**이다.
   * 서버 탓일 때는 눈앞의 운영자에게 넘긴다 — 참가자가 할 수 있는 게 없다.
   */
  const broken = !offline && !removed && !sessionGone;
  /*
   * **회차를 잃었다** (ADR-71). 다시 물어도 같은 답이고, 이 앱에서 회차에 들어가는 길은
   * **참가 링크 하나**다 (ADR-13·15·32) — 앱이 대신 눌러줄 수 있는 것이 없다.
   *
   * 예전에는 여기에 `처음으로`·`다시 입장하기` 를 두고 `/` 로 보냈다. 그런데 `/` 는
   * **세션이 있으면 그 회차로 옮기는 문**이다. 지워진 회차를 묻고 없다는 답을 들은 사람이
   * 그 버튼을 누르면 **참석 중인 다른 파티 안에 서 있었다** — 게다가 `처음으로` 라는 이름은
   * 자기가 어디로 가는지 말하지 않아서, 옮겨간 줄도 모른다. 실제로 나온 신고다.
   *
   * `/` 의 그 이동은 **주소만 치고 들어온 사람**을 위한 것이라 그 자리에서는 맞다.
   * 여기 오는 사람은 회차 하나를 물은 사람이라, 묻지 않은 회차로 데려가면 안 된다.
   */
  /*
   * **막힌 나라는 예외다** (ADR-92). 위의 "다시 물어도 같은 답" 이 여기서만 틀리다 —
   * VPN 을 끄거나 한국 망으로 옮기면 **같은 요청이 다르게 답한다.** 그래서 버튼을 남긴다.
   * 문구가 `끄고 다시 열어주세요` 라고 말하는데 누를 것이 없으면 그 문장이 헛말이 된다.
   */
  const blockedHere = error.code === "region_blocked";
  const stuck = removed || (sessionGone && !blockedHere);
  /*
   * **망 문제에 `location.reload()` 를 걸면 안 된다.** 앱을 통째로 버리고 `index.html`
   * 부터 다시 받는 일인데, 망이 흔들리는 바로 그 순간에 가장 하면 안 되는 것이다.
   * 실패하면 브라우저의 오류 화면으로 넘어가고 거기서는 우리가 할 수 있는 게 없다.
   * 요청 하나만 다시 보내면 된다 — 성공하면 그 자리에서 화면이 돌아온다.
   */
  return (
    <div className="screen">
      <div className="body stack center" style={{ justifyContent: "center" }}>
        {/*
          설명 없이 온 401 은 세션이 아예 없는 것이다. `화면을 불러오지 못했어요` 로는
          할 일을 알 수 없어서 **문이 어디인지** 말한다 — 버튼을 걷어낸 자리를 이 줄이 맡는다.
        */}
        <p className="dim pre">
          {error.userMessage ?? (removed ? ENTRY.notFound : sessionGone ? ENTRY.linkOnly : FAIL.title)}
        </p>
        {!stuck && (
          <button className="btn primary" disabled={offline && busy} onClick={() => (offline ? onRetry() : location.reload())}>
            {offline ? (busy ? FAIL.reconnecting : FAIL.reconnect) : FAIL.retry}
          </button>
        )}
        {/* 파티장에는 운영자가 눈앞에 있다. 실패를 사람에게 넘길 수 있는 앱은 흔치 않다 */}
        {(offline || broken) && <p className="tiny dim">{FAIL.askHost}</p>}
      </div>
    </div>
  );
}
