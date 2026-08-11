#!/usr/bin/env bash
# PreToolUse 훅 — .env 계열 파일의 읽기·수정·삭제를 차단한다.
#
# 대상: Read / Edit / Write / NotebookEdit 의 file_path, 그리고 Bash 명령어 전체.
# 예외: .env.example / .env.sample / .env.template / .env.dist (공유용 템플릿)
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // ""')

case "$tool" in
  Bash)
    target=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
    ;;
  *)
    target=$(printf '%s' "$input" |
      jq -r '.tool_input.file_path // .tool_input.notebook_path // .tool_input.path // ""')
    ;;
esac

[ -z "$target" ] && exit 0

# 경로 토큰으로 쓰인 .env 만 잡는다. 앞 글자를 공백·따옴표·/·=·( 로 제한했으므로
# process.env 나 import.meta.env 처럼 식별자 뒤에 붙은 .env 는 걸리지 않는다.
ENV_RE='(^|[[:space:]"'"'"'`=(/])\.env([.-][A-Za-z0-9_.-]+)?'

printf '%s' "$target" | grep -qE "$ENV_RE" || exit 0

# 템플릿 파일명을 지운 뒤에도 .env 가 남아야 진짜 차단 대상이다.
stripped=$(printf '%s' "$target" | sed -E 's/\.env\.(example|sample|template|dist)/.ENVTEMPLATE/g')
printf '%s' "$stripped" | grep -qE "$ENV_RE" || exit 0

reason=".env 파일은 이 프로젝트에서 보호 대상입니다. 읽기·수정·삭제 모두 차단됩니다(.env.example 만 예외). 값이 필요하면 사용자에게 직접 요청하고, 코드에서는 process.env 로만 참조하세요."

jq -n --arg reason "$reason" --arg tool "$tool" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  },
  systemMessage: ("🔒 .env 접근 차단됨 (" + $tool + ")")
}'
exit 0
