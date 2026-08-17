"use client";

/**
 * Trigger a file download from a string.
 *
 * iOS Safari does not honour the `download` attribute on a blob URL the way
 * desktop browsers do — it opens the content in a tab instead. That is still a
 * usable path (share sheet → Save to Files), so this stays a plain anchor click
 * rather than something cleverer that breaks elsewhere.
 */
export function downloadFile(
  contents: string,
  filename: string,
  mimeType: string,
) {
  const blob = new Blob([contents], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next frame; revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
