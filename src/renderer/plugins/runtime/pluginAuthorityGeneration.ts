// 백엔드 플러그인 authority generation 추적 - 메인이 리셋(plugin_authority_reset)한 값을
// 요소 커밋(plugin_instances_*)에 실어 보내 낡은 런타임의 쓰기를 백엔드가 거절하게 한다

let currentAuthorityGeneration = 0;

// generation은 reset마다 단조 증가 - 늦게 도착한 낡은 값 무시
export const setPluginAuthorityGeneration = (generation: number): void => {
  if (generation > currentAuthorityGeneration) {
    currentAuthorityGeneration = generation;
  }
};

export const getPluginAuthorityGeneration = (): number =>
  currentAuthorityGeneration;
