import type { KeySlot, MultiKeySlot, SlotMatch } from '@src/types/key/keys';
import { getKeyInfoByGlobalKey } from './core/KeyMaps';

// 계약 v4 §2: 슬롯당 멤버 상한
export const MAX_SLOT_KEYS = 8;
// 계약 v4 §2: 모드 내 한 멤버 라벨의 참조 슬롯 상한
export const MAX_SLOTS_PER_MEMBER = 16;

// canonical 조인 구분자 (생성·비교 전용, 파싱 금지)
const ALL_SEPARATOR = '+';
const ANY_SEPARATOR = '|';

export const isMultiSlot = (slot: KeySlot): slot is MultiKeySlot =>
  typeof slot !== 'string';

export const slotMembers = (slot: KeySlot): string[] => {
  if (isMultiSlot(slot)) return slot.keys;
  return slot === '' ? [] : [slot];
};

export const slotMatch = (slot: KeySlot): SlotMatch | 'single' =>
  isMultiSlot(slot) ? slot.match : 'single';

export const isSlotAssigned = (slot: KeySlot): boolean =>
  isMultiSlot(slot) || slot !== '';

// 계약 v4 §3: Rust KeySlot::canonical과 바이트 일치 필수
export const slotCanonical = (slot: KeySlot): string => {
  if (!isMultiSlot(slot)) return slot;
  return slot.keys.join(slot.match === 'all' ? ALL_SEPARATOR : ANY_SEPARATOR);
};

// 표시 라벨 합성: all → LCtrl+Z, any → Z/B
export const slotDisplayName = (slot: KeySlot): string => {
  if (!isMultiSlot(slot)) {
    return slot === '' ? '' : getKeyInfoByGlobalKey(slot).displayName;
  }
  const parts = slot.keys.map((key) => getKeyInfoByGlobalKey(key).displayName);
  return parts.join(slot.match === 'all' ? '+' : '/');
};

// 편집 UI의 입력 방식: 단일(키 1개) / 개별(any) / 동시(all)
export type KeySlotUiMode = 'single' | SlotMatch;

// 슬롯 → UI 입력 방식
export const slotUiMode = (slot: KeySlot): KeySlotUiMode =>
  isMultiSlot(slot) ? slot.match : 'single';

// 행 버튼용 축약 라벨: 멀티 슬롯은 첫 키 + "+N" 배지 (키가 많아도 길어지지 않음)
// extra는 개수 배지라 본문과 다른 색으로 렌더하도록 분리 반환
export const slotCompactParts = (
  slot: KeySlot,
): { label: string; extra: string | null } => {
  if (!isMultiSlot(slot)) return { label: slotDisplayName(slot), extra: null };
  return {
    label: getKeyInfoByGlobalKey(slot.keys[0]).displayName,
    extra: `+${slot.keys.length - 1}`,
  };
};

// 멤버로 쓸 수 없는 문자열 (구분자 포함, canonical 단사성 보장)
export const isValidSlotMember = (key: string): boolean =>
  key !== '' && !key.includes(ALL_SEPARATOR) && !key.includes(ANY_SEPARATOR);

// 계약 v4 §2: 무실패 정규화 (Rust normalize_key_slot과 동일 결과)
export const normalizeSlot = (raw: unknown): KeySlot => {
  if (typeof raw === 'string') return raw;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const candidate = raw as { keys?: unknown; match?: unknown };
    if (candidate.match !== 'all' && candidate.match !== 'any') return '';
    if (!Array.isArray(candidate.keys)) return '';
    const members: string[] = [];
    for (const entry of candidate.keys) {
      if (typeof entry !== 'string' || !isValidSlotMember(entry)) continue;
      if (members.includes(entry)) continue;
      members.push(entry);
      if (members.length >= MAX_SLOT_KEYS) break;
    }
    if (members.length >= 2) return { keys: members, match: candidate.match };
    if (members.length === 1) return members[0];
    return '';
  }
  return '';
};

// 멤버 목록 + 판정으로 슬롯 구성 (캡처 UI용)
// 멤버 1개 이하는 문자열 그대로 통과 (레거시 Single 무손실, 계약 §2 규칙 1)
export const buildSlot = (members: string[], match: SlotMatch): KeySlot => {
  if (members.length <= 1) return members[0] ?? '';
  return normalizeSlot({ keys: members, match });
};

// 슬롯 복제 (클립보드 등 공유 참조 방지)
export const cloneSlot = (slot: KeySlot): KeySlot =>
  isMultiSlot(slot) ? { keys: [...slot.keys], match: slot.match } : slot;

// 구분자 포함 Single(수제 데이터)은 매칭 불가한 inert 슬롯 (계약 §3 잔존 edge)
export const isInertSingle = (slot: KeySlot): boolean =>
  !isMultiSlot(slot) &&
  slot !== '' &&
  slot !== ALL_SEPARATOR &&
  (slot.includes(ALL_SEPARATOR) || slot.includes(ANY_SEPARATOR));

// canonical → 대표 슬롯 인덱스 (노트 이펙트용, Multi 우선 후 첫 등장)
export const buildCanonicalIndexMap = (
  slots: readonly KeySlot[],
): Map<string, number> => {
  const map = new Map<string, number>();
  slots.forEach((slot, index) => {
    if (!isSlotAssigned(slot)) return;
    const canonical = slotCanonical(slot);
    const existing = map.get(canonical);
    if (existing === undefined) {
      map.set(canonical, index);
      return;
    }
    // inert Single이 선점한 자리는 실제 Multi가 대체 (계약 §11)
    if (isInertSingle(slots[existing]) && isMultiSlot(slot)) {
      map.set(canonical, index);
    }
  });
  return map;
};
