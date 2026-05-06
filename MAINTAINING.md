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
vscode-zhihu-0.6.1.vsix
```

Install locally:

```bash
code --install-extension vscode-zhihu-0.6.1.vsix
```

## Release Checklist

1. Update `package.json` and `package-lock.json` version.
2. Add a release note under `release_notes/`.
3. Run `npm run compile`.
4. Run `npm run vscode:prepublish`.
5. Run `npx vsce package`.
6. Install the generated VSIX in VSCode and test login, feed refresh, preview, and publish flow.
7. Confirm the packaged VSIX contains `res/template/pre-publish.pug` and the
   `zhihu.publishCurrentMarkdown`, `zhihu.preview`, and `zhihu.newDraft`
   command contributions.

## Extension Identity

This maintained fork keeps `niudai.vscode-zhihu` as its extension ID so a VSIX
install upgrades the existing extension instead of installing a second extension
with conflicting `zhihu.*` commands. The code and release assets are distributed
from the `StaryMoon/VSCode-Zhihu` fork.
