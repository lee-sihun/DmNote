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
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import PopupExit from '@components/main/Modal/PopupExit';
import ImagePicker from '@components/main/Modal/content/pickers/ImagePicker';

interface SingleImagePickerPopupProps {
  open: boolean;
  keyPosition: KeyPosition;
  imageButtonRef?: React.RefObject<HTMLButtonElement>;
  panelElement?: HTMLElement | null;
  canvasAnchor?: GradientCanvasAnchor;
  showActiveState: boolean;
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

  return (
    <PopupExit open={open}>
      {open && onToggle && imageButtonRef ? (
        <ImagePicker
          open={open}
          previewAnchor={canvasAnchor ?? null}
          referenceRef={imageButtonRef}
          panelElement={panelElement}
          completionBinding="element-id"
          idleImage={keyPosition.inactiveImage || ''}
          activeImage={keyPosition.activeImage || ''}
          idleTransparent={keyPosition.idleTransparent ?? false}
          activeTransparent={keyPosition.activeTransparent ?? false}
          idleImageFit={
            keyPosition.idleImageFit ?? keyPosition.imageFit ?? 'cover'
          }
          activeImageFit={
            keyPosition.activeImageFit ?? keyPosition.imageFit ?? 'cover'
          }
          onIdleImageChange={(imageUrl) => onInactiveImageCommit?.(imageUrl)}
          onActiveImageChange={(imageUrl) => onActiveImageCommit?.(imageUrl)}
          onIdleTransparentChange={(checked) =>
            onIdleTransparentCommit?.(checked)
          }
          onActiveTransparentChange={(checked) =>
            onActiveTransparentCommit?.(checked)
          }
          onIdleImageFitChange={(fit) =>
            onIdleImageFitCommit?.(fit as ImageFit)
          }
          onActiveImageFitChange={(fit) =>
            onActiveImageFitCommit?.(fit as ImageFit)
          }
          onIdleImageReset={() => onInactiveImageCommit?.('')}
          onActiveImageReset={() => onActiveImageCommit?.('')}
          {...(showActiveState
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
