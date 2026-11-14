# Contributing

Thanks for helping improve DeepSeek Chat. Issues and pull requests in Chinese or English are both welcome.

## Setup

```bash
git clone https://github.com/KivenBig/obsidian-deepseek-chat.git
cd obsidian-deepseek-chat
npm install
npm run dev
```

Symlink or copy the folder into a **test vault** at `<vault>/.obsidian/plugins/deepseek-chat/`, then enable the plugin. Please do not develop against a vault with important notes.

## Before opening a pull request

```bash
npm run lint    # must report 0 errors
npm run check
npm test
npm run build
```

- Follow the [Obsidian plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines): no `innerHTML`, no inline styles, use the Vault API, clean up on unload.
- Use `requestUrl` for network requests. `fetch` is used only for streaming replies; keep it that way.
- Put user-facing text in `src/i18n.ts` with both Chinese and English, in sentence case.
- Keep pure logic in `src/core/` and add tests in `src/tests/`.
- Never commit API keys, `data.json` or chat files.

## Project layout

```
main.ts              plugin entry: commands, menus, settings, export
src/api/             DeepSeek requests (chat, files, TTS, ASR) and audio
src/core/            pure logic: types, SSE parsing, history, pricing, export
src/ui/              chat view, rendering, modals
src/settings.ts      settings and settings tab
src/tools.ts         read-only vault tools for tool calls
src/i18n.ts          interface text
```

## Releasing (maintainers)

1. Update `CHANGELOG.md` with a `## x.y.z` section.
2. `npm version x.y.z` (updates `manifest.json` and `versions.json`).
3. `git push && git push origin x.y.z` — the tag has no `v` prefix.
4. The Release workflow builds, attests and creates a **draft** release; review and publish it on GitHub.
