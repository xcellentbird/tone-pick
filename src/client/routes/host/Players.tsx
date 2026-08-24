/**
 * 참가자 탭. **위아래 두 목록이 역할을 나눈다.**
 *
 * - 위의 **입장 명단 카드** — 등록 **전/후**를 맡는다. 카드는 상태 한 줄만 말하고,
 *   누르면 시트가 열려 그 안에서 다 한다: 더하기 · 안내문 · 아직 등록 안 한 사람 · 빼기.
 *   명단에 더하는 길도 그 시트 하나뿐이다.
 *   **시트로 접은 이유** — 명단 일은 파티 **며칠 전에 한 번에** 하는 일이고,
 *   카드 일(참석 찍기)은 **문 앞에서** 하는 일이다. 늘 펼쳐 두면 당일에 쓰는 목록이
 *   지난 일 아래로 밀린다. 카드 한 줄이 "지금 할 일이 있나" 를 대신 말해준다
 * - 아래의 **참가자 카드** — 등록 **후**를 맡는다. 온 사람이 누구인가.
 *   참석 상태는 카드 안 맨 오른쪽에 붙는다 (ADR-33)
 *
 * 한 사람은 **한 번만** 나온다 — 등록하면 명단 행에서 빠지고 카드로 올라온다.
 * 그래서 명단은 파티가 다가올수록 줄고 카드가 그만큼 는다.
 *
 * 명단이 파티의 문이다 (ADR-15). 비어 있으면 아무도 못 들어오므로 그 상태를 가장 크게 말한다.
 *
 * 삭제는 **상세 시트에서만** 한다 — 목록에서 스와이프 삭제 같은 걸 두면
 * 콕 기록과 자리가 통째로 날아가는 일이 손끝에서 일어난다.
 *
 * 상세 시트는 라우트다. 뒤로 가기로 닫힌다 (ROUTES.md).
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BTN, DELETE_PLAYER, GENDER, HOST_UI, ME, UNIT } from "../../../shared/copy.ts";
import type { Attendance, Gender, Invite } from "../../../shared/types.ts";
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
 * 필터는 **성별 축**이다. 카드 목록은 등록한 사람만 담으므로 상태로 나눌 것이 없고,
 * 참석은 카드마다 오른쪽에 붙어 있어 훑으면 보인다.
 *
 * 칩 셋의 진짜 용도는 **세 숫자를 한 번에 보는 것**(성비)이다 — 고른 쪽만 세면
 * 성비를 보려고 버튼을 두 번 눌러야 한다.
 */
type Filter = "all" | Gender;

export default function Players() {
  const { state, reload } = useConsole();
  const { pid } = useParams();
  const navigate = useNavigate();
  const { confirm, toast } = useOverlay();
  const base = `/host/${state.meta.id}/players`;
  const picked = state.players.find((p) => p.id === pid);
  /*
   * 명단 시트도 **라우트다** — 뒤로 가기로 닫힌다 (ROUTES.md).
   * `/players/invites` 는 참가자 아이디와 겹치지 않는다 (아이디는 서버가 만든 난수다).
   */
  const atInvites = pid === "invites";
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

  /**
   * 명단 카드가 말하는 두 숫자. 나머지는 시트 안에서 센다.
   *
   * **안내문을 보낼 일이 남은 사람은 아직 등록 안 한 사람뿐이다** — 등록했다는 건
   * 이미 자기 링크로 들어왔다는 뜻이라, 안 보냄으로 남아 있어도 보낼 것이 없다.
   * 그 사람들까지 세면 카드가 없는 할 일을 만들어 낸다.
   */
  const joinedN = state.invites.filter((i) => i.nickname).length;
  const unsentN = state.invites.filter((i) => !i.nickname && !i.sentAt).length;

  const att = (id: string) => state.attendance[id];
  const shown = state.players.filter((p) => filter === "all" || p.gender === filter);
  const count: Record<Filter, number> = {
    all: state.players.length,
    M: state.players.filter((p) => p.gender === "M").length,
    F: state.players.filter((p) => p.gender === "F").length,
  };

  /**
   * 카드 오른쪽에 붙는 **참가 상태**. 파티 전후로 이름이 갈린다.
   *
   * 톤은 저장된 값(`key`)이 정하고 글자(`label`)가 같은 정보를 다시 말한다 —
   * 색만으로 말하면 못 읽는 사람이 생긴다. `등록함` 과 `미도착` 은 **같은 값**이라
   * 같은 톤(조용한 기본)을 쓴다.
   */
  const statusOf = (id: string) => {
    const a = att(id);
    if (a === "left") return { key: "left", label: HOST_UI.status.left };
    if (a === "arrived") return { key: "arrived", label: HOST_UI.status.arrived };
    return { key: "absent", label: started ? HOST_UI.status.absent : HOST_UI.status.registered };
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
        **명단 카드가 맨 위다** — 파티의 문이고, 운영자가 먼저 하는 일이 여기 있다.
        카드는 **열지 않고도 아는 것**만 말한다: 비었나 · 몇 명인가 · 안내문을 못 보낸 사람이 있나.
        나머지는 전부 시트 안이다.

        **링크를 통째로 복사하는 버튼은 없다** (ADR-32). 링크가 사람마다 달라서
        한 번 복사해 단톡방에 뿌릴 수가 없다 — 그게 이 슬라이스의 요점이다.
      */}
      <button className="card row between" onClick={() => navigate(`${base}/invites`)}>
        <span className="grow" style={{ textAlign: "left" }}>
          <span className="name">{HOST_UI.invites.title}</span>
          {/* 명단이 비면 아무도 못 들어온다. 그 상태를 가장 크게 말한다 (ADR-15) */}
          <div className={`small ${state.invites.length === 0 ? "warnText" : "dim"}`}>
            {state.invites.length === 0
              ? HOST_UI.invites.empty
              : HOST_UI.invites.count(state.invites.length, joinedN)}
          </div>
          {/* 안내문을 아직 못 보낸 사람 — **여는 이유**가 되는 유일한 숫자다 */}
          {unsentN > 0 && <div className="tiny dim">{HOST_UI.invite.remaining(unsentN)}</div>}
        </span>
        <span className="dim">{"›"}</span>
      </button>

      {/* 한 버튼을 껐다 켜면 지금 어느 쪽인지 알 수 없다. 셋 중 하나가 항상 켜져 있다 */}
      <div className="choice">
        {(
          [
            ["all", HOST_UI.players.filterAll],
            ["M", GENDER.M],
            ["F", GENDER.F],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label} <span className="filterCount">{count[key]}</span>
          </button>
        ))}
      </div>

      {/*
        참석 숫자는 **한 줄로만** 둔다 (ADR-33). 카드마다 상태가 붙어 있어도
        "몇 명 남았나" 는 세어서 알 일이 아니다. 파티 전에는 전원이 같은 값이라 뜨지 않는다.
      */}
      {started && state.players.length > 0 && (
        <p className="tiny dim">
          {HOST_UI.status.summary(
            state.players.filter((p) => att(p.id) === "arrived").length,
            state.players.filter((p) => !att(p.id)).length,
            state.players.filter((p) => att(p.id) === "left").length,
          )}
        </p>
      )}

      {state.players.length === 0 && <p className="dim center">{HOST_UI.players.empty}</p>}
      {state.players.length > 0 && shown.length === 0 && (
        <p className="dim center">{HOST_UI.players.emptyFiltered}</p>
      )}

      {/*
        **문 앞에서 사람을 찾는 화면이다.** 얼굴과 맞추는 건 실명이지 닉네임이 아니다 —
        그래서 실명이 앞에 온다. MBTI·콕 횟수는 상세로 갔다 (ADR-33).

        카드가 **버튼 하나가 아니라 상자**인 이유는 오른쪽 참석 칩 때문이다 —
        버튼 안에 버튼을 넣을 수 없다. 왼쪽 전체가 상세를 여는 손잡이다.
      */}
      {shown.map((p) => (
        <div className="person" key={p.id}>
          <button type="button" className="open" onClick={() => navigate(`${base}/${p.id}`)}>
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
            파티가 시작되면 **상태 배지가 곧 버튼이다** — 문 앞에서 한 명씩 찍는 자리라
            한 번에 끝나야 한다. `나감` 은 눌러서 바꾸지 않는다. 되돌릴 자리는 상세다.
          */}
          {started && att(p.id) !== "left" ? (
            <button
              className="att live"
              data-att={statusOf(p.id).key}
              aria-pressed={att(p.id) === "arrived"}
              onClick={() => void toggleArrived(p.id)}
            >
              {statusOf(p.id).label}
            </button>
          ) : (
            <span className={`att${started ? " live" : ""}`} data-att={statusOf(p.id).key}>
              {statusOf(p.id).label}
            </span>
          )}
        </div>
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

      {/* 명단 시트. 여는 카드가 위에 있고, 뒤로 가기로 닫힌다 */}
      <Sheet open={atInvites} onClose={() => navigate(-1)} title={HOST_UI.invites.title}>
        <Invites
          invites={state.invites}
          eventId={state.meta.id}
          hasPlace={!!state.meta.place}
          noteFor={noteFor}
          onCopy={copyNote}
          onSent={setSent}
          onRemove={askRemove}
          onEditTemplate={() => navigate("/host/defaults")}
          onDone={(added) => {
            toast(added > 0 ? HOST_UI.invites.saved : added < 0 ? HOST_UI.invites.removed : HOST_UI.invites.already);
            reload();
          }}
        />
      </Sheet>
    </div>
  );
}

/**
 * 입장 명단 **시트의 속**. 등록 전/후를 여기서 본다 — 부를 사람을 넣고, 안내문을 보내고,
 * 아직 등록 안 한 사람이 누구인지 확인한다. 등록한 사람은 시트에서 빠져 탭의 카드로 올라간다.
 *
 * 더하기는 **한 명씩뿐**이다. 통째로 갈아치우는 길은 두지 않는다 —
 * 한 명 추가하려다 손이 미끄러지면 그 파티의 명단 전체가 날아가고, 되돌릴 방법이 없다.
 * 여러 줄을 한 번에 붙여넣는 칸도 뺐다. (API 는 배열을 받으므로 리허설 스크립트는 그대로 쓴다)
 *
 * 빼기는 **아직 등록 안 한 행에서만** 한다 — 누구를 빼는지 보면서 하는 일이다.
 * 등록한 사람을 파티에서 지우는 건 다른 일이고, 그건 카드 상세의 삭제다.
 */
function Invites({
  invites,
  eventId,
  hasPlace,
  noteFor,
  onCopy,
  onSent,
  onRemove,
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
  /** 그 사람의 안내문을 복사한다 — 복사하면 보낸 것으로 본다 */
  onCopy: (i: Invite) => void;
  /** 보냄 표시를 되돌린다 */
  onSent: (i: Invite, sent: boolean) => void;
  /** 명단에서 뺀다. 확인창을 거친다 */
  onRemove: (i: Invite) => void;
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
  /** 보낼 일이 남은 사람 — **아직 등록 안 한 쪽만** 센다 (탭의 카드와 같은 셈이다) */
  const left = invites.filter((i) => !i.nickname && !i.sentAt).length;
  const joined = invites.filter((i) => i.nickname).length;
  /** 아직 등록 안 한 사람. **이 목록은 파티가 다가올수록 줄고, 그만큼 아래 카드가 는다** */
  const waiting = invites.filter((i) => !i.nickname);

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
      {/*
        이름은 시트 제목이 말한다. 여기서는 **숫자만** 한 줄.
        비어 있으면 그 사실이 숫자를 대신한다 — 아무도 못 들어오는 상태다 (ADR-15).
      */}
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
              <button className="btn ghost compact" type="button" aria-pressed={showNote} onClick={() => setShowNote((v) => !v)}>
                {HOST_UI.invite.preview}
              </button>
              <button className="btn ghost compact" type="button" onClick={onEditTemplate}>
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

      {/*
        **아직 등록 안 한 사람들.** 번호가 그 사람의 유일한 이름인 자리라
        한 덩어리로 모여 있어야 어깨너머로 덜 읽힌다.
        여기서 하는 일은 **안내문을 보내는 것**과 **명단에서 빼는 것** 둘뿐이다.
        행마다 `미등록` 을 또 달지 않는다 — 구역 머리가 이미 한 번 말했다.
      */}
      {waiting.length > 0 && (
        <>
          <p className="kicker" style={{ marginTop: 4 }}>
            {HOST_UI.invites.waitingCount(waiting.length)}
          </p>
          <div className="stack">
            {waiting.map((i) => (
              <div className="row between" key={i.phone}>
                {/* 목록도 입력칸과 같은 모양으로 끊는다 — 다르면 같은 번호가 다르게 읽힌다 */}
                <span className="grow ellipsis">{formatPhone(i.phone)}</span>
                {/* 보냈으면 **글자로** 말한다. 눌러서 되돌린다 */}
                {i.sentAt ? (
                  <button className="btn ghost compact" aria-pressed onClick={() => onSent(i, false)}>
                    {HOST_UI.status.invited}
                  </button>
                ) : (
                  <button className="btn ghost compact" onClick={() => onCopy(i)}>
                    {HOST_UI.invite.copy}
                  </button>
                )}
                <button className="btn ghost compact" onClick={() => onRemove(i)}>
                  {HOST_UI.invites.remove}
                </button>
              </div>
            ))}
          </div>
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
