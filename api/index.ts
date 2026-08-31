import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from '../src/app';

let app: ReturnType<typeof createApp> | null = null;
let initError: Error | null = null;

try {
  app = createApp();
  console.log('[Vercel] Express app initialized successfully');
} catch (err) {
  initError = err as Error;
  console.error('[Vercel] FATAL: Failed to initialize Express app:', err);
}

// Catch unhandled promise rejections globally
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Vercel] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Vercel] Uncaught Exception:', err);
});

export default function handler(req: IncomingMessage, res: ServerResponse) {
  console.log(`[Vercel] Request: ${req.method} ${req.url}`);

  if (initError || !app) {
    console.error('[Vercel] Init error, returning 500:', initError?.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Server initialization failed',
      message: initError?.message || 'Unknown error',
    }));
    return;
  }

  try {
    return app(req as any, res as any);
  } catch (err) {
    console.error('[Vercel] Request handler threw synchronously:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Handler error', message: String(err) }));
    }
  }
}
