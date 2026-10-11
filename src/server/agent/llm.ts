import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "../config";

export type Effort = "low" | "medium" | "high";

export interface StructuredRequest<S extends z.ZodType> {
  /** Short name used in logs, e.g. "understand-task". */
  name: string;
  system: string;
  prompt: string;
  schema: S;
  effort?: Effort;
  maxTokens?: number;
}

/**
 * Telo's only dependency on a model provider. Every call returns data that
 * has already been validated against a zod schema, so free-form model prose
 * never drives task state directly.
 */
export interface LLM {
  readonly name: "anthropic" | "mock";
  structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>>;
}

export class LLMUnavailableError extends Error {}

class AnthropicLLM implements LLM {
  readonly name = "anthropic" as const;
  private client = new Anthropic();

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    const started = Date.now();
    const response = await this.client.beta.messages.parse({
      model: config.llm.model,
      max_tokens: req.maxTokens ?? 8000,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      output_config: { format: betaZodOutputFormat(req.schema), effort: req.effort ?? "medium" },
      // If a safety classifier declines, the API retries on a fallback model
      // inside the same request instead of failing the task.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") {
      throw new Error(`${req.name}: model declined the request`);
    }
    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) {
      throw new Error(`${req.name}: model returned no parsable output (stop_reason=${response.stop_reason})`);
    }
    console.info(`[llm] ${req.name} ok in ${Date.now() - started}ms`);
    return parsed as z.infer<S>;
  }
}

// Module-level (not globalThis) so code edits take effect on hot reload.
let instance: LLM | undefined;

export function getLLM(): LLM {
  if (instance) return instance;
  if (config.llm.provider === "anthropic") {
    instance = new AnthropicLLM();
  } else {
    // Imported lazily so the heuristic stand-in never loads in a live setup.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MockLLM } = require("./mock-llm") as typeof import("./mock-llm");
    instance = new MockLLM();
  }
  return instance;
}

/** For tests: swap in a fake model. */
export function setLLMForTests(llm: LLM | undefined) {
  instance = llm;
}
