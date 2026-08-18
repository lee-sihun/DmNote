// 시계 방향 원호 + 직각 화살촉의 리로드 아이콘. 스트로크 1.5는 다른 컨트롤 글리프와 같은 굵기
const ReloadIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M12.25 7A5.25 5.25 0 1 1 7 1.75C8.47 1.75 9.876 2.333 10.932 3.348L12.25 4.667"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12.25 1.75V4.667H9.333"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default ReloadIcon;
