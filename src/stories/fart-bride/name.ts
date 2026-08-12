/**
 * 아이 이름 호명 유틸.
 *
 * 대사 원문의 "ㅇㅇ" 은 아이 이름 자리 표시자다 (data.ts 참고).
 * 한글 이름 마지막 글자의 받침 유무로 조사를 고른다 — 지훈아/수아야, 지훈이/수아.
 * 마지막 글자가 한글이 아니면(영문 이름 등) 받침 없음으로 취급한다.
 */

function hasBatchim(name: string) {
  const code = name.charCodeAt(name.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

/** 호격 조사 — "지훈" → "아", "수아" → "야" */
export function vocative(name: string) {
  return hasBatchim(name) ? "아" : "야";
}

/** 대사 속 "ㅇㅇ" 자리에 이름을 넣는다. */
export function fillChildName(text: string, name: string) {
  return text
    .replaceAll(/ㅇㅇ[아야]/g, `${name}${vocative(name)}`)
    .replaceAll(/ㅇㅇ이/g, hasBatchim(name) ? `${name}이` : name)
    .replaceAll("ㅇㅇ", name);
}
