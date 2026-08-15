/**
 * 참가자 탭. 두 가지를 본다 — **누가 들어올 수 있나(입장 명단)** 와 **누가 왔나(등록)**.
 *
 * 명단이 파티의 문이다 (ADR-15). 비어 있으면 아무도 못 들어오므로 그 상태를 가장 크게 말한다.
 *
 * 삭제는 **상세 시트에서만** 한다 — 목록에서 스와이프 삭제 같은 걸 두면
 * 콕 기록과 자리가 통째로 날아가는 일이 손끝에서 일어난다.
 *
 * 상세 시트와 명단 시트는 라우트다. 뒤로 가기로 닫힌다 (ROUTES.md).
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, DELETE_PLAYER, GENDER, HOST_UI, ME, UNIT } from "../../../shared/copy.ts";
import type { Gender, Invite } from "../../../shared/types.ts";
import { LIMITS, normalizePhone } from "../../../shared/constants.ts";
import { ApiError, del, put } from "../../lib/api.ts";
import { useOverlay } from "../../ui/Overlays.tsx";
import Sheet from "../../ui/Sheet.tsx";
import { useConsole } from "./HostConsole.tsx";

type Filter = "all" | Gender;

export default function Players() {
  const { state, reload } = useConsole();
  const { pid } = useParams();
  const navigate = useNavigate();
  const { confirm, toast } = useOverlay();
  const base = `/host/${state.meta.id}/players`;
  const picked = state.players.find((p) => p.id === pid);
  // 명단 시트도 라우트다. `/players/invites` 는 참가자 아이디와 겹치지 않는다
  const atInvites = pid === "invites";

  const [filter, setFilter] = useState<Filter>("all");
  const shown = state.players.filter((p) => filter === "all" || p.gender === filter);
  const joined = state.invites.filter((i) => i.nickname).length;

  function askDelete(playerId: string) {
    const rounds = state.seatings.filter((s) => s.seats.some((x) => x.playerId === playerId)).length;
    confirm(
      {
        btn: BTN.delete,
        title: DELETE_PLAYER.title,
        danger: true,
        note: DELETE_PLAYER.note,
        facts: DELETE_PLAYER.facts({
          sent: state.sent[playerId] ?? 0,
          received: state.received[playerId] ?? 0,
          rounds,
        }),
      },
      async () => {
        await del(`/host/events/${state.meta.id}/players/${playerId}`);
        navigate(base, { replace: true });
        reload();
      },
    );
  }

  return (
    <div className="stack">
      <button className="card row between" onClick={() => navigate(`${base}/invites`)}>
        <span className="grow" style={{ textAlign: "left" }}>
          <span className="name">{HOST_UI.invites.title}</span>
          <div className={`small ${state.invites.length === 0 ? "warnText" : "dim"}`}>
            {state.invites.length === 0
              ? HOST_UI.invites.empty
              : HOST_UI.invites.count(state.invites.length, joined)}
          </div>
        </span>
        <span className="dim">{"›"}</span>
      </button>

      {/* 한 버튼을 껐다 켜면 지금 어느 쪽인지 알 수 없다. 셋 중 하나가 항상 켜져 있다 */}
      <div className="choice">
        {([["all", HOST_UI.players.filterAll], ["M", GENDER.M], ["F", GENDER.F]] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      {state.players.length === 0 && <p className="dim center">{HOST_UI.players.empty}</p>}
      {state.players.length > 0 && shown.length === 0 && (
        <p className="dim center">{HOST_UI.players.emptyFiltered}</p>
      )}

      {shown.map((p) => (
        <button className="person" key={p.id} onClick={() => navigate(`${base}/${p.id}`)}>
          <span className="avatar">{p.gender === "M" ? "🙋‍♂️" : "🙋‍♀️"}</span>
          <span className="meta">
            <span className="name ellipsis">
              {p.nickname} · {UNIT.age(p.age)} · {p.mbti}
            </span>
            <span className="charm ellipsis">
              {HOST_UI.players.received(state.received[p.id] ?? 0)} ·{" "}
              {HOST_UI.players.sent(state.sent[p.id] ?? 0)}
            </span>
          </span>
        </button>
      ))}

      <Sheet open={!!picked} onClose={() => navigate(-1)} title={picked?.nickname ?? ""}>
        {picked && (
          <>
            <div className="stack">
              <Row label={ME.labels.realName} value={picked.realName} />
              <Row label={ME.labels.age} value={UNIT.age(picked.age)} />
              <Row label={ME.labels.gender} value={GENDER[picked.gender]} />
              <Row label={ME.labels.mbti} value={picked.mbti} />
              <Row label={ME.labels.phone} value={picked.phone} />
              {picked.instagram && <Row label={ME.labels.instagram} value={picked.instagram} />}
              <Row label={HOST_UI.players.received(state.received[picked.id] ?? 0)} value="" />
              <Row label={HOST_UI.players.sent(state.sent[picked.id] ?? 0)} value="" />
            </div>

            <p className="kicker" style={{ marginTop: 16 }}>
              {ME.labels.charms}
            </p>
            <div className="stack">
              {picked.charms.map((c, i) => (
                <div className="fact" key={i}>
                  <span className="grow pre">{c}</span>
                </div>
              ))}
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn wide ghost" onClick={() => navigate(-1)}>
                {BTN.close}
              </button>
              <button className="btn wide danger" onClick={() => askDelete(picked.id)}>
                {BTN.delete}
              </button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet open={atInvites} onClose={() => navigate(-1)} title={HOST_UI.invites.title}>
        <Invites
          invites={state.invites}
          eventId={state.meta.id}
          onSaved={(n) => {
            toast(HOST_UI.invites.saved(n));
            reload();
          }}
        />
      </Sheet>
    </div>
  );
}

/**
 * 명단 편집.
 *
 * 운영자가 실제로 하는 일은 **붙여넣기 한 번**이다 — 단톡방에서 받은 번호 뭉치를 그대로 넣는다.
 * 한 명씩 추가하는 칸을 만들면 100명을 넣을 방법이 없다.
 */
function Invites({
  invites,
  eventId,
  onSaved,
}: {
  invites: Invite[];
  eventId: string;
  onSaved: (count: number) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 시트를 열 때마다 지금 명단을 그대로 보여준다. 편집이 곧 전체 교체다
  useEffect(() => setText(invites.map((i) => i.phone).join("\n")), [invites]);

  const parsed = [...new Set(text.split(/[\s,;]+/).map(normalizePhone).filter((p) => p.length >= 9))];

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await put<Invite[]>(`/host/events/${eventId}/invites`, { phones: parsed });
      onSaved(parsed.length);
    } catch (e) {
      setError(e instanceof ApiError ? (e.userMessage ?? HOST_UI.invites.tooMany(LIMITS.inviteMax)) : "");
    } finally {
      setBusy(false);
    }
  }

  async function remove(phone: string) {
    await del(`/host/events/${eventId}/invites/${phone}`);
    onSaved(invites.length - 1);
  }

  return (
    <div className="stack">
      <p className="small dim">{HOST_UI.invites.emptyNote}</p>

      <div className="field">
        <label htmlFor="invites">{HOST_UI.invites.pasteLabel}</label>
        <textarea id="invites" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        <span className="tiny dim">{HOST_UI.invites.pasteHint}</span>
      </div>

      {error && <p className="err danger">{error}</p>}
      <button className="btn primary block" onClick={save} disabled={busy}>
        {HOST_UI.invites.save} · {UNIT.people(parsed.length)}
      </button>

      {invites.length > 0 && (
        <>
          <p className="kicker" style={{ marginTop: 8 }}>
            {HOST_UI.invites.count(invites.length, invites.filter((i) => i.nickname).length)}
          </p>
          <div className="stack">
            {invites.map((i) => (
              <div className="row between" key={i.phone}>
                <span className="grow ellipsis">{i.phone}</span>
                <span className={`small ${i.nickname ? "okText" : "dim"}`}>
                  {i.nickname ? `${i.nickname} · ${HOST_UI.invites.joined}` : HOST_UI.invites.waiting}
                </span>
                <button className="btn ghost" onClick={() => remove(i.phone)}>
                  {HOST_UI.invites.remove}
                </button>
              </div>
            ))}
          </div>
          {/* 명단에서 빼는 것과 참가자를 지우는 것은 다른 일이다 */}
          <p className="tiny dim">{HOST_UI.invites.removeNote}</p>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row between">
      <span className="small dim">{label}</span>
      <span className="ellipsis">{value}</span>
    </div>
  );
}
