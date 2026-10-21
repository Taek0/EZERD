import { arrangeNativeTableNodes } from '@ezerd/model';
import type { nativeTableLayoutInput } from './native-canvas-selection.js';
self.onmessage = (event: MessageEvent<ReturnType<typeof nativeTableLayoutInput>>) => {
  try {
    if (event.data.nodes.length > 100) throw Error('canvas.placement-invalid');
    self.postMessage({ nodes: arrangeNativeTableNodes(event.data.nodes, event.data.relations) });
  } catch {
    self.postMessage({ error: 'canvas.placement-invalid' });
  }
};
