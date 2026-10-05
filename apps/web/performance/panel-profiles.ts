import type { ProfilerOnRenderCallback } from 'react';
export const panelProfiles = { active: false, samples: [] as { id: string; actual: number }[] };
export const recordPanelProfile: ProfilerOnRenderCallback = (id, _phase, actual) => {
  if (panelProfiles.active) panelProfiles.samples.push({ id, actual });
};
