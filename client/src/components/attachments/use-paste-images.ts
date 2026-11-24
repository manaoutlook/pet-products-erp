import { useEffect, useRef } from "react";
import { imageFilesFromClipboard } from "./clipboard-images";

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
