import { routeNativeScene, type NativeSceneRoutingInput } from './native-ghost-routing-core.js';
self.onmessage = (event: MessageEvent<{ key: string; input: NativeSceneRoutingInput }>) => {
  try {
    self.postMessage({ key: event.data.key, geometries: routeNativeScene(event.data.input) });
  } catch {
    self.postMessage({ error: 'canvas.placement-invalid' });
  }
};
