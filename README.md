# Tropy Capture

Tropy Capture is an independent, local-first web application for archival work. It captures screenshots or folders of images, lets researchers describe material immediately, and exports one portable package that can be imported into Tropy.

## Version 1.7.0

- Use Ctrl/⌘ or Shift with a click or the item navigation keys to select several documents. Page Up and Page Down move through the items. Editing a field updates only that field in the selection; a trailing + indicates differing values. The Delete action removes the whole selection after confirmation, with its button focused for Enter.
- Enter a ZIP filename in Export for Tropy. In Manage sessions, merge another local session into the current one with its + button, or use Merge sessions for a Tropy Capture ZIP. The adjacent folder button accepts an extracted export. Originals remain available as separate sessions.
- The Session tab puts template upload beside its select and shortens the date option to Recognize dates.

## Version 1.6.0

- Zoom the photo in the main preview with the mouse wheel, then click and drag the enlarged image to inspect areas outside the frame. The image stays within the viewing area. The separate photo viewer has been removed; PDFs still use the browser's viewer in the main panel.
- Compact field spacing now always shows every field and its input, without collapse controls. Existing collapsed choices remain available when switching back to Comfort.
- The spacing switch uses an icon for each layout instead of the Comfort and Compact text labels.

## Version 1.5.0

- Drag a photo thumbnail onto another thumbnail in the same item to reorder the photos. The saved order also controls their order in the Tropy export. Use the dedicated drag handle above the large preview to move a photo onto another document in the left column.
- In the metadata panel, use the **Field spacing** switch beside the Tropy template to choose **Comfort** or **Compact**. Compact keeps labels and inputs on the same row and tightens the spacing around collapsed fields. The choice is saved with the session.
- Wheel zoom is active by default in the main image preview. Place the pointer over the area to inspect and scroll to enlarge or shrink it, with a smooth transition. The neighboring expand button still opens the full image viewer.

## Version 1.4.0

- Use the expand button on a photo to open a large preview. Zoom controls enlarge it, and scrollbars let you inspect the entire image. PDFs open in the same large viewer with the browser's own controls.
- Exported ZIP and folder names preserve the capitalization of the session name (while replacing characters that cannot be used safely in filenames).
- Drag a photo onto a *different* document in the left column to move it there. A one-photo source item is merged, including its metadata; a multi-photo source item keeps its remaining photos. Dropping the photo back onto its own item or the image area does nothing.
- Selecting a document or photo keeps the selected entry visible at its current position in the left column and photo strip.
- Collapse individual metadata fields with the arrow beside their name. The choices are saved in the session and retained in its backup.

The server only delivers static files. Images and metadata are stored in each user’s browser with IndexedDB and are never uploaded to the server. A shared installation can therefore serve many researchers while keeping their sessions and materials separate on their own devices.

> Tropy Capture is independent and is not affiliated with the Tropy team. Its interface follows visual conventions familiar to Tropy users without including Tropy code or graphic assets.

## Recommended workflow

1. Open Tropy Capture on the archive computer and create a session.
2. In the **Session** tab, set recurring values such as archive, collection, box, folder, rights, tags, and Tropy list.
3. While browsing microfilm, paste screenshots with `Ctrl+V` / `⌘V`, drag images into the window, or import an existing folder.
4. Choose **New item** when each image is a separate archival item, or **Add pages** when several images belong to one item.
5. Press `Tab` after pasting to move directly to the Title field. Once you are editing any field, `Tab` follows the normal field order. Values already used in each metadata field are suggested within the current session.
6. Use **Copy previous** for recurring metadata. It also copies title and date while preserving the current reference.
7. In the export window, keep a flat `images/` folder or build a reorderable path from metadata (for example Collection / Box / Folder) and fixed folder names. Export the session as a ZIP file or directly to a folder.
8. On the personal computer, extract the ZIP and move the entire folder to its final location.
9. Import only `tropy.jsonld` into Tropy. Images, metadata, tags, and notes are imported together. Enable **Recreate lists** in Tropy’s import preferences if list paths should also be recreated.

Tropy links images at their location during import rather than creating another copy, so place the exported folder in its final location first and keep it there.

## Export package

```text
session-name/
├── tropy.jsonld             # import this file into Tropy
├── images/                  # original images with stable names
├── capture-session.json     # backup that Tropy Capture can restore
├── manifest.json            # machine-readable package index
├── README.txt               # import instructions
└── templates/               # optional custom Tropy templates
```

Image filenames use the acquisition timestamp and a persistent sequence number:

```text
img_YYYYMMDD-HHMMSS-0001.png
```

The same filename is written into the Tropy Photo title field. Paths in `tropy.jsonld` are relative, making the complete package portable between computers. Session restore identifies every image by its stable filename, so images can be moved between subfolders without breaking the restorable backup.

Dates retain the exact text entered by the researcher. When the optional date presentation setting is enabled, recognized dates use Tropy-style localized month names while the field is inactive—for example, `07 May 1943` in English and `07 mag 1943` in Italian—with a small `d · m · y` recognition legend. Focusing the field reveals the original stored value again.

Dragging an item onto another item in the left column merges it into the destination, following Tropy’s target-first behavior: photos are appended, missing metadata is added, tags are combined, and the source item is removed. To move a single photo, drag it from the handle above its large preview onto another item; when the source contains multiple photos, only that photo moves. Dragging a thumbnail reorders photos within its current item.

When the document column is collapsed, its thumbnails remain visible and can still be selected or dragged to merge items.

## Interface language

English is the default language for the interface, source code, and generated instructions. Italian, Spanish, and French can be selected from the language menu in the top-right corner. The selected preference is stored locally in the browser.

All translations, locale identifiers, month aliases, and localized month abbreviations are maintained in `dist/i18n.js`. The same language is used for the interface, date presentation, validation messages, and the README generated inside exported packages.

## Existing web server

The `dist/` directory is ready to publish. Copy its contents into the document root of Nginx, Apache, Caddy, or any static hosting service. There is no build step.

HTTPS is recommended in production. Standard keyboard paste works without special permission; HTTPS also enables direct clipboard access through the Paste button, PWA installation, and more reliable offline behavior.

## GitHub Pages

The repository is ready for public hosting on GitHub Pages. Its automated workflow verifies the JavaScript and test suite, then publishes the contents of `dist/` whenever the `main` branch is updated.

1. Create a GitHub repository and push this project to its `main` branch.
2. Open **Settings → Pages** in GitHub.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Open the **Actions** tab to follow the first deployment.

All application URLs are relative, so the service worker and static assets also work when the site is hosted below a repository path such as `https://username.github.io/tropy-capture/`. No credentials, database, or server-side configuration are required.

## Backup and restore

Every exported package is both a Tropy import package and a complete Tropy Capture backup. To reopen it:

1. extract the ZIP;
2. open **Session → Restore from exported folder**;
3. select the complete extracted folder.

Restore creates a new session and does not overwrite the open one.

Releases `v1.0.0`, `v1.1.0`, `v1.2.0`, and `v1.2.1` are retained as known-good restore points. From a Git clone, the immediately previous version can be restored with:

```bash
git switch --detach v1.2.1
```

Versioned release archives are also kept separately from later packages.

## Compatibility and practical limits

- Use a recent Chrome, Edge, Firefox, or Safari release.
- **Save to folder** uses the File System Access API and is primarily available in Chromium browsers. **Download ZIP** works in other modern browsers.
- TIFF, HEIC, JP2, and similar formats are preserved and exported even when the browser cannot preview them.
- IndexedDB quota depends on the browser and free disk space. Export periodically during very large sessions and use **Protect from automatic cleanup**.
- Avoid private browsing for important sessions because the browser may delete data when it closes.
- Standard ZIP files have a limit of approximately 4 GB. Above 1.5 GB, Tropy Capture recommends direct folder export.
- Clearing site data in the browser deletes sessions that have not been exported.

## Custom Tropy templates

Import a `.ttp` file from the **Session** tab. Tropy Capture displays its fields and includes the template in the exported package. Import the `.ttp` template into Tropy’s template editor before importing `tropy.jsonld` on the personal computer.

## Security and privacy

- no application backend;
- no accounts or tracking;
- no requests to external services;
- restrictive Content Security Policy in the Docker image;
- files and metadata stored locally in the browser;
- exports initiated only by the user.

On a shared archive computer, use a separate session for each project and export it before leaving the workstation.

## Development and verification

There are no runtime dependencies and no compilation step.

```bash
npm test
npm run check
```

For a local development server:

```bash
python3 -m http.server 8080 --directory dist
```

Then open `http://localhost:8080`.

## Project structure

- `dist/app.js`: interface and capture workflow;
- `dist/date.js`: non-destructive archival date recognition and presentation;
- `dist/i18n.js`: all translations and locale-specific date resources;
- `dist/session-helpers.js`: session metadata helpers;
- `dist/viewport.js`: image panning limits;
- `dist/storage.js`: IndexedDB persistence;
- `dist/tropy.js`: Tropy JSON-LD conversion and validation;
- `dist/zip.js`: local ZIP creation without external services;
- `dist/sw.js`: offline interface cache;

## License

MIT. See `LICENSE`.
