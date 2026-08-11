/**
 * 플러그인 발신 keys·editor 쓰기 게이트웨이 (계약 §10)
 * provenance는 전역 상태가 아니라 플러그인 프록시가 이 모듈을 명시 호출하는
 * 것으로 결정된다. keys 쓰기는 coordinator의 공유 snapshot 병합에 합류하지
 * 않고 단일 직렬 큐의 격리 커밋으로 처리한다.
 */

import { editorCommitRaw } from '@api/modules/editorApi';
import { editorCoordinator } from '@src/renderer/editor/runtime/editorStateCoordinator';
import { EDITOR_SCHEMA_VERSION } from '@src/types/editor';
import type {
  EditorCommitResult,
  PluginEditorCommitRequest,
} from '@src/types/editor';
import { normalizeSlot } from '@utils/keySlot';
import type { KeyMappings, KeyPositions } from '@src/types/key/keys';

interface PluginWriteOptions {
  multiKey?: boolean;
}

// 계약 §2: 플러그인 입력도 무실패 정규화를 통과시켜 Rust normalize_key_slot과
// 동일한 결과를 assert·diff·transport·반환값에 사용 (모드·슬롯 인덱스 보존).
// 컨테이너 검증은 실제 wire(JSON) 표현 기준 - Date·URL·custom toJSON 객체가
// 객체 검사를 통과한 채 빈 매핑으로 축약되면 기존 키 매핑 전체가 삭제될 수
// 있으므로 Rust 역직렬화처럼 엄격 거절한다
const normalizeMappings = (raw: unknown): KeyMappings => {
  let wire: unknown;
  try {
    wire = raw === undefined ? undefined : JSON.parse(JSON.stringify(raw));
  } catch {
    throw new TypeError('keys mappings must be JSON-serializable');
  }
  if (
    wire === null ||
    wire === undefined ||
    typeof wire !== 'object' ||
    Array.isArray(wire)
  ) {
    throw new TypeError('keys mappings must be an object of mode arrays');
  }
  return Object.fromEntries(
    Object.entries(wire as Record<string, unknown>).map(([mode, slots]) => {
      if (!Array.isArray(slots)) {
        throw new TypeError(`keys mappings['${mode}'] must be an array`);
      }
      return [mode, slots.map((slot) => normalizeSlot(slot))];
    }),
  );
};

// async: 검증 실패도 동기 throw가 아닌 rejection으로 전달 (플러그인 호출 관례)
export const pluginKeysUpdate = async (
  mappings: KeyMappings,
  options?: PluginWriteOptions,
): Promise<KeyMappings> => {
  const document = await editorCoordinator.commitIsolatedPluginPatch(
    { schemaVersion: 1, keys: normalizeMappings(mappings) },
    { multiKey: options?.multiKey === true },
  );
  return document.keys;
};

export const pluginKeysUpdateWithPositions = async (
  mappings: KeyMappings,
  positions: KeyPositions,
  options?: PluginWriteOptions,
): Promise<{ keys: KeyMappings; positions: KeyPositions }> => {
  const document = await editorCoordinator.commitIsolatedPluginPatch(
    {
      schemaVersion: 1,
      keys: normalizeMappings(mappings),
      keyPositions: positions,
    },
    { multiKey: options?.multiKey === true },
  );
  return { keys: document.keys, positions: document.keyPositions };
};

// 플러그인의 직접 editor_commit. keys를 포함하면 coordinator 큐로 직렬화해
// 예약된 자사 변경보다 먼저 lock을 잡는 경합을 차단하고, envelope는 무가공
// 전달 (multiKey는 플러그인이 선언한 값만 백엔드 게이트에 도달)
export const pluginEditorCommit = async (
  request: PluginEditorCommitRequest,
): Promise<EditorCommitResult> => {
  // commit wire v2는 자사 내부 전용 - 플러그인 경계는 v1만 통과 (fail-closed)
  if (request?.changes?.schemaVersion !== EDITOR_SCHEMA_VERSION) {
    throw new TypeError('editor.commit changes.schemaVersion must be 1');
  }
  if (request.changes.keys !== undefined) {
    return editorCoordinator.runSerializedPluginCommit(() =>
      editorCommitRaw(request),
    );
  }
  return editorCommitRaw(request);
};
