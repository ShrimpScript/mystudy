import Anthropic from "@anthropic-ai/sdk";
import { guideJsonSchema, normalizeGuide, type Guide } from "./guide.js";
import { SYSTEM_PROMPT } from "./prompt.js";

// The one Claude call that writes a guide. Used by the Node server and, on the
// static (GitHub Pages) build, directly from the browser with the user's own key.

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type GenerateEvent =
  | { type: "stage"; stage: "reading" | "writing" | "finishing" }
  | { type: "progress"; chars: number; sections: number; flashcards: number; quiz: number };

export async function writeGuide(
  client: Anthropic,
  opts: {
    model: string;
    effort: Effort;
    blocks: Anthropic.Beta.BetaContentBlockParam[];
    instructions: string;
    signal: AbortSignal;
    onEvent: (e: GenerateEvent) => void;
  },
): Promise<Guide> {
  const stream = client.beta.messages.stream(
    {
      model: opts.model,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: opts.effort, format: { type: "json_schema", schema: guideJsonSchema } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [...opts.blocks, { type: "text", text: opts.instructions }] }],
    },
    { signal: opts.signal },
  );

  let text = "";
  let lastSent = 0;
  let started = false;
  stream.on("text", (delta) => {
    if (!started) {
      started = true;
      opts.onEvent({ type: "stage", stage: "writing" });
    }
    text += delta;
    if (text.length - lastSent > 400) {
      lastSent = text.length;
      opts.onEvent({
        type: "progress",
        chars: text.length,
        sections: count(text, '"simplified"'),
        flashcards: count(text, '"front"'),
        quiz: count(text, '"answer_index"'),
      });
    }
  });

  const message = await stream.finalMessage();
  opts.onEvent({ type: "stage", stage: "finishing" });

  if (message.stop_reason === "refusal") {
    throw new Error("Claude declined to process this material. Try different files.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("The material was too long to finish in one pass. Try uploading fewer pages at a time.");
  }
  const json = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return normalizeGuide(JSON.parse(json) as Guide);
}

/** Plain-language message for a failed call. `whose` names the key's owner in auth errors. */
export function describeError(err: unknown, whose: "server" | "your" = "server") {
  if (err instanceof Anthropic.AuthenticationError)
    return whose === "your"
      ? "Your API key was rejected. Check it at console.anthropic.com and paste it again."
      : "The server's Anthropic API key was rejected.";
  if (err instanceof Anthropic.PermissionDeniedError)
    return "This API key isn't allowed to use that model. Check your Anthropic console.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the API. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) return "Your Anthropic account is out of credit. Add credit at console.anthropic.com › Billing.";
    return `The API rejected the request: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API. Check your connection.";
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  if (err instanceof SyntaxError) return "The generated guide came back malformed. Please try again.";
  return err instanceof Error ? err.message : "Something went wrong.";
}

function count(haystack: string, needle: string) {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}
