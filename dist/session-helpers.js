function cloneValue(value) {
  return typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function collectMetadataSuggestions(items, property, locale = "en-US", limit = 24) {
  const values = [];
  const seen = new Set();
  for (const item of [...items].reverse()) {
    const value = String(item.metadata?.[property] ?? "").trim();
    const key = value.toLocaleLowerCase(locale);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
    if (values.length === limit) break;
  }
  return values;
}

export function applyPreviousItemData(item, previous, referenceProperty) {
  const currentReference = item.metadata?.[referenceProperty] || "";
  item.metadata = {
    ...cloneValue(previous.metadata || {}),
    [referenceProperty]: currentReference
  };
  item.tags = [...(previous.tags || [])];
  item.listPath = previous.listPath || "";
  item.templateId = previous.templateId;
  return item;
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Merge a source item into a target using Tropy's target-first semantics.
 * The target keeps its own metadata and receives only properties it does not
 * already contain. Source photos are appended and the source item is removed.
 */
export function mergeCaptureItems(session, sourceId, targetId) {
  if (!session || sourceId === targetId) return null;
  const sourceIndex = session.items.findIndex((item) => item.id === sourceId);
  const target = session.items.find((item) => item.id === targetId);
  if (sourceIndex < 0 || !target) return null;
  const source = session.items[sourceIndex];

  target.metadata = { ...(target.metadata || {}) };
  for (const [property, value] of Object.entries(source.metadata || {})) {
    if (!Object.prototype.hasOwnProperty.call(target.metadata, property)) {
      target.metadata[property] = cloneValue(value);
    }
  }
  target.pages = [...(target.pages || []), ...(source.pages || [])];
  target.tags = uniqueValues([...(target.tags || []), ...(source.tags || [])]);
  if (!target.listPath && source.listPath) target.listPath = source.listPath;
  if (String(source.note || "").trim() && String(source.note || "").trim() !== String(target.note || "").trim()) {
    target.note = [target.note, source.note].map((value) => String(value || "").trim()).filter(Boolean).join("\n\n");
  }

  session.items.splice(sourceIndex, 1);
  return target;
}

/** Move one photo to another item, without creating another asset or photo record. */
export function moveCapturePage(session, pageId, targetId) {
  if (!session || !pageId || !targetId) return null;
  const source = session.items.find((item) => item.pages?.some((page) => page.id === pageId));
  const target = session.items.find((item) => item.id === targetId);
  if (!source || !target || source.id === target.id) return null;

  // A one-photo item is fully merged, including its metadata, tags and notes.
  if (source.pages.length === 1) {
    return mergeCaptureItems(session, source.id, target.id) ? { target, pageId } : null;
  }

  const index = source.pages.findIndex((page) => page.id === pageId);
  const [page] = source.pages.splice(index, 1);
  target.pages.push(page);
  return { target, pageId };
}

/** Reorder photos within one item without changing their IDs or image assets. */
export function reorderCapturePage(item, pageId, targetPageId, after = false) {
  if (!item?.pages || pageId === targetPageId) return false;
  const sourceIndex = item.pages.findIndex((page) => page.id === pageId);
  const targetIndex = item.pages.findIndex((page) => page.id === targetPageId);
  if (sourceIndex < 0 || targetIndex < 0) return false;
  const insertionIndex = targetIndex + Number(after) - Number(sourceIndex < targetIndex);
  if (insertionIndex === sourceIndex) return false;

  const [page] = item.pages.splice(sourceIndex, 1);
  item.pages.splice(insertionIndex, 0, page);
  return true;
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

export function findRestoredAsset(files, expectedPath) {
  const normalizedExpected = normalizePath(expectedPath);
  if (!normalizedExpected) return null;
  const filename = normalizedExpected.split("/").pop();
  const exactSuffix = `images/${normalizedExpected}`;
  return files.find((file) => normalizePath(file.webkitRelativePath || file.name).endsWith(exactSuffix))
    || files.find((file) => String(file.name || "").toLowerCase() === filename)
    || null;
}
