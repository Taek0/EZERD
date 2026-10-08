import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(
  <main>
    <h1>Legacy v1 measurement retired</h1>
    <p>
      Main no longer contains the Legacy Canvas renderer. Previous measurements and archived builds
      remain available in the performance worktree.
    </p>
    <p>The previous harness source is preserved in performance/archive/legacy-main.tsx.txt.</p>
    <a href="./compare.html">Open Native comparison</a>
  </main>,
);
