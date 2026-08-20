import QRCode from "qrcode";
import { describe, expect, it } from "vitest";

import { decodeQrFrame, type QrFrame } from "./qr-decode";

// rasterize a camera-like frame with quiet zone
function frameFor(payload: string): QrFrame {
  const code = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const moduleSize = 8;
  const quietModules = 4;
  const size = (code.modules.size + quietModules * 2) * moduleSize;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let row = 0; row < code.modules.size; row += 1) {
    for (let column = 0; column < code.modules.size; column += 1) {
      if (!code.modules.get(row, column)) {
        continue;
      }
      const top = (row + quietModules) * moduleSize;
      const left = (column + quietModules) * moduleSize;
      for (let y = top; y < top + moduleSize; y += 1) {
        for (let x = left; x < left + moduleSize; x += 1) {
          const offset = (y * size + x) * 4;
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
        }
      }
    }
  }
  return { data, height: size, width: size };
}

describe("decodeQrFrame", () => {
  it("round-trips a bearer through the same encoder the ticket page uses", () => {
    const payload = "a".repeat(43);
    expect(decodeQrFrame(frameFor(payload))).toBe(payload);
  });

  it("returns null for a frame without a code", () => {
    const size = 64;
    expect(
      decodeQrFrame({
        data: new Uint8ClampedArray(size * size * 4).fill(255),
        height: size,
        width: size,
      })
    ).toBeNull();
  });
});
