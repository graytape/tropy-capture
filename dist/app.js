import {
  deleteAsset,
  deleteSession as deleteStoredSession,
  getAsset,
  getSession,
  listSessions,
  requestPersistentStorage,
  saveAssets,
  saveSession,
  storageEstimate
} from "./storage.js";
import { createZip } from "./zip.js";
import { datePresentation } from "./date.js";
import {
  applyPreviousItemData,
  collectMetadataSuggestions,
  findRestoredAsset,
  mergeCaptureItems
} from "./session-helpers.js";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  localeTag,
  translate
} from "./i18n.js";
import {
  ARCHIVE_IMAGE_PATH,
  APP_VERSION,
  IMAGE_PATH_FIELDS,
  URIS,
  buildCaptureBackup,
  buildManifest,
  buildPackageReadme,
  buildTropyJson,
  exportFileMap,
  getTemplate,
  getTemplates,
  normalizeImagePathSegments,
  normalizeTemplate,
  packageName,
  safeFilename,
  safePathSegment,
  validateSession
} from "./tropy.js";

const root = document.querySelector("#app");
const ACCEPTED_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "svg", "heic", "avif", "jp2", "jpx", "pdf"
]);
const PREVIEWABLE_MIMES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/avif"
]);
const LAST_SESSION_KEY = "tropy-capture:last-session";
const THEME_KEY = "tropy-capture:theme";
const LANGUAGE_KEY = "tropy-capture:language";
const LIBRARY_COLLAPSED_KEY = "tropy-capture:library-collapsed";
const objectUrls = new Map();
const naturalFileOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

let session;
let sessionIndex = [];
let saveTimer;

const ui = {
  selectedItemId: null,
  selectedPageId: null,
  inspectorTab: "metadata",
  search: "",
  modal: null,
  confirm: null,
  busy: false,
  progress: null,
  dragging: false,
  draggedItemId: null,
  draggedPathIndex: null,
  mobilePane: "viewer",
  theme: localStorage.getItem(THEME_KEY) || "system",
  locale: SUPPORTED_LOCALES.some(({ code }) => code === localStorage.getItem(LANGUAGE_KEY))
    ? localStorage.getItem(LANGUAGE_KEY)
    : DEFAULT_LOCALE,
  libraryCollapsed: localStorage.getItem(LIBRARY_COLLAPSED_KEY) === "true",
  focusTitleOnNextTab: false,
  saveState: "saved",
  storage: null
};

function t(message, parameters) {
  return translate(ui.locale, message, parameters);
}

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
        const value = Math.random() * 16 | 0;
        return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
      });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const escapeAttr = escapeHtml;

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return new Intl.NumberFormat(localeTag(ui.locale), {
    maximumFractionDigits: index > 1 ? 1 : 0
  }).format(value) + " " + units[index];
}

function todayLabel() {
  return new Intl.DateTimeFormat(localeTag(ui.locale), {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date());
}

function localTimestampToken(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return [
    valid.getFullYear(),
    String(valid.getMonth() + 1).padStart(2, "0"),
    String(valid.getDate()).padStart(2, "0"),
    "-",
    String(valid.getHours()).padStart(2, "0"),
    String(valid.getMinutes()).padStart(2, "0"),
    String(valid.getSeconds()).padStart(2, "0")
  ].join("");
}

function baseName(filename = "") {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function fileExtension(file) {
  return file.name.split(".").pop()?.toLowerCase() || "";
}

function mimeForFile(file) {
  if (file.type) return file.type;
  const byExtension = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", tif: "image/tiff", tiff: "image/tiff", svg: "image/svg+xml",
    heic: "image/heic", avif: "image/avif", jp2: "image/jp2", jpx: "image/jpx",
    pdf: "application/pdf"
  };
  return byExtension[fileExtension(file)] || "application/octet-stream";
}

function isAcceptedFile(file) {
  return file.type.startsWith("image/")
    || file.type === "application/pdf"
    || ACCEPTED_EXTENSIONS.has(fileExtension(file));
}

function clone(value) {
  return "structuredClone" in window ? window.structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function createDefaultSession(name = t("Archive session · {date}", { date: todayLabel() })) {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    name,
    createdAt: now,
    updatedAt: now,
    templateKey: "generic",
    customTemplates: [],
    defaultMetadata: {},
    defaultTags: [],
    defaultListPath: "",
    counterWidth: 4,
    nextSequence: 1,
    nextImageSequence: 1,
    captureMode: "new",
    formatDatesOnBlur: true,
    imagePathSegments: [],
    items: []
  };
}

function prepareSession(raw) {
  const fallback = createDefaultSession(raw?.name);
  const prepared = {
    ...fallback,
    ...(raw || {}),
    defaultMetadata: { ...(raw?.defaultMetadata || {}) },
    defaultTags: Array.isArray(raw?.defaultTags) ? raw.defaultTags : [],
    customTemplates: Array.isArray(raw?.customTemplates) ? raw.customTemplates : [],
    formatDatesOnBlur: raw?.formatDatesOnBlur !== false,
    imagePathSegments: normalizeImagePathSegments(raw?.imagePathSegments),
    items: Array.isArray(raw?.items) ? raw.items : []
  };
  const fallbackTemplate = getTemplate(prepared);
  const existingImageSequence = prepared.items
    .flatMap((item) => Array.isArray(item.pages) ? item.pages : [])
    .reduce((maximum, page) => Math.max(maximum, Number(page.exportSequence) || 0), 0);
  let nextImageSequence = Math.max(Number(prepared.nextImageSequence) || 1, existingImageSequence + 1);
  prepared.items = prepared.items.map((item, index) => {
    const itemCreatedAt = item.createdAt || prepared.createdAt;
    return {
      id: item.id || uuid(),
      sequence: Number(item.sequence) || index + 1,
      templateId: item.templateId || fallbackTemplate.id,
      metadata: { ...(item.metadata || {}) },
      pages: (Array.isArray(item.pages) ? item.pages : []).map((page) => ({
        ...page,
        createdAt: page.createdAt || itemCreatedAt,
        filenameTimestamp: /^\d{8}-\d{6}$/.test(page.filenameTimestamp || "")
          ? page.filenameTimestamp
          : localTimestampToken(page.createdAt || itemCreatedAt),
        exportSequence: Number(page.exportSequence) || nextImageSequence++
      })),
      tags: Array.isArray(item.tags) ? item.tags : [],
      listPath: item.listPath || "",
      note: item.note || "",
      createdAt: itemCreatedAt
    };
  });
  const next = prepared.items.reduce((maximum, item) => Math.max(maximum, item.sequence + 1), 1);
  prepared.nextSequence = Math.max(Number(prepared.nextSequence) || 1, next);
  prepared.nextImageSequence = Math.max(nextImageSequence, existingImageSequence + 1);
  prepared.counterWidth = Math.min(8, Math.max(3, Number(prepared.counterWidth) || 4));
  return prepared;
}

function makeItem({ title = "", identifier = "", date = "" } = {}) {
  const template = getTemplate(session);
  const metadata = { ...(session.defaultMetadata || {}) };
  for (const entry of template.fields) {
    if (entry.value && !metadata[entry.property]) metadata[entry.property] = entry.value;
  }
  if (title) metadata[URIS.title] = title;
  if (identifier) metadata[URIS.identifier] = identifier;
  if (date) metadata[URIS.date] = date;

  const item = {
    id: uuid(),
    sequence: session.nextSequence,
    templateId: template.id,
    metadata,
    pages: [],
    tags: [...(session.defaultTags || [])],
    listPath: session.defaultListPath || "",
    note: "",
    createdAt: new Date().toISOString()
  };
  session.nextSequence += 1;
  return item;
}

function selectedItem() {
  return session.items.find((item) => item.id === ui.selectedItemId) || null;
}

function selectedPage() {
  const item = selectedItem();
  return item?.pages.find((page) => page.id === ui.selectedPageId) || item?.pages[0] || null;
}

function applyTheme() {
  if (ui.theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = ui.theme;
  }
  localStorage.setItem(THEME_KEY, ui.theme);
}

function clearObjectUrls() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

function scheduleSave() {
  ui.saveState = "saving";
  updateSaveIndicator();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      session.updatedAt = new Date().toISOString();
      await saveSession(session);
      ui.saveState = "saved";
      updateSaveIndicator();
    } catch (error) {
      console.error(error);
      ui.saveState = "error";
      updateSaveIndicator();
      toast(t("Local saving failed. Export the session and check the available storage space."), "error", 7000);
    }
  }, 300);
}

async function flushSave() {
  clearTimeout(saveTimer);
  try {
    session.updatedAt = new Date().toISOString();
    await saveSession(session);
    ui.saveState = "saved";
    updateSaveIndicator();
  } catch (error) {
    ui.saveState = "error";
    updateSaveIndicator();
    throw error;
  }
}

function updateSaveIndicator() {
  const element = document.querySelector("[data-save-state]");
  if (!element) return;
  element.textContent = ui.saveState === "saving"
    ? t("Saving…")
    : ui.saveState === "error"
      ? t("Save error")
      : t("Saved locally");
  element.dataset.state = ui.saveState;
}

async function readImageDimensions(file) {
  const mime = mimeForFile(file);
  if (!mime.startsWith("image/") || mime === "image/svg+xml") return {};
  try {
    if ("createImageBitmap" in window) {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    }
  } catch {
    // The file can still be preserved even if this browser cannot decode it.
  }
  return {};
}

async function fileToPage(file) {
  const id = uuid();
  const dimensions = await readImageDimensions(file);
  const capturedAt = new Date();
  return {
    id,
    originalName: file.name || `capture-${id}.png`,
    mime: mimeForFile(file),
    size: file.size,
    lastModified: file.lastModified || Date.now(),
    density: 72,
    checksum: `tropy-capture-${id}`,
    createdAt: capturedAt.toISOString(),
    filenameTimestamp: localTimestampToken(capturedAt),
    exportSequence: session.nextImageSequence++,
    ...dimensions
  };
}

async function addFiles(fileList, forcedMode, options = {}) {
  if (ui.busy) return;
  const files = Array.from(fileList || []);
  const accepted = files
    .filter(isAcceptedFile)
    .sort((a, b) => naturalFileOrder.compare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
  const rejected = files.length - accepted.length;
  if (!accepted.length) {
    toast(t("No compatible images were found."), "error");
    return;
  }

  const sessionSnapshot = clone(session);
  const selectionSnapshot = { itemId: ui.selectedItemId, pageId: ui.selectedPageId };
  ui.busy = true;
  render();
  const mode = forcedMode || session.captureMode || "new";
  const assetRecords = [];
  let lastItem = null;

  try {
    if (mode === "pages") {
      let item = selectedItem();
      if (!item) {
        item = makeItem();
        session.items.push(item);
      }
      for (const file of accepted) {
        const page = await fileToPage(file);
        item.pages.push(page);
        assetRecords.push({ id: page.id, sessionId: session.id, blob: file });
        if (!item.metadata[URIS.title]) item.metadata[URIS.title] = baseName(file.name);
        ui.selectedPageId = page.id;
      }
      lastItem = item;
    } else {
      for (const file of accepted) {
        const item = makeItem({ title: baseName(file.name) });
        const page = await fileToPage(file);
        item.pages.push(page);
        session.items.push(item);
        assetRecords.push({ id: page.id, sessionId: session.id, blob: file });
        lastItem = item;
        ui.selectedPageId = page.id;
      }
    }

    await saveAssets(assetRecords);
    ui.selectedItemId = lastItem.id;
    ui.mobilePane = "viewer";
    if (options.focusTitleOnTab) {
      ui.focusTitleOnNextTab = true;
      ui.inspectorTab = "metadata";
    }
    await flushSave();
    toast(
      accepted.length === 1
        ? t("Image added.")
        : t("{count} images added.", { count: accepted.length }),
      "success"
    );
    if (rejected) toast(t("{count} incompatible files were ignored.", { count: rejected }), "warning");
  } catch (error) {
    console.error(error);
    for (const record of assetRecords) {
      try { await deleteAsset(record.id); } catch { /* Best-effort rollback. */ }
    }
    session = sessionSnapshot;
    ui.selectedItemId = selectionSnapshot.itemId;
    ui.selectedPageId = selectionSnapshot.pageId;
    toast(t("One or more images could not be saved."), "error");
  } finally {
    ui.busy = false;
    render();
  }
}

async function tryClipboardRead() {
  if (!navigator.clipboard?.read) {
    toast(t("Press Ctrl+V or ⌘V to paste a screenshot."), "info");
    return;
  }
  try {
    const clipboardItems = await navigator.clipboard.read();
    const files = [];
    for (const clipboardItem of clipboardItems) {
      const type = clipboardItem.types.find((candidate) => candidate.startsWith("image/"));
      if (!type) continue;
      const blob = await clipboardItem.getType(type);
      const extension = type.split("/")[1].replace("jpeg", "jpg");
      files.push(new File([blob], `screenshot-${Date.now()}.${extension}`, { type }));
    }
    await addFiles(files, undefined, { focusTitleOnTab: true });
  } catch (error) {
    if (error?.name !== "NotAllowedError") console.error(error);
    toast(t("Clipboard access was not granted. Use Ctrl+V or ⌘V."), "warning");
  }
}

function icon(name) {
  const icons = {
    archive: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v14H4z"/><path d="M2.8 3h18.4v4H2.8zM9 10.5h6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5h7l2 2h9v10H3z"/></svg>',
    clipboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5H6v16h12V5h-3"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>',
    export: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 16v5h14v-5"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l.1.1-2.6 2.6-.1-.1a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8V21h-3.6v-.2A2 2 0 0 0 9 19a2 2 0 0 0-2.2.4l-.1.1-2.6-2.6.1-.1A2 2 0 0 0 4.6 15a2 2 0 0 0-1.8-1.2H2.6v-3.6h.2A2 2 0 0 0 4.6 9a2 2 0 0 0-.4-2.2l-.1-.1 2.6-2.6.1.1A2 2 0 0 0 9 4.6a2 2 0 0 0 1.2-1.8V2.6h3.6v.2A2 2 0 0 0 15 4.6a2 2 0 0 0 2.2-.4l.1-.1 2.6 2.6-.1.1a2 2 0 0 0-.4 2.2 2 2 0 0 0 1.8 1.2h.2v3.6h-.2A2 2 0 0 0 19.4 15Z"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.4 2c-.8.4-1.2.9-1.2 2M12 17h.01"/></svg>',
    theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-.5 0-1-.1-1.4A7 7 0 0 1 12 3Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>',
    left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 20h16"/></svg>',
    database: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r=".5"/><circle cx="3.5" cy="12" r=".5"/><circle cx="3.5" cy="18" r=".5"/></svg>',
    panel: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m-4 4 4-4 4 4M4 20h16"/></svg>',
    restore: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V3m0 0h5M4 3l4 4a8 8 0 1 1-2 8"/></svg>',
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="6" r="1"/><circle cx="16" cy="6" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="18" r="1"/><circle cx="16" cy="18" r="1"/></svg>'
  };
  return icons[name] || icons.image;
}

function itemTitle(item) {
  return item.metadata?.[URIS.title] || t("Item {number}", { number: String(item.sequence).padStart(3, "0") });
}

function itemSubtitle(item) {
  const date = datePresentation(
    item.metadata?.[URIS.date],
    session.formatDatesOnBlur,
    ui.locale
  ).display;
  const parts = [
    item.metadata?.[URIS.identifier],
    date,
    item.metadata?.[URIS.box] ? t("Box {value}", { value: item.metadata[URIS.box] }) : ""
  ].filter(Boolean);
  return parts.join(" · ") || (item.pages.length
    ? `${item.pages.length} ${t(item.pages.length === 1 ? "image" : "images")}`
    : t("No images"));
}

function renderLibrary() {
  const query = ui.search.trim().toLowerCase();
  const items = session.items.filter((item) => {
    if (!query) return true;
    return [
      ...Object.values(item.metadata || {}),
      ...(item.tags || []),
      item.listPath,
      item.note
    ].join(" ").toLowerCase().includes(query);
  });

  return `
    <aside class="library-panel app-pane ${ui.libraryCollapsed ? "collapsed" : ""} ${ui.mobilePane === "library" ? "mobile-active" : ""}" aria-label="${escapeAttr(t("Documents"))}">
      <div class="library-collapse-rail">
        <button class="icon-button" type="button" data-action="toggle-library" title="${escapeAttr(t("Expand document column"))}">
          ${icon("right")}<span class="sr-only">${t("Expand document column")}</span>
        </button>
        <div class="collapsed-item-list" role="list">
          ${items.map((item) => {
            const selected = item.id === ui.selectedItemId;
            const firstPage = item.pages[0];
            return `
              <button class="collapsed-item-row ${selected ? "selected" : ""}" type="button" draggable="true"
                data-action="select-item" data-item-id="${item.id}" role="listitem"
                title="${escapeAttr(itemTitle(item))}">
                ${firstPage
                  ? `<img data-asset-src="${firstPage.id}" alt="">`
                  : icon("image")}
                ${item.pages.length > 1 ? `<span class="page-count">${item.pages.length}</span>` : ""}
              </button>
            `;
          }).join("")}
        </div>
      </div>
      <div class="library-content">
        <div class="panel-heading">
          <div>
            <span class="eyebrow">${t("Capture queue")}</span>
            <strong>${session.items.length} ${t(session.items.length === 1 ? "document" : "documents")}</strong>
          </div>
          <div class="panel-heading-actions">
            <button class="icon-button collapse-library-button" type="button" data-action="toggle-library" title="${escapeAttr(t("Collapse document column"))}">
              ${icon("left")}<span class="sr-only">${t("Collapse document column")}</span>
            </button>
            <button class="icon-button" type="button" data-action="new-item" title="${escapeAttr(t("New item (Ctrl/⌘+N)"))}">
              ${icon("plus")}<span class="sr-only">${t("New item")}</span>
            </button>
          </div>
        </div>
        <label class="search-box">
          ${icon("search")}
          <span class="sr-only">${t("Search items")}</span>
          <input type="search" data-search value="${escapeAttr(ui.search)}" placeholder="${escapeAttr(t("Search metadata…"))}" autocomplete="off">
        </label>
        <div class="item-list" role="list">
          ${items.length ? items.map((item) => {
            const selected = item.id === ui.selectedItemId;
            const firstPage = item.pages[0];
            return `
              <button class="item-row ${selected ? "selected" : ""}" type="button" draggable="true"
                data-action="select-item" data-item-id="${item.id}" role="listitem"
                title="${escapeAttr(t("Drag onto another item to merge"))}">
                <span class="item-thumbnail">
                  ${firstPage
                    ? `<img data-asset-src="${firstPage.id}" alt="" loading="lazy">`
                    : icon("image")}
                  ${item.pages.length > 1 ? `<span class="page-count">${item.pages.length}</span>` : ""}
                </span>
                <span class="item-copy">
                  <strong>${escapeHtml(itemTitle(item))}</strong>
                  <small>${escapeHtml(itemSubtitle(item))}</small>
                </span>
                ${!item.pages.length ? `<span class="warning-dot" title="${escapeAttr(t("No images"))}"></span>` : ""}
              </button>
            `;
          }).join("") : `
            <div class="list-empty">
              ${icon("search")}
              <p>${query ? t("No items match your search.") : t("Captures will appear here.")}</p>
            </div>
          `}
        </div>
        <div class="library-footer">
          <button class="text-button" type="button" data-action="sessions">
            ${icon("database")} ${t("Manage sessions")}
          </button>
        </div>
      </div>
    </aside>
  `;
}

function renderCaptureToolbar() {
  const mode = session.captureMode || "new";
  return `
    <div class="capture-toolbar">
      <div class="capture-mode" aria-label="${escapeAttr(t("Capture mode"))}">
        <button type="button" data-action="capture-mode" data-mode="new"
          class="${mode === "new" ? "active" : ""}" aria-pressed="${mode === "new"}">
          ${t("New item per image")}
        </button>
        <button type="button" data-action="capture-mode" data-mode="pages"
          class="${mode === "pages" ? "active" : ""}" aria-pressed="${mode === "pages"}">
          ${t("Add pages")}
        </button>
      </div>
      <div class="capture-actions">
        <button class="toolbar-button" type="button" data-action="pick-files" title="${escapeAttr(t("Choose images"))}">
          ${icon("image")}<span>${t("Images")}</span>
        </button>
        <button class="toolbar-button" type="button" data-action="pick-folder" title="${escapeAttr(t("Import a folder"))}">
          ${icon("folder")}<span>${t("Folder")}</span>
        </button>
        <button class="toolbar-button" type="button" data-action="paste" title="${escapeAttr(t("Paste screenshot"))}">
          ${icon("clipboard")}<span>${t("Paste")}</span>
        </button>
      </div>
    </div>
  `;
}

function renderViewer() {
  const item = selectedItem();
  const page = selectedPage();
  const selectedIndex = item && page ? item.pages.findIndex((candidate) => candidate.id === page.id) : -1;

  let content;
  if (!item) {
    content = `
      <button type="button" class="empty-capture drop-surface" data-action="pick-files">
        <span class="capture-mark">${icon("image")}<span class="capture-plus">${icon("plus")}</span></span>
        <strong>${t("Paste a screenshot")}</strong>
        <span>${t("Ctrl+V / ⌘V, drag images here, or choose a folder")}</span>
        <small>${t("Files stay on this computer")}</small>
      </button>
      <div class="workflow-strip" aria-label="${escapeAttr(t("Workflow"))}">
        <span><b>1</b> ${t("Set archive and reference")}</span>
        <span><b>2</b> ${t("Capture and describe")}</span>
        <span><b>3</b> ${t("Download and import into Tropy")}</span>
      </div>
    `;
  } else {
    content = `
      <div class="viewer-document">
        <div class="viewer-title">
          <div>
            <span class="eyebrow">${t("Item")} ${String(item.sequence).padStart(session.counterWidth || 4, "0")}</span>
            <h1>${escapeHtml(itemTitle(item))}</h1>
          </div>
          <span class="local-badge">${icon("lock")} ${t("Local")}</span>
        </div>
        <div class="image-stage drop-surface ${page ? "" : "empty"}">
          ${page ? renderPagePreview(page) : `
            <button type="button" class="stage-empty" data-action="add-pages">
              ${icon("image")}
              <strong>${t("Empty item")}</strong>
              <span>${t("Add the first image")}</span>
            </button>
          `}
          ${page ? `
            <div class="stage-controls">
              <button class="icon-button glass" type="button" data-action="move-page-left"
                ${selectedIndex <= 0 ? "disabled" : ""} title="${escapeAttr(t("Move page left"))}">
                ${icon("left")}<span class="sr-only">${t("Move left")}</span>
              </button>
              <span>${t("Page {current} of {total}", { current: selectedIndex + 1, total: item.pages.length })}</span>
              <button class="icon-button glass" type="button" data-action="move-page-right"
                ${selectedIndex >= item.pages.length - 1 ? "disabled" : ""} title="${escapeAttr(t("Move page right"))}">
                ${icon("right")}<span class="sr-only">${t("Move right")}</span>
              </button>
              <button class="icon-button glass danger" type="button" data-action="delete-page" title="${escapeAttr(t("Remove page"))}">
                ${icon("trash")}<span class="sr-only">${t("Remove page")}</span>
              </button>
            </div>
          ` : ""}
        </div>
        ${item.pages.length ? `
          <div class="page-strip" aria-label="${escapeAttr(t("Item pages"))}">
            ${item.pages.map((candidate, index) => `
              <button type="button" class="page-tile ${candidate.id === page?.id ? "selected" : ""}"
                data-action="select-page" data-page-id="${candidate.id}" title="${escapeAttr(t("Page {number}", { number: index + 1 }))}">
                <img data-asset-src="${candidate.id}" alt="">
                <span>${index + 1}</span>
              </button>
            `).join("")}
            <button type="button" class="page-tile add-page" data-action="add-pages" title="${escapeAttr(t("Add pages"))}">
              ${icon("plus")}<span class="sr-only">${t("Add pages")}</span>
            </button>
          </div>
        ` : ""}
        ${page ? `
          <div class="file-caption">
            <span>${escapeHtml(page.originalName)}</span>
            <span>${page.width && page.height ? `${page.width} × ${page.height} · ` : ""}${formatBytes(page.size)}</span>
          </div>
        ` : ""}
      </div>
    `;
  }

  return `
    <section class="viewer-panel app-pane ${ui.mobilePane === "viewer" ? "mobile-active" : ""}"
      aria-label="${escapeAttr(t("Capture"))}" data-drop-zone>
      ${renderCaptureToolbar()}
      <div class="viewer-content">${content}</div>
      <div class="drop-overlay" aria-hidden="true">
        ${icon("image")}<strong>${t("Drop to capture")}</strong>
        <span>${t(session.captureMode === "pages" ? "Images will be added to the selected item" : "Each image will become an item")}</span>
      </div>
    </section>
  `;
}

function renderPagePreview(page) {
  if (page.mime === "application/pdf") {
    return `<iframe class="main-preview pdf-preview" data-asset-src="${page.id}" title="${escapeAttr(page.originalName)}"></iframe>`;
  }
  if (PREVIEWABLE_MIMES.has(page.mime)) {
    return `<img class="main-preview" data-asset-src="${page.id}" alt="${escapeAttr(page.originalName)}">`;
  }
  return `
    <div class="unsupported-preview">
      ${icon("image")}
      <strong>${escapeHtml(page.originalName)}</strong>
      <span>${t("Preview is not available in this browser. The file will be exported unchanged.")}</span>
    </div>
  `;
}

function renderTemplateOptions(selectedKeyOrId) {
  return getTemplates(session).map((template) => {
    const selected = template.key === selectedKeyOrId || template.id === selectedKeyOrId;
    return `<option value="${escapeAttr(template.key)}" ${selected ? "selected" : ""}>${escapeHtml(template.name)}</option>`;
  }).join("");
}

function metadataSuggestions(property) {
  return collectMetadataSuggestions(session.items, property, localeTag(ui.locale));
}

function suggestionListId(property) {
  return `suggest-${String(property).replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

function renderMetadataFields(template, values, scope = "item") {
  return template.fields.map((field) => {
    const value = values?.[field.property] ?? field.value ?? "";
    const isDate = field.property === URIS.date || field.datatype === "https://tropy.org/v1/tropy#date";
    const presented = datePresentation(value, isDate && session.formatDatesOnBlur, ui.locale);
    const readonly = field.isConstant ? "readonly" : "";
    const dataAttribute = scope === "defaults" ? "data-default-meta" : "data-meta";
    const suggestions = scope === "item" && !field.isConstant ? metadataSuggestions(field.property) : [];
    const listId = suggestionListId(field.property);
    const translatedLabel = template.builtin ? t(field.label) : field.label;
    const translatedHint = template.builtin ? t(field.hint || "—") : (field.hint || "—");
    const input = `<input type="text" ${dataAttribute}="${escapeAttr(field.property)}"
          value="${escapeAttr(presented.display)}" ${readonly} ${suggestions.length ? `list="${listId}"` : ""}
          ${isDate ? `data-date-field data-date-raw="${escapeAttr(presented.raw)}"` : ""}
          placeholder="${escapeAttr(translatedHint)}" autocomplete="off">`;
    return `
      <label class="field-row">
        <span>${escapeHtml(translatedLabel)}${field.isRequired ? `<em title="${escapeAttr(t("Required field"))}">*</em>` : ""}</span>
        ${isDate ? `
          <span class="date-input-wrap">
            ${input}
            <small class="date-recognition ${presented.parts.length ? "" : "hidden"}"
              aria-label="${escapeAttr(t("Recognized date parts: {parts}", { parts: presented.parts.join(", ") }))}">${escapeHtml(presented.parts.join(" · "))}</small>
          </span>
        ` : input}
        ${suggestions.length ? `<datalist id="${listId}">${suggestions.map((entry) => `<option value="${escapeAttr(entry)}"></option>`).join("")}</datalist>` : ""}
      </label>
    `;
  }).join("");
}

function renderMetadataPanel(item) {
  if (!item) {
    return `
      <div class="inspector-empty">
        ${icon("panel")}
        <strong>${t("No item selected")}</strong>
        <p>${t("Add an image or create an empty item to enter metadata.")}</p>
        <button class="primary-button" type="button" data-action="new-item">${icon("plus")} ${t("New item")}</button>
      </div>
    `;
  }

  const template = getTemplates(session).find((candidate) => candidate.id === item.templateId) || getTemplate(session);
  return `
    <div class="inspector-scroll">
      <div class="inspector-section compact-section">
        <label class="field-row">
          <span>${t("Tropy template")}</span>
          <select data-item-template>${renderTemplateOptions(item.templateId)}</select>
        </label>
      </div>
      <div class="inspector-section metadata-fields">
        <div class="section-heading">
          <span class="eyebrow">${t("Description")}</span>
          <button class="small-button" type="button" data-action="copy-previous" ${session.items.indexOf(item) < 1 ? "disabled" : ""}>
            ${icon("copy")} ${t("Copy previous")}
          </button>
        </div>
        ${renderMetadataFields(template, item.metadata)}
      </div>
      <div class="inspector-section">
        <label class="field-row">
          <span>${t("Tags")} <small>${t("comma-separated")}</small></span>
          <input type="text" data-item-bind="tags" value="${escapeAttr((item.tags || []).join(", "))}" placeholder="${escapeAttr(t("microfilm, needs review"))}">
        </label>
        <label class="field-row">
          <span>${t("Tropy list")} <small>${t("use / for nested lists")}</small></span>
          <input type="text" data-item-bind="listPath" value="${escapeAttr(item.listPath || "")}" placeholder="${escapeAttr(t("Research / 2026 / Rome"))}">
        </label>
        <label class="field-row">
          <span>${t("Note")}</span>
          <textarea data-item-bind="note" rows="5" placeholder="${escapeAttr(t("Transcription, observations, references…"))}">${escapeHtml(item.note || "")}</textarea>
        </label>
      </div>
      <div class="inspector-danger-zone">
        <button class="text-button danger-text" type="button" data-action="delete-item">${icon("trash")} ${t("Delete item")}</button>
      </div>
    </div>
  `;
}

function renderSessionPanel() {
  const template = getTemplate(session);
  const used = ui.storage?.usage || 0;
  const quota = ui.storage?.quota || 0;
  const percent = quota ? Math.min(100, (used / quota) * 100) : 0;
  return `
    <div class="inspector-scroll">
      <div class="inspector-section">
        <span class="eyebrow">${t("Session")}</span>
        <label class="field-row">
          <span>${t("Name")}</span>
          <input type="text" data-session-bind="name" value="${escapeAttr(session.name)}">
        </label>
        <label class="field-row">
          <span>${t("Item counter digits")}</span>
          <input type="number" min="3" max="8" data-session-bind="counterWidth" value="${Number(session.counterWidth) || 4}">
        </label>
        <label class="field-row">
          <span>${t("Default template")}</span>
          <select data-session-template>${renderTemplateOptions(session.templateKey)}</select>
        </label>
        <label class="toggle-row">
          <input type="checkbox" data-session-toggle="formatDatesOnBlur" ${session.formatDatesOnBlur ? "checked" : ""}>
          <span><strong>${t("Format recognized dates when fields are inactive")}</strong><small>${t("The stored value is shown again while editing.")}</small></span>
        </label>
        <button class="secondary-button full-width" type="button" data-action="import-template">${icon("upload")} ${t("Import .ttp template")}</button>
      </div>
      <div class="inspector-section metadata-fields">
        <div class="section-heading stacked">
          <div>
            <span class="eyebrow">${t("Default values")}</span>
            <p>${t("Automatically entered in new items.")}</p>
          </div>
        </div>
        ${renderMetadataFields(template, session.defaultMetadata, "defaults")}
        <label class="field-row">
          <span>${t("Default tags")}</span>
          <input type="text" data-session-bind="defaultTags" value="${escapeAttr((session.defaultTags || []).join(", "))}" placeholder="${escapeAttr(t("microfilm, session-1"))}">
        </label>
        <label class="field-row">
          <span>${t("Default list")}</span>
          <input type="text" data-session-bind="defaultListPath" value="${escapeAttr(session.defaultListPath || "")}" placeholder="${escapeAttr(t("Research / Archive"))}">
        </label>
        <button class="secondary-button full-width" type="button" data-action="apply-defaults">${t("Apply to existing empty fields")}</button>
      </div>
      <div class="inspector-section storage-card">
        <div class="section-heading">
          <div>
            <span class="eyebrow">${t("Browser storage")}</span>
            <strong>${quota ? t("{used} of {quota}", { used: formatBytes(used), quota: formatBytes(quota) }) : t("{used} used", { used: formatBytes(used) })}</strong>
          </div>
          ${icon("database")}
        </div>
        <div class="storage-meter" aria-label="${escapeAttr(t("Storage used"))}"><span style="width:${percent}%"></span></div>
        <p>${t("Images stay on this device. Export a copy at the end of the session.")}</p>
        <button class="secondary-button full-width" type="button" data-action="persist-storage">${t("Protect from automatic cleanup")}</button>
        <button class="text-button full-width" type="button" data-action="restore">${icon("restore")} ${t("Restore from exported folder")}</button>
      </div>
    </div>
  `;
}

function renderInspector() {
  const metadataActive = ui.inspectorTab === "metadata";
  return `
    <aside class="inspector-panel app-pane ${ui.mobilePane === "inspector" ? "mobile-active" : ""}" aria-label="${escapeAttr(t("Data panel"))}">
      <div class="tab-bar" role="tablist">
        <button type="button" role="tab" data-action="inspector-tab" data-tab="metadata"
          class="${metadataActive ? "active" : ""}" aria-selected="${metadataActive}">${t("Metadata")}</button>
        <button type="button" role="tab" data-action="inspector-tab" data-tab="session"
          class="${!metadataActive ? "active" : ""}" aria-selected="${!metadataActive}">${t("Session")}</button>
      </div>
      ${metadataActive ? renderMetadataPanel(selectedItem()) : renderSessionPanel()}
    </aside>
  `;
}

function renderTopbar() {
  return `
    <header class="topbar">
      <button type="button" class="brand" data-action="sessions" title="${escapeAttr(t("Manage sessions"))}">
        <span class="brand-mark">TC</span>
        <span><strong>Tropy Capture</strong><small>${t("Local archive")}</small></span>
      </button>
      <button type="button" class="session-chip" data-action="sessions">
        <span class="session-live"></span>
        <span>${escapeHtml(session.name)}</span>
        ${icon("chevron")}
      </button>
      <div class="topbar-spacer"></div>
      <span class="save-state" data-save-state data-state="${ui.saveState}">${ui.saveState === "saving" ? t("Saving…") : ui.saveState === "error" ? t("Save error") : t("Saved locally")}</span>
      <label class="language-picker" title="${escapeAttr(t("Language"))}">
        <span class="sr-only">${t("Language")}</span>
        <select data-language aria-label="${escapeAttr(t("Language"))}">
          ${SUPPORTED_LOCALES.map(({ code, label }) => `<option value="${code}" ${ui.locale === code ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <button class="icon-button topbar-icon" type="button" data-action="theme" title="${escapeAttr(t("Change theme"))}">${icon("theme")}<span class="sr-only">${t("Change theme")}</span></button>
      <button class="icon-button topbar-icon" type="button" data-action="help" title="${escapeAttr(t("Help"))}">${icon("help")}<span class="sr-only">${t("Help")}</span></button>
      <button class="export-button" type="button" data-action="open-export">${icon("export")} <span>${t("Export for Tropy")}</span></button>
    </header>
  `;
}

function renderStatusbar() {
  const validation = validateSession(session, ui.locale);
  return `
    <footer class="statusbar">
      <span>${icon("lock")} ${t("Private: no uploads")}</span>
      <span>${t("{items} items ready · {files} files · {size}", { items: validation.itemCount, files: validation.pageCount, size: formatBytes(validation.bytes) })}</span>
      <span>v${APP_VERSION}</span>
    </footer>
  `;
}

function renderMobileNav() {
  return `
    <nav class="mobile-nav" aria-label="${escapeAttr(t("Panels"))}">
      <button type="button" data-action="mobile-pane" data-pane="library" class="${ui.mobilePane === "library" ? "active" : ""}">${icon("list")}<span>${t("Items")}</span></button>
      <button type="button" data-action="mobile-pane" data-pane="viewer" class="${ui.mobilePane === "viewer" ? "active" : ""}">${icon("image")}<span>${t("Capture")}</span></button>
      <button type="button" data-action="mobile-pane" data-pane="inspector" class="${ui.mobilePane === "inspector" ? "active" : ""}">${icon("panel")}<span>${t("Metadata")}</span></button>
    </nav>
  `;
}

function renderHelpModal() {
  return `
    <div class="modal-card modal-wide" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div class="modal-header">
        <div><span class="eyebrow">${t("Recommended workflow")}</span><h2 id="help-title">${t("From the archive to Tropy, without duplicate work")}</h2></div>
        <button class="icon-button" type="button" data-action="close-modal">${icon("close")}<span class="sr-only">${t("Close")}</span></button>
      </div>
      <div class="help-steps">
        <article><span>1</span><div><strong>${t("Prepare the session")}</strong><p>${t("Set archive, collection, box, and rights once in the Session tab.")}</p></div></article>
        <article><span>2</span><div><strong>${t("Capture as you browse")}</strong><p>${t("Paste screenshots with Ctrl+V, drag files, or import a folder. Choose whether each image is an item or a page.")}</p></div></article>
        <article><span>3</span><div><strong>${t("Describe immediately")}</strong><p>${t("Complete the title, date, and reference. Everything is saved automatically in the browser.")}</p></div></article>
        <article><span>4</span><div><strong>${t("Take one package with you")}</strong><p>${t("Export the ZIP to a drive or cloud storage, extract it on your computer, and move the folder to its final location.")}</p></div></article>
        <article><span>5</span><div><strong>${t("Import into Tropy")}</strong><p>${t("Select tropy.jsonld: images, metadata, tags, and notes are imported together. To recreate lists, first enable Recreate lists in Tropy’s import preferences.")}</p></div></article>
      </div>
      <div class="privacy-callout">${icon("lock")}<div><strong>${t("The site is only the interface.")}</strong><span>${t("Images and metadata are never sent to the server; they remain in the browser until you export or delete them.")}</span></div></div>
      <div class="modal-actions"><button class="primary-button" type="button" data-action="close-modal">${t("Got it")}</button></div>
    </div>
  `;
}

function imagePathFieldLabel(property) {
  const field = imagePathFields().find((entry) => entry.property === property);
  return field ? (field.builtin === false ? field.label : t(field.label)) : t("Metadata field");
}

function imagePathFields() {
  const fields = IMAGE_PATH_FIELDS.map((field) => ({ ...field, builtin: true }));
  const seen = new Set(fields.map(({ property }) => property));
  for (const template of getTemplates(session)) {
    for (const field of template.fields || []) {
      if (!field.property || seen.has(field.property)) continue;
      seen.add(field.property);
      fields.push({ property: field.property, label: field.label, builtin: template.builtin });
    }
  }
  return fields;
}

function imagePathPreview() {
  const item = session.items.find((entry) => entry.pages.length) || selectedItem() || { metadata: session.defaultMetadata || {} };
  const segments = normalizeImagePathSegments(session.imagePathSegments).flatMap((segment) => {
    if (segment.kind === "text") return [segment.value];
    const value = item.metadata?.[segment.property];
    return [safePathSegment(value || `[${imagePathFieldLabel(segment.property)}]`)];
  });
  const exported = item.pages?.length ? exportFileMap(session).get(item.pages[0].id) : "img_YYYYMMDD-HHMMSS-0001.png";
  const filename = String(exported || "img_YYYYMMDD-HHMMSS-0001.png").split("/").pop();
  return `images/${[...segments, filename].join("/")}`;
}

function renderImagePathBuilder() {
  const segments = normalizeImagePathSegments(session.imagePathSegments);
  const isArchivePreset = JSON.stringify(segments) === JSON.stringify(ARCHIVE_IMAGE_PATH);
  return `
    <section class="path-builder" aria-labelledby="path-builder-title">
      <div class="path-builder-heading">
        <div><span class="eyebrow">${t("Image folder structure")}</span><p id="path-builder-title">${t("Build the path inside the images folder.")}</p></div>
        <div class="path-presets" aria-label="${escapeAttr(t("Path presets"))}">
          <button type="button" class="small-button ${segments.length ? "" : "active"}" data-action="path-preset" data-preset="flat" ${ui.busy ? "disabled" : ""}>${t("Flat")}</button>
          <button type="button" class="small-button ${isArchivePreset ? "active" : ""}" data-action="path-preset" data-preset="archive" ${ui.busy ? "disabled" : ""}>${t("Collection / Box / Folder")}</button>
        </div>
      </div>
      <div class="path-segments ${segments.length ? "" : "empty"}" data-path-segments>
        ${segments.length ? segments.map((segment, index) => `
          <div class="path-segment" draggable="true" data-path-segment-index="${index}">
            <span class="path-grip" title="${escapeAttr(t("Drag to reorder"))}">${icon("grip")}</span>
            <span><strong>${escapeHtml(segment.kind === "field" ? imagePathFieldLabel(segment.property) : segment.value)}</strong><small>${t(segment.kind === "field" ? "metadata field" : "fixed text")}</small></span>
            <button class="icon-button danger" type="button" data-action="remove-path-segment" data-index="${index}" title="${escapeAttr(t("Remove from path"))}" ${ui.busy ? "disabled" : ""}>${icon("close")}<span class="sr-only">${t("Remove")}</span></button>
          </div>
        `).join("") : `<span>${t("No subfolders: images are exported directly inside images/.")}</span>`}
      </div>
      <div class="path-add-controls">
        <div>
          <select data-path-field aria-label="${escapeAttr(t("Metadata field"))}" ${ui.busy ? "disabled" : ""}>
            ${imagePathFields().map((field) => `<option value="${escapeAttr(field.property)}">${escapeHtml(field.builtin === false ? field.label : t(field.label))}</option>`).join("")}
          </select>
          <button class="secondary-button" type="button" data-action="add-path-field" ${ui.busy ? "disabled" : ""}>${icon("plus")} ${t("Add field")}</button>
        </div>
        <div>
          <input type="text" data-path-text placeholder="${escapeAttr(t("Fixed folder name"))}" aria-label="${escapeAttr(t("Fixed folder name"))}" ${ui.busy ? "disabled" : ""}>
          <button class="secondary-button" type="button" data-action="add-path-text" ${ui.busy ? "disabled" : ""}>${icon("plus")} ${t("Add text")}</button>
        </div>
      </div>
      <div class="path-preview"><span>${t("Preview")}</span><code>${escapeHtml(imagePathPreview())}</code></div>
      <p class="path-note">${t("Empty metadata segments are skipped. Restoring a session matches each image by its filename, even if folders have been rearranged.")}</p>
    </section>
  `;
}

function renderExportModal() {
  const validation = validateSession(session, ui.locale);
  const canFolder = "showDirectoryPicker" in window;
  const disabled = validation.errors.length || ui.busy ? "disabled" : "";
  return `
    <div class="modal-card modal-wide" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div class="modal-header">
        <div><span class="eyebrow">${t("Portable package")}</span><h2 id="export-title">${t("Export for Tropy")}</h2></div>
        <button class="icon-button" type="button" data-action="close-modal" ${ui.busy ? "disabled" : ""}>${icon("close")}<span class="sr-only">${t("Close")}</span></button>
      </div>
      <div class="export-summary">
        <div><strong>${validation.itemCount}</strong><span>${t("documents")}</span></div>
        <div><strong>${validation.pageCount}</strong><span>${t("files")}</span></div>
        <div><strong>${formatBytes(validation.bytes)}</strong><span>${t("size")}</span></div>
      </div>
      ${validation.errors.map((message) => `<div class="message error">${message}</div>`).join("")}
      ${validation.warnings.map((message) => `<div class="message warning">${message}</div>`).join("")}
      ${renderImagePathBuilder()}
      <div class="package-tree" aria-label="${escapeAttr(t("Package contents"))}">
        <span>${icon("folder")} <strong>${escapeHtml(packageName(session))}/</strong></span>
        <span>├─ <b>tropy.jsonld</b> <small>${t("import this into Tropy")}</small></span>
        <span>├─ images/ <small>${t("renamed originals in the selected structure")}</small></span>
        <span>├─ capture-session.json <small>${t("restorable backup")}</small></span>
        <span>└─ README.txt <small>${t("instructions")}</small></span>
      </div>
      ${ui.progress ? `
        <div class="export-progress">
          <div><span>${escapeHtml(ui.progress.label)}</span><strong>${Math.round(ui.progress.value * 100)}%</strong></div>
          <div class="progress-track"><span style="width:${ui.progress.value * 100}%"></span></div>
        </div>
      ` : ""}
      <div class="modal-actions split-actions">
        ${canFolder ? `<button class="secondary-button" type="button" data-action="export-folder" ${disabled}>${icon("folder")} ${t("Save to folder")}</button>` : ""}
        <button class="primary-button" type="button" data-action="export-zip" ${disabled}>${icon("download")} ${ui.busy ? t("Preparing…") : t("Download ZIP")}</button>
      </div>
      <p class="modal-footnote">${t("After extraction, move the folder to its final location before importing.")}</p>
    </div>
  `;
}

function renderSessionsModal() {
  return `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="sessions-title">
      <div class="modal-header">
        <div><span class="eyebrow">${t("Browser storage")}</span><h2 id="sessions-title">${t("Sessions")}</h2></div>
        <button class="icon-button" type="button" data-action="close-modal">${icon("close")}<span class="sr-only">${t("Close")}</span></button>
      </div>
      <div class="session-list">
        ${sessionIndex.map((entry) => `
          <div class="session-row ${entry.id === session.id ? "current" : ""}">
            <button type="button" data-action="switch-session" data-session-id="${entry.id}" ${entry.id === session.id ? "disabled" : ""}>
              <span class="session-avatar">${icon("archive")}</span>
              <span><strong>${escapeHtml(entry.name)}</strong><small>${entry.items?.length || 0} ${t("documents")} · ${new Intl.DateTimeFormat(localeTag(ui.locale), { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.updatedAt))}</small></span>
            </button>
            ${entry.id === session.id ? `<span class="current-label">${t("Open")}</span>` : `<button class="icon-button danger" type="button" data-action="delete-session" data-session-id="${entry.id}" title="${escapeAttr(t("Delete"))}">${icon("trash")}</button>`}
          </div>
        `).join("")}
      </div>
      <div class="modal-actions split-actions">
        <button class="secondary-button" type="button" data-action="restore">${icon("restore")} ${t("Restore")}</button>
        <button class="primary-button" type="button" data-action="new-session">${icon("plus")} ${t("New session")}</button>
      </div>
    </div>
  `;
}

function renderConfirmModal() {
  const confirm = ui.confirm;
  return `
    <div class="modal-card modal-small" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <div class="modal-header"><div><span class="eyebrow">${t("Confirm")}</span><h2 id="confirm-title">${escapeHtml(confirm.title)}</h2></div></div>
      <p>${escapeHtml(confirm.message)}</p>
      <div class="modal-actions split-actions">
        <button class="secondary-button" type="button" data-action="cancel-confirm">${t("Cancel")}</button>
        <button class="danger-button" type="button" data-action="confirm-action">${escapeHtml(confirm.label || t("Delete"))}</button>
      </div>
    </div>
  `;
}

function renderModal() {
  if (!ui.modal && !ui.confirm) return "";
  const content = ui.confirm
    ? renderConfirmModal()
    : ui.modal === "help"
      ? renderHelpModal()
      : ui.modal === "export"
        ? renderExportModal()
        : renderSessionsModal();
  return `<div class="modal-backdrop" data-modal-backdrop>${content}</div>`;
}

function render() {
  document.documentElement.lang = ui.locale;
  root.innerHTML = `
    <div class="app-shell ${ui.dragging ? "is-dragging" : ""} ${ui.libraryCollapsed ? "library-collapsed" : ""}">
      ${renderTopbar()}
      <main class="workspace">
        ${renderLibrary()}
        ${renderViewer()}
        ${renderInspector()}
      </main>
      ${renderStatusbar()}
      ${renderMobileNav()}
      <input class="sr-only" id="file-input" type="file" accept="image/*,.tif,.tiff,.heic,.jp2,.jpx,.pdf" multiple>
      <input class="sr-only" id="folder-input" type="file" accept="image/*,.tif,.tiff,.heic,.jp2,.jpx,.pdf" webkitdirectory multiple>
      <input class="sr-only" id="template-input" type="file" accept=".ttp,.json,application/json">
      <input class="sr-only" id="restore-input" type="file" webkitdirectory multiple>
      ${renderModal()}
    </div>
  `;
  hydrateAssetUrls();
}

async function hydrateAssetUrls() {
  const elements = Array.from(document.querySelectorAll("[data-asset-src]"));
  const pageIds = [...new Set(elements.map((element) => element.dataset.assetSrc))];
  await Promise.all(pageIds.map(async (pageId) => {
    let url = objectUrls.get(pageId);
    if (!url) {
      const blob = await getAsset(pageId);
      if (!blob) return;
      url = URL.createObjectURL(blob);
      objectUrls.set(pageId, url);
    }
    document.querySelectorAll(`[data-asset-src="${CSS.escape(pageId)}"]`).forEach((element) => {
      if (element.isConnected && element.getAttribute("src") !== url) element.setAttribute("src", url);
    });
  }));
}

function toast(message, type = "info", timeout = 3600) {
  let region = document.querySelector("body > .toast-region");
  if (!region) {
    region = document.createElement("div");
    region.className = "toast-region";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    document.body.append(region);
  }
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.innerHTML = `<span>${type === "success" ? icon("check") : type === "error" ? icon("close") : icon("help")}</span><p>${escapeHtml(message)}</p>`;
  region.append(element);
  requestAnimationFrame(() => element.classList.add("visible"));
  setTimeout(() => {
    element.classList.remove("visible");
    setTimeout(() => element.remove(), 180);
  }, timeout);
}

function localizeError(error, fallback) {
  const message = error?.message || fallback;
  const oversizedFile = /^The file (.+) exceeds the 4 GB ZIP limit\.$/.exec(message);
  return oversizedFile
    ? t("The file {name} exceeds the 4 GB ZIP limit.", { name: oversizedFile[1] })
    : t(message);
}

function selectItem(id) {
  const item = session.items.find((candidate) => candidate.id === id);
  if (!item) return;
  ui.selectedItemId = item.id;
  ui.selectedPageId = item.pages[0]?.id || null;
  ui.mobilePane = "viewer";
  render();
}

function mergeItems(sourceId, targetId) {
  const source = session.items.find((item) => item.id === sourceId);
  const target = session.items.find((item) => item.id === targetId);
  const merged = mergeCaptureItems(session, sourceId, targetId);
  if (!merged) return;
  ui.selectedItemId = merged.id;
  ui.selectedPageId = merged.pages[0]?.id || null;
  ui.mobilePane = "viewer";
  scheduleSave();
  render();
  toast(t("“{source}” was merged into “{target}”.", {
    source: source ? itemTitle(source) : t("Item"),
    target: target ? itemTitle(target) : t("Item")
  }), "success");
}

function setImagePathSegments(segments) {
  session.imagePathSegments = normalizeImagePathSegments(segments);
  scheduleSave();
  render();
}

function moveImagePathSegment(from, to) {
  const segments = normalizeImagePathSegments(session.imagePathSegments);
  if (from === to || from < 0 || to < 0 || from >= segments.length || to >= segments.length) return;
  const [moved] = segments.splice(from, 1);
  segments.splice(to, 0, moved);
  setImagePathSegments(segments);
}

function createBlankItem() {
  const item = makeItem();
  session.items.push(item);
  ui.selectedItemId = item.id;
  ui.selectedPageId = null;
  ui.inspectorTab = "metadata";
  ui.mobilePane = "inspector";
  scheduleSave();
  render();
  setTimeout(focusTitleField, 0);
}

function focusTitleField() {
  const titleField = document.querySelector(`[data-meta="${CSS.escape(URIS.title)}"]`);
  titleField?.focus();
  titleField?.select();
}

function moveSelectedPage(offset) {
  const item = selectedItem();
  const page = selectedPage();
  if (!item || !page) return;
  const index = item.pages.findIndex((candidate) => candidate.id === page.id);
  const target = index + offset;
  if (target < 0 || target >= item.pages.length) return;
  [item.pages[index], item.pages[target]] = [item.pages[target], item.pages[index]];
  scheduleSave();
  render();
}

function requestDeleteItem() {
  const item = selectedItem();
  if (!item) return;
  ui.confirm = {
    title: t("Delete this item?"),
    message: t("“{title}” and {count} {images} will be removed from this browser.", {
      title: itemTitle(item),
      count: item.pages.length,
      images: t(item.pages.length === 1 ? "image" : "images")
    }),
    label: t("Delete"),
    action: async () => {
      for (const page of item.pages) {
        await deleteAsset(page.id);
        const url = objectUrls.get(page.id);
        if (url) URL.revokeObjectURL(url);
        objectUrls.delete(page.id);
      }
      const index = session.items.indexOf(item);
      session.items.splice(index, 1);
      const fallback = session.items[Math.min(index, session.items.length - 1)];
      ui.selectedItemId = fallback?.id || null;
      ui.selectedPageId = fallback?.pages[0]?.id || null;
      await flushSave();
    }
  };
  render();
}

function requestDeletePage() {
  const item = selectedItem();
  const page = selectedPage();
  if (!item || !page) return;
  ui.confirm = {
    title: t("Remove this page?"),
    message: t("{name} will be removed from the local session.", { name: page.originalName }),
    label: t("Remove"),
    action: async () => {
      const index = item.pages.indexOf(page);
      item.pages.splice(index, 1);
      await deleteAsset(page.id);
      const url = objectUrls.get(page.id);
      if (url) URL.revokeObjectURL(url);
      objectUrls.delete(page.id);
      ui.selectedPageId = item.pages[Math.min(index, item.pages.length - 1)]?.id || null;
      await flushSave();
    }
  };
  render();
}

function copyPreviousMetadata() {
  const item = selectedItem();
  const index = session.items.indexOf(item);
  if (!item || index < 1) return;
  const previous = session.items[index - 1];
  applyPreviousItemData(item, previous, URIS.identifier);
  scheduleSave();
  render();
  toast(t("Previous metadata copied, including title and date; the current reference was preserved."), "success");
}

function applyDefaults() {
  for (const item of session.items) {
    for (const [property, value] of Object.entries(session.defaultMetadata || {})) {
      if (!String(item.metadata?.[property] || "").trim() && String(value || "").trim()) item.metadata[property] = value;
    }
    if (!(item.tags || []).length) item.tags = [...(session.defaultTags || [])];
    if (!item.listPath) item.listPath = session.defaultListPath || "";
  }
  scheduleSave();
  render();
  toast(t("Default values applied to empty fields."), "success");
}

async function packageEntries() {
  const fileMap = exportFileMap(session);
  const entries = [
    { name: "README.txt", data: buildPackageReadme(session, ui.locale), type: "text/plain;charset=utf-8" },
    { name: "tropy.jsonld", data: JSON.stringify(buildTropyJson(session), null, 2), type: "application/ld+json" },
    { name: "manifest.json", data: JSON.stringify(buildManifest(session), null, 2), type: "application/json" },
    { name: "capture-session.json", data: JSON.stringify(buildCaptureBackup(session), null, 2), type: "application/json" }
  ];

  for (const template of session.customTemplates || []) {
    entries.push({
      name: `templates/${safeFilename(template.sourceName || template.name, "template.ttp")}`,
      data: JSON.stringify(template.source || template, null, 2),
      type: "application/json"
    });
  }

  for (const item of session.items) {
    for (const page of item.pages) {
      const blob = await getAsset(page.id);
      if (!blob) throw new Error(t("Missing image: {name}", { name: page.originalName }));
      entries.push({ name: `images/${fileMap.get(page.id)}`, data: blob, type: page.mime, modifiedAt: page.lastModified });
    }
  }
  return entries;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function exportZip() {
  if (validateSession(session, ui.locale).errors.length || ui.busy) return;
  ui.busy = true;
  ui.progress = { value: 0.02, label: t("Collecting files…") };
  render();
  try {
    await flushSave();
    const entries = await packageEntries();
    const zip = await createZip(entries, (value, filename) => {
      ui.progress = { value, label: t("Preparing {name}", { name: filename }) };
      const track = document.querySelector(".progress-track span");
      const label = document.querySelector(".export-progress span");
      const amount = document.querySelector(".export-progress strong");
      if (track) track.style.width = `${value * 100}%`;
      if (label) label.textContent = ui.progress.label;
      if (amount) amount.textContent = `${Math.round(value * 100)}%`;
    });
    downloadBlob(zip, `${packageName(session)}.zip`);
    toast(t("The ZIP package is ready. Keep it until you have imported it into Tropy."), "success", 5200);
    ui.modal = null;
  } catch (error) {
    console.error(error);
    toast(localizeError(error, "Export failed."), "error", 6000);
  } finally {
    ui.busy = false;
    ui.progress = null;
    render();
  }
}

async function writeFileHandle(directory, path, data) {
  const parts = path.split("/").filter(Boolean);
  const filename = parts.pop();
  let target = directory;
  for (const part of parts) target = await target.getDirectoryHandle(part, { create: true });
  const handle = await target.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data instanceof Blob ? data : new Blob([data]));
  await writable.close();
}

async function exportFolder() {
  if (validateSession(session, ui.locale).errors.length || ui.busy || !("showDirectoryPicker" in window)) return;
  ui.busy = true;
  ui.progress = { value: 0, label: t("Choose a folder…") };
  render();
  try {
    const destination = await window.showDirectoryPicker({ mode: "readwrite" });
    const timestamp = new Date().toISOString().slice(0, 10);
    const target = await destination.getDirectoryHandle(`${packageName(session)}-${timestamp}`, { create: true });
    const entries = await packageEntries();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      ui.progress = { value: (index + 1) / entries.length, label: t("Writing {name}", { name: entry.name }) };
      await writeFileHandle(target, entry.name, entry.data);
    }
    await flushSave();
    ui.modal = null;
    toast(t("Folder exported. Move it to its final location before importing."), "success", 5200);
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.error(error);
      toast(localizeError(error, "Folder export failed."), "error", 6000);
    }
  } finally {
    ui.busy = false;
    ui.progress = null;
    render();
  }
}

async function importTemplate(file) {
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const template = normalizeTemplate(raw, file.name);
    const existingIndex = (session.customTemplates || []).findIndex((entry) => entry.id === template.id);
    if (existingIndex >= 0) session.customTemplates.splice(existingIndex, 1, template);
    else session.customTemplates.push(template);
    session.templateKey = template.key;
    await flushSave();
    render();
    toast(t("Template “{name}” imported.", { name: template.name }), "success");
  } catch (error) {
    console.error(error);
    toast(localizeError(error, "Invalid template."), "error");
  }
}

function pathOf(file) {
  return String(file.webkitRelativePath || file.name).replace(/\\/g, "/");
}

async function restoreFromFolder(fileList) {
  const files = Array.from(fileList || []);
  const backupFile = files.find((file) => /(^|\/)capture-session\.json$/i.test(pathOf(file)));
  if (!backupFile) {
    toast(t("capture-session.json was not found. Select the complete extracted folder."), "error", 6000);
    return;
  }
  ui.busy = true;
  render();
  try {
    const backup = JSON.parse(await backupFile.text());
    if (backup.format !== "tropy-capture-session" || !backup.session) throw new Error(t("This is not a recognized Tropy Capture backup."));
    const restored = prepareSession(clone(backup.session));
    restored.id = uuid();
    restored.name = t("{name} · restored", { name: restored.name });
    restored.createdAt = new Date().toISOString();
    restored.updatedAt = restored.createdAt;
    const assetRecords = [];
    let missing = 0;

    restored.items = (restored.items || []).map((item) => {
      const restoredItem = { ...item, id: uuid() };
      restoredItem.pages = (item.pages || []).flatMap((page) => {
        const expected = page.exportName || page.originalName;
        const match = findRestoredAsset(files, expected);
        if (!match) {
          missing += 1;
          return [];
        }
        const id = uuid();
        assetRecords.push({ id, sessionId: restored.id, blob: match });
        const { exportName, ...cleanPage } = page;
        return [{ ...cleanPage, id, checksum: `tropy-capture-${id}`, size: match.size, mime: match.type || page.mime }];
      });
      return restoredItem;
    });

    await saveAssets(assetRecords);
    await saveSession(restored);
    clearObjectUrls();
    session = restored;
    localStorage.setItem(LAST_SESSION_KEY, session.id);
    ui.selectedItemId = session.items[0]?.id || null;
    ui.selectedPageId = session.items[0]?.pages[0]?.id || null;
    ui.modal = null;
    await refreshSessionIndex();
    render();
    toast(
      missing ? t("Session restored; {count} files were not found.", { count: missing }) : t("Session and images restored."),
      missing ? "warning" : "success",
      6000
    );
  } catch (error) {
    console.error(error);
    toast(localizeError(error, "Restore failed."), "error", 6000);
  } finally {
    ui.busy = false;
    render();
  }
}

async function refreshSessionIndex() {
  sessionIndex = await listSessions();
}

async function newSession() {
  await flushSave();
  const created = createDefaultSession();
  await saveSession(created);
  clearObjectUrls();
  session = created;
  localStorage.setItem(LAST_SESSION_KEY, session.id);
  ui.selectedItemId = null;
  ui.selectedPageId = null;
  ui.modal = null;
  await refreshSessionIndex();
  render();
}

async function switchSession(id) {
  if (id === session.id) return;
  await flushSave();
  const next = await getSession(id);
  if (!next) return;
  clearObjectUrls();
  session = prepareSession(next);
  await saveSession(session);
  localStorage.setItem(LAST_SESSION_KEY, id);
  ui.selectedItemId = session.items[0]?.id || null;
  ui.selectedPageId = session.items[0]?.pages[0]?.id || null;
  ui.modal = null;
  ui.search = "";
  render();
}

function requestDeleteSession(id) {
  const target = sessionIndex.find((entry) => entry.id === id);
  if (!target || id === session.id) return;
  ui.confirm = {
    title: t("Delete this session?"),
    message: t("“{name}” and all its local images will be permanently deleted from this browser.", { name: target.name }),
    label: t("Delete session"),
    action: async () => {
      await deleteStoredSession(id);
      await refreshSessionIndex();
      ui.modal = "sessions";
    }
  };
  render();
}

async function handleAction(action, element) {
  switch (action) {
    case "new-item": createBlankItem(); break;
    case "select-item": selectItem(element.dataset.itemId); break;
    case "select-page": ui.selectedPageId = element.dataset.pageId; render(); break;
    case "pick-files": {
      const input = document.querySelector("#file-input");
      if (input) {
        delete input.dataset.forceMode;
        input.click();
      }
      break;
    }
    case "pick-folder": document.querySelector("#folder-input")?.click(); break;
    case "add-pages": {
      const input = document.querySelector("#file-input");
      if (input) {
        input.dataset.forceMode = "pages";
        input.click();
      }
      break;
    }
    case "paste": await tryClipboardRead(); break;
    case "capture-mode": session.captureMode = element.dataset.mode; scheduleSave(); render(); break;
    case "move-page-left": moveSelectedPage(-1); break;
    case "move-page-right": moveSelectedPage(1); break;
    case "delete-page": requestDeletePage(); break;
    case "delete-item": requestDeleteItem(); break;
    case "copy-previous": copyPreviousMetadata(); break;
    case "toggle-library": {
      ui.libraryCollapsed = !ui.libraryCollapsed;
      localStorage.setItem(LIBRARY_COLLAPSED_KEY, String(ui.libraryCollapsed));
      render();
      break;
    }
    case "inspector-tab": ui.inspectorTab = element.dataset.tab; render(); break;
    case "mobile-pane": ui.mobilePane = element.dataset.pane; render(); break;
    case "apply-defaults": applyDefaults(); break;
    case "import-template": document.querySelector("#template-input")?.click(); break;
    case "restore": document.querySelector("#restore-input")?.click(); break;
    case "persist-storage": {
      const granted = await requestPersistentStorage();
      toast(
        t(granted ? "Persistent storage is enabled in this browser." : "The browser did not grant persistent storage."),
        granted ? "success" : "warning"
      );
      break;
    }
    case "theme": {
      const order = ["system", "light", "dark"];
      ui.theme = order[(order.indexOf(ui.theme) + 1) % order.length];
      applyTheme();
      toast(t(`Theme: ${ui.theme}.`), "info");
      break;
    }
    case "help": ui.modal = "help"; render(); break;
    case "open-export": ui.modal = "export"; render(); break;
    case "path-preset": {
      setImagePathSegments(element.dataset.preset === "archive" ? ARCHIVE_IMAGE_PATH.map((segment) => ({ ...segment })) : []);
      break;
    }
    case "add-path-field": {
      const property = document.querySelector("[data-path-field]")?.value;
      if (!imagePathFields().some((field) => field.property === property)) break;
      const segments = normalizeImagePathSegments(session.imagePathSegments);
      if (segments.some((segment) => segment.kind === "field" && segment.property === property)) {
        toast(t("That metadata field is already in the path."), "warning");
        break;
      }
      setImagePathSegments([...segments, { kind: "field", property }]);
      break;
    }
    case "add-path-text": {
      const input = document.querySelector("[data-path-text]");
      const value = input?.value.trim();
      if (!value) { input?.focus(); break; }
      setImagePathSegments([...normalizeImagePathSegments(session.imagePathSegments), { kind: "text", value }]);
      break;
    }
    case "remove-path-segment": {
      const segments = normalizeImagePathSegments(session.imagePathSegments);
      segments.splice(Number(element.dataset.index), 1);
      setImagePathSegments(segments);
      break;
    }
    case "sessions": await refreshSessionIndex(); ui.modal = "sessions"; render(); break;
    case "close-modal": if (!ui.busy) { ui.modal = null; ui.confirm = null; render(); } break;
    case "export-zip": await exportZip(); break;
    case "export-folder": await exportFolder(); break;
    case "new-session": await newSession(); break;
    case "switch-session": await switchSession(element.dataset.sessionId); break;
    case "delete-session": requestDeleteSession(element.dataset.sessionId); break;
    case "cancel-confirm": ui.confirm = null; render(); break;
    case "confirm-action": {
      const callback = ui.confirm?.action;
      ui.confirm = null;
      if (callback) await callback();
      render();
      break;
    }
  }
}

root.addEventListener("click", async (event) => {
  const actionElement = event.target.closest("[data-action]");
  if (actionElement) {
    event.preventDefault();
    await handleAction(actionElement.dataset.action, actionElement);
    return;
  }
  if (event.target.matches("[data-modal-backdrop]") && !ui.busy) {
    ui.modal = null;
    ui.confirm = null;
    render();
  }
});

root.addEventListener("input", (event) => {
  const target = event.target;
  const item = selectedItem();
  if (target.matches("[data-date-field]")) target.dataset.dateRaw = target.value;
  if (target.matches("[data-search]")) {
    ui.search = target.value;
    const panel = target.closest(".library-panel");
    panel?.querySelector(".item-list")?.replaceWith(document.createRange().createContextualFragment(renderLibrary()).querySelector(".item-list"));
    hydrateAssetUrls();
    return;
  }
  if (target.hasAttribute("data-meta") && item) {
    item.metadata[target.dataset.meta] = target.value;
    scheduleSave();
  } else if (target.hasAttribute("data-default-meta")) {
    session.defaultMetadata[target.dataset.defaultMeta] = target.value;
    scheduleSave();
  } else if (target.hasAttribute("data-item-bind") && item) {
    const key = target.dataset.itemBind;
    item[key] = key === "tags" ? target.value.split(",").map((tag) => tag.trim()).filter(Boolean) : target.value;
    scheduleSave();
  } else if (target.hasAttribute("data-session-bind")) {
    const key = target.dataset.sessionBind;
    if (key === "defaultTags") session[key] = target.value.split(",").map((tag) => tag.trim()).filter(Boolean);
    else if (key === "counterWidth") session[key] = Math.min(8, Math.max(3, Number(target.value) || 4));
    else session[key] = target.value;
    scheduleSave();
  }
});

root.addEventListener("change", async (event) => {
  const target = event.target;
  if (target.matches("[data-language]")) {
    ui.locale = SUPPORTED_LOCALES.some(({ code }) => code === target.value) ? target.value : DEFAULT_LOCALE;
    localStorage.setItem(LANGUAGE_KEY, ui.locale);
    render();
  } else if (target.id === "file-input") {
    const forcedMode = target.dataset.forceMode;
    delete target.dataset.forceMode;
    await addFiles(target.files, forcedMode);
    target.value = "";
  } else if (target.id === "folder-input") {
    await addFiles(target.files);
    target.value = "";
  } else if (target.id === "template-input") {
    await importTemplate(target.files[0]);
    target.value = "";
  } else if (target.id === "restore-input") {
    await restoreFromFolder(target.files);
    target.value = "";
  } else if (target.matches("[data-session-template]")) {
    session.templateKey = target.value;
    scheduleSave();
    render();
  } else if (target.matches("[data-item-template]")) {
    const item = selectedItem();
    const template = getTemplate(session, target.value);
    if (item) item.templateId = template.id;
    scheduleSave();
    render();
  } else if (target.matches("[data-session-toggle]")) {
    session[target.dataset.sessionToggle] = target.checked;
    scheduleSave();
    render();
  }
});

root.addEventListener("focusin", (event) => {
  const target = event.target;
  if (target.matches("input, textarea, select, [contenteditable='true']")) {
    ui.focusTitleOnNextTab = false;
  }
  if (!target.matches("[data-date-field]") || !session.formatDatesOnBlur) return;
  target.value = target.dataset.dateRaw || "";
  target.closest(".date-input-wrap")?.querySelector(".date-recognition")?.classList.add("hidden");
});

root.addEventListener("focusout", (event) => {
  const target = event.target;
  if (!target.matches("[data-date-field]") || !session.formatDatesOnBlur) return;
  const presented = datePresentation(target.dataset.dateRaw || target.value, true, ui.locale);
  target.value = presented.display;
  const legend = target.closest(".date-input-wrap")?.querySelector(".date-recognition");
  if (!legend) return;
  legend.textContent = presented.parts.join(" · ");
  legend.setAttribute("aria-label", t("Recognized date parts: {parts}", { parts: presented.parts.join(", ") }));
  legend.classList.toggle("hidden", !presented.parts.length);
});

root.addEventListener("dragstart", (event) => {
  const pathSegment = event.target.closest("[data-path-segment-index]");
  if (pathSegment && !ui.busy) {
    ui.draggedPathIndex = Number(pathSegment.dataset.pathSegmentIndex);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-tropy-capture-path-segment", String(ui.draggedPathIndex));
    pathSegment.classList.add("dragging");
    return;
  }

  const itemRow = event.target.closest("[data-item-id]");
  if (!itemRow) return;
  ui.draggedItemId = itemRow.dataset.itemId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-tropy-capture-item", ui.draggedItemId);
  itemRow.classList.add("dragging");
});

root.addEventListener("dragover", (event) => {
  if (ui.draggedPathIndex !== null) {
    const target = event.target.closest("[data-path-segment-index]");
    if (!target || Number(target.dataset.pathSegmentIndex) === ui.draggedPathIndex) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".path-segment.drop-target").forEach((entry) => entry.classList.remove("drop-target"));
    target.classList.add("drop-target");
    return;
  }

  if (ui.draggedItemId) {
    const target = event.target.closest("[data-item-id]");
    if (!target || target.dataset.itemId === ui.draggedItemId) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".item-row.merge-target, .collapsed-item-row.merge-target").forEach((entry) => entry.classList.remove("merge-target"));
    target.classList.add("merge-target");
  }
});

root.addEventListener("dragleave", (event) => {
  const target = event.target.closest(".item-row.merge-target, .collapsed-item-row.merge-target, .path-segment.drop-target");
  if (target && !target.contains(event.relatedTarget)) target.classList.remove("merge-target", "drop-target");
});

root.addEventListener("drop", (event) => {
  if (ui.draggedPathIndex !== null) {
    const target = event.target.closest("[data-path-segment-index]");
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceIndex = ui.draggedPathIndex;
    const targetIndex = Number(target.dataset.pathSegmentIndex);
    ui.draggedPathIndex = null;
    moveImagePathSegment(sourceIndex, targetIndex);
    return;
  }

  if (ui.draggedItemId) {
    const target = event.target.closest("[data-item-id]");
    if (!target || target.dataset.itemId === ui.draggedItemId) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = ui.draggedItemId;
    ui.draggedItemId = null;
    mergeItems(sourceId, target.dataset.itemId);
  }
});

root.addEventListener("dragend", () => {
  ui.draggedItemId = null;
  ui.draggedPathIndex = null;
  document.querySelectorAll(".dragging, .merge-target, .drop-target").forEach((entry) => {
    entry.classList.remove("dragging", "merge-target", "drop-target");
  });
});

document.addEventListener("paste", async (event) => {
  const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  event.preventDefault();
  await addFiles(files, undefined, { focusTitleOnTab: true });
});

let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
  event.preventDefault();
  dragDepth += 1;
  if (!ui.dragging) { ui.dragging = true; document.querySelector(".app-shell")?.classList.add("is-dragging"); }
});
document.addEventListener("dragover", (event) => {
  if (Array.from(event.dataTransfer?.types || []).includes("Files")) event.preventDefault();
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) { ui.dragging = false; document.querySelector(".app-shell")?.classList.remove("is-dragging"); }
});
document.addEventListener("drop", async (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
  event.preventDefault();
  dragDepth = 0;
  ui.dragging = false;
  document.querySelector(".app-shell")?.classList.remove("is-dragging");
  await addFiles(event.dataTransfer?.files);
});

document.addEventListener("keydown", (event) => {
  const mod = event.ctrlKey || event.metaKey;
  const activeElementIsEditable = document.activeElement?.matches?.("input, textarea, select, [contenteditable='true']");
  if (event.key === "Tab" && !event.shiftKey && ui.focusTitleOnNextTab && !activeElementIsEditable && !ui.modal && !ui.confirm) {
    event.preventDefault();
    ui.focusTitleOnNextTab = false;
    ui.inspectorTab = "metadata";
    ui.mobilePane = "inspector";
    render();
    requestAnimationFrame(focusTitleField);
  } else if (event.key === "Escape" && (ui.modal || ui.confirm) && !ui.busy) {
    ui.modal = null;
    ui.confirm = null;
    render();
  } else if (mod && event.key.toLowerCase() === "n") {
    event.preventDefault();
    createBlankItem();
  } else if (mod && event.key.toLowerCase() === "e") {
    event.preventDefault();
    ui.modal = "export";
    render();
  } else if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) {
    event.preventDefault();
    document.querySelector("[data-search]")?.focus();
  }
});

function registerWebMcp() {
  if (!document.modelContext?.registerTool) return;
  const tools = [
    {
      name: "get_capture_summary",
      description: "Returns a summary of the open Tropy Capture session.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        const result = validateSession(session, ui.locale);
        return { content: [{ type: "text", text: JSON.stringify({ session: session.name, ...result }) }] };
      }
    },
    {
      name: "set_session_defaults",
      description: "Sets the default archival values used for new items.",
      inputSchema: {
        type: "object",
        properties: {
          archive: { type: "string" }, collection: { type: "string" }, box: { type: "string" },
          folder: { type: "string" }, rights: { type: "string" }, listPath: { type: "string" },
          tags: { type: "array", items: { type: "string" } }
        },
        additionalProperties: false
      },
      execute: async (args) => {
        const mapping = { archive: URIS.source, collection: URIS.collection, box: URIS.box, folder: URIS.folder, rights: URIS.rights };
        for (const [key, property] of Object.entries(mapping)) if (args[key] !== undefined) session.defaultMetadata[property] = args[key];
        if (args.listPath !== undefined) session.defaultListPath = args.listPath;
        if (args.tags !== undefined) session.defaultTags = args.tags;
        await flushSave();
        render();
        return { content: [{ type: "text", text: t("Default values updated.") }] };
      }
    },
    {
      name: "create_capture_item",
      description: "Creates an empty item with optional title, reference, and date.",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, identifier: { type: "string" }, date: { type: "string" } },
        additionalProperties: false
      },
      execute: async (args) => {
        const item = makeItem(args);
        session.items.push(item);
        ui.selectedItemId = item.id;
        await flushSave();
        render();
        return { content: [{ type: "text", text: t("Item {number} created.", { number: item.sequence }) }] };
      }
    }
  ];
  for (const tool of tools) {
    try { document.modelContext.registerTool(tool); } catch (error) { console.debug("WebMCP tool was not registered", error); }
  }
}

async function initialize() {
  applyTheme();
  const lastId = localStorage.getItem(LAST_SESSION_KEY);
  session = lastId ? await getSession(lastId) : null;
  if (!session) {
    const sessions = await listSessions();
    session = sessions[0] || createDefaultSession();
    if (!sessions.length) await saveSession(session);
  }
  session = prepareSession(session);
  await saveSession(session);
  localStorage.setItem(LAST_SESSION_KEY, session.id);
  ui.selectedItemId = session.items[0]?.id || null;
  ui.selectedPageId = session.items[0]?.pages[0]?.id || null;
  ui.storage = await storageEstimate();
  await refreshSessionIndex();
  render();
  registerWebMcp();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.debug("Service worker was not registered", error));
  }
}

initialize().catch((error) => {
  console.error(error);
  root.innerHTML = `<div class="fatal-error"><strong>${t("Could not open Tropy Capture")}</strong><p>${escapeHtml(error.message)}</p><button data-reload>${t("Try again")}</button></div>`;
  root.querySelector("[data-reload]")?.addEventListener("click", () => location.reload());
});
