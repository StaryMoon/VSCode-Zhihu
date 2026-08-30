# Repository Guidelines

## Project Structure & Module Organization

`src/extension.ts` is the VS Code extension entry point; feature code is grouped
under `src/service/`, `src/model/`,
`src/treeview/`, `src/util/`, `src/global/`, and `src/const/`. Templates,
styles, scripts, and icons used by webviews live in `res/`; webpack helpers and
shims are in `build/`. TypeScript tests are in `test/suite/`, with reusable
inputs under `test/fixtures/`. `out/` is the compiler output and `dist/` is the
webpack bundle; both are generated and should not be edited or committed.

## Build, Test, and Development Commands

Run these from the repository root:

```bash
npm install                 # install dependencies
npm run develop             # webpack development build in watch mode
npm run compile             # compile src/ and test/ to out/
npm test                    # compile, then run the VS Code integration suite
npm run lint                # lint TypeScript under src/
npm run vscode:prepublish   # create the production dist/ bundle
npx vsce package            # package the extension as a .vsix
```

Use the VS Code `Launch Extension` configuration to open an Extension
Development Host. Tests may download a VS Code instance on first run.

## Coding Style & Naming Conventions

Follow the existing ESLint configuration: four-space indentation in new code,
double-quoted strings, semicolons, Unix line endings, and a 120-column limit.
Use explicit member visibility and keep imports ordered. Name modules by
responsibility (for example, `publish.service.ts` or
`feed-treeview-provider.ts`), classes in PascalCase, functions and locals in
camelCase, and tests with the `*.test.ts` suffix. Run `npm run lint` before
submitting.

## Testing Guidelines

Tests use Mocha's TDD interface through `vscode-test`. Add focused `*.test.ts`
cases in `test/suite/` and stable inputs in `test/fixtures/`. Run `npm test` for
the full suite and `npm run compile` for a type check. No coverage threshold is
configured, so cover changed behavior and regressions directly.

## Commit & Pull Request Guidelines

Use a short, imperative commit subject; recent patterns include `Add ...`,
`Refine ...`, and `feat(scope): ...`. Keep unrelated changes separate. Discuss
work in an issue first, then open a PR with a behavior summary, linked issue,
test results, and screenshots for UI/webview changes. Releases should also
update the version, `package-lock.json`, and `release_notes/`.

## Security & Configuration Tips

Never commit cookies, credentials, captcha images, caches, or generated VSIX
files. The extension stores login state locally; use test accounts and remove
any generated artifacts before committing.

## RULES

- Do not preserve backward compatibility. Remove obsolete paths instead of adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current requirements. Avoid speculative abstractions, configuration, and indirection.
- Grow the system in layers. Start from the smallest version that works end to end, and add each new capability on top of a product that already works. Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall complexity or improve reliability. Do not reimplement common functionality without a clear reason.
- Lean on the dependencies already in the project before writing your own implementation or adding packages. Do not assume a library lacks a capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that only works for now and is meant to be replaced later.
