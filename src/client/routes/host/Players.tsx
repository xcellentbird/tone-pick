/**
 * 참가자 탭. 삭제는 **상세 시트에서만** 한다 — 목록에서 스와이프 삭제 같은 걸 두면
 * 콕 기록과 자리가 통째로 날아가는 일이 손끝에서 일어난다.
 *
 * 상세 시트는 라우트다. 뒤로 가기로 닫힌다 (ROUTES.md).
 */
import { useNavigate, useParams } from "react-router";
import { BTN, DELETE_PLAYER, GENDER, HOST_UI, ME, UNIT } from "../../../shared/copy.ts";
import { del } from "../../lib/api.ts";
import { useOverlay } from "../../ui/Overlays.tsx";
import { useConsole } from "./HostConsole.tsx";

export default function Players() {
  const { state, reload } = useConsole();
  const { pid } = useParams();
  const navigate = useNavigate();
  const { confirm } = useOverlay();
  const base = `/host/${state.meta.id}/players`;
  const picked = state.players.find((p) => p.id === pid);

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
      {state.players.length === 0 && <p className="dim center">{HOST_UI.players.empty}</p>}

      {state.players.map((p) => (
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

      {picked && (
        <div className="scrim" onClick={() => navigate(-1)} role="presentation">
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 style={{ marginTop: 0 }}>{picked.nickname}</h2>
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
          </div>
        </div>
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
