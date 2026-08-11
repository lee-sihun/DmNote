// 요소 안정 신원 발급. 생성·복제·붙여넣기는 항상 새 ID를 받는다 (수명 규칙).
// 형식과 전역 유일성 검증은 백엔드 커밋 경계가 한다
export const newElementId = (): string => crypto.randomUUID();
