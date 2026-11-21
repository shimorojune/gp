# GP repo notes

- Commit messages must be Conventional Commits (`feat(voice): ...`, `fix(engineer): ...`,
  `chore: ...`). The `commit-msg` hook (commitlint) rejects anything else, and semantic-release
  turns `feat`/`fix` on `main` into a new app version and GitHub Release. Use `chore`, `docs`,
  `test`, `refactor` or `ci` for changes that shouldn't ship a release.
- Plan and phase status: `docs/PLAN.md`. Runtime data lives in `~/Documents/GP/`, never in the repo.
- `pnpm package` (macOS only) builds GP.app; it's also what the release workflow runs.
