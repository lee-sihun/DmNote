/**
 * Smart Guides (스마트 가이드) 공개 API
 */

export {
  CANVAS_CENTER_X,
  CANVAS_CENTER_Y,
  calculateBounds,
  calculateGroupBounds,
  calculateGuideLineExtent,
} from './smartGuides/bounds';
export { calculateSnapPoints } from './smartGuides/alignment';
export { calculateSizeSnap } from './smartGuides/size';
export type {
  ElementBounds,
  GuideLine,
  SizeMatchGuide,
  SizeSnapAxes,
  SizeSnapResult,
  SnapPointsOptions,
  SnapResult,
  SpacingGuide,
} from './smartGuides/types';
