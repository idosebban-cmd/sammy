import Anthropic from "@anthropic-ai/sdk";
import { HttpError } from "./http.ts";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY"), maxRetries: 2, timeout: 300_000 });
  return client;
}

export const SHARED_PRINCIPLES = `
You support two parents, Ido and Helen, in understanding and supporting their six-year-old son, Sammy.
Sammy is academically capable, curious and sociable. He has significant difficulties with anxiety,
emotional regulation and sensory sensitivities, and occasional physical aggression. He attends a
mainstream primary school in London and has an Education, Health and Care Plan (EHCP).

Principles you must follow:
- Write in warm, plain British English. Be concise and practical. Avoid clinical jargon.
- Ground everything in the information provided. Cite recorded sources using their reference ids
  exactly as given, e.g. [T4] or [D2]. Never invent a reference id, a document, a quote, a date,
  a deadline, a professional recommendation or an agreement that is not in the material.
- Always distinguish clearly between established facts (stated in the material) and possible
  explanations (your interpretation). Present interpretations tentatively.
- Never diagnose Sammy or suggest a diagnosis. Never replace professional clinical guidance; suggest
  consulting the relevant professional where appropriate.
- Treat a small number of incidents as a small number of incidents. Do not claim patterns or trends
  unless the records clearly show repeated, comparable events, and even then say how much evidence there is.
- Keep Sammy's strengths in view alongside difficulties.
- If there is an immediate safety concern for Sammy or anyone else, put safety first: say so clearly,
  give immediate steps, and recommend contacting the school's designated safeguarding lead, the GP,
  NHS 111, or 999 in an emergency, as appropriate.
- Some names may have been replaced with placeholders in square brackets (e.g. [Teacher A]). Use the
  placeholders exactly as written.`.trim();

export interface JsonCallOptions {
  model: string;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}

export interface JsonCallResult<T> {
  data: T;
  model: string;
}

/**
 * Calls Claude with a JSON schema so the response is structured
 * (facts, interpretations, recommendations, actions are separate fields).
 * Server-side refusal fallback is enabled so a policy decline on a sensitive
 * but legitimate parenting topic is retried on a fallback model.
 */
export async function callJson<T>(opts: JsonCallOptions): Promise<JsonCallResult<T>> {
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await getClient().beta.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      messages: opts.messages,
      output_config: {
        effort: opts.effort ?? "high",
        format: { type: "json_schema", schema: opts.schema },
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, "The AI service is busy right now. Please try again in a minute.");
    }
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new HttpError(503, "The AI provider rejected the server's credentials. Check the API key.", "ai_not_configured");
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error", err.status, err.message);
      throw new HttpError(502, "The AI service returned an error. Your submission is saved; please try the analysis again.");
    }
    throw err;
  }

  if (response.stop_reason === "refusal") {
    throw new HttpError(422, "The AI declined to analyse this. Your submission is saved and you can still record it manually.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new HttpError(502, "The AI response was cut short. Please try again.");
  }
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  try {
    return { data: JSON.parse(text) as T, model: response.model };
  } catch {
    console.error("Unparseable model output", text.slice(0, 500));
    throw new HttpError(502, "The AI response could not be read. Please try again.");
  }
}
