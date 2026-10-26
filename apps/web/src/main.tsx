import { createRoot } from 'react-dom/client';
import '@/index.css';
import { App } from '@/app/App.tsx';
import { bootstrap } from '@/app/bootstrap.ts';

const root = createRoot(document.getElementById('root')!);

bootstrap()
  .then(() => root.render(<App />))
  .catch((err: unknown) => {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    root.render(
      <div role="alert" style={{ padding: 32, fontFamily: 'system-ui', maxWidth: 560 }}>
        <h1 style={{ fontSize: 18 }}>MDLeaf could not start</h1>
        <p>
          This browser does not provide the storage MDLeaf needs (the Origin Private File System), or it is blocked in this window — for
          example in a private window, where Safari turns it off.
        </p>
        <p style={{ color: '#5f6368' }}>{message}</p>
      </div>,
    );
  });
