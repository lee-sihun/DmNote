import React, { Profiler, useState } from 'react';

import TabSwitch from '@components/main/common/TabSwitch';
import type { CommitStrategy } from '@hooks/useOptimisticBooleanCommit';

interface TabSwitchBenchmarkSurfaceProps {
  itemCount: number;
  commitStrategy: CommitStrategy;
  onRender?: (durationMs: number) => void;
}

const TABS = [
  { id: 'summary', label: '요약' },
  { id: 'details', label: '상세' },
];

export const TabSwitchBenchmarkSurface = ({
  itemCount,
  commitStrategy,
  onRender = () => undefined,
}: TabSwitchBenchmarkSurfaceProps) => {
  const [activeTab, setActiveTab] = useState('summary');

  return (
    <Profiler
      id="tab-switch-benchmark"
      onRender={(_, __, duration) => onRender(duration)}
    >
      <div data-canonical-tab={activeTab}>
        <TabSwitch
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          commitStrategy={commitStrategy}
        />
        <div aria-hidden="true">
          {Array.from({ length: itemCount }, (_, index) => (
            <div
              key={index}
              data-content-tab={activeTab}
              style={{
                transform: `translate3d(${index % 20}px, ${Math.floor(
                  index / 20,
                )}px, 0)`,
                opacity: activeTab === 'summary' ? 0.72 : 0.96,
                boxShadow:
                  activeTab === 'summary'
                    ? '0 2px 8px rgba(0, 0, 0, 0.18)'
                    : '0 4px 14px rgba(0, 0, 0, 0.28)',
              }}
            >
              {activeTab}-{index}
            </div>
          ))}
        </div>
      </div>
    </Profiler>
  );
};
