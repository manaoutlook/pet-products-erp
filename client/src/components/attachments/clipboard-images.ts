/**
 * Pictures that arrive from the clipboard instead of the file dialog.
 *
 * The paperwork this feature exists for is usually already a picture on the machine: a screenshot
 * of the bank transfer, a photo taken on the phone and copied over. Uploading those means saving
 * the screenshot to disk first and then finding it in the file dialog - two steps that users skip,
 * so they attach nothing. `Cmd+V` / `Ctrl+V` inside the dialog removes that friction: the picture
 * goes straight from the clipboard into the same validation-and-cap path as a picked file.
 *
 * This module is deliberately free of React and of `ClipboardEvent` so the parsing can be tested
 * without a DOM (`tests/frontend/utils/clipboard-images.test.ts` runs in the node environment).
 */

/** The part of `DataTransferItem` the parser needs. */
export interface ClipboardItemLike {
  kind: string;
  type: string;
  getAsFile: () => File | null;
}

/** The part of `ClipboardEvent.clipboardData` / `DataTransfer` the parser needs. */
export interface ClipboardPayloadLike {
  items?: ArrayLike<ClipboardItemLike> | null;
  files?: ArrayLike<File> | null;
}

/** Extension for a pasted picture, so the stored file name on disk is recognisable. */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

let pasteCounter = 0;

/**
 * Screenshots usually arrive with no name at all (`File.name === ""`), and the database column is
 * `NOT NULL`. Give those a name that says where they came from instead of rejecting them.
 */
function namedPastedFile(file: File): File {
  if (file.name.trim().length > 0) return file;

  pasteCounter += 1;
  const extension = EXTENSIONS[file.type.toLowerCase()] ?? "png";
  return new File([file], `pasted-${Date.now()}-${pasteCounter}.${extension}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
}

function isPicture(file: File): boolean {
  return file.type.toLowerCase().startsWith("image/");
}

/**
 * Every picture on the clipboard, in the order the browser reports it.
 *
 * Non-picture items (text, HTML, a copied PDF) are ignored, so a normal text paste into a form
 * field is never intercepted. `items` is preferred because it keeps the clipboard order; browsers
 * that only populate `files` (some Linux/GTK builds) are handled as a fallback.
 */
export function imageFilesFromClipboard(
  payload: ClipboardPayloadLike | null | undefined
): File[] {
  if (!payload) return [];

  const fromItems: File[] = [];
  const items = payload.items;

  if (items) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      // `kind` is 'file' | 'string'; the type is the MIME type ('image/png', 'text/plain', ...).
      if (!item || item.kind !== "file") continue;
      if (!item.type.toLowerCase().startsWith("image/")) continue;

      const file = item.getAsFile();
      if (file) fromItems.push(file);
    }
  }

  if (fromItems.length > 0) return fromItems.map(namedPastedFile);

  const files = payload.files ? Array.from(payload.files) : [];
  return files.filter(isPicture).map(namedPastedFile);
}
