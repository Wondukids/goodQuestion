"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Commit Graph — 저장소 커밋 그래프를 그리고, 커밋을 우클릭하면
 * 체크아웃·워크트리 만들기·해시 복사를 실행한다.
 *
 * 조회는 /api/dev/git, 실행은 /api/dev/git/action. 실행 결과(성공·git 에러)
 * 는 상단 알림에 그대로 보여 준다 — force 옵션은 일부러 없다.
 */

type Commit = {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  refs: string[];
  subject: string;
};

type Worktree = { path: string; head: string; branch: string | null };

type RepoState = {
  commits: Commit[];
  head: string;
  branch: string;
  dirtyCount: number;
  worktrees: Worktree[];
};

const ROW_H = 34;
const LANE_W = 18;
const DOT_R = 5;
const PAD = 14;
const LANE_COLORS = [
  "#45a9d3",
  "#fd7c51",
  "#7cb342",
  "#ab47bc",
  "#f4b400",
  "#26a69a",
  "#ec407a",
  "#5c6bc0",
];

/** 커밋 순서(topo)대로 레인을 배치한다 — 반환된 laneOf 로 간선을 그린다 */
function layoutGraph(commits: Commit[]) {
  const lanes: (string | null)[] = [];
  const laneOf = new Map<string, number>();
  const rows: { commit: Commit; lane: number }[] = [];

  for (const commit of commits) {
    let lane = lanes.findIndex((h) => h === commit.hash);
    if (lane === -1) {
      lane = lanes.findIndex((h) => h === null);
      if (lane === -1) {
        lanes.push(null);
        lane = lanes.length - 1;
      }
    }
    /* 같은 커밋을 기다리던 다른 레인은 여기서 합류한다 */
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === commit.hash) lanes[i] = null;
    }
    const [first, ...rest] = commit.parents;
    lanes[lane] = first ?? null;
    for (const parent of rest) {
      if (!lanes.includes(parent)) {
        let free = lanes.findIndex((h) => h === null);
        if (free === -1) {
          lanes.push(null);
          free = lanes.length - 1;
        }
        lanes[free] = parent;
      }
    }
    laneOf.set(commit.hash, lane);
    rows.push({ commit, lane });
  }

  const maxLane = rows.reduce((m, r) => Math.max(m, r.lane), 0);
  return { rows, laneOf, maxLane };
}

const laneX = (lane: number) => PAD + lane * LANE_W;
const rowY = (row: number) => row * ROW_H + ROW_H / 2;

/** refs 문자열("HEAD -> x", "origin/x", "tag: v1")을 배지용으로 분해 */
function parseRef(ref: string): { name: string; kind: "local" | "remote" | "tag" } {
  const name = ref.replace(/^HEAD -> /, "");
  if (name.startsWith("tag: ")) return { name: name.slice(5), kind: "tag" };
  if (name.startsWith("origin/") || name === "origin") {
    return { name, kind: "remote" };
  }
  return { name, kind: "local" };
}

/** 이 커밋을 가리키는 로컬 브랜치 이름들 */
function localBranches(commit: Commit): string[] {
  return commit.refs
    .map(parseRef)
    .filter((r) => r.kind === "local" && r.name !== "HEAD")
    .map((r) => r.name);
}

export default function GitGraphPage() {
  const [repo, setRepo] = useState<RepoState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; commit: Commit } | null>(
    null,
  );

  /* 조회만 한다 — 상태 반영은 호출한 쪽의 then 에서 */
  const loadRepo = useCallback(async () => {
    const res = await fetch("/api/dev/git");
    const data = (await res.json()) as RepoState & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `조회 실패 (${res.status})`);
    return data;
  }, []);

  const fetchRepo = useCallback(
    () =>
      loadRepo()
        .then((data) => {
          setRepo(data);
          setLoadError("");
        })
        .catch((error: unknown) => {
          setLoadError(error instanceof Error ? error.message : String(error));
        }),
    [loadRepo],
  );

  useEffect(() => {
    let cancelled = false;
    loadRepo()
      .then((data) => {
        if (cancelled) return;
        setRepo(data);
        setLoadError("");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [loadRepo]);

  const layout = useMemo(
    () => (repo ? layoutGraph(repo.commits) : null),
    [repo],
  );

  async function runAction(payload: {
    action: "checkout" | "worktree-add" | "worktree-remove";
    ref?: string;
    path?: string;
  }) {
    setMenu(null);
    setBusy(true);
    setNotice("");
    try {
      const res = await fetch("/api/dev/git/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        output?: string;
        path?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `실행 실패 (${res.status})`);
      setNotice(
        [data.output, data.path && `워크트리 위치: ${data.path}`]
          .filter(Boolean)
          .join("\n") || "완료했습니다.",
      );
      await fetchRepo();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function checkout(ref: string) {
    if (
      repo &&
      repo.dirtyCount > 0 &&
      !window.confirm(
        `커밋하지 않은 변경이 ${repo.dirtyCount}개 있습니다. 그래도 체크아웃할까요?`,
      )
    ) {
      setMenu(null);
      return;
    }
    void runAction({ action: "checkout", ref });
  }

  function copyHash(hash: string) {
    setMenu(null);
    void navigator.clipboard
      .writeText(hash)
      .then(() => setNotice(`해시를 복사했습니다: ${hash}`))
      .catch(() => setNotice("클립보드 복사에 실패했습니다."));
  }

  const graphWidth = layout ? PAD * 2 + layout.maxLane * LANE_W : PAD * 2;

  return (
    <main className="min-h-screen bg-app-bg px-6 py-8">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] font-extrabold text-ink">Commit Graph</h1>
          {repo && (
            <span className="flex items-center gap-2 text-[13px] font-bold text-ink-soft">
              <span className="rounded-lg bg-primary-soft px-2 py-1 text-primary-strong">
                {repo.branch === "HEAD" ? `detached @ ${repo.head.slice(0, 7)}` : repo.branch}
              </span>
              {repo.dirtyCount > 0 && (
                <span className="rounded-lg bg-brand-50 px-2 py-1 text-point-strong">
                  커밋 안 된 변경 {repo.dirtyCount}개
                </span>
              )}
            </span>
          )}
          <span className="ml-auto flex items-center gap-3">
            <span className="text-[12px] text-ink-faint">
              커밋을 우클릭하면 체크아웃·워크트리 메뉴가 열립니다
            </span>
            <button
              type="button"
              onClick={() => void fetchRepo()}
              className="rounded-xl bg-chip px-4 py-2 text-[13px] font-bold text-ink"
            >
              새로고침
            </button>
          </span>
        </header>

        {loadError && (
          <p className="rounded-xl bg-surface px-4 py-3 text-[14px] font-bold text-red-600 shadow-panel">
            {loadError}
          </p>
        )}
        {notice && (
          <pre className="whitespace-pre-wrap rounded-xl bg-surface px-4 py-3 font-sans text-[13px] font-bold text-ink-soft shadow-panel">
            {notice}
          </pre>
        )}
        {busy && (
          <p className="text-[13px] font-bold text-ink-muted">git 실행 중...</p>
        )}

        {/* ---------- 그래프 ---------- */}
        {repo && layout && (
          <div className="max-h-[620px] overflow-auto rounded-2xl bg-surface py-2 shadow-panel">
            <div
              className="relative"
              style={{ minHeight: layout.rows.length * ROW_H }}
            >
              <svg
                className="pointer-events-none absolute top-0 left-0"
                width={graphWidth}
                height={layout.rows.length * ROW_H}
              >
                {/* 간선 — 자식 → 부모 */}
                {layout.rows.map(({ commit, lane }, row) =>
                  commit.parents.map((parent) => {
                    const parentRow = layout.rows.findIndex(
                      (r) => r.commit.hash === parent,
                    );
                    const x1 = laneX(lane);
                    const y1 = rowY(row);
                    if (parentRow === -1) {
                      /* 로그 범위 밖 부모 — 짧은 꼬리만 */
                      return (
                        <line
                          key={`${commit.hash}-${parent}`}
                          x1={x1}
                          y1={y1}
                          x2={x1}
                          y2={y1 + ROW_H * 0.6}
                          stroke={LANE_COLORS[lane % LANE_COLORS.length]}
                          strokeWidth={2}
                          opacity={0.35}
                        />
                      );
                    }
                    const parentLane = layout.rows[parentRow].lane;
                    const x2 = laneX(parentLane);
                    const y2 = rowY(parentRow);
                    const color =
                      LANE_COLORS[Math.max(lane, parentLane) % LANE_COLORS.length];
                    const d =
                      x1 === x2
                        ? `M ${x1} ${y1} L ${x2} ${y2}`
                        : `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
                    return (
                      <path
                        key={`${commit.hash}-${parent}`}
                        d={d}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        opacity={0.7}
                      />
                    );
                  }),
                )}
                {/* 노드 */}
                {layout.rows.map(({ commit, lane }, row) => (
                  <g key={commit.hash}>
                    {commit.hash === repo.head && (
                      <circle
                        cx={laneX(lane)}
                        cy={rowY(row)}
                        r={DOT_R + 3.5}
                        fill="none"
                        stroke={LANE_COLORS[lane % LANE_COLORS.length]}
                        strokeWidth={2}
                      />
                    )}
                    <circle
                      cx={laneX(lane)}
                      cy={rowY(row)}
                      r={DOT_R}
                      fill={LANE_COLORS[lane % LANE_COLORS.length]}
                    />
                  </g>
                ))}
              </svg>

              {layout.rows.map(({ commit }, row) => (
                <div
                  key={commit.hash}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({
                      x: Math.min(e.clientX, window.innerWidth - 280),
                      y: Math.min(e.clientY, window.innerHeight - 260),
                      commit,
                    });
                  }}
                  className={`flex cursor-context-menu items-center gap-2 pr-4 select-none ${
                    commit.hash === repo.head
                      ? "bg-primary-soft/50"
                      : row % 2 === 1
                        ? "bg-app-bg/60"
                        : ""
                  } hover:bg-chip/70`}
                  style={{ height: ROW_H, paddingLeft: graphWidth + 6 }}
                >
                  {commit.refs.map((ref) => {
                    const { name, kind } = parseRef(ref);
                    if (name === "HEAD") return null;
                    return (
                      <span
                        key={ref}
                        className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                          kind === "local"
                            ? "bg-primary-strong text-white"
                            : kind === "remote"
                              ? "bg-chip text-ink-mid"
                              : "bg-warm text-ink"
                        }`}
                      >
                        {name}
                      </span>
                    );
                  })}
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                    {commit.subject}
                  </span>
                  <span className="shrink-0 text-[12px] text-ink-faint">
                    {commit.author} · {commit.date} ·{" "}
                    <span className="font-mono">{commit.hash.slice(0, 7)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---------- 워크트리 목록 ---------- */}
        {repo && (
          <div className="flex flex-col gap-1 rounded-2xl bg-surface p-4 shadow-panel">
            <h2 className="mb-1 text-[16px] font-extrabold text-ink">
              워크트리 {repo.worktrees.length}개
            </h2>
            {repo.worktrees.map((wt, i) => (
              <div
                key={wt.path}
                className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-chip/60"
              >
                <span className="rounded-lg bg-chip px-2 py-1 text-[12px] font-bold text-ink-mid">
                  {wt.branch ?? `detached @ ${wt.head.slice(0, 7)}`}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
                  {wt.path}
                </span>
                {i === 0 ? (
                  <span className="text-[12px] font-bold text-ink-faint">
                    본 저장소
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runAction({ action: "worktree-remove", path: wt.path })
                    }
                    className="rounded-lg bg-chip px-3 py-1 text-[12px] font-bold text-point-strong disabled:opacity-40"
                  >
                    제거
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- 우클릭 컨텍스트 메뉴 ---------- */}
      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="fixed z-50 flex w-[264px] flex-col overflow-hidden rounded-xl border border-divider bg-surface py-1 shadow-panel"
            style={{ left: menu.x, top: menu.y }}
          >
            <p className="truncate px-3 py-1.5 text-[12px] font-bold text-ink-faint">
              {menu.commit.hash.slice(0, 7)} · {menu.commit.subject}
            </p>
            {localBranches(menu.commit).map((branch) => (
              <button
                key={`co-${branch}`}
                type="button"
                disabled={busy || branch === repo?.branch}
                onClick={() => checkout(branch)}
                className="px-3 py-2 text-left text-[14px] font-bold text-ink hover:bg-chip disabled:opacity-40"
              >
                ‘{branch}’ 브랜치 체크아웃
                {branch === repo?.branch && " (현재)"}
              </button>
            ))}
            <button
              type="button"
              disabled={busy || menu.commit.hash === repo?.head}
              onClick={() => checkout(menu.commit.hash)}
              className="px-3 py-2 text-left text-[14px] font-bold text-ink hover:bg-chip disabled:opacity-40"
            >
              이 커밋 체크아웃 (detached)
            </button>
            <div className="my-1 h-px bg-divider" />
            {localBranches(menu.commit).map((branch) => (
              <button
                key={`wt-${branch}`}
                type="button"
                disabled={busy}
                onClick={() => void runAction({ action: "worktree-add", ref: branch })}
                className="px-3 py-2 text-left text-[14px] font-bold text-ink hover:bg-chip disabled:opacity-40"
              >
                ‘{branch}’ 브랜치로 워크트리 만들기
              </button>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction({ action: "worktree-add", ref: menu.commit.hash })
              }
              className="px-3 py-2 text-left text-[14px] font-bold text-ink hover:bg-chip disabled:opacity-40"
            >
              이 커밋으로 워크트리 만들기
            </button>
            <div className="my-1 h-px bg-divider" />
            <button
              type="button"
              onClick={() => copyHash(menu.commit.hash)}
              className="px-3 py-2 text-left text-[14px] font-bold text-ink hover:bg-chip"
            >
              해시 복사
            </button>
          </div>
        </>
      )}
    </main>
  );
}
