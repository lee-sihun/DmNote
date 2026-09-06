// 경로 마지막 세그먼트 (윈도우·유닉스 구분자 모두 처리)
export const pathBaseName = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;
