import { monthAbbreviation, monthNumber } from "./i18n.js";

function daysInMonth(month, year = 2000) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validParts({ day, month, year }) {
  if (year !== undefined && (!Number.isInteger(year) || year < 1 || year > 9999)) return false;
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) return false;
  if (day !== undefined) {
    if (!Number.isInteger(day) || day < 1) return false;
    if (month !== undefined && day > daysInMonth(month, year || 2000)) return false;
    if (month === undefined && day > 31) return false;
  }
  return true;
}

function result(parts) {
  if (!validParts(parts)) return null;
  const recognized = [];
  const display = [];
  if (parts.day !== undefined) {
    recognized.push("d");
    display.push(String(parts.day).padStart(2, "0"));
  }
  if (parts.month !== undefined) {
    recognized.push("m");
    display.push(String(parts.month).padStart(2, "0"));
  }
  if (parts.year !== undefined) {
    recognized.push("y");
    display.push(String(parts.year).padStart(4, "0"));
  }
  return { ...parts, parts: recognized, display: display.join("/") };
}

/**
 * Recognize common archival date forms without changing the stored value.
 * Numeric input ending in a four-digit year is read as day/month/year;
 * numeric input beginning with a four-digit year is read as ISO year/month/day.
 */
export function recognizeDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  let match = raw.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
  if (match) {
    return result({
      year: Number(match[1]),
      ...(match[2] ? { month: Number(match[2]) } : {}),
      ...(match[3] ? { day: Number(match[3]) } : {})
    });
  }

  match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) return result({ day: Number(match[1]), month: Number(match[2]), year: Number(match[3]) });

  match = raw.match(/^(\d{1,2})[./-](\d{4})$/);
  if (match) return result({ month: Number(match[1]), year: Number(match[2]) });

  match = raw.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (match) return result({ day: Number(match[1]), month: Number(match[2]) });

  const word = "([A-Za-zÀ-ÖØ-öø-ÿ.]+)";
  match = raw.match(new RegExp(`^(\\d{1,2})\\s+${word}\\s+(\\d{4})$`, "i"));
  if (match) {
    const month = monthNumber(match[2]);
    return month ? result({ day: Number(match[1]), month, year: Number(match[3]) }) : null;
  }

  match = raw.match(new RegExp(`^${word}\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i"));
  if (match) {
    const month = monthNumber(match[1]);
    return month ? result({ day: Number(match[2]), month, year: Number(match[3]) }) : null;
  }

  match = raw.match(new RegExp(`^${word}\\s+(\\d{4})$`, "i"));
  if (match) {
    const month = monthNumber(match[1]);
    return month ? result({ month, year: Number(match[2]) }) : null;
  }

  match = raw.match(new RegExp(`^(\\d{4})\\s+${word}$`, "i"));
  if (match) {
    const month = monthNumber(match[2]);
    return month ? result({ month, year: Number(match[1]) }) : null;
  }

  return null;
}

function localizedDisplay(recognized, locale) {
  const parts = [];
  if (recognized.day !== undefined) parts.push(String(recognized.day).padStart(2, "0"));
  if (recognized.month !== undefined) parts.push(monthAbbreviation(recognized.month, locale));
  if (recognized.year !== undefined) parts.push(String(recognized.year).padStart(4, "0"));
  return parts.join(" ");
}

export function datePresentation(value, enabled = true, locale = "en") {
  const raw = String(value ?? "");
  if (!enabled) return { raw, display: raw, parts: [] };
  const recognized = recognizeDate(raw);
  return recognized
    ? { raw, display: localizedDisplay(recognized, locale), parts: recognized.parts }
    : { raw, display: raw, parts: [] };
}
