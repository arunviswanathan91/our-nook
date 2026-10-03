import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  throw new Error('iPhone compilation needs macOS and Xcode. Use the repository’s Verify iPhone build GitHub Action, or run this command on a Mac after npm run ios:sync.')
}
const cwd = fileURLToPath(new URL('..', import.meta.url))
const result = spawnSync('xcodebuild', [
  '-project', 'ios/App/App.xcodeproj', '-scheme', 'App',
  '-configuration', 'Release', '-destination', 'generic/platform=iOS',
  '-derivedDataPath', 'ios/DerivedData',
  'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=',
  'COMPILER_INDEX_STORE_ENABLE=NO', 'build',
], { cwd, stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
