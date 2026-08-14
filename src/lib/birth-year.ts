/* 등록 가능한 아이 나이는 4~13세. 입력은 출생연도로 받으므로
   그 범위를 해마다 올해 기준으로 되돌려 쓴다. 폼과 서버 액션이 같은 값을 봐야 해서
   클라이언트 전용이 아닌 곳에 둔다. */
export const MIN_AGE = 4;
export const MAX_AGE = 13;

export function birthYearRange() {
  const thisYear = new Date().getFullYear();
  return { min: thisYear - MAX_AGE, max: thisYear - MIN_AGE };
}
