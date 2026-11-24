// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  imageFilesFromClipboard,
  type ClipboardItemLike,
} from "@/components/attachments/clipboard-images";

/**
 * Clipboard parsing for "paste a picture" on a transaction.
 *
 * Runs in the node environment on purpose: the parser must not depend on a DOM so the awkward part
 * of the feature (what a browser actually hands over) can be tested directly, without rendering a
 * dialog or faking a real `ClipboardEvent`.
 */

/** A `DataTransferItem` stand-in; `getAsFile` returns whatever the browser put on the clipboard. */
const item = (type: string, file: File | null, kind = "file"): ClipboardItemLike => ({
  kind,
  type,
  getAsFile: () => file,
});

const image = (name = "screenshot.png", type = "image/png") =>
  new File(["binary"], name, { type });

describe("imageFilesFromClipboard", () => {
  it("returns the pictures on the clipboard", () => {
    const screenshot = image();

    const files = imageFilesFromClipboard({ items: [item("image/png", screenshot)] });

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("screenshot.png");
    expect(files[0].type).toBe("image/png");
  });

  it("keeps the order and the pictures when several are copied at once", () => {
    const files = imageFilesFromClipboard({
      items: [
        item("image/png", image("first.png")),
        item("image/jpeg", image("second.jpg", "image/jpeg")),
      ],
    });

    expect(files.map((file) => file.name)).toEqual(["first.png", "second.jpg"]);
  });

  it("ignores text, HTML and other non-picture items", () => {
    const files = imageFilesFromClipboard({
      items: [
        { kind: "string", type: "text/plain", getAsFile: () => null },
        { kind: "string", type: "text/html", getAsFile: () => null },
        item("application/pdf", new File(["pdf"], "invoice.pdf", { type: "application/pdf" })),
      ],
    });

    expect(files).toEqual([]);
  });

  it("falls back to `files` when the browser exposes no items", () => {
    // Some Linux/GTK builds only populate `files`.
    const files = imageFilesFromClipboard({
      files: [image("note.png"), new File(["x"], "notes.txt", { type: "text/plain" })],
    });

    expect(files.map((file) => file.name)).toEqual(["note.png"]);
  });

  it("names a nameless screenshot instead of handing the API an empty file name", () => {
    // macOS/Windows clipboard images arrive with `name === ""`; the column is NOT NULL.
    const files = imageFilesFromClipboard({ items: [item("image/png", image(""))] });

    expect(files).toHaveLength(1);
    expect(files[0].name).toMatch(/^pasted-\d+-\d+\.png$/);
  });

  it("gives each pasted batch a different name", () => {
    const first = imageFilesFromClipboard({ items: [item("image/png", image(""))] });
    const second = imageFilesFromClipboard({ items: [item("image/png", image(""))] });

    expect(first[0].name).not.toBe(second[0].name);
  });

  it("returns nothing for an empty or missing clipboard", () => {
    expect(imageFilesFromClipboard(null)).toEqual([]);
    expect(imageFilesFromClipboard(undefined)).toEqual([]);
    expect(imageFilesFromClipboard({})).toEqual([]);
    expect(imageFilesFromClipboard({ items: [] })).toEqual([]);
  });
});
