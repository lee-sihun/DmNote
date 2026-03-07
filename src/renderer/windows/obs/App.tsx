import { useObsWebSocket } from '@hooks/obs/useObsWebSocket';
import { useOverlayRuntime } from '@hooks/shared/useOverlayRuntime';
import OverlayScene from '@components/shared/OverlayScene';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const host = params.get('host') || window.location.hostname || '127.0.0.1';
  const port = params.get('port') || window.location.port || '34891';
  const token = params.get('token') || '';
  const wsUrl = `ws://${host}:${port}`;

  const { handlers, sceneProps, initialized } = useOverlayRuntime();

  useObsWebSocket({
    url: wsUrl,
    token,
    ...handlers,
  });

  if (!initialized) {
    return (
      <div
        className="flex items-center justify-center w-full h-screen"
        style={{ backgroundColor: 'transparent' }}
      >
        <div className="text-white/40 text-sm">Connecting...</div>
      </div>
    );
  }

  return <OverlayScene {...sceneProps} />;
}
