# Item icons

Shop/barter item icons live in `public/items/`, one file per item named after
its Traditional Chinese item name: `public/items/鹽.webp`. The set covers the
shop and barter item names (191 files).

- Format: WebP, 128×128, transparency kept. Match the existing files when
  adding or replacing one.
- Reference from the app as `/items/<percent-encoded name>.webp`. Always
  render with a fallback (text or a generic tile): names without a file
  resolve to nothing.
- Missing (no icon yet): 愛心幣, 喵幣. These are currencies without item art;
  they fall back to text until art turns up.
- These are third-party game artwork (© NEXON Korea) used under fan-content
  convention. If the rights holder objects, they will be removed — do not
  redistribute them outside this project.

Adding an icon: drop the `<TW name>.webp` file in `public/items/` and rebuild.
No manifest to update; the filename is the lookup.
