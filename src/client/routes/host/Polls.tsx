/**
 * 설문 탭 (슬라이스 27, ADR-88). 운영자가 두 선택지 설문을 보내고, **누가 무엇을 골랐는지** 본다.
 *
 * 목록 카드는 숫자 셋(선택지 둘 + 미응답)만 말한다. 카드를 누르면 참가자 탭과 같은 카드 목록이
 * 답으로 걸러져 나온다 — 뒤풀이 인원을 세고 **연락까지 하는** 화면이라 실명이 앞에 오고 전화번호가 같이 선다.
 * 카드를 누르면 참가자 탭의 상세 시트가 그대로 열린다 — 인스타 같은 나머지는 거기서 본다.
 * 설문은 여러 개가 함께 열려 있을 수 있다. 닫는 것도 지우는 것도 운영자가 누른다.
 *
 * 보내기 시트와 상세는 라우트다 — 뒤로 가기로 닫힌다 (ROUTES.md). `/polls/new` 가 시트,
 * `/polls/<설문id>` 가 상세다. `new` 는 서버가 만드는 아이디(16진수)와 겹치지 않는다.
 */
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { HOST_UI } from "../../../shared/copy.ts";
import type { HostAnnouncement, Player, PollChoice } from "../../../shared/types.ts";
import { formatWhen } from "../../../shared/time.ts";
import { del, messageOf, post, put } from "../../lib/api.ts";
import { useOverlay } from "../../ui/Overlays.tsx";
import Sheet from "../../ui/Sheet.tsx";
import { useConsole } from "./HostConsole.tsx";
import PersonCard from "./PersonCard.tsx";

/** 답 둘과 '미응답'. 셋 중 하나가 늘 켜져 있다 — 참가자 탭의 성별 칩과 같은 꼴이다 */
type Filter = PollChoice | "none";

/** 답 둘과 미응답 — 지금 명단에 있는 사람만 센다. 나간 사람의 답은 서버가 이미 뺐다. 카드와 상세가 같은 셈이다 */
function tally(a: HostAnnouncement, players: Player[]) {
  const n = { a: 0, b: 0, none: 0 };
  for (const p of players) n[a.choices[p.id] ?? "none"]++;
  return n;
}

export default function Polls() {
  const { state, reload } = useConsole();
  const { aid } = useParams();
  const navigate = useNavigate();
  const base = `/host/${state.meta.id}/polls`;
  const polls = state.announcements.filter((a) => a.poll);
  const atNew = aid === "new";
  const picked = aid && !atNew ? polls.find((a) => a.id === aid) : undefined;

  // 지운 설문의 주소로 돌아온 경우. 뒤로 갈 자리가 없으니 목록으로 갈아끼운다
  if (aid && !atNew && !picked) return <Navigate to={base} replace />;
  if (picked) return <Detail poll={picked} players={state.players} base={base} eventId={state.meta.id} reload={reload} />;

  return (
    <div className="stack">
      <button className="btn primary block" onClick={() => navigate(`${base}/new`)}>
        {HOST_UI.polls.newBtn}
      </button>

      {polls.length === 0 && <p className="dim center">{HOST_UI.polls.empty}</p>}

      {polls.map((a) => {
        const n = tally(a, state.players);
        const closed = !!a.poll!.closedAt;
        return (
          <button key={a.id} type="button" className="card stack" style={{ textAlign: "left" }} onClick={() => navigate(`${base}/${a.id}`)}>
            <div className="row between">
              <span className="name pre grow">{a.text}</span>
              <span className="badge">{closed ? HOST_UI.polls.closedBadge : HOST_UI.polls.open}</span>
            </div>
            <div className="small dim">{HOST_UI.polls.summary(a.poll!.a, n.a, a.poll!.b, n.b, n.none)}</div>
          </button>
        );
      })}

      <Sheet open={atNew} onClose={() => navigate(-1)} title={HOST_UI.polls.newBtn}>
        <NewPoll
          eventId={state.meta.id}
          onDone={() => {
            // 시트는 라우트다 — 닫는 것은 뒤로 가기다. 새 카드가 목록에 서는 것이 곧 알림이라 토스트는 없다 (ADR-65)
            navigate(-1);
            reload();
          }}
        />
      </Sheet>
    </div>
  );
}

function NewPoll({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const { toast } = useOverlay();
  const [text, setText] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = text.trim() && a.trim() && b.trim();

  async function send() {
    setBusy(true);
    try {
      await post(`/host/events/${eventId}/announcements`, { text: text.trim(), poll: { a: a.trim(), b: b.trim() } });
      onDone();
    } catch (e) {
      // 조용히 실패하면 운영자가 다시 누른다 — 같은 설문이 둘 선다
      toast(messageOf(e, HOST_UI.saveFailed));
    } finally {
      setBusy(false);
    }
  }

  // 열렸다고 커서를 주지 않는다 (ADR-63) — 키보드가 화면 절반을 먹는다
  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="pollQ">{HOST_UI.polls.question}</label>
        <textarea id="pollQ" rows={2} value={text} placeholder={HOST_UI.polls.questionHint} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pollA">{HOST_UI.polls.optionA}</label>
        <input id="pollA" value={a} placeholder={HOST_UI.polls.optionHintA} onChange={(e) => setA(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pollB">{HOST_UI.polls.optionB}</label>
        <input id="pollB" value={b} placeholder={HOST_UI.polls.optionHintB} onChange={(e) => setB(e.target.value)} />
      </div>
      {/* 시나리오 14 의 첫 규칙 — 선택지에 사람을 넣지 않는다. 코드가 못 막는 것을 이 한 줄이 막는다 */}
      <p className="small dim">{HOST_UI.polls.note}</p>
      <button className="btn primary block" disabled={!ready || busy} onClick={send}>
        {HOST_UI.polls.send}
      </button>
    </div>
  );
}

/**
 * 설문 하나. 누가 무엇을 골랐는지를 **참가자 카드로** 본다 (ADR-88).
 * 칩 셋의 숫자가 곧 집계라 따로 적지 않는다 — 같은 숫자를 두 곳에 두면 눈이 한 번 더 확인한다.
 */
function Detail({
  poll: ann,
  players,
  base,
  eventId,
  reload,
}: {
  poll: HostAnnouncement;
  players: Player[];
  base: string;
  eventId: string;
  reload: () => void;
}) {
  const navigate = useNavigate();
  const { confirm, toast } = useOverlay();
  const [filter, setFilter] = useState<Filter>("a");
  const poll = ann.poll!;
  const closed = !!poll.closedAt;

  const by = (f: Filter) => players.filter((p) => (f === "none" ? !ann.choices[p.id] : ann.choices[p.id] === f));
  const shown = by(filter);
  const n = tally(ann, players);
  const answered = n.a + n.b;

  /** 마감·다시 열기. 되돌릴 수 있으므로 확인창이 없다 — 배지가 바뀌는 것이 곧 알림이다. 거절만 토스트로 말한다 */
  async function toggle() {
    try {
      await put(`/host/events/${eventId}/announcements/${ann.id}`, { open: closed });
      reload();
    } catch (e) {
      toast(messageOf(e, HOST_UI.saveFailed));
    }
  }

  /** 지우기. 받은 답이 함께 사라지므로 확인창이 그 수를 말한다 */
  function askRemove() {
    confirm(
      {
        btn: HOST_UI.polls.remove,
        title: HOST_UI.polls.removeTitle,
        danger: true,
        facts: HOST_UI.polls.removeFacts(answered),
        note: HOST_UI.polls.removeNote,
      },
      async () => {
        await del(`/host/events/${eventId}/announcements/${ann.id}`);
        navigate(base, { replace: true });
        reload();
      },
    );
  }

  return (
    <div className="stack">
      <button className="btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => navigate(-1)}>
        ‹ {HOST_UI.polls.back}
      </button>

      <div className="card stack">
        <div className="name pre">{ann.text}</div>
        <div className="small dim">
          {closed ? HOST_UI.polls.closedBadge : HOST_UI.polls.open} · {formatWhen(ann.at)}
        </div>
      </div>

      <div className="choice">
        {(
          [
            ["a", poll.a, n.a],
            ["b", poll.b, n.b],
            ["none", HOST_UI.polls.notYet, n.none],
          ] as const
        ).map(([key, label, n]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label} <span className="filterCount">{n}</span>
          </button>
        ))}
      </div>

      {/* 빈 자리는 하나다 — 어느 문장인지만 고른다 */}
      {shown.length === 0 && (
        <p className="dim center">
          {filter === "none" ? HOST_UI.polls.everyoneAnswered : answered === 0 ? HOST_UI.polls.noOne : HOST_UI.polls.emptyFiltered}
        </p>
      )}

      {/*
        참가자 탭의 카드와 같다 — 누르면 그 탭의 상세 시트가 열린다(인스타는 거기서 본다).
        카드에는 전화번호까지만 — 뒤풀이 자리를 잡고 나면 이 목록을 보며 연락한다. 운영자 화면이라 된다 (원칙 3).
        인스타까지 넣었더니 카드가 세 줄이 되어 목록이 길어졌다.
      */}
      {shown.map((p) => (
        <PersonCard key={p.id} p={p} phone onOpen={() => navigate(`/host/${eventId}/players/${p.id}`)} />
      ))}
      <div className="row mt">
        <button className="btn wide ghost" onClick={toggle}>
          {closed ? HOST_UI.polls.reopen : HOST_UI.polls.close}
        </button>
        <button className="btn wide danger" onClick={askRemove}>
          {HOST_UI.polls.remove}
        </button>
      </div>
    </div>
  );
}
