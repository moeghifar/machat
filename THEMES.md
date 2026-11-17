# THEMES.md: three candidate skins for machat

Goal: compare 3 complete skins in screenshots, then keep one. A skin is a token set (light + dark) plus a few layout toggles. It is chosen with `<html data-skin="ember|fjord|ink">`, which sits alongside the existing `data-theme`. Components are not forked: every per-skin difference is CSS under `[data-skin=…]`.

Applies to all skins: no gradients, no mascots, no WhatsApp green or trade dress, no chips on every row (only the unread pill), no text below 12px, and dark mode has no shadows.

## 1. Skins

- **A `ember`**: Slate & Ember (PLAN §7), refined. Ink-slate neutrals, a coral-ember accent and dark outgoing bubbles. This is the default.
- **B `fjord`**: cool and calm. Blue-grey neutrals, a muted steel-blue accent, a low-contrast surface hierarchy, soft tinted outgoing bubbles and a larger radius.
- **C `ink`**: high-contrast editorial. Warm paper and true black, with a signal-yellow accent used only as a fill behind black text. Square corners, hairline rules and heavier type.

## 2. Tokens

The token names are the existing ones in `frontend/public/style.css`, plus four new ones: `--surface-3` (a 4th neutral level), `--muted-pill`, `--sel` (selected-row tint) and `--rail` (the rail background). Dark values apply under `[data-theme=dark]` and inside the existing `prefers-color-scheme` block when the theme is `system`. Dark borders are `rgb(255 255 255 / .08)`, and dark `--sh-1` and `--sh-2` are `none`.

### A ember
| Token | Light | Dark |
|---|---|---|
| --bg | #F6F7F9 | #0E1015 |
| --surface | #FFFFFF | #151821 |
| --surface-2 | #EEF0F4 | #1C2030 |
| --surface-3 | #E4E7ED | #252A3B |
| --rail | #EEF0F4 | #0B0D11 |
| --border | #E2E5EB | rgb(255 255 255/.08) |
| --text / --text-2 | #141821 / #555C6C | #E8EAF0 / #9AA1B2 |
| --accent / --on-accent | #E8643C / #1A0E0A | #FF7A50 / #1A0E0A |
| --accent-text | #B23B17 | #FF9A78 |
| --accent-soft / --sel | #FDE9E1 / #FDE9E1 | #3A2018 / #2A1C18 |
| --muted-pill | #8A90A0 (text #fff) | #4A5065 (text #E8EAF0) |
| --bubble-out / on | #1F2433 / #F4F5F8 | #2B3350 / #EEF0F6 |
| --bubble-in / on | #FFFFFF / #141821 | #1C2030 / #E8EAF0 |
| --tick-read / --danger | #2F7BEA / #C8303F | #6AA8FF / #FF6170 |
| radius bubble / tail | 16px / 4px | same |

### B fjord
| Token | Light | Dark |
|---|---|---|
| --bg | #F3F5F8 | #0F141A |
| --surface | #FBFCFD | #151B23 |
| --surface-2 | #E9EEF3 | #1B232D |
| --surface-3 | #DDE4EC | #232D39 |
| --rail | #E3E9EF | #0C1015 |
| --border | #D8DFE7 | rgb(255 255 255/.08) |
| --text / --text-2 | #17202B / #4E5B6B | #E3E9F0 / #93A1B2 |
| --accent / --on-accent | #2F6FB3 / #FFFFFF | #6FA8E6 / #0B1520 |
| --accent-text | #245A93 | #8DBBEE |
| --accent-soft / --sel | #E1ECF7 / #E6EEF7 | #1A2A3D / #182433 |
| --muted-pill | #8796A8 (text #fff) | #3E4B5B (text #E3E9F0) |
| --bubble-out / on | #DCE8F5 / #12253A | #213A57 / #E6EEF7 |
| --bubble-in / on | #FFFFFF / #17202B | #1B232D / #E3E9F0 |
| --link-out | #1F5A99 | #9CC6F2 |
| --tick-read / --danger | #2F6FB3 / #B9343F | #8DBBEE / #F0707A |
| radius bubble / tail | 18px / 4px | same |

### C ink
| Token | Light | Dark |
|---|---|---|
| --bg | #F4F2EC | #000000 |
| --surface | #FBFAF6 | #0D0D0D |
| --surface-2 | #ECE9E1 | #171717 |
| --surface-3 | #E0DCD2 | #222222 |
| --rail | #0A0A0A (icons #FBFAF6) | #0D0D0D |
| --border | #0A0A0A at 12% | rgb(255 255 255/.08) |
| --text / --text-2 | #0A0A0A / #4A4740 | #F4F2EC / #A8A49A |
| --accent / --on-accent | #FFD400 / #0A0A0A | #FFD400 / #0A0A0A |
| --accent-text (never yellow on paper) | #0A0A0A, underline 2px #FFD400 | #FFD400 |
| --accent-soft / --sel | #FFF3B0 / #FFF3B0 | #2A2400 / #1F1B00 |
| --muted-pill | #8C887E (text #fff) | #3A3A3A (text #F4F2EC) |
| --bubble-out / on | #0A0A0A / #FBFAF6 | #F4F2EC / #0A0A0A |
| --bubble-in / on | #FBFAF6 + 1px border / #0A0A0A | #171717 / #F4F2EC |
| --link-out | #FFD400 | #0A0A0A, underlined |
| --tick-read / --danger | #FFD400 on out, #0A0A0A on in / #B3261E | #0A0A0A on out / #FF5A4F |
| radius bubble / tail | 4px / 0px | same |
| type | names 600 → 700; header 20px | same |

Layout toggles (skin-specific CSS only, no new markup):
| Toggle | ember | fjord | ink |
|---|---|---|---|
| chat row height | 68px | 72px | 64px |
| selected row | full-bleed `--sel` + 3px accent bar | full-bleed `--sel`, no bar | full-bleed `--sel` + 1px black rules |
| bubble-in border | 1px light / none dark | none | 1px (light) |
| rail style | `--rail`, accent active dot | `--rail`, soft pill on active | black slab, yellow active square |

## 3. Patterns (S = shared by all skins, K = skin-specific values)

1. **Icon rail, 64px** (S, K for colours): a vertical rail left of the sidebar holding the logo, the chats icon, the privacy toggle (moved, keeps `data-testid=privacy-toggle`), a new theme toggle (light/dark cycle), and settings at the bottom (keeps `settings-button`). Below 600px the rail becomes a row inside the sidebar header.
2. **Chat rows 64–72px** (S, K for height): full-bleed selected tint, an accent unread pill (`--muted-pill` when the chat is muted), and a "typing…" preview in `--accent-text` replacing the preview. No other chips on rows.
3. **Bubble clustering** (S, K for radius): consecutive messages from the same sender within 5 min form a cluster. Gaps are 4px inside a cluster and 16px between clusters. Radius is `--r-bubble`; only the last bubble of a cluster gets the `--r-tail` corner (bottom-right for out, bottom-left for in). The avatar shows only on the last incoming bubble of a cluster in groups, with a 32px placeholder on the others.
4. **Sticky date chips** (S): `.day` becomes `position: sticky; top: 8px`. In dark mode the chip uses `--surface-2` with no blur or shadow.
5. **Composer** (S): an empty textarea shows a mic icon (visual only, disabled, `title="Voice messages coming later"`). Non-empty text swaps to send with a crossfade. The paperclip opens a popover (Photo/Video, Document); both call the existing `PickAndSendFile`.
6. **Reactions and hover toolbar** (S): the reaction chips row sits under the bubble, overlapping by 6px. The existing ＋/↩ hover buttons become one floating toolbar (react, reply, copy) at the bubble's top corner.
7. **Media grid and file card** (S): 2+ consecutive images from one sender render as a 2×2 grid with a "+N" tile on the 4th. Documents use a card with icon, name, size and save button.
8. **Info panel** (S): avatar, name, about → media grid (3-column, +N) → files list → participants (groups) → a destructive section at the bottom (Mute, Archive, Log out of this device, in `--danger`). Only actions that already exist are wired; the rest are left out, not shown disabled.
9. **Dark discipline** (S): 4 neutral levels (bg, surface, surface-2, surface-3), one accent, 8% borders, `--sh-*: none`.
10. **12px floor** (S): `--fs-xs` stays at 12px. Grep the CSS for `font-size: 1[01]px` and `0.7rem` and remove any hits.

## 4. Changes by file

- `frontend/public/style.css`: `:root` = ember light. Add `[data-skin=fjord]` and `[data-skin=ink]` blocks, each with a `[data-theme=dark]` variant and a `prefers-color-scheme` variant, plus the 4 new tokens and `--r-bubble/--r-tail`. Add styles for rail, cluster, sticky day, composer swap/popover, toolbar, grid/+N, file card and drawer sections. Dark shadows become `none`.
- `frontend/src/store.js`: `DEFAULTS.skin = "ember"`. In the existing effect (~line 183), set `data-skin` from `skinOverride ?? settings.skin`. Read `skinOverride` once from `new URLSearchParams(location.search).get("skin")`, or `import.meta.env.VITE_SKIN`, accepting only the 3 names. The override is never saved.
- `frontend/src/Sidebar.jsx`: add the `Rail` component and move the privacy/settings buttons into it with the same testids. Add `muted` and `typing` classes to ChatRow and the muted pill.
- `frontend/src/Chat.jsx`: `Row` gets `first/last` cluster flags computed in `MessageList` from the previous/next message. Avatar shows on last-in only. Add the hover toolbar, the composer mic/send swap and attachment popover, and the media grid grouping.
- `frontend/src/Panels.jsx`: add a skin radio to `SettingsSheet` (`data-testid=skin-ember|fjord|ink`) and the drawer sections (media grid, files, destructive area).
- `frontend/src/icons.jsx`: add mic, sun/moon, file and image icons if missing.
- `frontend/src/Common.jsx`: no change unless the Avatar needs a `size` prop (32px in clusters).
- `store.go` / `wa.go` / `wa_test.go`: add `Skin string json:"skin"` with an empty value defaulting to `ember`. Validate it against the 3 names (pattern near `wa.go:978`) and add one bad-skin test (pattern near `wa_test.go:345`). Update the PLAN.md "Contract changes" section.
- `frontend/e2e/shots.spec.js`: loop over skins (§6).

## 5. Choosing a skin

- Settings → Appearance → Skin: Ember / Fjord / Ink radio, persisted through `updateSettings({ skin })` (localStorage mirror + `SetSettings`), the same path as theme.
- Override: `?skin=fjord` in the URL (or `VITE_SKIN=fjord` at dev time). It wins over settings for that session only and is used for screenshots. Invalid values are ignored.
- After the user picks a final skin, delete the other two blocks and the radio (a one-commit cleanup).

## 6. Screenshots

The run is `SHOTS_DIR=/tmp/claude-1000/-home-mgf-Code-github-moeghifar-machat/a3b7f1c3-5db6-4efe-b943-ca2d325175fb/scratchpad/themes npx playwright test shots`.
`shots.spec.js` loops `for (const s of ["ember","fjord","ink"])` and does `page.goto("/?skin=" + s)`, then runs the existing flow with `shot(page, \`${s}-${view}-${mode}\`)`. Per skin that gives 10 files, 30 in total:

| File | View |
|---|---|
| `<s>-qr-light.png`, `<s>-qr-dark.png` | QR screen |
| `<s>-list-light.png`, `<s>-list-dark.png` | chat list, 1280×800 |
| `<s>-chat-light.png`, `<s>-chat-dark.png` | Alice open (media, reactions, clusters) |
| `<s>-privacy-light.png` | privacy on, Alice open |
| `<s>-drawer-light.png` | Climbing Crew info drawer |
| `<s>-400list-light.png`, `<s>-400chat-light.png` | 400×760 |

The QR shot only needs a logout on the first skin; later skins `page.goto` back to the QR after logout as the current flow does. The final `theme(page, "system")` reset stays.

## 7. Acceptance

- **Contrast:** a check script (node --test, next to `text.test.js`) parses the skin blocks and asserts WCAG AA (≥4.5:1, or ≥3:1 for 15px+/600) for these pairs in every skin and mode: text/text-2 on bg, surface, surface-2 and sel; on-accent/accent; accent-text/surface; on-bubble/bubble for both directions; link-out/bubble-out; muted-pill text; danger/surface. Ink's yellow is checked only as a fill behind black text.
- **Privacy:** in all 3 skins, Ctrl+Shift+X blurs names, previews, messages, avatars and media. The new rail, toolbar, grid and drawer items carry the right `data-pb` attributes, and the typing preview is `data-pb=previews`.
- **Tests:** `go test ./...`, `npm test` and the Playwright E2E suite (`app`, `extra`) all pass. Testids are preserved.
- **12px floor:** no text below 12px, checked with a grep in the contrast test. No gradients (grep for `gradient(`) and no shadows in dark mode.
- All 30 PNGs exist and none are blank.

## 8. Tasks (one implementer, in order; run the tests after each)

- **T1. Tokens:** restructure `style.css` into ember `:root` plus fjord/ink blocks with light and dark variants, add the new tokens, then write the contrast and 12px test and adjust hex values until it passes.
- **T2. Selection:** add the Go `Skin` field, validation and test; in `store.js`, the default, the `data-skin` effect and the `?skin=` override; add the Settings radio. Run E2E.
- **T3. Sidebar:** rail, row heights, selected tint, muted pill and typing preview.
- **T4. Chat:** clustering, avatar on the last incoming bubble, sticky day chip, hover toolbar, reaction chips, media grid/+N, file card, composer swap and popover.
- **T5. Drawer:** media grid, files and destructive section; check that `data-pb` covers everything new.
- **T6. Shots:** the skin loop in `shots.spec.js`; capture the 30 PNGs and confirm the privacy shots are blurred.
