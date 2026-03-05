/**
 * Components API 핸들러 관리
 * 플러그인별로 컴포넌트 이벤트 핸들러를 등록하고 관리합니다.
 */

let handlerIdCounter = 0;

// 플러그인별 핸들러 맵: pluginId -> handlerId -> handler function
const componentHandlers = new Map<string, Map<string, Function>>();

/**
 * 컴포넌트 핸들러를 등록하고 고유 ID를 반환합니다.
 *
 * @param pluginId - 플러그인 고유 ID
 * @param handler - 이벤트 핸들러 함수
 * @returns 핸들러 고유 ID (전역 window 객체에 할당됨)
 */
export function registerComponentHandler(
  pluginId: string,
  handler: Function,
): string {
  const handlerId = `__dmn_component_handler_${++handlerIdCounter}`;

  // 플러그인별 핸들러 맵 가져오기 또는 생성
  if (!componentHandlers.has(pluginId)) {
    componentHandlers.set(pluginId, new Map());
  }
  const pluginHandlers = componentHandlers.get(pluginId)!;
  pluginHandlers.set(handlerId, handler);

  // 전역에 핸들러 등록
  (window as any)[handlerId] = handler;

  return handlerId;
}

/**
 * 플러그인의 모든 컴포넌트 핸들러를 정리합니다.
 *
 * @param pluginId - 플러그인 고유 ID
 */
export function clearComponentHandlers(pluginId: string): void {
  const pluginHandlers = componentHandlers.get(pluginId);
  if (!pluginHandlers) return;

  // 전역 핸들러 제거
  for (const handlerId of pluginHandlers.keys()) {
    delete (window as any)[handlerId];
  }

  // 플러그인 핸들러 맵 제거
  componentHandlers.delete(pluginId);
}

/**
 * 플러그인 파일 내용에서 @id 메타데이터를 추출하거나 파일명으로 폴백합니다.
 *
 * @param content - 플러그인 파일 내용
 * @param filename - 플러그인 파일명
 * @returns 플러그인 고유 ID (네임스페이스로 사용)
 */
export function extractPluginId(content: string, filename: string): string {
  // 첫 20줄에서 @id 메타데이터 찾기
  const lines = content.split('\n').slice(0, 20);
  for (const line of lines) {
    const match = line.match(/\/\/\s*@id(?:\s*:\s*|\s+)([a-z0-9-_]+)/i);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  // 폴백: 파일명 정규화
  return filename
    .toLowerCase()
    .replace(/\.(js|mjs|ts)$/i, '')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '');
}
