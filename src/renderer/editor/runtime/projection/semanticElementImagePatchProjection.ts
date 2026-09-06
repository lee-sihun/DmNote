import type { EditorOpV1 } from '@src/types/editor';
import {
  applyImageTransformLeaf,
  type ImageTransform,
} from '@src/types/key/imageLayer';

type PatchElementOp = Extract<EditorOpV1, { kind: 'patchElement' }>;
type SemanticElementPosition = Record<string, unknown> & { id: string };

export type SemanticElementImagePatch = Extract<
  PatchElementOp['patch'],
  {
    property:
      | 'inactiveImage'
      | 'activeImage'
      | 'idleTransparent'
      | 'activeTransparent'
      | 'idleImageFit'
      | 'activeImageFit'
      | 'imageMode'
      | 'idleImageTransform'
      | 'activeImageTransform';
  }
>;

export const projectSemanticElementImagePatch = (
  position: SemanticElementPosition,
  op: PatchElementOp,
): SemanticElementPosition | undefined => {
  if (op.patch.property === 'inactiveImage') {
    return { ...position, inactiveImage: op.patch.value };
  }
  if (op.patch.property === 'activeImage') {
    return { ...position, activeImage: op.patch.value };
  }
  if (op.patch.property === 'idleTransparent') {
    return {
      ...position,
      idleTransparent: op.patch.value,
    };
  }
  if (op.patch.property === 'activeTransparent') {
    return {
      ...position,
      activeTransparent: op.patch.value,
    };
  }
  if (op.patch.property === 'idleImageFit') {
    return { ...position, idleImageFit: op.patch.value };
  }
  if (op.patch.property === 'activeImageFit') {
    return { ...position, activeImageFit: op.patch.value };
  }
  if (op.patch.property === 'imageMode') {
    // replace는 기본값이라 sparse 저장 - 백엔드와 동일
    const { imageMode: _imageMode, ...rest } = position;
    return op.patch.value === 'replace'
      ? rest
      : { ...position, imageMode: op.patch.value };
  }
  if (
    op.patch.property === 'idleImageTransform' ||
    op.patch.property === 'activeImageTransform'
  ) {
    const field = op.patch.property;
    if (op.patch.value === null) {
      const { [field]: _dropped, ...rest } = position;
      return rest;
    }
    return {
      ...position,
      [field]: applyImageTransformLeaf(
        position[field] as ImageTransform | undefined,
        op.patch.value,
      ),
    };
  }
  return undefined;
};
