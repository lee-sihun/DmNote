import type { SpritePose } from '@src/types/key/sprites';

// 자세 이름 규칙 - 표시 번호 부여와 사본 이름 짓기. 라벨·접미사는 로케일에서
// 오므로 인자로 받고, 여기서는 문자열 규칙만 다룬다

/**
 * 무명(name=null) 자세에 줄 번호를 매긴다. 저장된 '라벨 N'이 점유한 번호는
 * 건너뛰므로 명시 이름과 섞여도 중복이 없다
 */
export const resolvePoseNames = (
  poses: readonly SpritePose[],
  label: string,
): string[] => {
  const prefix = `${label} `;
  const used = new Set<number>();
  for (const pose of poses) {
    if (!pose.name?.startsWith(prefix)) continue;
    const digits = pose.name.slice(prefix.length);
    if (!/^\d+$/.test(digits) || digits !== String(Number(digits))) continue;
    used.add(Number(digits));
  }
  let next = 1;
  return poses.map((pose) => {
    if (pose.name) return pose.name;
    while (used.has(next)) next += 1;
    used.add(next);
    return `${label} ${next}`;
  });
};

/**
 * 구조 변경(추가·복제·삭제) 직전에 무명 자세의 현재 표시 번호를 이름으로 고정한다.
 * 표시값 그대로 저장하므로 화면은 그대로이고 이후 삽입·삭제에도 번호가 유지된다
 */
export const materializePoseNames = (
  poses: readonly SpritePose[],
  label: string,
): SpritePose[] => {
  const names = resolvePoseNames(poses, label);
  return poses.map((pose, index) =>
    pose.name ? pose : { ...pose, name: names[index] },
  );
};

// "이름 복제"·"이름 복제 3"을 다시 복제해도 루트를 유지하고 숫자만 올린다.
// 카운터는 2부터만 생성되므로 "복제 0"·"복제 01" 같은 이름은 사용자 작명으로 보존
export const stripCopySuffix = (name: string, suffix: string): string => {
  const marker = ` ${suffix}`;
  const markerIndex = name.lastIndexOf(marker);
  if (markerIndex <= 0) return name;
  const tail = name.slice(markerIndex + marker.length);
  if (tail === '') return name.slice(0, markerIndex);
  const digits = tail.startsWith(' ') ? tail.slice(1) : '';
  const isGeneratedCounter =
    /^\d+$/.test(digits) &&
    digits === String(Number(digits)) &&
    Number(digits) >= 2;
  return isGeneratedCounter ? name.slice(0, markerIndex) : name;
};

/** 사본 이름: 원본 이름 + 복제 접미사, 겹치면 2부터 숫자를 올린다 */
export const copyPoseName = (
  poses: readonly SpritePose[],
  sourceIndex: number,
  label: string,
  suffix: string,
): string => {
  const base =
    poses[sourceIndex].name || resolvePoseNames(poses, label)[sourceIndex];
  const root = stripCopySuffix(base, suffix);
  const usedNames = new Set(
    poses.flatMap((pose) => (pose.name ? [pose.name] : [])),
  );
  let candidate = `${root} ${suffix}`;
  for (let counter = 2; usedNames.has(candidate); counter += 1) {
    candidate = `${root} ${suffix} ${counter}`;
  }
  return candidate;
};
