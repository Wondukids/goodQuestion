import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

/**
 * /dev/git 커밋 그래프가 읽는 저장소 상태 — 로그·HEAD·워킹트리 오염 여부·
 * 워크트리 목록을 한 번에 내린다. git CLI 를 execFile 로 호출하므로
 * 셸 해석이 없다 (인자 배열 그대로 전달).
 */

const run = promisify(execFile);

async function git(...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd: process.cwd(),
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

export type GitCommit = {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  /** %D 그대로 — "HEAD -> api_team", "origin/main", "tag: v1" 형태 */
  refs: string[];
  subject: string;
};

export type GitWorktree = {
  path: string;
  head: string;
  /** 체크아웃된 브랜치 이름, detached 면 null */
  branch: string | null;
};

function parseWorktrees(porcelain: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let current: Partial<GitWorktree> = {};
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), branch: null };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (line === "" && current.path) {
      worktrees.push(current as GitWorktree);
      current = {};
    }
  }
  if (current.path) worktrees.push(current as GitWorktree);
  return worktrees;
}

export async function GET() {
  /* \x1f 필드 구분·\x1e 레코드 구분 — 제목에 쉼표·개행이 있어도 안전하다 */
  const FIELD = "%x1f";
  const RECORD = "%x1e";
  try {
    const [log, head, branch, status, worktreeList] = await Promise.all([
      git(
        "log",
        "--all",
        "--topo-order",
        "-n",
        "200",
        `--pretty=format:%H${FIELD}%P${FIELD}%an${FIELD}%ad${FIELD}%D${FIELD}%s${RECORD}`,
        "--date=format:%m-%d %H:%M",
      ),
      git("rev-parse", "HEAD"),
      git("rev-parse", "--abbrev-ref", "HEAD"),
      git("status", "--porcelain"),
      git("worktree", "list", "--porcelain"),
    ]);

    const commits: GitCommit[] = log
      .split("\x1e")
      .map((record) => record.replace(/^\n/, ""))
      .filter((record) => record.includes("\x1f"))
      .map((record) => {
        const [hash, parents, author, date, refs, subject] = record.split("\x1f");
        return {
          hash,
          parents: parents ? parents.split(" ") : [],
          author,
          date,
          refs: refs ? refs.split(", ").filter(Boolean) : [],
          subject,
        };
      });

    return NextResponse.json({
      commits,
      head: head.trim(),
      branch: branch.trim(),
      dirtyCount: status.trim() ? status.trim().split("\n").length : 0,
      worktrees: parseWorktrees(worktreeList),
    });
  } catch (error) {
    const detail = error as { stderr?: string; message?: string };
    return NextResponse.json(
      { error: detail.stderr?.trim() || detail.message || "git 호출 실패" },
      { status: 500 },
    );
  }
}
