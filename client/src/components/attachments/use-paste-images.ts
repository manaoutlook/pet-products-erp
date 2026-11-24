import { useEffect, useRef } from "react";
import { imageFilesFromClipboard, imageFilesFromClipboardItems } from "./clipboard-images";

/**
 * Shown when the browser has no Async Clipboard API at all (or refuses to expose it - it is
 * restricted to secure contexts, so a plain-http LAN address does not get it).
 */
export const CLIPBOARD_UNSUPPORTED =
  "This browser will not let the page read the clipboard. Copy the screenshot and press ⌘V (Ctrl+V) with the window focused.";

/**
 * Why a Paste click produced nothing, when the reason is the clipboard rather than the file rules.
 */
export const CLIPBOARD_EMPTY =
  "There is no picture on the clipboard. Take a screenshot first (⌘⇧⌃4 on a Mac, Win+Shift+S on Windows), then press Paste again.";

export const CLIPBOARD_REFUSED =
  "The browser blocked clipboard access. Allow it in the address bar, or copy the screenshot and press ⌘V (Ctrl+V) instead.";

/**
 * Read the clipboard on demand - the "Paste" button next to "Add pictures".
 *
 * `Cmd+V` (`usePasteImages` below) is the fast path, but it is invisible: nothing on screen says
 * it exists, and it does nothing at all when the focus sits somewhere that eats the keystroke.
 * This is the same handler behind a button, so the feature can be found by looking.
 *
 * Never throws: every failure is a message for the picker's error line.
 */
export async function readClipboardImages(): Promise<{ files: File[]; error: string | null }> {
  if (typeof navigator === "undefined" || typeof navigator.clipboard?.read !== "function") {
    return { files: [], error: CLIPBOARD_UNSUPPORTED };
  }

  try {
    const files = await imageFilesFromClipboardItems(await navigator.clipboard.read());
    return { files, error: files.length > 0 ? null : CLIPBOARD_EMPTY };
  } catch {
    // NotAllowedError (permission dismissed) or a browser that answers `read()` with an error
    // whenever the tab is not focused. The Cmd+V route still works, so say so.
    return { files: [], error: CLIPBOARD_REFUSED };
  }
}

/**
 * Attach whatever picture is pasted while this component is mounted.
 *
 * The listener sits on `document`, not on the picker's own element, because `Cmd+V` only fires
 * where the focus is: the user may have just typed the order notes, or be sitting on the dialog's
 * close button, and the picture still has to land in the picker.
 *
 * AI Agent Note - a paste that carries no picture is left completely alone (`preventDefault` is
 * only called once at least one image was found), so copying a supplier name into the notes field
 * keeps working. The callback is held in a ref so re-renders do not tear down and re-add the
 * listener on every keystroke.
 */
export function usePasteImages(onImages: (files: File[]) => void, enabled = true) {
  const latest = useRef(onImages);

  useEffect(() => {
    latest.current = onImages;
  }, [onImages]);

  useEffect(() => {
    if (!enabled) return;

    const handlePaste = (event: ClipboardEvent) => {
      // Another handler already consumed this paste - do not steal it.
      if (event.defaultPrevented) return;

      const files = imageFilesFromClipboard(event.clipboardData);
      if (files.length === 0) return;

      event.preventDefault();
      latest.current(files);
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [enabled]);
}
