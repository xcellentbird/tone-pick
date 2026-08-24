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
import type { Attendance, Invite } from "../../../shared/types.ts";
import type { Defaults } from "../../../shared/types.ts";
import { LIMITS, PHONE_SEED, formatPhone, typedPhone } from "../../../shared/constants.ts";
import { INVITE_TEMPLATE } from "../../../shared/copy.ts";
import { renderInvite } from "../../../shared/invite.ts";
import { formatWhen } from "../../../shared/time.ts";
import { api } from "../../lib/api.ts";
import { useLoad } from "../../lib/useLoad.ts";
import { keepPhoneSeed } from "../../lib/phoneField.ts";
import { ApiError, del, post } from "../../lib/api.ts";
import { useOverlay } from "../../ui/Overlays.tsx";
import Avatar from "../../ui/Avatar.tsx";
import Sheet from "../../ui/Sheet.tsx";
import { useConsole } from "./HostConsole.tsx";

/**
 * 필터는 **상태 축**이다 (ADR-33). 성별은 숫자로만 남았다 —
 * 성별 칩의 진짜 용도가 "세 숫자를 한 번에 보는 것"(성비)이었기 때문이다.
 *
 * 칩 세트는 **단계가 정한다.** 운영자가 묻는 질문이 파티 전후로 다르다 —
 * 전에는 "누가 아직 등록 안 했지", 후에는 "누가 왔지".
 */
type Filter = "all" | "registered" | "unregistered" | "arrived" | "absent" | "left";

export default function Players() {
  const { state, reload } = useConsole();
  const { pid } = useParams();
  const navigate = useNavigate();
  const { confirm, toast } = useOverlay();
  const base = `/host/${state.meta.id}/players`;
  const picked = state.players.find((p) => p.id === pid);
  /*
   * 안내문 문구는 **운영자 기본값**에 하나만 둔다 (ADR-32). 여기서 한 번 읽어
   * 위의 미리보기와 아래 행별 복사가 **같은 값**을 본다 — 둘로 읽으면 언젠가 어긋난다.
   */
  const tpl = useLoad(() => api<Defaults>("/host/defaults"));
  const template = tpl.data?.inviteTemplate ?? INVITE_TEMPLATE;

  /** 그 사람의 안내문. **링크가 사람마다 다르므로 한 사람분씩 만든다** */
  const noteFor = (i: Invite) =>
    renderInvite(template, {
      place: state.meta.place ?? "",
      when: formatWhen(state.meta.schedule.partyAt),
      link: `${location.origin}/j/${state.meta.id}/${i.token}`,
    });

  /**
   * **복사하면 보낸 것으로 본다.** 운영자가 복사했다는 건 보낼 참이라는 뜻이고,
   * 버튼을 둘 두면 한 명당 두 번 누르게 된다 — 스무 명이면 마흔 번이다.
   * 잘못 찍혔으면 그 행의 표시를 눌러 되돌린다.
   */
  function copyNote(i: Invite) {
    // 복사가 막히는 브라우저가 있다 (권한·구버전). 실패를 성공이라고 말하지 않는다
    navigator.clipboard
      ?.writeText(noteFor(i))
      .then(() => {
        toast(HOST_UI.copied);
        if (!i.sentAt) void setSent(i, true);
      })
      .catch(() => toast(HOST_UI.copyFailed));
  }

  /** 보냄 표시. 되돌릴 수 있어서 확인창이 없다 */
  async function setSent(i: Invite, sent: boolean) {
    await post(`/host/events/${state.meta.id}/invites/${i.phone}/sent`, { sent });
    reload();
  }

  /**
   * 명단에서 빼기. **되돌릴 수 있지만 토큰은 되돌아오지 않는다** (ADR-32) —
   * 다시 넣으면 새 링크가 나오고 이미 보낸 링크는 죽는다. 그래서 확인을 붙인다.
   * 목록에 나와 있는 행이라 손이 미끄러지기 쉬운 자리이기도 하다.
   */
  function askRemove(i: Invite) {
    confirm(
      {
        btn: HOST_UI.invites.remove,
        title: HOST_UI.invites.removeTitle,
        facts: [[formatPhone(i.phone), HOST_UI.invites.remove]],
        note: HOST_UI.invites.removeNote2,
      },
      async () => {
        await del(`/host/events/${state.meta.id}/invites/${i.phone}`);
        toast(HOST_UI.invites.removed);
        reload();
      },
    );
  }

  const [filter, setFilter] = useState<Filter>("all");
  /** 파티가 시작되면 같은 값이 다른 이름으로 읽힌다 — `등록함` 이 `안 옴` 이 된다 */
  const started = state.meta.phase === "party" || state.meta.phase === "done";

  const att = (id: string) => state.attendance[id];
  const shown = state.players.filter((p) => {
    if (filter === "all") return true;
    if (filter === "registered") return true;
    if (filter === "arrived") return att(p.id) === "arrived";
    if (filter === "left") return att(p.id) === "left";
    if (filter === "absent") return !att(p.id);
    return false;   // unregistered — 등록자는 해당 없음
  });
  /**
   * 세 숫자를 한 번에 보여준다 — 고른 쪽만 세면 성비를 보려고 버튼을 두 번 눌러야 한다.
   * 현황 탭에서 뺀 성비가 실제로 필요한 자리는 명단 앞이다.
   */
  const waiting = state.invites.filter((i) => !i.nickname);
  const arrivedN = state.players.filter((p) => att(p.id) === "arrived").length;
  const leftN = state.players.filter((p) => att(p.id) === "left").length;
  const absentN = state.players.filter((p) => !att(p.id)).length;
  const count: Record<Filter, number> = {
    all: state.players.length + waiting.length,
    registered: state.players.length,
    unregistered: waiting.length,
    arrived: arrivedN,
    absent: absentN,
    left: leftN,
  };

  /** **나감 칩은 나간 사람이 생겼을 때만 나온다.** 늘 0인 칩은 자리만 차지한다 */
  const chips: Filter[] = started
    ? (["all", "arrived", "absent", "unregistered", ...(leftN > 0 ? (["left"] as const) : [])] as Filter[])
    : ["all", "registered", "unregistered"];
  const chipLabel: Record<Filter, string> = {
    all: HOST_UI.players.filterAll,
    registered: HOST_UI.status.registered,
    unregistered: HOST_UI.status.unregistered,
    arrived: HOST_UI.status.arrived,
    absent: HOST_UI.status.absent,
    left: HOST_UI.status.left,
  };

  /** 카드 오른쪽에 붙는 한 낱말. 파티 전후로 이름이 갈린다 */
  const statusOf = (id: string) => {
    const a = att(id);
    if (a === "left") return HOST_UI.status.left;
    if (a === "arrived") return HOST_UI.status.arrived;
    return started ? HOST_UI.status.absent : HOST_UI.status.registered;
  };

  /** 칩을 눌러 바로 찍는다 (ADR-33). 문 앞에서 한 명씩 하는 일이라 한 번에 끝나야 한다 */
  async function toggleArrived(playerId: string) {
    const now = att(playerId);
    const to = now === "arrived" ? null : "arrived";
    await post(`/host/events/${state.meta.id}/players/${playerId}/attendance`, { to });
    reload();
  }

  async function setAttendance(playerId: string, to: Attendance | null) {
    await post(`/host/events/${state.meta.id}/players/${playerId}/attendance`, { to });
    reload();
  }

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
      {/*
        **명단과 참가자를 한 목록으로 본다.** 둘은 같은 사람들이고 운영자가 하는 일도 하나다 —
        부를 사람을 넣고, 안내문을 보내고, 온 사람을 본다. 두 화면으로 갈라 두니
        같은 사람이 두 번 나오고 "누구에게 보냈나" 와 "누가 왔나" 를 따로 세게 됐다.

        **링크를 통째로 복사하는 버튼은 없다** (ADR-32). 링크가 사람마다 달라서
        한 번 복사해 단톡방에 뿌릴 수가 없다 — 그게 이 슬라이스의 요점이다.
      */}
      <Invites
        invites={state.invites}
        eventId={state.meta.id}
        hasPlace={!!state.meta.place}
        noteFor={noteFor}
        onEditTemplate={() => navigate("/host/defaults")}
        onDone={(added) => {
          toast(added > 0 ? HOST_UI.invites.saved : added < 0 ? HOST_UI.invites.removed : HOST_UI.invites.already);
          reload();
        }}
      />
      {/* 성비는 숫자로만 남았다 — 칩 한 줄은 상태가 쓴다 (ADR-33) */}
      <p className="tiny dim">
        {HOST_UI.players.ratio(
          state.players.filter((p) => p.gender === "M").length,
          state.players.filter((p) => p.gender === "F").length,
        )}
      </p>

      {/* 한 버튼을 껐다 켜면 지금 어느 쪽인지 알 수 없다. 하나가 항상 켜져 있다 */}
      <div className="choice">
        {chips.map((key) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {chipLabel[key]} <span className="filterCount">{count[key]}</span>
          </button>
        ))}
      </div>

      {state.players.length === 0 && <p className="dim center">{HOST_UI.players.empty}</p>}
      {state.players.length > 0 && shown.length === 0 && (
        <p className="dim center">{HOST_UI.players.emptyFiltered}</p>
      )}

      {/*
        **문 앞에서 사람을 찾는 화면이다.** 얼굴과 맞추는 건 실명이지 닉네임이 아니다 —
        그래서 실명이 앞에 온다. MBTI·콕 횟수는 상세로 갔다 (ADR-33).
      */}
      {shown.map((p) => (
        <div className="row between" key={p.id}>
          <button className="person grow" onClick={() => navigate(`${base}/${p.id}`)}>
            <Avatar nickname={p.nickname} gender={p.gender} />
            <span className="meta">
              <span className="name ellipsis">
                {p.realName} · {p.nickname} · {UNIT.age(p.age)}
              </span>
              {/* 받은 콕은 보여주지 않는다 — 알면 그 사람을 다르게 대하게 된다 (ADR-22) */}
              <span className="charm ellipsis">{formatPhone(p.phone)}</span>
            </span>
          </button>
          {/*
            파티가 시작되면 칩이 곧 버튼이다 — 문 앞에서 한 명씩 찍는 자리라 한 번에 끝나야 한다.
            `나감` 은 눌러서 바꾸지 않는다. 되돌릴 자리는 상세다.
          */}
          {started && att(p.id) !== "left" ? (
            <button className="btn ghost" aria-pressed={att(p.id) === "arrived"} onClick={() => void toggleArrived(p.id)}>
              {statusOf(p.id)}
            </button>
          ) : (
            <span className="small dim">{statusOf(p.id)}</span>
          )}
        </div>
      ))}

      {/*
        **아직 안 온 사람들.** 등록한 사람 아래에 모아 둔다 — 파티 당일에 주로 보는 건 위쪽이고,
        번호가 한 덩어리로 모여 있어야 어깨너머로 덜 읽힌다.
        여기서는 **삭제를 하지 않는다.** 명단에서 빼는 것과 참가자를 지우는 것은 다른 일이다.
      */}
      {/*
        **아직 안 온 사람들.** 등록한 사람 아래에 모아 둔다 — 파티 당일에 주로 보는 건 위쪽이고,
        번호가 한 덩어리로 모여 있어야 어깨너머로 덜 읽힌다.
        여기서 하는 일은 **안내문을 보내는 것** 하나라, 버튼도 그것과 되돌리기뿐이다.
      */}
      {(filter === "all" || filter === "unregistered") && waiting.length > 0 && (
        <>
          <p className="kicker" style={{ marginTop: 8 }}>
            {HOST_UI.invites.waitingCount(waiting.length)}
          </p>
          <div className="stack">
            {waiting.map((i) => (
              <div className="row between" key={i.phone}>
                {/* 목록도 입력칸과 같은 모양으로 끊는다 — 다르면 같은 번호가 다르게 읽힌다 */}
                <span className="grow ellipsis">{formatPhone(i.phone)}</span>
                {/* 보냈으면 **글자로** 말한다. 눌러서 되돌린다 */}
                {i.sentAt ? (
                  <button className="btn ghost" aria-pressed onClick={() => void setSent(i, false)}>
                    {HOST_UI.status.invited}
                  </button>
                ) : (
                  <button className="btn ghost" onClick={() => copyNote(i)}>
                    {HOST_UI.invite.copy}
                  </button>
                )}
                <button className="btn ghost" onClick={() => askRemove(i)}>
                  {HOST_UI.invites.remove}
                </button>
                <span className="small dim">{HOST_UI.status.unregistered}</span>
              </div>
            ))}
          </div>
          <p className="tiny dim">{HOST_UI.invites.removeNote}</p>
        </>
      )}

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

            {/*
              참석은 **순서가 있는 한 축**이다 — 안 옴 → 도착 → 나감.
              토글 둘로 두면 "나갔는데 온 적 없음" 같은 조합이 생긴다 (ADR-33).
              되돌릴 수 있어서 확인창이 없다.
            */}
            <p className="kicker" style={{ marginTop: 16 }}>
              {HOST_UI.status.title}
            </p>
            <div className="choice">
              {(
                [
                  [null, HOST_UI.status.setAbsent],
                  ["arrived", HOST_UI.status.setArrived],
                  ["left", HOST_UI.status.setLeft],
                ] as const
              ).map(([to, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={(state.attendance[picked.id] ?? null) === to}
                  onClick={() => void setAttendance(picked.id, to)}
                >
                  {label}
                </button>
              ))}
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

            {/* 링크를 잃었다는 연락이 오는 자리. 등록한 사람도 자기 링크로 다시 들어온다 */}
            {(() => {
              const mine = state.invites.find((i) => i.phone === picked.phone);
              return mine ? (
                <button className="btn ghost block" style={{ marginTop: 16 }} onClick={() => copyNote(mine)}>
                  {HOST_UI.invite.copy}
                </button>
              ) : null;
            })()}

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
    </div>
  );
}

/**
 * 명단에 부를 사람을 넣고, 안내문을 준비한다. **한 명 넣기뿐**이다.
 *
 * 통째로 갈아치우는 길은 두지 않는다 — 한 명 추가하려다 손이 미끄러지면
 * 그 파티의 명단 전체가 날아가고, 되돌릴 방법이 없다.
 * 여러 줄을 한 번에 붙여넣는 칸도 뺐다. (API 는 배열을 받으므로 리허설 스크립트는 그대로 쓴다)
 *
 * **빼기는 여기 없다.** 아직 안 온 사람 목록의 그 행에서 한다 — 누구를 빼는지 보면서 하는 일이다.
 */
function Invites({
  invites,
  eventId,
  hasPlace,
  noteFor,
  onEditTemplate,
  onDone,
}: {
  invites: Invite[];
  eventId: string;
  /** 회차에 장소가 들어 있나. 비었으면 안내문에 자리만 빈다 */
  hasPlace: boolean;
  /** 안내문 문구를 고치러 간다. 운영자 기본값에 하나만 둔다 (ADR-32) */
  onEditTemplate: () => void;
  /** 한 사람분 안내문. 템플릿은 위에서 한 번만 읽는다 */
  noteFor: (i: Invite) => string;
  /** 더한 수. 이미 있어서 아무 일도 없었으면 0 */
  onDone: (added: number) => void;
}) {
  /**
   * 참가자가 입장할 때 치는 칸과 **같은 모양**이다 — `010` 이 미리 들어가 있고
   * 하이픈으로 끊어 보인다. 두 칸이 달리 보이면 같은 번호를 다르게 옮겨 적게 된다.
   *
   * 상태는 **숫자 그대로**다. 하이픈은 보여줄 때만 붙는다 (`formatPhone`).
   */
  const [one, setOne] = useState(PHONE_SEED);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = new Set(invites.map((i) => i.phone));

  /*
   * 미리보기는 **눌러야 열린다.** 항상 펼쳐 두면 명단이 그만큼 아래로 밀리는데,
   * 문구는 한 번 확인하면 되는 것이고 명단은 계속 보면서 일하는 것이다.
   */
  const [showNote, setShowNote] = useState(false);
  const left = invites.filter((i) => !i.sentAt).length;
  const joined = invites.filter((i) => i.nickname).length;

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
    // 이미 있는 번호는 서버까지 갈 것도 없다. 조용히 성공하면 넣은 줄 알고 넘어간다
    if (known.has(one)) return setError(HOST_UI.invites.already);
    // 넣고 나면 다음 사람을 바로 칠 수 있게 씨앗만 남긴다
    void add([one], () => setOne(PHONE_SEED));
  }

  return (
    <div className="stack">
      {/* 명단이 비면 아무도 못 들어온다. 그 상태를 가장 크게 말한다 (ADR-15) */}
      {invites.length === 0 ? (
        <p className="small warnText">{HOST_UI.invites.empty}</p>
      ) : (
        <p className="kicker">{HOST_UI.invites.count(invites.length, joined)}</p>
      )}

      <form className="field" onSubmit={addOne}>
        <label htmlFor="oneInvite">{HOST_UI.invites.addLabel}</label>
        <div className="row">
          <input
            id="oneInvite"
            className="grow"
            value={formatPhone(one)}
            /* 미리 든 `010` 이 통째로 선택된 채 오면 다음 숫자가 그걸 덮는다 */
            onFocus={keepPhoneSeed}
            inputMode="tel"
            autoComplete="off"
            onChange={(e) => {
              setOne(typedPhone(e.target.value));
              setError(null);
            }}
          />
          {/* 문턱은 서버와 같은 아홉 자리다 (`addInvites`). 011 같은 옛 번호도 명단에 들어간다 */}
          <button className="btn primary" disabled={busy || one.length < 9}>
            {HOST_UI.invites.addOne}
          </button>
        </div>
        <span className="tiny dim">{HOST_UI.invites.addHint}</span>
      </form>

      {error && <p className="err danger">{error}</p>}

      {invites.length > 0 && (
        <div className="card stack">
          <div className="row between">
            <span className="tiny dim">{left > 0 ? HOST_UI.invite.remaining(left) : HOST_UI.invite.allSent}</span>
            <span className="row">
              <button className="btn ghost" type="button" aria-pressed={showNote} onClick={() => setShowNote((v) => !v)}>
                {HOST_UI.invite.preview}
              </button>
              <button className="btn ghost" type="button" onClick={onEditTemplate}>
                {HOST_UI.invite.editTemplate}
              </button>
            </span>
          </div>

          {/* 장소가 비었다는 건 **접어두지 않는다** — 그대로 보내면 안내문에 자리만 빈다 */}
          {!hasPlace && <p className="tiny warnText">{HOST_UI.invite.noPlace}</p>}

          {/* 첫 사람 기준으로 그린다. 사람마다 다른 건 링크뿐이다 */}
          {showNote && <p className="small pre" style={{ margin: 0 }}>{noteFor(invites[0])}</p>}
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
