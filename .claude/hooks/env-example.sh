#!/usr/bin/env bash
# Stop 훅 — 작업이 끝날 때마다 소스에 하드코딩된 설정값을 검사하고
# .env.example 을 갱신한다. 기존 줄은 건드리지 않고 빠진 키만 덧붙인다.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0

root="${CLAUDE_PROJECT_DIR:-$PWD}"
cd "$root" 2>/dev/null || exit 0

# ── 검사 대상: 소스 디렉터리 + 루트의 설정 파일 (node_modules·빌드 산출물 제외)
targets=()
for d in src app lib components pages server scripts; do
  [ -d "$d" ] && targets+=("$d")
done
for f in *.ts *.tsx *.js *.mjs *.cjs; do
  [ -f "$f" ] && targets+=("$f")
done
[ ${#targets[@]} -eq 0 ] && exit 0

GREP=(grep -rInE
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx'
  --include='*.mjs' --include='*.cjs' --include='*.json'
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
  --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage)

# ── 1) 코드가 이미 참조하는 환경변수 이름 수집
refs=$(
  {
    "${GREP[@]}" -o 'process\.env\.[A-Za-z_][A-Za-z0-9_]*' "${targets[@]}" 2>/dev/null |
      sed -E 's/.*process\.env\.//'
    "${GREP[@]}" -o 'process\.env\[["'"'"'][A-Za-z_][A-Za-z0-9_]*["'"'"']\]' "${targets[@]}" 2>/dev/null |
      sed -E 's/.*\[["'"'"']//; s/["'"'"']\]$//'
  } | sort -u
)

# ── 2) 하드코딩된 설정값 탐지: 정규식|제안할 키 이름|사람이 읽는 설명
rules=(
  'https://[a-z0-9-]+\.supabase\.co|NEXT_PUBLIC_SUPABASE_URL|Supabase 프로젝트 URL'
  'sb_publishable_[A-Za-z0-9_-]{10,}|NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY|Supabase publishable 키'
  'sb_secret_[A-Za-z0-9_-]{10,}|SUPABASE_SECRET_KEY|Supabase secret 키'
  'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}|NEXT_PUBLIC_SUPABASE_ANON_KEY|JWT 형식 키'
  'sk-ant-[A-Za-z0-9_-]{20,}|ANTHROPIC_API_KEY|Anthropic API 키'
  'AIza[A-Za-z0-9_-]{30,}|GOOGLE_API_KEY|Google API 키'
  'gh[pousr]_[A-Za-z0-9]{20,}|GITHUB_TOKEN|GitHub 토큰'
  'postgres(ql)?://[^"'"'"'[:space:]]{10,}|DATABASE_URL|DB 접속 문자열'
)

findings=""
suggested=""

for rule in "${rules[@]}"; do
  re=${rule%%|*}
  rest=${rule#*|}
  key=${rest%%|*}
  label=${rest#*|}

  hits=$("${GREP[@]}" -o "$re" "${targets[@]}" 2>/dev/null | cut -d: -f1,2 | sort -u)
  [ -z "$hits" ] && continue

  suggested+="$key"$'\n'
  while IFS= read -r loc; do
    [ -n "$loc" ] && findings+="  $loc — $label"$'\n'
  done <<<"$hits"
done

# 이름 자체가 비밀을 뜻하는 식별자에 문자열 리터럴이 박힌 경우
generic=$("${GREP[@]}" -o \
  '[A-Za-z0-9_]*(_KEY|_SECRET|_TOKEN|_PASSWORD|apiKey|secretKey|accessToken)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{8,}["'"'"']' \
  "${targets[@]}" 2>/dev/null | sort -u)
while IFS= read -r line; do
  [ -z "$line" ] && continue
  loc=$(printf '%s' "$line" | cut -d: -f1,2)
  ident=$(printf '%s' "$line" | cut -d: -f3- | sed -E 's/[[:space:]]*[:=].*//; s/^[[:space:]]*//')
  [ -z "$ident" ] && continue
  key=$(printf '%s' "$ident" | sed -E 's/([a-z0-9])([A-Z])/\1_\2/g' | tr '[:lower:]' '[:upper:]')
  suggested+="$key"$'\n'
  findings+="  $loc — 하드코딩된 비밀값처럼 보임 ($ident)"$'\n'
done <<<"$generic"

# ── 3) .env.example 갱신 — 기존 줄은 보존하고 빠진 키만 추가
example=".env.example"
existing=""
[ -f "$example" ] && existing=$(sed -nE 's/^[[:space:]]*#?[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "$example" | sort -u)

wanted=$(printf '%s\n%s\n' "$refs" "$suggested" | sed '/^$/d' | sort -u)
missing=$(comm -23 <(printf '%s\n' "$wanted" | sed '/^$/d') <(printf '%s\n' "$existing" | sed '/^$/d'))

added=0
if [ -n "$missing" ]; then
  if [ ! -f "$example" ]; then
    {
      printf '# 이 파일은 Stop 훅(.claude/hooks/env-example.sh)이 자동으로 채웁니다.\n'
      printf '# 실제 값은 .env.local 에 두고, 이 파일에는 키 이름만 남겨 두세요.\n'
    } >"$example"
  fi
  printf '\n' >>"$example"
  while IFS= read -r key; do
    [ -z "$key" ] && continue
    printf '%s=\n' "$key" >>"$example"
    added=$((added + 1))
  done <<<"$missing"
fi

# ── 4) 결과 알림 (변화가 없으면 조용히 종료)
[ -z "$findings" ] && [ "$added" -eq 0 ] && exit 0

msg=""
if [ "$added" -gt 0 ]; then
  msg+="📝 .env.example 에 키 ${added}개 추가: $(printf '%s' "$missing" | tr '\n' ' ')"
fi
if [ -n "$findings" ]; then
  [ -n "$msg" ] && msg+=$'\n'
  count=$(printf '%s' "$findings" | grep -c '' || true)
  msg+="⚠️ 하드코딩된 설정값 ${count}건 — process.env 참조로 바꾸는 걸 권합니다."$'\n'
  msg+="$findings"
fi

jq -n --arg msg "$msg" '{systemMessage: $msg, suppressOutput: true}'
exit 0
