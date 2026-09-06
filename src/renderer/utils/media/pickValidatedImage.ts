import { imageApi } from '@api/modules/resources/resourceApi';

import {
  canDecodeImage,
  probeImageSize,
  type ProbedImageSize,
} from './assetProbe';

type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

const showInvalidImageAlert = (t: Translate): void => {
  void window.api.ui.dialog
    .alert(t('imagePicker.invalidImage'), {
      confirmText: t('common.ok') || '확인',
    })
    .catch((error) => {
      console.error('Failed to open invalid image alert:', error);
    });
};

/**
 * 파일 선택 + 디코드 확인을 통과한 이미지 경로. 취소·실패는 null이다.
 * 호출부가 try/catch를 들지 않게 여기서 전부 삼킨다 - 컴포넌트 안의 try는
 * React Compiler가 그 컴포넌트를 통째로 최적화에서 제외하는 원인이 된다.
 * 재진입 가드와 로딩 표시는 호출부 몫
 */
export interface PickedImage extends ProbedImageSize {
  path: string;
}

/**
 * 파일 선택 + 디코드 확인을 통과한 이미지 경로와 원본 픽셀 크기. 디코드 확인이
 * 이미 이미지를 로드하므로 크기는 그 자리에서 나온다 - 스프라이트 축 배치가
 * 경로와 한 커밋으로 저장한다
 */
// 파일창 결과 - 취소는 null, 실패는 안내 뒤 null. 예외는 여기서 삼킨다
const loadPickedPath = async (t: Translate): Promise<string | null> => {
  try {
    const result = await imageApi.load();
    if (!result?.success || !result.imagePath) {
      // errorCode가 없는 실패는 사용자 취소
      if (result?.errorCode) showInvalidImageAlert(t);
      return null;
    }
    return result.imagePath;
  } catch (error) {
    console.error('Failed to load image', error);
    return null;
  }
};

export const pickValidatedImage = async (
  t: Translate,
): Promise<PickedImage | null> => {
  const path = await loadPickedPath(t);
  if (!path) return null;
  // 시그니처를 통과해도 WebView가 못 그리는 파일이 있다. 직전 값을 덮기 전에 확인한다
  const size = await probeImageSize(path).catch((error: unknown) => {
    console.error('Failed to probe image', error);
    return null;
  });
  if (!size) {
    showInvalidImageAlert(t);
    return null;
  }
  return { path, ...size };
};

/** 경로만 필요한 호출부(키 이미지 피커) - 디코드 확인만 거친다 */
export const pickValidatedImagePath = async (
  t: Translate,
): Promise<string | null> => {
  const path = await loadPickedPath(t);
  if (!path) return null;
  const decodable = await canDecodeImage(path).catch((error: unknown) => {
    console.error('Failed to probe image', error);
    return false;
  });
  if (!decodable) {
    showInvalidImageAlert(t);
    return null;
  }
  return path;
};

/** 이미 저장된 이미지의 원본 크기 - 못 읽으면 안내하고 null */
export const probeImageMetrics = async (
  path: string,
  t: Translate,
): Promise<ProbedImageSize | null> => {
  const size = await probeImageSize(path).catch((error: unknown) => {
    console.error('Failed to probe image', error);
    return null;
  });
  if (!size) showInvalidImageAlert(t);
  return size;
};

/**
 * 선택 완료 처리를 감싸 예외가 재진입 가드 해제를 건너뛰지 못하게 한다.
 * 호출부가 try를 들면 그 컴포넌트가 React Compiler 최적화에서 빠지므로 여기서 삼킨다
 */
export const runImageCompletion = (complete: () => void): void => {
  try {
    complete();
  } catch (error) {
    console.error('Failed to apply picked image', error);
  }
};
