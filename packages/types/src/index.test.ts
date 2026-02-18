import { describe, test, expect } from "bun:test";
import { HEADER_MIC_AUDIO, HEADER_TTS_AUDIO } from "./index";

describe("binary protocol constants", () => {
  test("HEADER_MIC_AUDIO is 0x01", () => {
    expect(HEADER_MIC_AUDIO).toBe(0x01);
  });

  test("HEADER_TTS_AUDIO is 0x02", () => {
    expect(HEADER_TTS_AUDIO).toBe(0x02);
  });

  test("headers are distinct values", () => {
    expect(HEADER_MIC_AUDIO).not.toBe(HEADER_TTS_AUDIO);
  });
});
