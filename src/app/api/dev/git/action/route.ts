import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse, type NextRequest } from "next/server";

/**
 * /dev/git 우클릭 메뉴의 실행 담당 — checkout / worktree add / worktree remove.
 *
 * execFile 인자 배열로만 넘기므로 셸 인젝션은 없고, ref 는 해시·브랜치명
 * 형태만 통과시키며 "-" 로 시작하는 값(옵션 위장)은 거부한다.
 * 워킹트리가 더러운 상태의 checkout 실패 등은 git 의 stderr 를 그대로
 * 돌려줘서 화면에 보이게 한다 — 여기서 --force 를 쓰지 않는다.
 */

const run = promisify(execFile);

async function git(...args: string[]): Promise<string> {
  const { stdout, stderr } = await run("git", args, {
    cwd: process.cwd(),
    maxBuffer: 16 * 1024 * 1024,
  });
  /* "Updating files: 42%\r43%\r..." 진행률은 마지막 상태만 남긴다 */
  return (stdout + stderr)
    .split("\n")
    .map((line) => line.split("\r").filter(Boolean).pop() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** 커밋 해시 또는 브랜치명 형태만 허용 */
function isSafeRef(ref: string): boolean {
  if (!ref || ref.startsWith("-") || ref.includes("..")) return false;
  return /^[\w./-]+$/.test(ref);
}

/** 워크트리 폴더 이름용 — 경로 구분자를 하이픈으로 바꾼다 */
function worktreeFolderName(ref: string): string {
  return ref.replace(/[/\\]/g, "-").slice(0, 40);
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    action?: "checkout" | "worktree-add" | "worktree-remove";
    ref?: string;
    path?: string;
  };

  try {
    switch (body.action) {
      case "checkout": {
        const ref = body.ref ?? "";
        if (!isSafeRef(ref)) {
          return NextResponse.json({ error: "잘못된 ref 입니다." }, { status: 400 });
        }
        const output = await git("checkout", ref);
        return NextResponse.json({ ok: true, output });
      }

      case "worktree-add": {
        const ref = body.ref ?? "";
        if (!isSafeRef(ref)) {
          return NextResponse.json({ error: "잘못된 ref 입니다." }, { status: 400 });
        }
        /* 저장소 옆 <repo>-worktrees/ 아래에 만든다 — 저장소 안이면 git 이 거부 */
        const repoRoot = process.cwd();
        const base = path.join(
          path.dirname(repoRoot),
          `${path.basename(repoRoot)}-worktrees`,
        );
        await mkdir(base, { recursive: true });
        const target = path.join(base, worktreeFolderName(ref));
        /* 브랜치는 그대로 체크아웃(다른 곳에 이미 있으면 git 이 거절),
           해시는 detached 로 연다 */
        const isHash = /^[0-9a-f]{4,40}$/i.test(ref);
        const output = isHash
          ? await git("worktree", "add", "--detach", target, ref)
          : await git("worktree", "add", target, ref);
        return NextResponse.json({ ok: true, output, path: target });
      }

      case "worktree-remove": {
        /* git 은 Windows 에서도 슬래시 경로를 내므로 resolve 로 맞춰 비교한다 */
        const target = path.resolve(body.path ?? "");
        /* 실제 워크트리 목록에 있는 경로만 지운다 — 임의 폴더 삭제 방지 */
        const list = await git("worktree", "list", "--porcelain");
        const known = list
          .split("\n")
          .filter((l) => l.startsWith("worktree "))
          .map((l) => path.resolve(l.slice("worktree ".length)));
        /* 첫 항목은 본 저장소 — 제거 대상이 될 수 없다 */
        if (!known.slice(1).includes(target)) {
          return NextResponse.json(
            { error: "워크트리 목록에 없는 경로입니다." },
            { status: 400 },
          );
        }
        const output = await git("worktree", "remove", target);
        return NextResponse.json({ ok: true, output });
      }

      default:
        return NextResponse.json({ error: "알 수 없는 action 입니다." }, { status: 400 });
    }
  } catch (error) {
    const detail = error as { stderr?: string; message?: string };
    return NextResponse.json(
      { error: detail.stderr?.trim() || detail.message || "git 실행 실패" },
      { status: 500 },
    );
  }
}
