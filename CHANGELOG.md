# Changelog

All notable changes to this project are documented here. Versions follow [Semantic Versioning](https://semver.org/). Release notes for each tag are taken from the matching section below.

## 0.2.0

- Vault write tools: add `create_note`, `append_note`, `edit_note`, and `update_note` (enabled by default with confirmation preview)
- Optional vault organization tools in settings: `rename_note` (auto-updates wikilinks) and `delete_note` (moves to trash, always requires confirmation)
- Add confirmation preview modal with diff view for partial edits and session-level approval option
- Protect hidden and config folders from write, move, and delete operations
- Improve tool step cards with distinct icons, success/failure indicators, and clickable links to created/moved notes

## 0.1.1

- Remove all `!important` rules and the partially supported `text-decoration-style` from styles (community review CSS lint)
- README: disclose vault file listing and clipboard writing

## 0.1.0

First public release.

- Streaming chat with thinking mode and adjustable effort
- Web search and deep search with citations and source list
- Read links in messages (server-side)
- File input: PDF, Word, PowerPoint, images, Excel, ebooks and plain text
- Image understanding (deepseek-flash)
- Optional safety check with custom refusal message
- User context (date, weekday, location, language) on each turn
- Auto chat titles
- Read aloud (streaming or whole clip) and voice input
- Continue truncated replies
- Per-reply usage and estimated cost with an editable price table
- Optional read-only vault tools (current note, search, read, list folder)
- Include current note, ask about selection, insert into note, save as note, export chat
- Clickable `[[links]]` and note paths with hover preview
- JSON extraction command
- Chinese and English interface
