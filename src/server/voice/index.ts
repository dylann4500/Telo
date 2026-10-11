import { config } from "../config";
import { DialVoice } from "./dial";
import { MockVoice } from "./mock";
import type { VoiceProvider } from "./provider";

// Module-level so code edits apply on hot reload; the mock keeps its live
// call state on globalThis separately.
let instance: VoiceProvider | undefined;

export function getVoice(): VoiceProvider {
  if (instance) return instance;
  instance = config.voice.provider === "dial" ? new DialVoice() : new MockVoice();
  return instance;
}

/** For tests. */
export function setVoiceForTests(voice: VoiceProvider | undefined) {
  instance = voice;
}
