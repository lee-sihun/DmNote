import React, { useRef } from 'react';
import { useOptimisticValueCommit } from '@hooks/useOptimisticValueCommit';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';

interface TabItem {
  id: string;
  label: string;
}

interface TabSwitchProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  commitStrategy?: CommitStrategy;
  className?: string;
}

// 세그먼트 컨트롤 — 활성 인디케이터가 transform으로 슬라이딩
const TabSwitch = ({
  tabs,
  activeTab,
  onTabChange,
  commitStrategy = 'sync',
  className,
}: TabSwitchProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { value: visualActiveTab, select } = useOptimisticValueCommit({
    canonicalValue: activeTab,
    onCommit: onTabChange,
    strategy: commitStrategy,
    frameHostRef: rootRef,
  });
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === visualActiveTab),
  );

  return (
    <div
      ref={rootRef}
      className={`relative flex w-full h-[30px] bg-inset rounded-surface items-center p-[2px] ${
        className ?? ''
      }`}
    >
      {/* 인디케이터 — 레이어를 미리 승격해 둔다.
          퍼센트 translate는 "박스 크기에 의존하는 transform"이라 엔진에 따라 합성에서
          탈락한다. 탈락하면 애니메이션이 메인 스레드에서 돌고, 탭 콘텐츠의 레이아웃·페인트가
          프레임을 먹는다. ease-out-expo는 180ms 중 59ms에 90%를 주파해서 한 프레임만 잃어도
          썸이 72% 지점에 나타난다 — 움직임이 통째로 사라진 것처럼 읽힌다.
          무거운 탭으로 갈 때만 그래서 방향 비대칭으로 체감된다 */}
      <div
        aria-hidden
        className="dmn-segment-thumb absolute top-[2px] bottom-[2px] left-[2px] rounded-[8px] bg-fill shadow-elevation-chrome will-change-transform"
        style={{
          width: `calc((100% - 4px) / ${tabs.length})`,
          transform: `translate3d(${activeIndex * 100}%, 0, 0)`,
        }}
      />
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={visualActiveTab === tab.id}
          data-tab-id={tab.id}
          onClick={() => select(tab.id)}
          className={`relative z-10 w-full h-full rounded-[8px] text-body transition-colors duration-base ${
            visualActiveTab === tab.id
              ? 'text-fg'
              : 'text-fg-muted hover:text-fg'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default TabSwitch;
