/* eslint-disable no-console */
import { describe, test, expect } from 'vitest';

/**
 * ResizeHandles.tsx의 스냅 로직 버그 검증 테스트
 *
 * 버그: 한쪽 핸들로 리사이즈할 때, 독립적인 위치 스냅이
 * 앵커(고정되어야 할 반대쪽 엣지)를 1~2px 이동시킴
 */

const MIN_SIZE = 10;

// ResizeHandles.tsx 272-273줄과 동일한 스냅 함수
const snap = (value: number, snapSize: number): number =>
  Math.round(value / snapSize) * snapSize;

/**
 * 현재 ResizeHandles.tsx의 리사이즈 로직 (버그 있는 버전)
 * handleMouseMove 내부 로직을 추출 (줄 276-354)
 */
function currentResizeLogic(
  startBounds: { x: number; y: number; width: number; height: number },
  handleDx: -1 | 0 | 1,
  handleDy: -1 | 0 | 1,
  rawDeltaX: number,
  rawDeltaY: number,
  snapSize: number,
) {
  // 크기 계산 (줄 276-290)
  let nextWidth = startBounds.width;
  let nextHeight = startBounds.height;

  if (handleDx === -1) {
    nextWidth = Math.max(MIN_SIZE, startBounds.width - rawDeltaX);
  } else if (handleDx === 1) {
    nextWidth = Math.max(MIN_SIZE, startBounds.width + rawDeltaX);
  }

  if (handleDy === -1) {
    nextHeight = Math.max(MIN_SIZE, startBounds.height - rawDeltaY);
  } else if (handleDy === 1) {
    nextHeight = Math.max(MIN_SIZE, startBounds.height + rawDeltaY);
  }

  // 크기 스냅 (줄 331-333, keepAspect=false 가정)
  const newWidth = Math.max(MIN_SIZE, snap(nextWidth, snapSize));
  const newHeight = Math.max(MIN_SIZE, snap(nextHeight, snapSize));

  // 위치 계산 (줄 337-350)
  let newX = startBounds.x;
  let newY = startBounds.y;

  if (handleDx === -1) {
    newX = startBounds.x + (startBounds.width - newWidth);
  } else if (handleDx === 0) {
    newX = startBounds.x + (startBounds.width - newWidth) / 2;
  }

  if (handleDy === -1) {
    newY = startBounds.y + (startBounds.height - newHeight);
  } else if (handleDy === 0) {
    newY = startBounds.y + (startBounds.height - newHeight) / 2;
  }

  // 위치 스냅 (줄 352-354) — 버그 원인
  newX = snap(newX, snapSize);
  newY = snap(newY, snapSize);

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

/**
 * 수정된 리사이즈 로직 (앵커 엣지 보존)
 */
function fixedResizeLogic(
  startBounds: { x: number; y: number; width: number; height: number },
  handleDx: -1 | 0 | 1,
  handleDy: -1 | 0 | 1,
  rawDeltaX: number,
  rawDeltaY: number,
  snapSize: number,
) {
  let nextWidth = startBounds.width;
  let nextHeight = startBounds.height;

  if (handleDx === -1) {
    nextWidth = Math.max(MIN_SIZE, startBounds.width - rawDeltaX);
  } else if (handleDx === 1) {
    nextWidth = Math.max(MIN_SIZE, startBounds.width + rawDeltaX);
  }

  if (handleDy === -1) {
    nextHeight = Math.max(MIN_SIZE, startBounds.height - rawDeltaY);
  } else if (handleDy === 1) {
    nextHeight = Math.max(MIN_SIZE, startBounds.height + rawDeltaY);
  }

  // 크기 스냅
  let newWidth = Math.max(MIN_SIZE, snap(nextWidth, snapSize));
  let newHeight = Math.max(MIN_SIZE, snap(nextHeight, snapSize));

  // 수정: 핸들 방향에 따라 올바른 앵커 기반 위치 계산
  let newX = startBounds.x;
  let newY = startBounds.y;

  if (handleDx === -1) {
    // 좌측 핸들: 우측 엣지가 앵커
    const rightAnchor = startBounds.x + startBounds.width;
    newX = snap(rightAnchor - newWidth, snapSize);
    newWidth = rightAnchor - newX; // 우측 엣지 정확히 보존
  } else if (handleDx === 1) {
    // 우측 핸들: 좌측 엣지가 앵커 — 위치 스냅 불필요
    // newX = startBounds.x (이미 설정됨)
  }
  // dx === 0: X축 변경 없음

  if (handleDy === -1) {
    // 상단 핸들: 하단 엣지가 앵커
    const bottomAnchor = startBounds.y + startBounds.height;
    newY = snap(bottomAnchor - newHeight, snapSize);
    newHeight = bottomAnchor - newY; // 하단 엣지 정확히 보존
  } else if (handleDy === 1) {
    // 하단 핸들: 상단 엣지가 앵커 — 위치 스냅 불필요
    // newY = startBounds.y (이미 설정됨)
  }
  // dy === 0: Y축 변경 없음

  return { x: newX, y: newY, width: newWidth, height: newHeight };
}

describe('ResizeHandles 스냅 로직 - 앵커 엣지 보존 검증', () => {
  const snapSize = 5;

  describe('비그리드 위치의 요소 (스마트 가이드로 배치됨)', () => {
    // 스마트 가이드에 의해 그리드 배수가 아닌 위치에 배치된 요소
    const startBounds = { x: 103, y: 47, width: 50, height: 30 };

    test('현재 로직: 좌측 핸들 드래그 시 우측 엣지 이동 (버그)', () => {
      const rightEdgeBefore = startBounds.x + startBounds.width; // 153
      const result = currentResizeLogic(startBounds, -1, 0, -7, 0, snapSize);
      const rightEdgeAfter = result.x + result.width;

      console.log(`[현재 로직] 좌측 핸들 드래그:`);
      console.log(
        `  시작: x=${startBounds.x}, w=${startBounds.width}, 우측=${rightEdgeBefore}`,
      );
      console.log(
        `  결과: x=${result.x}, w=${result.width}, 우측=${rightEdgeAfter}`,
      );
      console.log(`  우측 엣지 이동량: ${rightEdgeAfter - rightEdgeBefore}px`);

      // 버그: 우측 엣지가 이동함
      expect(rightEdgeAfter).not.toBe(rightEdgeBefore);
    });

    test('수정 로직: 좌측 핸들 드래그 시 우측 엣지 보존', () => {
      const rightEdgeBefore = startBounds.x + startBounds.width; // 153
      const result = fixedResizeLogic(startBounds, -1, 0, -7, 0, snapSize);
      const rightEdgeAfter = result.x + result.width;

      console.log(`[수정 로직] 좌측 핸들 드래그:`);
      console.log(
        `  시작: x=${startBounds.x}, w=${startBounds.width}, 우측=${rightEdgeBefore}`,
      );
      console.log(
        `  결과: x=${result.x}, w=${result.width}, 우측=${rightEdgeAfter}`,
      );
      console.log(`  우측 엣지 이동량: ${rightEdgeAfter - rightEdgeBefore}px`);

      // 수정: 우측 엣지 정확히 보존
      expect(rightEdgeAfter).toBe(rightEdgeBefore);
    });

    test('현재 로직: 우측 핸들 드래그 시 좌측 엣지 이동 (버그)', () => {
      const leftEdgeBefore = startBounds.x; // 103
      const result = currentResizeLogic(startBounds, 1, 0, 7, 0, snapSize);

      console.log(`[현재 로직] 우측 핸들 드래그:`);
      console.log(`  시작: x=${startBounds.x}, w=${startBounds.width}`);
      console.log(`  결과: x=${result.x}, w=${result.width}`);
      console.log(`  좌측 엣지 이동량: ${result.x - leftEdgeBefore}px`);

      // 버그: 좌측 엣지(앵커)가 스냅으로 이동함
      expect(result.x).not.toBe(leftEdgeBefore);
    });

    test('수정 로직: 우측 핸들 드래그 시 좌측 엣지 보존', () => {
      const leftEdgeBefore = startBounds.x; // 103
      const result = fixedResizeLogic(startBounds, 1, 0, 7, 0, snapSize);

      console.log(`[수정 로직] 우측 핸들 드래그:`);
      console.log(`  시작: x=${startBounds.x}, w=${startBounds.width}`);
      console.log(`  결과: x=${result.x}, w=${result.width}`);
      console.log(`  좌측 엣지 이동량: ${result.x - leftEdgeBefore}px`);

      // 수정: 좌측 엣지 정확히 보존
      expect(result.x).toBe(leftEdgeBefore);
    });

    test('현재 로직: 상단 핸들 드래그 시 하단 엣지 이동 (버그)', () => {
      const bottomEdgeBefore = startBounds.y + startBounds.height; // 77
      const result = currentResizeLogic(startBounds, 0, -1, 0, -8, snapSize);
      const bottomEdgeAfter = result.y + result.height;

      console.log(`[현재 로직] 상단 핸들 드래그:`);
      console.log(
        `  시작: y=${startBounds.y}, h=${startBounds.height}, 하단=${bottomEdgeBefore}`,
      );
      console.log(
        `  결과: y=${result.y}, h=${result.height}, 하단=${bottomEdgeAfter}`,
      );
      console.log(
        `  하단 엣지 이동량: ${bottomEdgeAfter - bottomEdgeBefore}px`,
      );

      // 버그: 하단 엣지가 이동함
      expect(bottomEdgeAfter).not.toBe(bottomEdgeBefore);
    });

    test('수정 로직: 상단 핸들 드래그 시 하단 엣지 보존', () => {
      const bottomEdgeBefore = startBounds.y + startBounds.height; // 77
      const result = fixedResizeLogic(startBounds, 0, -1, 0, -8, snapSize);
      const bottomEdgeAfter = result.y + result.height;

      console.log(`[수정 로직] 상단 핸들 드래그:`);
      console.log(
        `  시작: y=${startBounds.y}, h=${startBounds.height}, 하단=${bottomEdgeBefore}`,
      );
      console.log(
        `  결과: y=${result.y}, h=${result.height}, 하단=${bottomEdgeAfter}`,
      );
      console.log(
        `  하단 엣지 이동량: ${bottomEdgeAfter - bottomEdgeBefore}px`,
      );

      // 수정: 하단 엣지 정확히 보존
      expect(bottomEdgeAfter).toBe(bottomEdgeBefore);
    });
  });

  describe('그리드 정렬된 요소 (문제 미발생 케이스)', () => {
    const startBounds = { x: 100, y: 50, width: 50, height: 30 };

    test('그리드 정렬 위치: 현재 로직도 정상 동작', () => {
      const rightEdgeBefore = startBounds.x + startBounds.width; // 150
      const result = currentResizeLogic(startBounds, -1, 0, -5, 0, snapSize);
      const rightEdgeAfter = result.x + result.width;

      console.log(`[그리드 정렬] 좌측 핸들 드래그:`);
      console.log(
        `  시작: x=${startBounds.x}, w=${startBounds.width}, 우측=${rightEdgeBefore}`,
      );
      console.log(
        `  결과: x=${result.x}, w=${result.width}, 우측=${rightEdgeAfter}`,
      );

      // 그리드 정렬된 경우 문제 없음
      expect(rightEdgeAfter).toBe(rightEdgeBefore);
    });
  });

  describe('다양한 비그리드 위치에서의 이동량 확인', () => {
    const testCases = [
      { x: 101, y: 51, width: 52, height: 33, desc: 'offset 1px' },
      { x: 102, y: 48, width: 53, height: 27, desc: 'offset 2px' },
      { x: 103, y: 47, width: 51, height: 31, desc: 'offset 3px' },
      { x: 104, y: 46, width: 54, height: 29, desc: 'offset 4px' },
    ];

    test.each(testCases)(
      '현재 로직 - $desc: 좌측 핸들 드래그 시 우측 엣지 drift',
      (startBounds) => {
        const rightAnchor = startBounds.x + startBounds.width;
        const result = currentResizeLogic(startBounds, -1, 0, -10, 0, snapSize);
        const drift = result.x + result.width - rightAnchor;
        console.log(
          `  [${startBounds.desc}] start=(${startBounds.x},${
            startBounds.width
          }) right=${rightAnchor} → result=(${result.x},${
            result.width
          }) right=${result.x + result.width} drift=${drift}px`,
        );
        // 대부분 drift가 발생
      },
    );

    test.each(testCases)(
      '수정 로직 - $desc: 좌측 핸들 드래그 시 우측 엣지 보존',
      (startBounds) => {
        const rightAnchor = startBounds.x + startBounds.width;
        const result = fixedResizeLogic(startBounds, -1, 0, -10, 0, snapSize);
        const drift = result.x + result.width - rightAnchor;
        console.log(
          `  [${startBounds.desc}] start=(${startBounds.x},${
            startBounds.width
          }) right=${rightAnchor} → result=(${result.x},${
            result.width
          }) right=${result.x + result.width} drift=${drift}px`,
        );
        expect(drift).toBe(0);
      },
    );
  });

  describe('dx=0 (상/하 핸들)에서 X축 불필요한 이동 검증', () => {
    const startBounds = { x: 103, y: 47, width: 50, height: 30 };

    test('현재 로직: 하단 핸들(dy=1)만 드래그해도 X좌표 이동 (버그)', () => {
      const result = currentResizeLogic(startBounds, 0, 1, 0, 10, snapSize);
      console.log(
        `[현재 로직] 하단 핸들: x=${startBounds.x} → ${result.x} (이동량: ${
          result.x - startBounds.x
        }px)`,
      );

      // 버그: 수직 리사이즈인데 X가 스냅되어 이동
      expect(result.x).not.toBe(startBounds.x);
    });

    test('수정 로직: 하단 핸들(dy=1)만 드래그 시 X좌표 보존', () => {
      const result = fixedResizeLogic(startBounds, 0, 1, 0, 10, snapSize);
      console.log(
        `[수정 로직] 하단 핸들: x=${startBounds.x} → ${result.x} (이동량: ${
          result.x - startBounds.x
        }px)`,
      );

      // 수정: X축 변경 없음
      expect(result.x).toBe(startBounds.x);
    });
  });
});
