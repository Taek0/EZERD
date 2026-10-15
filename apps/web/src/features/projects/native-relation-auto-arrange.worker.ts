import { arrangeRelationRoutes } from '@ezerd/model';

type ArrangeInput = Parameters<typeof arrangeRelationRoutes>[0];

self.onmessage = (event: MessageEvent<{ jobId: string; input: ArrangeInput }>) => {
  const { jobId, input } = event.data;
  self.postMessage({ jobId, type: 'progress', phase: 'routing' });
  try {
    self.postMessage({ jobId, type: 'result', result: arrangeRelationRoutes(input) });
  } catch (error) {
    self.postMessage({
      jobId,
      type: 'error',
      message: error instanceof Error ? error.message : 'relation.auto-arrange-failed',
    });
  }
};
