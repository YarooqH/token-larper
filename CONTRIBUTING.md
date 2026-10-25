# Contributing to Token Larper

Thanks for helping out. Bug reports, fixes, new agent support, and docs improvements are all welcome. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

* **Bugs and ideas:** search the [issues](https://github.com/YarooqH/token-larper/issues) first, then open one with the bug report or feature request form.
* **Bigger changes:** open an issue before you write code, so we can agree on the approach. Small fixes and doc tweaks can go straight to a pull request.
* **Security problems:** don't open an issue. Follow [SECURITY.md](SECURITY.md).

## Setting up

You need [Bun](https://bun.sh) 1.1 or later.

```bash
git clone https://github.com/YarooqH/token-larper.git
cd token-larper
bun install
bun run dev        # server with restart on file changes, dashboard at http://localhost:4269
```

If you fork the repository, clone your fork instead and branch from `main`. The [project layout](README.md#project-layout) in the README shows where things live.

A clone bundles the dashboard from `src/client/` when the server starts, so restart the server after changing dashboard code. `dist/` only holds the prebuilt bundle that gets published to npm.

## Checks to run

CI runs these on every pull request, so run them locally first:

```bash
bunx tsc --noEmit -p .   # typecheck
bun test                 # tests
bun run build            # builds the dashboard into dist/
```

Add or update a test when you change behavior. Tests sit next to the code as `*.test.ts` and `*.test.tsx`.

## Pull requests

1. Make one branch per change, from an up-to-date `main`. Branch names like `fix/short-description` or `feat/short-description` are the habit here.
2. Keep the change focused. Unrelated cleanups belong in their own pull request.
3. **Bump the version in `package.json`.** CI fails a pull request whose version isn't higher than `main`'s, and every merge to `main` is published to npm. Use semver: a patch bump for fixes and docs, a minor bump for new features, a major bump for breaking changes. Commit it as `chore(release): bump version to X.Y.Z`.
4. Fill in the pull request template, and include a screenshot or short clip for anything visible.

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`, in the imperative and under about 72 characters.

```
fix(limits): make Offline mode stop plan quota lookups
feat(stats): cap streak freezes at 5
docs(readme): bring the README up to date
chore(release): bump version to 1.25.8
```

Common types are `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `ci`, and `chore`. Scopes follow the area you touched, such as `ui`, `limits`, `tray`, `usage`, or `readme`.

## Things to know

* **Keep real usage out of public places.** Don't put your own token counts, costs, project names, or streaks in issues, pull requests, commits, or test fixtures. Use made-up numbers, and turn on **Screenshot mode** in **Settings → Privacy** before taking screenshots.
* **Privacy is a feature.** Token Larper has no telemetry and only makes the requests listed under [Privacy and network requests](README.md#privacy-and-network-requests). Anything new that touches the network needs to respect **Offline mode** and be added to that table.
* **Windows, macOS, and Linux all matter.** Test on the one you have, and say in the pull request what you couldn't check. Don't assume path separators or shells.
* **Don't run a second copy against your own data while testing the tray or startup code.** Set `TOKEN_LARPER_DATA_DIR` to a scratch folder and `PORT` to a free port. The Windows start-at-sign-in setting writes to the registry.
* **Line endings.** The repository stores LF. If your editor or Git rewrites files as CRLF on Windows, that's fine, but don't commit whole-file line-ending changes.
* **The live demo** at [yarooqh.github.io/token-larper](https://yarooqh.github.io/token-larper/) is the real dashboard with made-up data from `demo/fixtures.ts`. `bun demo/build.ts` builds it into `demo/dist/`, and it redeploys on every merge to main. If you add an API endpoint, answer it in `demo/mock-api.ts` too.
* **Adding a supported agent** usually means changes in `src/ccusage.ts` (usage), possibly `src/limits/` (plan quotas), and the agent list in the README and `llms.txt`.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
