/* eslint-disable react-hooks/refs */
import React from 'react';
import PopupExit from '@components/main/Modal/PopupExit';
import ImagePicker from '@components/main/Modal/content/pickers/ImagePicker';
import type { CompletionBinding } from '@src/renderer/contexts/EditSessionScope';

interface BatchImagePickerPopupProps {
  open: boolean;
  referenceRef: React.RefObject<HTMLButtonElement | null>;
  panelElement: HTMLDivElement | null;
  publishBatchPreview: boolean;
  showActiveState: boolean;
  idleImage: string;
  activeImage: string;
  idleTransparent: boolean;
  activeTransparent: boolean;
  completionBinding: CompletionBinding;
  onIdleImageChange: (imageUrl: string) => void;
  onActiveImageChange?: (imageUrl: string) => void;
  onIdleTransparentChange: (value: boolean) => void;
  onActiveTransparentChange?: (value: boolean) => void;
  onIdleImageReset: () => void;
  onActiveImageReset?: () => void;
  onClose: () => void;
}

const BatchImagePickerPopup = ({
  open,
  referenceRef,
  panelElement,
  publishBatchPreview,
  showActiveState,
  idleImage,
  activeImage,
  idleTransparent,
  activeTransparent,
  completionBinding,
  onIdleImageChange,
  onActiveImageChange,
  onIdleTransparentChange,
  onActiveTransparentChange,
  onIdleImageReset,
  onActiveImageReset,
  onClose,
}: BatchImagePickerPopupProps) => {
  return (
    <PopupExit open={open}>
      {open && referenceRef.current ? (
        <ImagePicker
          open={open}
          previewAnchor={publishBatchPreview ? { kind: 'batch' } : undefined}
          referenceRef={referenceRef}
          panelElement={panelElement}
          idleImage={idleImage}
          activeImage={activeImage}
          idleTransparent={idleTransparent}
          activeTransparent={activeTransparent}
          completionBinding={completionBinding}
          onIdleImageChange={onIdleImageChange}
          onActiveImageChange={onActiveImageChange}
          onIdleTransparentChange={onIdleTransparentChange}
          onActiveTransparentChange={onActiveTransparentChange}
          onIdleImageReset={onIdleImageReset}
          onActiveImageReset={onActiveImageReset}
          onClose={onClose}
          showActiveState={showActiveState}
        />
      ) : null}
    </PopupExit>
  );
};

export default BatchImagePickerPopup;
