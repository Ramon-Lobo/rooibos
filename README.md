<p align="center">
  <img src="docs/images/logo.png" alt="Rooibos test framework" width="200" height="200"/>
</p>
<h3 align="center">
Simple, mocha and junit inspired, flexible, and fun Brightscript test framework for Roku apps
</h3>
<p align="center">
  <img src="docs/images/exampleImage.png" alt="Mocha test framework" />
</p>

[![build status](https://img.shields.io/github/actions/workflow/status/rokucommunity/rooibos/build.yml?branch=master&logo=github)](https://github.com/rokucommunity/rooibos/actions?query=branch%3Amaster+workflow%3Abuild)
[![security](https://img.shields.io/github/actions/workflow/status/rokucommunity/rooibos/security-audit.yml?branch=master&label=security&logo=data:image/svg%2Bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHJlY3QgeD0iMyIgeT0iOCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjciIHJ4PSIxIiBmaWxsPSJ3aGl0ZSIvPjxwYXRoIGQ9Ik01IDhWNWEzIDMgMCAwIDEgNiAwdjMiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg==)](https://github.com/rokucommunity/rooibos/actions/workflows/security-audit.yml)
[![coverage status](https://img.shields.io/coveralls/github/rokucommunity/rooibos?logo=coveralls)](https://coveralls.io/github/rokucommunity/rooibos?branch=master)
[![monthly downloads](https://img.shields.io/npm/dm/rooibos-roku.svg?sanitize=true&logo=npm&logoColor=&label=npm)](https://npmcharts.com/compare/rooibos-roku?minimal=true)
[![npm version](https://img.shields.io/npm/v/rooibos-roku.svg?logo=npm&label=npm)](https://www.npmjs.com/package/rooibos-roku)
[![license](https://img.shields.io/npm/l/rooibos-roku.svg)](LICENSE)
[![Slack](https://img.shields.io/badge/Slack-RokuCommunity-4A154B?logo=slack)](https://join.slack.com/t/rokudevelopers/shared_invite/zt-4vw7rg6v-NH46oY7hTktpRIBM_zGvwA)

## Links

- [Documentation](https://github.com/rokucommunity/rooibos/blob/master/docs/index.md)
- [API Documentation](https://rokucommunity.github.io/rooibos)
- [CHANGELOG](CHANGELOG.md)
- [VSCode snippets](docs/vsCodeSnippets.md)
- [Roku Developers slack](https://join.slack.com/t/rokudevelopers/shared_invite/zt-4vw7rg6v-NH46oY7hTktpRIBM_zGvwA)

## Development

Rooibos is an independent open-source project maintained exclusively by volunteers.

You might want to help! Get in touch via the [slack group](https://join.slack.com/t/rokudevelopers/shared_invite/zt-4vw7rg6v-NH46oY7hTktpRIBM_zGvwA) or [raise issues](https://github.com/rokucommunity/rooibos/issues/new).

To work on Rooibos locally:

```bash
npm install
npx ropm copy   # copies the framework's ropm dependencies into framework/src
npm test
```

`npx ropm copy` is required because `npm install` alone doesn't copy the ropm modules the framework depends on. `npm run build` also runs it for you, and the test/device scripts will tell you if you've forgotten it.

## Opt-in run guards (rooibos-cli)

These flags are off by default; without them the CLI behaves as stock. A normal run (no runtime error, a result line printed) with any of them set still exits 0.

- `--continue-on-runtime-error`: keep the run going after a device runtime error. The CLI still marks the run failed (exit 1), sends a `continue` to the debugger, and later suites keep running. **Limit:** this only works when the test sets rooibos `catchCrashes: true`. With `catchCrashes: false` the device cannot resume a faulted thread: the run ends with exit 1 and the message "the debugger cannot continue after the runtime error (it only continues with rooibos catchCrashes: true)". If the app stays at the debugger prompt for 5 s after the continue, the run also ends with exit 1 ("no progress ...").
- `--app-exit-grace <ms>`: app-exit events within `<ms>` of deploy (teardown of a previously running channel) are not acted on, but one is remembered. If no `[Rooibos Result]: PASS|FAIL` line has arrived when the window expires, the run fails with exit 1 ("the app exited without a [Rooibos Result] line"). If a result line was seen, the remembered exit is dropped and the run carries on. An app-exit after the window fails the same way when no result line was seen.
- `--idle-timeout <s>`: if the device prints nothing for `<s>` seconds after deploy, the run ends with exit 1 and the message "no device output for N s - run stalled; finishing with the results captured so far".

Code: `src/lib/rooibos/RunGuards.ts`, wired in `src/cli.ts`.

## Sample project

https://github.com/rokucommunity/rooibos-roku-sample

## Quick start

https://github.com/rokucommunity/rooibos/blob/master/docs/index.md#getting-started

## FAQ

### Is Rooibos ready for production use?

Yes, it's been used in production by quite a few respectable companies. There are 10,000's of tests in production.

### Is Rooibos actively maintained?

We at RokuCommunity love rooibos, and regularly keep it up to date.

## Accepted security advisories

Dependencies flagged by `npm audit` that we have reviewed and chosen not to upgrade are tracked in [audit-ci.jsonc](https://github.com/RokuCommunity/rooibos/blob/master/audit-ci.jsonc). Each entry includes the advisory ID, the date it was added, and the reason it does not apply to this project.
