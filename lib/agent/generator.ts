import type { TextProvider } from "../model-provider";
import { completeStructured, OutputTruncatedError } from "../openrouter";
import type { Generator } from "./reasoning-agent";
import type { Tracer } from "./trace";

// The live generator: one structured completion per reasoning step on the configured provider
// (Meterless Nightshift first). It records the model that actually answered, because a routing
// mode such as meterless/auto resolves to a concrete model, Nemotron or otherwise, per request.
export function providerGenerator(provider: TextProvider, tracer: Tracer): Generator {
  return async (request) => {
    const started = Date.now();
    let answered = provider.agentModel;
    let usage = { promptTokens: 0, completionTokens: 0 };
    const call = (maxTokens: number) => completeStructured(provider.client, {
      model: provider.agentModel,
      schema: request.schema,
      name: "agent_" + request.step,
      instructions: request.instructions,
      input: request.input,
      maxTokens,
      reasoningEffort: "low",
      onCompletion: (info) => {
        answered = info.model;
        usage = { promptTokens: info.promptTokens, completionTokens: info.completionTokens };
      }
    });
    try {
      const output = await call(request.maxTokens).catch((error: unknown) => {
        if (!(error instanceof OutputTruncatedError)) throw error;
        tracer.write("trace", "model", "retry", { step: request.step, reason: error.message });
        return call(error.maxTokens * 2);
      });
      tracer.write("telemetry", "model", "request", {
        step: request.step,
        provider: provider.id,
        requestedModel: provider.agentModel,
        answeredBy: answered,
        nemotron: /nemotron/i.test(answered),
        ...usage,
        durationMs: Date.now() - started
      });
      return { output, model: answered };
    } catch (error) {
      tracer.write("trace", "model", "error", {
        step: request.step,
        provider: provider.id,
        requestedModel: provider.agentModel,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  };
}
