import React from "react";

export function LatencyDisplay({
  stats,
  recentLatencies,
  isMeasuring,
  onToggle,
  onReset,
}) {
  return (
    <div
      className="absolute top-0 left-0 p-2 bg-black bg-opacity-60 text-white text-xs rounded-md font-mono"
      style={{ appRegion: "no-drag" }} // 이 영역은 클릭 가능하도록 설정
    >
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={onToggle}
          className={`px-2 py-1 text-white rounded ${
            isMeasuring ? "bg-red-500" : "bg-green-500"
          }`}
        >
          {isMeasuring ? "측정 중단" : "측정 시작"}
        </button>
        <button
          onClick={onReset}
          className="px-2 py-1 text-white rounded bg-gray-500"
        >
          초기화
        </button>
      </div>
      <div className="border-b border-gray-500 my-1"></div>
      <div>상태: {isMeasuring ? "측정 중..." : "중단됨"}</div>
      <div className="mt-1">
        <div>측정 횟수: {stats.count}</div>
        <div>평균 (최근 100회): {stats.avg} ms</div>
        <div>최소: {stats.min > 0 ? `${stats.min} ms` : "-"}</div>
        <div>최대: {stats.max > 0 ? `${stats.max} ms` : "-"}</div>
      </div>
      <div className="mt-2">
        <div>최근 측정값:</div>
        <ul className="pl-2">
          {recentLatencies.map((latency, index) => (
            <li key={index}>- {latency} ms</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
