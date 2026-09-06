/* eslint-disable react-hooks/refs -- 피커 open 시점 reference DOM 존재 계약 */
import React from 'react';
import type { ImageFit, KeyPosition } from '@src/types/key/keys';
import type {
  EditorElementPropertyPatchV1,
  EditorStylePropertyPreviewPatchV1,
} from '@src/types/editor';
import type { GradientCanvasAnchor } from '@stores/grid/useGradientEditStore';
import {
  applyImageTransformLeaf,
  type ImageMode,
  type ImageTransformLeaf,
} from '@src/types/key/imageLayer';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import PopupExit from '@components/main/Modal/PopupExit';
import ImagePicker from '@components/main/Modal/content/pickers/ImagePicker';

interface SingleImagePickerPopupProps {
  open: boolean;
  keyPosition: KeyPosition;
  imageButtonRef?: React.RefObject<HTMLButtonElement>;
  panelElement?: HTMLElement | null;
  canvasAnchor?: GradientCanvasAnchor;
  showActiveState: boolean;
  showTransformControls?: boolean;
  bindActiveState?: boolean;
  fallbackEmptyImageFit?: boolean;
  requireMountedReference?: boolean;
  onToggle?: () => void;
  onInactiveImageCommit?: (imageUrl: string) => void;
  onActiveImageCommit?: (imageUrl: string) => void;
  onIdleTransparentCommit?: (checked: boolean) => void;
  onActiveTransparentCommit?: (checked: boolean) => void;
  onIdleImageFitCommit?: (fit: ImageFit) => void;
  onActiveImageFitCommit?: (fit: ImageFit) => void;
  onElementPropertyCommit?: (patch: EditorElementPropertyPatchV1) => void;
  onStylePropertyPreview?: (patch: EditorStylePropertyPreviewPatchV1) => void;
}

const SingleImagePickerPopup = ({
  open,
  keyPosition,
  imageButtonRef,
  panelElement,
  canvasAnchor,
  showActiveState,
  showTransformControls = showActiveState,
  bindActiveState = true,
  fallbackEmptyImageFit = false,
  requireMountedReference = false,
  onToggle,
  onInactiveImageCommit,
  onActiveImageCommit,
  onIdleTransparentCommit,
  onActiveTransparentCommit,
  onIdleImageFitCommit,
  onActiveImageFitCommit,
  onElementPropertyCommit,
  onStylePropertyPreview,
}: SingleImagePickerPopupProps) => {
  const handleImageModeChange = (mode: ImageMode) => {
    onElementPropertyCommit?.({ property: 'imageMode', value: mode });
  };
  const handleImageTransformChange = (
    state: 'idle' | 'active',
    leaf: ImageTransformLeaf,
    value: number,
  ) => {
    onElementPropertyCommit?.(
      state === 'idle'
        ? { property: 'idleImageTransform', value: { leaf, value } }
        : { property: 'activeImageTransform', value: { leaf, value } },
    );
  };
  // 프리뷰는 leaf가 아니라 전체 변환을 전달 — overlay 얕은 병합에서 나머지 축 보존
  const handleImageTransformPreview = (
    state: 'idle' | 'active',
    leaf: ImageTransformLeaf,
    value: number,
  ) => {
    const property =
      state === 'idle' ? 'idleImageTransform' : 'activeImageTransform';
    onStylePropertyPreview?.({
      property,
      value: applyImageTransformLeaf(keyPosition[property], { leaf, value }),
    });
  };
  const hasMountedReference =
    imageButtonRef &&
    (!requireMountedReference || Boolean(imageButtonRef.current));
  const idleImageFit = fallbackEmptyImageFit
    ? keyPosition.idleImageFit || keyPosition.imageFit || 'cover'
    : keyPosition.idleImageFit ?? keyPosition.imageFit ?? 'cover';
  const activeImageFit = fallbackEmptyImageFit
    ? keyPosition.activeImageFit || keyPosition.imageFit || 'cover'
    : keyPosition.activeImageFit ?? keyPosition.imageFit ?? 'cover';

  return (
    <PopupExit open={open}>
      {open && onToggle && hasMountedReference ? (
        <ImagePicker
          open={open}
          previewAnchor={canvasAnchor ?? null}
          referenceRef={imageButtonRef}
          panelElement={panelElement}
          completionBinding="element-id"
          idleImage={keyPosition.inactiveImage || ''}
          activeImage={keyPosition.activeImage || ''}
          idleTransparent={keyPosition.idleTransparent ?? false}
          activeTransparent={
            bindActiveState ? keyPosition.activeTransparent ?? false : false
          }
          idleImageFit={idleImageFit}
          activeImageFit={activeImageFit}
          onIdleImageChange={(imageUrl) => onInactiveImageCommit?.(imageUrl)}
          onIdleTransparentChange={(checked) =>
            onIdleTransparentCommit?.(checked)
          }
          onIdleImageFitChange={(fit) =>
            onIdleImageFitCommit?.(fit as ImageFit)
          }
          onIdleImageReset={() => onInactiveImageCommit?.('')}
          {...(bindActiveState
            ? {
                onActiveImageChange: (imageUrl: string) =>
                  onActiveImageCommit?.(imageUrl),
                onActiveTransparentChange: (checked: boolean) =>
                  onActiveTransparentCommit?.(checked),
                onActiveImageFitChange: (fit: string) =>
                  onActiveImageFitCommit?.(fit as ImageFit),
                onActiveImageReset: () => onActiveImageCommit?.(''),
              }
            : {})}
          {...(showTransformControls
            ? {
                imageMode: keyPosition.imageMode,
                idleImageTransform: keyPosition.idleImageTransform,
                activeImageTransform: keyPosition.activeImageTransform,
                onImageModeChange: handleImageModeChange,
                onImageTransformChange: handleImageTransformChange,
                onImageTransformPreview: handleImageTransformPreview,
                onImageTransformCancel: () => editGestureController.cancel(),
              }
            : {})}
          onClose={onToggle}
          showActiveState={showActiveState}
        />
      ) : null}
    </PopupExit>
  );
};

export default SingleImagePickerPopup;
