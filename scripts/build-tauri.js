const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const forwardedArgs = process.argv.slice(2);
const noAsioIndex = forwardedArgs.indexOf('--no-asio');
const useAsio = noAsioIndex === -1;

if (!useAsio) {
  forwardedArgs.splice(noAsioIndex, 1);
}

const tauriArgs = ['build'];
if (useAsio) {
  tauriArgs.push('--features', 'asio-backend');
}
tauriArgs.push(...forwardedArgs);

const env = { ...process.env };

// Windows 배포 바이너리 크기 최적화
if (process.platform === 'win32') {
  env.CARGO_PROFILE_RELEASE_PANIC = 'abort';
}

const tauriCli = path.join(
  projectRoot,
  'node_modules',
  '@tauri-apps',
  'cli',
  'tauri.js',
);
const result = spawnSync(process.execPath, [tauriCli, ...tauriArgs], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
