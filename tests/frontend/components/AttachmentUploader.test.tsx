import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { PendingAttachmentPicker } from "@/components/attachments/AttachmentUploader";
import { MAX_ATTACHMENTS_PER_ENTITY } from "@shared/attachments";

/**
 * The create-mode picker. A transaction has no id while it is being typed, so the files are held
 * in memory and staged for the POST that follows (`uploadAttachmentFiles`). These tests cover what
 * the user can do before anything is saved: add, reject, remove, and the ten-picture ceiling that
 * sits above the five the business asked for.
 *
 * The stored side (`AttachmentUploader`) is not exercised here because it loads from the API; the
 * server rules it depends on are pinned in tests/backend/attachments.test.ts.
 */

// Object URLs are how a File is previewed before upload; jsdom does not implement them.
beforeAll(() => {
  if (typeof URL.createObjectURL !== "function") {
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:preview"),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true });
  }
});

const makeFile = (name = "receipt.png", type = "image/png") =>
  new File(["binary"], name, { type });

function Harness({ initial = [] }: { initial?: File[] }) {
  const [files, setFiles] = useState<File[]>(initial);

  return (
    <>
      <PendingAttachmentPicker files={files} onFilesChange={setFiles} />
      <p data-testid="count">{files.length}</p>
    </>
  );
}

const fileInput = (container: HTMLElement) =>
  container.querySelector('input[type="file"]') as HTMLInputElement;

/**
 * Stand-in for `navigator.clipboard.read()`, which jsdom does not implement. Each entry is one
 * `ClipboardItem`: the types it offers and the blob for a given type.
 */
const stubClipboard = (blobs: Array<{ type: string; types?: string[] }>) => {
  const read = vi.fn(async () =>
    blobs.map(({ type, types }) => ({
      types: types ?? [type],
      getType: async (requested: string) =>
        new Blob(["binary"], { type: requested === type ? type : "application/octet-stream" }),
    }))
  );

  Object.defineProperty(navigator, "clipboard", { value: { read }, configurable: true });
  return read;
};

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
});

describe("PendingAttachmentPicker", () => {
  it("stages a picked picture and shows it", () => {
    const { container } = render(<Harness />);

    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } });

    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByAltText("receipt.png")).toBeInTheDocument();
  });

  it("refuses a file that is not a picture", () => {
    const { container } = render(<Harness />);

    fireEvent.change(fileInput(container), {
      target: { files: [new File(["binary"], "invoice.pdf", { type: "application/pdf" })] },
    });

    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByText(/is not a picture/i)).toBeInTheDocument();
  });

  it("removes a staged picture again", () => {
    const { container } = render(<Harness />);

    fireEvent.change(fileInput(container), { target: { files: [makeFile()] } });
    expect(screen.getByTestId("count").textContent).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: /remove receipt\.png/i }));

    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.queryByAltText("receipt.png")).not.toBeInTheDocument();
  });

  it("stops at the per-transaction ceiling", () => {
    const full = Array.from({ length: MAX_ATTACHMENTS_PER_ENTITY }, (_, index) =>
      makeFile(`receipt-${index}.png`)
    );

    render(<Harness initial={full} />);

    // Ten pictures is above the five the business asked for, and the button closes the door.
    expect(screen.getByTestId("count").textContent).toBe(String(MAX_ATTACHMENTS_PER_ENTITY));
    expect(
      screen.getByText(`(${MAX_ATTACHMENTS_PER_ENTITY}/${MAX_ATTACHMENTS_PER_ENTITY})`)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add pictures/i })).toBeDisabled();
  });

  it("stages a picture pasted from the clipboard", () => {
    render(<Harness />);

    fireEvent.paste(document, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => makeFile("pasted.png") }],
        files: [],
      },
    });

    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByAltText("pasted.png")).toBeInTheDocument();
    expect(screen.getByText(/press ⌘V \(Ctrl\+V\) here/i)).toBeInTheDocument();
  });

  it("leaves a text-only paste to the browser", () => {
    render(<Harness />);

    // `true` means the event was not prevented, so copying text into a form field still works.
    const dispatched = fireEvent.paste(document, {
      clipboardData: {
        items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
        files: [],
      },
    });

    expect(dispatched).toBe(true);
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("holds a pasted picture to the same ceiling as a picked one", () => {
    const full = Array.from({ length: MAX_ATTACHMENTS_PER_ENTITY }, (_, index) =>
      makeFile(`receipt-${index}.png`)
    );

    render(<Harness initial={full} />);

    fireEvent.paste(document, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => makeFile("late.png") }],
        files: [],
      },
    });

    expect(screen.getByTestId("count").textContent).toBe(String(MAX_ATTACHMENTS_PER_ENTITY));
    expect(screen.getByText(/remove one to choose another/i)).toBeInTheDocument();
  });

  it("stages the picture behind the Paste screenshot button", async () => {
    const read = stubClipboard([{ type: "image/png" }]);

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /paste screenshot/i }));

    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("1"));
    expect(read).toHaveBeenCalledTimes(1);
    // The clipboard image has no name of its own, so it is named after where it came from.
    expect(screen.getByAltText(/^pasted-\d+-\d+\.png$/)).toBeInTheDocument();
  });

  it("says so when the clipboard holds no picture", async () => {
    stubClipboard([]);

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /paste screenshot/i }));

    expect(await screen.findByText(/no picture on the clipboard/i)).toBeInTheDocument();
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("points at Cmd+V when the browser refuses to open the clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { read: vi.fn(async () => Promise.reject(new Error("NotAllowedError"))) },
      configurable: true,
    });

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /paste screenshot/i }));

    expect(await screen.findByText(/will not let the page read the clipboard|blocked clipboard access/i)).toBeInTheDocument();
  });

  it("stages a clipboard picture from the Paste button under the same ceiling", async () => {
    stubClipboard([{ type: "image/png" }]);
    const full = Array.from({ length: MAX_ATTACHMENTS_PER_ENTITY }, (_, index) =>
      makeFile(`receipt-${index}.png`)
    );

    render(<Harness initial={full} />);

    // At the cap both buttons are closed, so nothing can be pasted past the limit.
    expect(screen.getByRole("button", { name: /paste screenshot/i })).toBeDisabled();
    expect(screen.getByTestId("count").textContent).toBe(String(MAX_ATTACHMENTS_PER_ENTITY));
  });
});
