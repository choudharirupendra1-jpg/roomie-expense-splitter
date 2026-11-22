const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RECEIPT_CHARS = 200_000;

function readAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("receipt-read-failed"));
    reader.onerror = () => reject(new Error("receipt-read-failed"));
    reader.readAsDataURL(blob);
  });
}

export async function compressReceipt(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("receipt-image-only");
  if (file.size > MAX_FILE_BYTES) throw new Error("receipt-file-too-large");

  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("receipt-compression-failed");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.72, 0.6, 0.48]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) continue;
      const dataUrl = await readAsDataUrl(blob);
      if (dataUrl.length <= MAX_RECEIPT_CHARS) return dataUrl;
    }
    throw new Error("receipt-compressed-too-large");
  } finally {
    image.close();
  }
}
