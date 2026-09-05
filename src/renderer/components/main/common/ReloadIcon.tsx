interface ReloadIconProps {
  // 회전 중 표시. svg 루트가 아니라 래퍼를 돌려야 회전축이 아이콘 중심에 고정된다
  spinning?: boolean;
}

// 시계 방향 원호 + 직각 화살촉의 리로드 아이콘. 13px 글리프는 23px 컨트롤에서
// 위아래 여백이 5px 정수로 떨어져 행 원점과 무관하게 픽셀 그리드에 앉는다
// (14px이면 4.5px 여백이라 반픽셀 위로 밀린다). 스트로크 1.5는 테두리 방향 글리프와 같다.
// 화살촉 끝이 원의 상단·우단과 같은 높이라 원을 기하 중앙에 두면 상자 중앙과 일치한다.
// 잉크 무게중심 기준 옵티컬 보정은 원이 내려가 보여 쓰지 않는다
const ReloadIcon = ({ spinning = false }: ReloadIconProps) => (
  <span
    className={
      'inline-flex' + (spinning ? ' dmn-reload-spin animate-spin' : '')
    }
  >
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M11.25 6.5A4.75 4.75 0 1 1 6.5 1.75C7.83 1.75 9.1 2.28 10.06 3.2L11.25 4.33"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.25 1.75V4.33H8.67"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

export default ReloadIcon;
