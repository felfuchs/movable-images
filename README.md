# Movable Images

Move and resize images freely inside your Obsidian notes.

Drag an image anywhere on the page and resize it from its corner. The position and size are saved in the image link itself, so your notes stay plain Markdown and nothing is stored outside the file.

## How to use

- **Free-position an image:** hold <kbd>Alt</kbd> (<kbd>Option</kbd> on macOS) and drag an image. From then on you can drag it without holding Alt.
- **Resize:** drag the bottom-right corner of a free image.
- **Reset an image:** hold <kbd>Alt</kbd> and double-click it. It goes back to its normal place and keeps its width.
- **Remove an image:** hover a free image and click the trash button in its top-right corner. This removes the embed from the note; the image file stays in your vault. On touch screens the button is always visible.

This works in Live Preview and Reading view.

### Commands

| Command | What it does |
| --- | --- |
| Free-position image on current line | Turns the image embed on the cursor's line into a free image. |
| Reset image on current line | Puts that image back in the normal text flow. |
| Reset all free images in current note | Resets every free image in the note. |

## How it's stored

A free image is a normal embed with extra info after the `|`:

```markdown
![[photo.png|free x=120 y=-40 w=300]]
```

- `x`, `y`: offset from the image's normal position, in pixels
- `w`: width in pixels (optional)

If you uninstall the plugin, images simply show in their normal place again.

## Limitations

- Only wiki-style embeds (`![[...]]`) are supported, not Markdown image links (`![](...)`).
- Positions are in pixels, so a free image may sit differently on a narrower window or another device.

## Installation

From Obsidian: **Settings → Community plugins → Browse**, search for "Movable Images", then install and enable it.

Manually: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/felfuchs/movable-images/releases/latest) into `<your vault>/.obsidian/plugins/movable-images/`, then enable the plugin in **Settings → Community plugins**.

## License

[MIT](LICENSE)
