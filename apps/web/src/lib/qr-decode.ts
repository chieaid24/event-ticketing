import jsQR from "jsqr";

export interface QrFrame {
  data: Uint8ClampedArray;
  height: number;
  width: number;
}

// decode without retaining the live bearer
export function decodeQrFrame(frame: QrFrame): string | null {
  const result = jsQR(frame.data, frame.width, frame.height, {
    inversionAttempts: "dontInvert",
  });
  const payload = result?.data.trim();
  return payload ? payload : null;
}
