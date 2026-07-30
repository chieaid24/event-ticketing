import jsQR from "jsqr";

export interface QrFrame {
  data: Uint8ClampedArray;
  height: number;
  width: number;
}

/**
 * Decodes one camera frame's pixel data to the QR payload, or null when the
 * frame holds no readable code. Pure so the decode path is testable without a
 * camera. The returned payload is a live admission bearer: pass it on and
 * drop it, never store or log it.
 */
export function decodeQrFrame(frame: QrFrame): string | null {
  const result = jsQR(frame.data, frame.width, frame.height, {
    inversionAttempts: "dontInvert",
  });
  const payload = result?.data.trim();
  return payload ? payload : null;
}
