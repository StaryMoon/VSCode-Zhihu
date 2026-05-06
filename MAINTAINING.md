# Maintaining Zhihu On VSCode

This fork is based on [`niudai/VSCode-Zhihu`](https://github.com/niudai/VSCode-Zhihu)
and the auth/collection fixes from PR
[`#211`](https://github.com/niudai/VSCode-Zhihu/pull/211).

## Build A VSIX

A VSIX is a zip-format VSCode extension package. For this project, the important
inputs are:

- `package.json`: extension identity, commands, menus, scripts, and dependencies.
- `src/`: TypeScript source.
- `res/`: icons, templates, styles, and webview assets.
- `webpack.config.js`: bundles `src/extension.ts` into `dist/extension.js`.
- `.vscodeignore`: excludes source/build-only files from the final package.

Build commands:

```bash
npm install
npm run vscode:prepublish
npx vsce package
```

The generated file will look like:

```text
vscode-zhihu-starymoon-0.6.1.vsix
```

Install locally:

```bash
code --install-extension vscode-zhihu-starymoon-0.6.1.vsix
```

## Release Checklist

1. Update `package.json` and `package-lock.json` version.
2. Add a release note under `release_notes/`.
3. Run `npm run compile`.
4. Run `npm run vscode:prepublish`.
5. Run `npx vsce package`.
6. Install the generated VSIX in VSCode and test login, feed refresh, preview, and publish flow.

## Extension Identity

This maintained fork uses `starymoon.vscode-zhihu-starymoon` as its extension ID.
If the original `niudai.vscode-zhihu` is installed, disable or uninstall it before
using this fork because both extensions expose the same `zhihu.*` commands.
