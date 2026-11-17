import Anthropic from "@anthropic-ai/sdk";
import { HttpError } from "./http.ts";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // maxRetries: the SDK retries connection errors, 408/409/429 and 5xx with
  // backoff. Safety refusals are never retried or rerouted to another model.
  client ??= new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY"), maxRetries: 2, timeout: 300_000 });
  return client;
}

export const SHARED_PRINCIPLES = `
You support two parents, Ido and Helen, in understanding and supporting their six-year-old son, Sammy.
Sammy is academically capable, curious and sociable. He has significant difficulties with anxiety,
emotional regulation and sensory sensitivities, and occasional physical aggression. He attends a
mainstream primary school in London and has an Education, Health and Care Plan (EHCP).

You know Sammy through his record, which is provided with every request. Use it. Advice that could
apply to any child is far less useful than advice that builds on what is known about Sammy: his
strengths and interests, known triggers and early signs, strategies recorded as helpful or unhelpful,
interventions under way and what has been observed since, professional recommendations, school
arrangements, and upcoming reviews and commitments.

Principles you must follow:
- Write in warm, plain British English. Be concise and practical: short sentences, no padding.
- Ground everything in the record. Cite the items you rely on using their reference ids exactly as
  given, e.g. [T4] or [D2]. Never invent a reference id, a document, a quote, a date, a deadline,
  a professional recommendation or an agreement that is not in the material.
- Distinguish clearly between documented facts and possible explanations. Present interpretations
  tentatively ("may", "one possibility").
- Do not assume a cause from co-occurrence. One incident, or a few, is not a pattern, and one difficult
  day does not show that an intervention has failed (nor one good day that it works). Say how much
  evidence there is.
- For EHCPs and professional documents, distinguish confirmed provision (in a final plan or agreed),
  proposed changes (draft or under discussion) and reported implementation (what someone says is
  happening). If a document you would need is not in the library, or its text is not readable, say so.
- Never diagnose Sammy or suggest a diagnosis. Never replace professional clinical guidance; suggest
  the relevant professional where appropriate.
- Keep Sammy's strengths and positive developments as visible as difficulties.
- If there is an immediate safety concern for Sammy or anyone else, put safety first: say so clearly,
  give immediate steps, and recommend contacting the school's designated safeguarding lead, the GP,
  NHS 111, or 999 in an emergency, as appropriate.
- Some names may have been replaced with placeholders in square brackets (e.g. [Teacher A]). Use the
  placeholders exactly as written.`.trim();

export interface JsonCallOptions {
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}

export interface JsonCallResult<T> {
  data: T;
  model: string;
}

export const REFUSAL_MESSAGE =
  "The AI declined to respond to this. Nothing was changed and your record is saved. " +
  "You can still record it yourself, or rephrase and try again.";

/**
 * Calls Claude with a JSON schema so the response is structured.
 * Streaming is used so long responses don't hit HTTP timeouts.
 * One extra attempt is made if the response is cut short or unreadable;
 * a safety refusal is surfaced to the parent and never retried.
 */
export async function callJson<T>(opts: JsonCallOptions): Promise<JsonCallResult<T>> {
  for (let attempt = 1; ; attempt++) {
    let response: Anthropic.Message;
    try {
      response = await getClient().messages.stream({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 32000,
        system: opts.system,
        messages: opts.messages,
        output_config: {
          effort: opts.effort ?? "high",
          format: { type: "json_schema", schema: opts.schema },
        },
      }).finalMessage();
    } catch (err) {
      throw mapApiError(err);
    }

    if (response.stop_reason === "refusal") {
      console.warn("Refusal", JSON.stringify(response.stop_details ?? null));
      throw new HttpError(422, REFUSAL_MESSAGE, "ai_refusal");
    }
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (response.stop_reason !== "max_tokens") {
      try {
        return { data: JSON.parse(text) as T, model: response.model };
      } catch {
        console.error("Unparseable model output", text.slice(0, 300));
      }
    }
    if (attempt >= 2) {
      throw new HttpError(502, response.stop_reason === "max_tokens"
        ? "The AI response was too long to finish. Please try again, or split the material into smaller parts."
        : "The AI response could not be read. Please try again.");
    }
  }
}

/** Plain text call (no schema), used for transcription. */
export async function callText(opts: Omit<JsonCallOptions, "schema">): Promise<string> {
  let response: Anthropic.Message;
  try {
    response = await getClient().messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 32000,
      system: opts.system,
      messages: opts.messages,
      output_config: { effort: opts.effort ?? "low" },
    }).finalMessage();
  } catch (err) {
    throw mapApiError(err);
  }
  if (response.stop_reason === "refusal") throw new HttpError(422, REFUSAL_MESSAGE, "ai_refusal");
  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function mapApiError(err: unknown): Error {
  if (err instanceof Anthropic.RateLimitError) {
    return new HttpError(429, "The AI service is busy right now. Please try again in a minute.");
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(503, "The AI provider rejected the server's credentials. Check the API key.", "ai_not_configured");
  }
  if (err instanceof Anthropic.BadRequestError) {
    console.error("Anthropic bad request", err.message);
    return new HttpError(502, "The AI service couldn't process this request. Your record is saved; please try again.");
  }
  if (err instanceof Anthropic.APIError) {
    console.error("Anthropic API error", err.status, err.message);
    return new HttpError(502, "The AI service is having problems. Your record is saved; please try again shortly.");
  }
  if (err instanceof HttpError) return err;
  console.error(err);
  return new HttpError(502, "Couldn't reach the AI service. Your record is saved; please try again.");
}
