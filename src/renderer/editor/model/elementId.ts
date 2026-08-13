// 요소 안정 신원 발급. 생성·복제·붙여넣기는 항상 새 ID를 받는다 (수명 규칙).
// 형식과 전역 유일성 검증은 백엔드 커밋 경계가 한다
export const newElementId = (): string => crypto.randomUUID();

const SIMPLE_UUID = /^[0-9a-fA-F]{32}$/;
const HYPHENATED_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const isNativeElementId = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0) return false;
  let body = value;
  if (body.startsWith('urn:uuid:')) {
    body = body.slice('urn:uuid:'.length);
    if (!HYPHENATED_UUID.test(body)) return false;
  } else if (body.startsWith('{') && body.endsWith('}')) {
    body = body.slice(1, -1);
    if (!HYPHENATED_UUID.test(body)) return false;
  } else if (!SIMPLE_UUID.test(body) && !HYPHENATED_UUID.test(body)) {
    return false;
  }
  return body.split('-').join('').toLowerCase() !== '0'.repeat(32);
};
