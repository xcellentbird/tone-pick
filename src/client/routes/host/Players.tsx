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
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, DELETE_PLAYER, GENDER, HOST_UI, ME, UNIT } from "../../../shared/copy.ts";
import type { Gender, Invite } from "../../../shared/types.ts";
import { LIMITS, normalizePhone } from "../../../shared/constants.ts";
import { ApiError, del, post } from "../../lib/api.ts";
import { useOverlay } from "../../ui/Overlays.tsx";
import Avatar from "../../ui/Avatar.tsx";
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
  /**
   * 세 숫자를 한 번에 보여준다 — 고른 쪽만 세면 성비를 보려고 버튼을 두 번 눌러야 한다.
   * 현황 탭에서 뺀 성비가 실제로 필요한 자리는 명단 앞이다.
   */
  const count: Record<Filter, number> = {
    all: state.players.length,
    M: state.players.filter((p) => p.gender === "M").length,
    F: state.players.filter((p) => p.gender === "F").length,
  };

  function askDelete(playerId: string) {
    const rounds = state.seatings.filter((s) => s.seats.some((x) => x.playerId === playerId)).length;
    confirm(
      {
        btn: BTN.delete,
        title: DELETE_PLAYER.title,
        danger: true,
        note: DELETE_PLAYER.note,
        facts: DELETE_PLAYER.facts({ sent: state.sent[playerId] ?? 0, rounds }),
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
            {label} <span className="filterCount">{count[key]}</span>
          </button>
        ))}
      </div>

      {state.players.length === 0 && <p className="dim center">{HOST_UI.players.empty}</p>}
      {state.players.length > 0 && shown.length === 0 && (
        <p className="dim center">{HOST_UI.players.emptyFiltered}</p>
      )}

      {shown.map((p) => (
        <button className="person" key={p.id} onClick={() => navigate(`${base}/${p.id}`)}>
          <Avatar nickname={p.nickname} gender={p.gender} />
          <span className="meta">
            <span className="name ellipsis">
              {p.nickname} · {UNIT.age(p.age)} · {p.mbti}
            </span>
            {/* 받은 콕은 보여주지 않는다 — 알면 그 사람을 다르게 대하게 된다 (ADR-22) */}
            <span className="charm ellipsis">{HOST_UI.players.sent(state.sent[p.id] ?? 0)}</span>
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
          onDone={(added) => {
            // 뺀 것과 더한 것, 이미 있어서 아무 일도 없었던 것은 다른 말이다
            toast(added > 0 ? HOST_UI.invites.saved(added) : added < 0 ? HOST_UI.invites.removed : HOST_UI.invites.already);
            reload();
          }}
        />
      </Sheet>
    </div>
  );
}

/**
 * 명단 편집. **한 명 넣기와 한 명 빼기뿐**이다.
 *
 * 통째로 갈아치우는 길은 두지 않는다 — 한 명 추가하려다 손이 미끄러지면
 * 그 파티의 명단 전체가 날아가고, 되돌릴 방법이 없다.
 *
 * 여러 줄을 한 번에 붙여넣는 칸도 뺐다. 화면에서 하는 일은 번호 하나를 더하는 것이고,
 * 그 하나만 있으면 헷갈릴 자리가 없다. (API 는 배열을 받으므로 리허설 스크립트는 그대로 쓴다)
 */
function Invites({
  invites,
  eventId,
  onDone,
}: {
  invites: Invite[];
  eventId: string;
  /** 더한 수. 뺐으면 음수, 이미 있어서 아무 일도 없었으면 0 */
  onDone: (added: number) => void;
}) {
  const [one, setOne] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = new Set(invites.map((i) => i.phone));

  async function add(phones: string[], clear: () => void) {
    setBusy(true);
    setError(null);
    try {
      const next = await post<Invite[]>(`/host/events/${eventId}/invites`, { phones });
      clear();
      onDone(next.length - invites.length);
    } catch (e) {
      setError(e instanceof ApiError ? (e.userMessage ?? HOST_UI.invites.tooMany(LIMITS.inviteMax)) : "");
    } finally {
      setBusy(false);
    }
  }

  function addOne(e: React.FormEvent) {
    e.preventDefault();
    const phone = normalizePhone(one);
    // 이미 있는 번호는 서버까지 갈 것도 없다. 조용히 성공하면 넣은 줄 알고 넘어간다
    if (known.has(phone)) return setError(HOST_UI.invites.already);
    void add([phone], () => setOne(""));
  }

  async function remove(phone: string) {
    await del(`/host/events/${eventId}/invites/${phone}`);
    onDone(-1);
  }

  return (
    <div className="stack">
      <p className="small dim">{HOST_UI.invites.emptyNote}</p>

      <form className="field" onSubmit={addOne}>
        <label htmlFor="oneInvite">{HOST_UI.invites.addLabel}</label>
        <div className="row">
          <input
            id="oneInvite"
            className="grow"
            value={one}
            inputMode="tel"
            autoComplete="off"
            onChange={(e) => {
              setOne(e.target.value);
              setError(null);
            }}
          />
          <button className="btn primary" disabled={busy || normalizePhone(one).length < 9}>
            {HOST_UI.invites.addOne}
          </button>
        </div>
        <span className="tiny dim">{HOST_UI.invites.addHint}</span>
      </form>

      {error && <p className="err danger">{error}</p>}

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
