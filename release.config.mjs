// semantic-release for the desktop app only. The whole monorepo ships inside the app
// (packages/* are bundled into apps/desktop), so every conventional commit on main counts,
// but only apps/desktop/package.json gets a version and only the app is released.
//
// Release assets (keep these names stable, the self-updater will look for them):
//   GP-<version>-arm64.zip   the .app for updates (ditto -x -k)
//   GP-<version>-arm64.dmg   first install
//   gp-release.json          version, commit, sha256 + size of each file
export default {
  branches: ['main'],
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    [
      '@semantic-release/changelog',
      { changelogFile: 'apps/desktop/CHANGELOG.md', changelogTitle: '# GP changelog' },
    ],
    [
      '@semantic-release/exec',
      {
        // Version bump, then build, package and smoke-test the app. A package that fails the
        // smoke test fails the release before anything is tagged.
        prepareCmd:
          'node apps/desktop/scripts/set-version.mjs ${nextRelease.version} && pnpm --filter @gp/desktop package',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['apps/desktop/package.json', 'apps/desktop/CHANGELOG.md'],
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    [
      '@semantic-release/github',
      {
        assets: [
          { path: 'apps/desktop/release/GP-*-arm64.zip' },
          { path: 'apps/desktop/release/GP-*-arm64.dmg' },
          { path: 'apps/desktop/release/gp-release.json' },
        ],
        successComment: false,
        failComment: false,
        releasedLabels: false,
      },
    ],
  ],
}
