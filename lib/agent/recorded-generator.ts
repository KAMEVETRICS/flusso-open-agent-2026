import type { Generator } from "./reasoning-agent";
import type { Tracer } from "./trace";

// Model replies recorded from a live run, keyed by reasoning step ("plan", "decide", "revise"),
// with the model that produced each one. Sample mode replays them, and the replayed output is
// still parsed by the step's schema and checked by the verifier.
export type ModelRecording = { provider: string; steps: Record<string, Array<{ model: string; output: unknown }>> };

export function recordingGenerator(inner: Generator, recording: ModelRecording, provider: string): Generator {
  recording.provider = provider;
  recording.steps ??= {};
  return async (request) => {
    const result = await inner(request);
    (recording.steps[request.step] ??= []).push({ model: result.model, output: result.output });
    return result;
  };
}

export function replayGenerator(recording: ModelRecording, tracer: Tracer): Generator {
  const used = new Map<string, number>();
  return async (request) => {
    const index = used.get(request.step) ?? 0;
    const stored = recording.steps[request.step]?.[index];
    if (!stored) throw new Error("Sample mode has no recorded model reply for step " + request.step + " (call " + (index + 1) + ").");
    used.set(request.step, index + 1);
    const output = request.schema.parse(stored.output);
    tracer.write("telemetry", "model", "request", { step: request.step, provider: "sample", answeredBy: stored.model, nemotron: /nemotron/i.test(stored.model), replayed: true });
    return { output, model: stored.model };
  };
}
