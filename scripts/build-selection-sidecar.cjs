/**
 * 清除 CARGO_TARGET_DIR（部分 IDE/沙箱会指向临时目录），使产物落在 native/selection-sidecar/target/release。
 */
const { spawnSync } = require('child_process')
const path = require('path')

const root = path.resolve(__dirname, '..')
const manifest = path.join(root, 'native', 'selection-sidecar', 'Cargo.toml')
const env = { ...process.env }
delete env.CARGO_TARGET_DIR

const r = spawnSync('cargo', ['build', '--release', '--manifest-path', manifest], {
  env,
  stdio: 'inherit',
  cwd: root,
})
process.exit(r.status === null ? 1 : r.status)
