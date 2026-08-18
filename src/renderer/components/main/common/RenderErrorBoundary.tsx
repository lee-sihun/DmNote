import { Component, type ErrorInfo, type ReactNode } from 'react';

interface RenderErrorBoundaryProps {
  // 잡힌 예외를 호출부가 처리한다. 안내·정리·재시도 준비는 여기서 결정
  onError: (error: unknown, info: ErrorInfo) => void;
  children: ReactNode;
}

interface RenderErrorBoundaryState {
  failed: boolean;
}

/**
 * 하위 렌더 예외를 이 경계에서 끊는다. 창 루트에 경계가 없어 어떤 렌더 예외든
 * 창 전체가 비므로, 실패해도 창이 살아야 하는 지연 로드 표면을 이걸로 감싼다.
 * 실패 뒤엔 아무것도 그리지 않는다. 다시 시도하려면 key를 바꿔 새로 마운트한다
 */
class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  state: RenderErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RenderErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError(error, info);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default RenderErrorBoundary;
