import { createRoot } from 'react-dom/client';
import { NativeProjectView } from '../src/features/projects/NativeProjectView.js';
import { createNativePerformanceFixture } from '../src/shared/performance/native-fixture.js';
import { ConfirmProvider } from '../src/components/ui/ConfirmProvider.js';
import '../src/components/ui/tailwind.css';
import '../src/styles/tokens.css';
import '../src/components/ui/ui.css';
import '../src/styles/styles.css';
import '../src/styles/editor-topbar.css';
import '../src/styles/canvas-viewport.css';
import '../src/styles/navigation-controls.css';
const fixture = createNativePerformanceFixture(10, 10);
fixture.snapshot.project.name = 'Native ERD · 편집기 UI';
createRoot(document.getElementById('root')!).render(
  <ConfirmProvider>
    <div className="app-shell editor-shell" style={{ height: '100dvh', padding: 0 }}>
      <NativeProjectView
        entry={{ kind: 'native', ...fixture, personalUnavailable: false }}
        onLeave={() => {}}
        onReload={() => {}}
      />
    </div>
  </ConfirmProvider>,
);
