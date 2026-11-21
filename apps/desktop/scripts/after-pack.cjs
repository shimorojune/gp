// electron-builder afterPack hook: ad-hoc sign GP.app. There's no Apple Developer account, and
// Apple Silicon refuses to run arm64 code without at least an ad-hoc signature (renaming the
// Electron helpers breaks the signatures they ship with). Runs before the zip and dmg are made.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin' || process.platform !== 'darwin') return
  const app = join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  console.log(`[after-pack] ad-hoc signed ${app}`)
}
