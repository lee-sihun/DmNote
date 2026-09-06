interface HitAnimationSample {
  effect: KeyframeEffect;
  target: Element;
  progress: number;
  currentIteration: number | null;
  composite: CompositeOperation;
  iterationComposite?: string;
  pseudoElement?: string | null;
  keyframes: string;
}

export type HitAnimationSamples = Map<Animation, HitAnimationSample>;

// 상자의 위치·크기를 바꾸지 않는 장식과 키프레임 메타데이터
const DECORATIVE_PROPERTIES = new Set([
  'offset',
  'computedOffset',
  'easing',
  'composite',
  'opacity',
  'color',
  'background',
  'backgroundColor',
  'backgroundImage',
  'backgroundPosition',
  'backgroundSize',
  'boxShadow',
  'textShadow',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'outlineColor',
  'outlineWidth',
  'outlineOffset',
  'fill',
  'stroke',
]);

// 알 수 없는 속성과 CSS 변수는 기하를 바꿀 수 있으므로 보수적으로 추적
export const sampleHitAnimations = (
  animations: Animation[],
  targets: ReadonlySet<Element>,
  previous: HitAnimationSamples,
): { samples: HitAnimationSamples; changed: boolean } => {
  const samples: HitAnimationSamples = new Map();
  let changed = false;
  for (const animation of animations) {
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (
      !(target instanceof Element) ||
      !targets.has(target) ||
      typeof effect.getKeyframes !== 'function'
    ) {
      continue;
    }
    const frames = effect.getKeyframes();
    if (
      !frames.some((frame) =>
        Object.keys(frame).some((key) => !DECORATIVE_PROPERTIES.has(key)),
      )
    ) {
      continue;
    }
    const { progress, currentIteration } = effect.getComputedTiming();
    if (progress === null) continue;
    const keyframes = JSON.stringify(frames);
    const composite = effect.composite;
    const iterationComposite = (
      effect as KeyframeEffect & { iterationComposite?: string }
    ).iterationComposite;
    const pseudoElement = effect.pseudoElement;
    samples.set(animation, {
      effect,
      target,
      progress,
      currentIteration,
      composite,
      iterationComposite,
      pseudoElement,
      keyframes,
    });
    const old = previous.get(animation);
    if (
      !old ||
      old.effect !== effect ||
      old.target !== target ||
      old.progress !== progress ||
      old.currentIteration !== currentIteration ||
      old.composite !== composite ||
      old.iterationComposite !== iterationComposite ||
      old.pseudoElement !== pseudoElement ||
      old.keyframes !== keyframes
    ) {
      changed = true;
    }
  }
  return { samples, changed: changed || samples.size !== previous.size };
};
