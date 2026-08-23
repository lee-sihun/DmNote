// @id storage-sample

/**
 * 저장 데이터가 있는 플러그인 표본
 *
 * 삭제 흐름을 눈으로 보려고 만든 것이다. 불러오는 즉시 스토리지에 값을 남겨
 * "데이터가 있는 플러그인"이 되고, 지울 때 데이터 삭제 모달이 뜬다.
 *
 * 남기는 값
 * - settings : 설정처럼 보이는 값 한 벌
 * - history  : 늘어나는 기록 (불러올 때마다 한 줄씩 쌓인다)
 */

const KEY_SETTINGS = 'settings';
const KEY_HISTORY = 'history';

async function seed() {
  const existing = await dmn.plugin.storage.get(KEY_SETTINGS);

  if (!existing) {
    await dmn.plugin.storage.set(KEY_SETTINGS, {
      theme: 'dark',
      accent: '#8b5cf6',
      showLabels: true,
    });
  }

  // 기록은 쌓여야 "지우면 아까운 데이터"라는 게 드러난다
  const history = (await dmn.plugin.storage.get(KEY_HISTORY)) ?? [];
  history.push({ at: new Date().toISOString(), event: 'loaded' });
  await dmn.plugin.storage.set(KEY_HISTORY, history.slice(-20));

  const keys = await dmn.plugin.storage.keys();
  console.log('[storage-sample] 저장된 키', keys, '기록', history.length, '줄');
}

seed().catch((error) => {
  console.error('[storage-sample] 초기 데이터를 쓰지 못했습니다', error);
});

// 지울 때 데이터가 함께 사라지는지 확인하려면 콘솔에서 아래를 실행한다
//   await dmn.plugin.storage.keys()
