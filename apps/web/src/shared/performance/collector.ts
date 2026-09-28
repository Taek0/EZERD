export type Sample = { name: string; startMs: number; durationMs: number };
export type Measurement = ReturnType<ReturnType<typeof createCollector>['stop']>;

/** Inclusive spans; never sum nested function durations as total elapsed time. */
export function createCollector(clock: () => number = () => performance.now(), limit = 100000) {
  let active = false;
  let collectSpans = true;
  let generation = 0;
  let started = 0;
  let metadata: Record<string, unknown> = {};
  let samples: Sample[] = [];
  let dropped = 0;
  let totals = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  return {
    start(meta: Record<string, unknown>) {
      if (active) throw new Error('Measurement already running');
      generation++;
      metadata = structuredClone(meta);
      collectSpans = meta.collectSpans !== false;
      samples = [];
      dropped = 0;
      totals = new Map();
      started = clock();
      active = true;
    },
    begin(name: string) {
      if (!active || !collectSpans) return undefined;
      const epoch = generation;
      const start = clock();
      let ended = false;
      return () => {
        if (ended || !active || epoch !== generation) return;
        ended = true;
        const durationMs = Math.max(0, clock() - start);
        const total = totals.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
        total.count++;
        total.totalMs += durationMs;
        total.maxMs = Math.max(total.maxMs, durationMs);
        totals.set(name, total);
        if (samples.length < limit) samples.push({ name, startMs: start - started, durationMs });
        else dropped++;
      };
    },
    stop() {
      if (!active) throw new Error('No active measurement');
      const elapsedMs = clock() - started;
      active = false;
      const summary = [...totals].map(([name, total]) => {
        const times = samples
          .filter((s) => s.name === name)
          .map((s) => s.durationMs)
          .sort((a, b) => a - b);
        const percentile = (p: number) =>
          times.length === total.count ? (times[Math.ceil(times.length * p) - 1] ?? null) : null;
        return {
          name,
          ...total,
          retained: times.length,
          medianMs: percentile(0.5),
          p95Ms: percentile(0.95),
        };
      });
      return {
        schemaVersion: 1,
        metadata,
        elapsedMs,
        timing: 'inclusive' as const,
        status: dropped ? 'truncated' : 'complete',
        dropped,
        summary,
        samples,
      };
    },
    cancel() {
      active = false;
      generation++;
    },
  };
}

export const collector = createCollector();
export const beginMeasurementSpan = (name: string) => collector.begin(name);
