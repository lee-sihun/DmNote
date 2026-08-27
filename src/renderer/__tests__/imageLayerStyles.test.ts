import { describe, expect, it } from 'vitest';

import { computeKeyElementStyles } from '@hooks/overlay/useKeyElementStyles';
import {
  applyImageTransformLeaf,
  isImageTransformLeafPatch,
} from '@src/types/key/imageLayer';
import { isEditorElementPropertyPatchV1 } from '@src/types/editor';

const IMAGE = 'data:image/png;base64,AA==';

const compute = (
  position: Parameters<typeof computeKeyElementStyles>[0]['position'],
  active = false,
) => computeKeyElementStyles({ position, active, label: 'A' });

describe('키 이미지 레이어 스타일', () => {
  it('replace 모드는 앱 기본 표면을 억제하고 링 안쪽(z 0)에 그린다', () => {
    const styles = compute({
      dx: 0,
      dy: 0,
      width: 60,
      height: 60,
      inactiveImage: IMAGE,
    });
    expect(styles.imageMode).toBe('replace');
    expect(styles.imageReplaces).toBe(true);
    expect(styles.keyStyle['--dmn-key-bg-default']).toBe('transparent');
    expect(styles.keyStyle['--dmn-key-border-default']).toBe('none');
    expect(styles.borderRingStyle).toBeNull();
    expect(styles.keyStyle.contain).toBe('layout style');
    expect(styles.keyStyle.overflow).toBeUndefined();
    expect(styles.imageStyle['--dmn-key-image-z-default']).toBe('0');
    expect(styles.imageStyle['--dmn-key-image-transform-default']).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
  });

  it('overlay 모드는 표면을 그대로 두고 이미지를 위(z 3)에 올린다', () => {
    const styles = compute({
      dx: 0,
      dy: 0,
      width: 60,
      height: 60,
      inactiveImage: IMAGE,
      imageMode: 'overlay',
    });
    expect(styles.imageReplaces).toBe(false);
    expect(styles.keyStyle['--dmn-key-bg-default']).not.toBe('transparent');
    // 기본 테두리는 그라데이션 립이라 링 자식으로 살아 있다
    expect(styles.borderRingStyle).not.toBeNull();
    expect(styles.imageStyle['--dmn-key-image-z-default']).toBe('3');
  });

  it('이미지가 없으면 모드와 무관하게 paint containment를 유지한다', () => {
    const styles = compute({
      dx: 0,
      dy: 0,
      width: 60,
      height: 60,
      imageMode: 'overlay',
    });
    expect(styles.hasCurrentImage).toBe(false);
    expect(styles.imageReplaces).toBe(false);
    expect(styles.keyStyle.contain).toBe('layout style paint');
  });

  it('active 이미지가 없으면 idle 이미지와 idle 변환을 함께 쓴다', () => {
    const position = {
      dx: 0,
      dy: 0,
      width: 60,
      height: 60,
      inactiveImage: IMAGE,
      idleImageTransform: { offsetX: 4, offsetY: -2, rotation: 15, scale: 1.5 },
      activeImageTransform: { offsetX: 0, offsetY: 0, rotation: 90, scale: 1 },
    };
    const active = compute(position, true);
    expect(active.imageStyle['--dmn-key-image-transform-default']).toBe(
      'translate(4px, -2px) rotate(15deg) scale(1.5)',
    );
    const withActive = compute({ ...position, activeImage: IMAGE }, true);
    expect(withActive.imageStyle['--dmn-key-image-transform-default']).toBe(
      'translate(0px, 0px) rotate(90deg) scale(1)',
    );
  });

  it('인라인 우선 모드는 실제 선언으로 승격한다', () => {
    const styles = compute({
      dx: 0,
      dy: 0,
      width: 60,
      height: 60,
      inactiveImage: IMAGE,
      useInlineStyles: true,
      imageMode: 'overlay',
      idleImageTransform: { offsetX: 0, offsetY: 0, rotation: 0, scale: 2 },
    });
    expect(styles.imageStyle.position).toBe('absolute');
    expect(styles.imageStyle.padding).toBe(0);
    expect(styles.imageStyle.transform).toBe(
      'translate(0px, 0px) rotate(0deg) scale(2)',
    );
    expect(styles.imageStyle.zIndex).toBe(3);
  });
});

describe('이미지 변환 leaf 패치', () => {
  it('범위 안 leaf만 통과한다', () => {
    expect(isImageTransformLeafPatch({ leaf: 'offsetX', value: -500 })).toBe(
      true,
    );
    expect(isImageTransformLeafPatch({ leaf: 'offsetX', value: 501 })).toBe(
      false,
    );
    expect(isImageTransformLeafPatch({ leaf: 'rotation', value: 180 })).toBe(
      true,
    );
    expect(isImageTransformLeafPatch({ leaf: 'scale', value: 0.05 })).toBe(
      false,
    );
    expect(isImageTransformLeafPatch({ leaf: 'scale', value: NaN })).toBe(
      false,
    );
    expect(
      isImageTransformLeafPatch({ leaf: 'scale', value: 1, extra: 1 }),
    ).toBe(false);
  });

  it('identity를 seed한 뒤 해당 leaf만 바꾼다', () => {
    expect(
      applyImageTransformLeaf(undefined, { leaf: 'rotation', value: 30 }),
    ).toEqual({ offsetX: 0, offsetY: 0, rotation: 30, scale: 1 });
  });

  it('editor property는 키에만 열리고 null은 reset으로 허용한다', () => {
    expect(
      isEditorElementPropertyPatchV1(
        { property: 'imageMode', value: 'overlay' },
        'key',
      ),
    ).toBe(true);
    expect(
      isEditorElementPropertyPatchV1(
        { property: 'imageMode', value: 'overlay' },
        'stat',
      ),
    ).toBe(false);
    expect(
      isEditorElementPropertyPatchV1(
        { property: 'idleImageTransform', value: null },
        'key',
      ),
    ).toBe(true);
    expect(
      isEditorElementPropertyPatchV1(
        {
          property: 'activeImageTransform',
          value: { leaf: 'scale', value: 2 },
        },
        'key',
      ),
    ).toBe(true);
    expect(
      isEditorElementPropertyPatchV1(
        {
          property: 'activeImageTransform',
          value: { leaf: 'scale', value: 2 },
        },
        'knob',
      ),
    ).toBe(false);
  });
});
