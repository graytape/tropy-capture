# Tropy Capture

You can use it here: [https://graytape.github.io/tropy-capture/](https://graytape.github.io/tropy-capture/)

Tropy Capture is an independent, local-first web application for archival research, designed to complement [Tropy](https://tropy.org/). It accepts pasted screenshots, individual images and PDFs, or entire folders of files; lets researchers describe materials immediately; and exports a portable package that can be imported into Tropy.

## The problem

On computers provided by archives (especially microfilm workstations), the usual workflow can be fragmented and repetitive. Researchers must first browse and select materials in the viewing software, save them as images or multipage PDFs, transfer the files to their own computer, place them in their final location, and then perform the most time-consuming step: entering metadata.
This separates the initial reading and selection of a source from the moment when its archival context and relevance are recorded through metadata.

## The solution

Tropy Capture lets researchers keep a browser window open alongside microfilm or other proprietary viewing software, add selected materials to a local session, and enter metadata on the spot.
At the end of the session, the application exports a single portable package containing the files, metadata, tags, notes, templates, and a restorable backup. This avoids doing the work twice and preserves the connection between selecting a document and recording why it matters.

## Recommended workflow

1. Open Tropy Capture on the archive computer and create a session.
2. In the **Session** tab, set recurring values such as archive, collection, box, folder, rights, tags, and Tropy list.
3. While browsing microfilm, paste screenshots with `Ctrl+V` / `⌘V`, drag files into the window, or import an existing folder. A keyboard-activated screenshot tool is recommended to speed up the workflow.
4. Choose **New item** when each image is a separate archival item, or **Add pages** when several images belong to the same item.
5. Press `Tab` after pasting to move directly to the Title field. Once you are editing a field, `Tab` follows the normal field order. Values previously used in each metadata field are suggested within the current session.
6. Use **Copy previous** for recurring metadata. It also copies the title and date while preserving the current item’s reference.
7. In the export window, keep a flat `images/` folder or build a reorderable path from metadata fields—for example, Collection / Box / Folder—and fixed custom folder names. Export the session as a ZIP file or directly to a folder.
8. On your personal computer, extract the ZIP and move the entire exported folder to its final location.
9. Import only `tropy.jsonld` into Tropy. Images, metadata, tags, and notes are imported together. Enable **Recreate lists** in Tropy’s import preferences if list paths should also be recreated.

Tropy normally links images at their existing location rather than creating another copy. Place the exported folder in its final location before importing it, and keep it there afterward.

## Custom Tropy templates

Import a `.ttp` file from the **Session** tab. Tropy Capture displays its fields and includes the template in the exported package.

Import the `.ttp` template into Tropy’s template editor on your personal computer before importing `tropy.jsonld`.

## Export package

```text
session-name/
├── tropy.jsonld             # import this file into Tropy
├── images/                  # source files with stable names
├── capture-session.json     # backup that Tropy Capture can restore
├── manifest.json            # machine-readable package index
├── README.txt               # import instructions
└── templates/               # custom Tropy templates, when present
```

Image filenames use the acquisition timestamp and a persistent sequence number. For example:

```text
img_YYYYMMDD-HHMMSS-0001.png
```

Imported files retain their original extension. The same exported filename is written into the Tropy Photo title field.

Paths in `tropy.jsonld` are relative, making the complete package portable between computers. Session restore identifies each image by its stable filename, so images can be moved between subfolders without breaking the restorable backup.

## Interface languages

English, Italian, Spanish, and French are available.

## Self-hosting

The `dist/` directory is ready to publish. Copy its contents to any static hosting service or web server. There is no build step and no application backend.
HTTPS is recommended in production. Standard keyboard paste works without special permission; HTTPS also enables direct clipboard access through the Paste button, PWA installation, and more reliable offline behavior.


## Compatibility and practical limits

* **Save to folder** uses the File System Access API and is primarily available in Chromium-based browsers. **Download ZIP** works in other modern browsers.
* TIFF, HEIC, JP2, and similar formats are preserved and exported even when the browser cannot preview them.
* IndexedDB quota depends on the browser and available disk space. Export periodically during very large sessions and use **Protect from automatic cleanup** to request persistent browser storage.
* Avoid private browsing for important sessions because the browser may delete stored data when it closes.
* The standard ZIP format used by Tropy Capture has a limit of approximately 4 GB. Above 1.5 GB, the application recommends direct folder export.
* Clearing site data in the browser deletes sessions that have not been exported.

## Security and privacy

* No application backend.
* No user accounts, analytics, or application-level tracking.
* No requests to third-party services.
* Files and metadata are stored locally in the browser.
* Exports are initiated only by the user.

## Project structure

* `dist/index.html`: application entry point;
* `dist/styles.css`: interface styles;
* `dist/app.js`: interface and image-intake workflow;
* `dist/date.js`: non-destructive archival date recognition and presentation;
* `dist/i18n.js`: translations and locale-specific date resources;
* `dist/session-helpers.js`: session metadata helpers;
* `dist/storage.js`: IndexedDB persistence;
* `dist/tropy.js`: Tropy JSON-LD conversion and validation;
* `dist/zip.js`: local ZIP creation without external services;
* `dist/sw.js`: offline interface cache;
* `tests/`: automated regression tests;
* `.github/workflows/pages.yml`: GitHub Pages verification and deployment.

## Disclaimer

The server delivers static files only. Images and metadata are stored in each user’s browser with IndexedDB and are never uploaded to the application server. The same hosted installation can therefore serve many researchers while keeping data local to each device and browser profile.

> Tropy Capture is independent and is not affiliated with the Tropy team. Its interface follows visual conventions familiar to Tropy users without including Tropy code or graphic assets.

## License

MIT. See [LICENSE](LICENSE).
