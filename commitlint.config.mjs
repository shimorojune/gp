// Conventional commits drive the app's version (see release.config.mjs):
//   fix: ...      -> patch release
//   feat: ...     -> minor release
//   feat!: ... or a "BREAKING CHANGE:" footer -> major release
//   chore/docs/refactor/test/ci/build/perf/style: no release
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Sentence case subjects ("feat(voice): Cut credit use") are fine.
    'subject-case': [0],
    // Release notes and long URLs in bodies.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
}
