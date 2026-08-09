import React from 'react';

interface IconMotionProps {
  motion: string;
  children: React.ReactNode;
}

// 아이콘을 통째로 움직이는 모션은 svg가 아니라 이 래퍼가 받는다.
// svg 루트에 transform을 걸면 기준 박스를 뷰박스로 볼지 CSS 박스로 볼지가
// 엔진마다 갈려서 축이 미묘하게 어긋나고, 첫 프레임에 위치가 튄다.
// 평범한 HTML 박스에서는 transform-origin: center가 곧 아이콘 한가운데다.
// 모션 라이브러리가 대상을 감싸는 것도 같은 이유.
// 파트별로 움직이는 아이콘(탭 목록, 레이어, 팔레트, 페이더, 눈)은
// 래퍼가 아니라 svg 안에서 직접 처리한다
const IconMotion = ({ motion, children }: IconMotionProps) => {
  return (
    <span className="dmn-icon-motion" data-dmn-icon-motion={motion}>
      {children}
    </span>
  );
};

export default IconMotion;
