import { config } from "../config";
import type { VoiceProvider } from "./provider";

// Module-level so code edits apply on hot reload; the mock keeps its live
// call state on globalThis separately.
let instance: VoiceProvider | undefined;

export function getVoice(): VoiceProvider {
  if (instance) return instance;
  if (config.voice.provider === "dial") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DialVoice } = require("./dial") as typeof import("./dial");
    instance = new DialVoice();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MockVoice } = require("./mock") as typeof import("./mock");
    instance = new MockVoice();
  }
  return instance;
}

/** For tests. */
export function setVoiceForTests(voice: VoiceProvider | undefined) {
  instance = voice;
}
