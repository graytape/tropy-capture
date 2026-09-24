import { localeTag, translate } from "./i18n.js";

export const APP_VERSION = "1.6.0";

export const URIS = {
  title: "http://purl.org/dc/elements/1.1/title",
  creator: "http://purl.org/dc/elements/1.1/creator",
  date: "http://purl.org/dc/elements/1.1/date",
  type: "http://purl.org/dc/elements/1.1/type",
  source: "http://purl.org/dc/elements/1.1/source",
  collection: "https://tropy.org/v1/tropy#collection",
  box: "https://tropy.org/v1/tropy#box",
  folder: "https://tropy.org/v1/tropy#folder",
  identifier: "http://purl.org/dc/elements/1.1/identifier",
  rights: "http://purl.org/dc/elements/1.1/rights",
  audience: "http://purl.org/dc/terms/audience",
  coverage: "http://purl.org/dc/elements/1.1/coverage"
};

export const IMAGE_PATH_FIELDS = [
  { property: URIS.collection, label: "Collection" },
  { property: URIS.box, label: "Box" },
  { property: URIS.folder, label: "Folder / file" },
  { property: URIS.source, label: "Archive" },
  { property: URIS.title, label: "Title" },
  { property: URIS.date, label: "Date" },
  { property: URIS.identifier, label: "Reference" }
];

export const ARCHIVE_IMAGE_PATH = [
  { kind: "field", property: URIS.collection },
  { kind: "field", property: URIS.box },
  { kind: "field", property: URIS.folder }
];

const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";
const TROPY_DATE = "https://tropy.org/v1/tropy#date";
const RDFS_CLASS = "http://www.w3.org/2000/01/rdf-schema#Class";

const field = (property, label, options = {}) => ({
  property,
  label,
  datatype: XSD_STRING,
  hint: "",
  isRequired: false,
  ...options
});

export const BUILTIN_TEMPLATES = {
  generic: {
    key: "generic",
    id: "https://tropy.org/v1/templates/generic",
    name: "Tropy Generic",
    description: "Generic archival item",
    builtin: true,
    fields: [
      field(URIS.title, "Title"),
      field(URIS.creator, "Author or creator", { hint: "Person or organization responsible" }),
      field(URIS.date, "Date", { datatype: TROPY_DATE, hint: "ISO format: YYYY-MM-DD, partial dates are accepted" }),
      field(URIS.type, "Type", { hint: "Letter, report, photograph…" }),
      field(URIS.source, "Archive", { hint: "Institution holding the item" }),
      field(URIS.collection, "Collection"),
      field(URIS.box, "Box"),
      field(URIS.folder, "Folder / file"),
      field(URIS.identifier, "Reference", { hint: "Call number or URL" }),
      field(URIS.rights, "Rights", { isRequired: true })
    ]
  },
  correspondence: {
    key: "correspondence",
    id: "https://tropy.org/v1/templates/correspondence",
    name: "Tropy Correspondence",
    description: "Letters and correspondence",
    builtin: true,
    fields: [
      field(URIS.title, "Title"),
      field(URIS.creator, "Author", { hint: "Sender" }),
      field(URIS.audience, "Recipient"),
      field(URIS.date, "Date", { datatype: TROPY_DATE, hint: "ISO format: YYYY-MM-DD, partial dates are accepted" }),
      field(URIS.coverage, "Place"),
      field(URIS.type, "Type", { value: "Correspondence", hint: "Document type" }),
      field(URIS.source, "Archive", { hint: "Institution holding the item" }),
      field(URIS.collection, "Collection"),
      field(URIS.box, "Box"),
      field(URIS.folder, "Folder / file"),
      field(URIS.identifier, "Reference", { hint: "Call number or URL" }),
      field(URIS.rights, "Rights", { isRequired: true })
    ]
  }
};

export const TROPY_CONTEXT = {
  "@version": 1.1,
  "@vocab": "https://tropy.org/v1/tropy#",
  template: { "@type": "@id" },
  photo: {
    "@id": "https://tropy.org/v1/tropy#photo",
    "@container": "@list"
  },
  note: {
    "@id": "https://tropy.org/v1/tropy#note",
    "@container": "@list"
  },
  selection: {
    "@id": "https://tropy.org/v1/tropy#selection",
    "@container": "@list"
  }
};

export function normalizeTemplate(raw, sourceName = "template.ttp") {
  if (!raw || typeof raw !== "object") throw new Error("The template does not contain valid JSON.");
  const id = raw["@id"] || raw.id;
  const name = raw.name || sourceName.replace(/\.ttp$/i, "");
  const rawFields = raw.field || raw.fields;
  if (!id || !Array.isArray(rawFields)) throw new Error("The file does not appear to be a Tropy template (.ttp).");

  return {
    key: `custom:${id}`,
    id,
    name,
    description: raw.description || "Custom Tropy template",
    builtin: false,
    sourceName: sourceName.toLowerCase().endsWith(".ttp") ? sourceName : `${sourceName}.ttp`,
    source: raw,
    fields: rawFields.map((entry) => ({
      property: entry.property,
      label: entry.label || humanizeUri(entry.property),
      datatype: entry.datatype || XSD_STRING,
      hint: entry.hint || "",
      isRequired: Boolean(entry.isRequired),
      isConstant: Boolean(entry.isConstant),
      value: entry.value ?? ""
    })).filter((entry) => entry.property)
  };
}

export function humanizeUri(uri = "") {
  const tail = decodeURIComponent(String(uri).split(/[\/#]/).filter(Boolean).pop() || "Field");
  return tail
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
}

export function getTemplates(session) {
  return [
    BUILTIN_TEMPLATES.generic,
    BUILTIN_TEMPLATES.correspondence,
    ...(session.customTemplates || [])
  ];
}

export function getTemplate(session, key = session.templateKey) {
  return getTemplates(session).find((template) => template.key === key) || BUILTIN_TEMPLATES.generic;
}

export function safeFilename(value, fallback = "file") {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return normalized || fallback;
}

export function packageName(session) {
  return safeFilename(session.name, "tropy-capture");
}

export function safePathSegment(value, fallback = "") {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/^[ .-]+|[ .-]+$/g, "");
  return normalized || fallback;
}

export function normalizeImagePathSegments(segments) {
  if (!Array.isArray(segments)) return [];
  return segments.flatMap((segment) => {
    if (segment?.kind === "field" && typeof segment.property === "string" && segment.property.trim()) {
      return [{ kind: "field", property: segment.property.trim() }];
    }
    if (segment?.kind === "text" && safePathSegment(segment.value)) {
      return [{ kind: "text", value: safePathSegment(segment.value) }];
    }
    return [];
  });
}

export function imageDirectoryForItem(session, item) {
  return normalizeImagePathSegments(session.imagePathSegments).flatMap((segment) => {
    const value = segment.kind === "field"
      ? item?.metadata?.[segment.property]
      : segment.value;
    const safe = safePathSegment(value);
    return safe ? [safe] : [];
  }).join("/");
}

function extensionFor(page) {
  const match = String(page.originalName || "").match(/\.([a-zA-Z0-9]{1,8})$/);
  const fromName = match?.[1]?.toLowerCase();
  if (fromName) return fromName === "jpeg" ? "jpg" : fromName;
  const mimeMap = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/tiff": "tif",
    "image/svg+xml": "svg",
    "image/heic": "heic",
    "image/avif": "avif",
    "application/pdf": "pdf"
  };
  return mimeMap[page.mime] || "bin";
}

export function exportFileMap(session) {
  const used = new Set();
  const map = new Map();
  const width = 4;
  let fallbackSequence = 1;

  for (const item of session.items) {
    item.pages.forEach((page) => {
      const timestamp = /^\d{8}-\d{6}$/.test(page.filenameTimestamp || "")
        ? page.filenameTimestamp
        : imageTimestampToken(page.createdAt || item.createdAt || session.createdAt);
      const number = Number(page.exportSequence) || fallbackSequence;
      fallbackSequence = Math.max(fallbackSequence + 1, number + 1);
      const base = `img_${timestamp}-${String(number).padStart(width, "0")}`;
      const extension = extensionFor(page);
      let candidate = `${base}.${extension}`;
      let collision = 2;
      while (used.has(candidate.toLowerCase())) {
        candidate = `${base}-${collision}.${extension}`;
        collision += 1;
      }
      used.add(candidate.toLowerCase());
      const directory = imageDirectoryForItem(session, item);
      map.set(page.id, directory ? `${directory}/${candidate}` : candidate);
    });
  }

  return map;
}

function imageTimestampToken(value) {
  const date = value ? new Date(value) : new Date();
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  return [
    valid.getUTCFullYear(),
    String(valid.getUTCMonth() + 1).padStart(2, "0"),
    String(valid.getUTCDate()).padStart(2, "0"),
    "-",
    String(valid.getUTCHours()).padStart(2, "0"),
    String(valid.getUTCMinutes()).padStart(2, "0"),
    String(valid.getUTCSeconds()).padStart(2, "0")
  ].join("");
}

function encodeMetadataValue(value, datatype) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (datatype === XSD_INTEGER) return Number.isFinite(Number(text)) ? Number(text) : text;
  if (datatype === RDFS_CLASS) return { "@id": text };
  if (!datatype || datatype === XSD_STRING) return text;
  return { "@value": text, "@type": datatype };
}

function noteToHtml(note) {
  const escaped = String(note || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function buildTropyJson(session) {
  const template = getTemplate(session);
  const fileMap = exportFileMap(session);
  const graph = session.items
    .filter((item) => item.pages.length > 0)
    .map((item) => {
      const output = {
        "@type": "Item",
        template: item.templateId || template.id
      };

      const itemTemplate = getTemplates(session).find((candidate) => candidate.id === output.template) || template;
      for (const metadataField of itemTemplate.fields) {
        const value = item.metadata?.[metadataField.property] ?? metadataField.value;
        const encoded = encodeMetadataValue(value, metadataField.datatype);
        if (encoded !== null) output[metadataField.property] = encoded;
      }

      const tags = (item.tags || []).map((tag) => String(tag).trim()).filter(Boolean);
      if (tags.length) output.tag = tags;
      if (String(item.listPath || "").trim()) output.list = [String(item.listPath).trim()];

      output.photo = item.pages.map((page, pageIndex) => {
        const relativePath = fileMap.get(page.id);
        const filename = relativePath.split("/").pop();
        const photo = {
          "@type": "Photo",
          template: "https://tropy.org/v1/templates/photo",
          [URIS.title]: filename,
          protocol: "file",
          path: `images/${relativePath}`,
          filename,
          mimetype: page.mime || "application/octet-stream",
          size: page.size || 0,
          checksum: page.checksum || `tropy-capture-${page.id}`,
          density: page.density || 72
        };
        if (page.width) photo.width = page.width;
        if (page.height) photo.height = page.height;
        if (page.mime === "application/pdf") photo.page = 0;
        if (pageIndex === 0 && String(item.note || "").trim()) {
          photo.note = [{
            "@type": "Note",
            text: String(item.note).trim(),
            html: noteToHtml(item.note)
          }];
        }
        return photo;
      });

      return output;
    });

  return {
    "@context": TROPY_CONTEXT,
    "@graph": graph
  };
}

export function validateSession(session, locale = "en") {
  const t = (message, parameters) => translate(locale, message, parameters);
  const warnings = [];
  const errors = [];
  const exportableItems = session.items.filter((item) => item.pages.length > 0);
  if (!exportableItems.length) errors.push(t("Add at least one image before exporting."));
  const emptyItems = session.items.length - exportableItems.length;
  if (emptyItems === 1) warnings.push(t("One empty item will be ignored."));
  if (emptyItems > 1) warnings.push(t("{count} empty items will be ignored.", { count: emptyItems }));

  for (const item of exportableItems) {
    const template = getTemplates(session).find((candidate) => candidate.id === item.templateId) || getTemplate(session);
    const missing = template.fields.filter((entry) => {
      const value = item.metadata?.[entry.property] ?? entry.value ?? "";
      return entry.isRequired && !String(value).trim();
    });
    if (missing.length) {
      const title = item.metadata?.[URIS.title] || t("Item {number}", { number: item.sequence });
      const fields = missing.map((entry) => t(entry.label)).join(", ");
      warnings.push(t("{title}: missing {fields}.", { title, fields }));
    }
  }

  const bytes = exportableItems
    .flatMap((item) => item.pages)
    .reduce((total, page) => total + (page.size || 0), 0);
  if (bytes > 1.5 * 1024 ** 3) {
    warnings.push(t("The package is larger than 1.5 GB. Exporting directly to a folder is recommended."));
  }

  return {
    errors,
    warnings,
    itemCount: exportableItems.length,
    pageCount: exportableItems.reduce((total, item) => total + item.pages.length, 0),
    bytes
  };
}

export function buildCaptureBackup(session) {
  const fileMap = exportFileMap(session);
  return {
    format: "tropy-capture-session",
    version: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    session: {
      ...session,
      items: session.items.map((item) => ({
        ...item,
        pages: item.pages.map((page) => ({
          ...page,
          exportName: fileMap.get(page.id)
        }))
      }))
    }
  };
}

export function buildManifest(session) {
  const fileMap = exportFileMap(session);
  return {
    format: "tropy-capture-package",
    version: 1,
    generator: `Tropy Capture ${APP_VERSION}`,
    exportedAt: new Date().toISOString(),
    session: session.name,
    template: getTemplate(session).name,
    items: session.items.filter((item) => item.pages.length).map((item) => ({
      sequence: item.sequence,
      title: item.metadata?.[URIS.title] || "",
      identifier: item.metadata?.[URIS.identifier] || "",
      images: item.pages.map((page) => fileMap.get(page.id))
    }))
  };
}

export function buildPackageReadme(session, locale = "en") {
  const template = getTemplate(session);
  const t = (message, parameters) => translate(locale, message, parameters);
  const lines = [
    t("TROPY CAPTURE — IMPORT INSTRUCTIONS"),
    "============================================",
    "", `${t("Session")}: ${session.name}`,
    `${t("Exported")}: ${new Date().toLocaleString(localeTag(locale))}`, "",
    t("IMPORTANT"),
    t("Move the entire extracted folder to its final location BEFORE importing it."),
    t("Tropy links images at their current location; it does not make a second copy."),
    "", t("PROCEDURE")
  ];

  let step = 1;
  if (!template.builtin) {
    lines.push(`${step}. ${t("In Tropy, open the template editor and import the .ttp file from the templates folder.")}`);
    step += 1;
  }
  lines.push(`${step}. ${t("Open Tropy and the destination project.")}`);
  step += 1;
  lines.push(`${step}. ${t("To recreate lists, enable Recreate lists in Tropy’s import preferences.")}`);
  step += 1;
  lines.push(`${step}. ${t("Use File > Import Photos (or drag a file into the project).")}`);
  step += 1;
  lines.push(`${step}. ${t("Select only tropy.jsonld. Images and metadata will be imported together.")}`);
  step += 1;
  lines.push(`${step}. ${t("Keep the images folder in the same location after importing.")}`);
  lines.push(
    "", t("PACKAGE CONTENTS"),
    `- ${t("tropy.jsonld: data to import into Tropy")}`,
    `- ${t("images/: original images")}`,
    `- ${t("capture-session.json: backup that can be reopened in Tropy Capture")}`,
    `- ${t("manifest.json: summary for other tools")}`,
    `- ${t("templates/: optional custom Tropy template")}`,
    "", t("Tropy Capture is an independent project. No files were uploaded to a server.")
  );
  return lines.join("\n");
}
