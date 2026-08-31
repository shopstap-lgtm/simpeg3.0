import { VercelRequest, VercelResponse } from '@vercel/node';
import { createApp } from '../src/app';

let app: ReturnType<typeof createApp> | null = null;
let initError: Error | null = null;

// Initialize app once (lazy singleton)
try {
  app = createApp();
  console.log('[Vercel] Express app initialized successfully');
} catch (err) {
  initError = err as Error;
  console.error('[Vercel] FATAL: Failed to initialize Express app:', err);
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (initError || !app) {
    console.error('[Vercel] Serving error response due to init failure:', initError);
    return res.status(500).json({
      error: 'Server initialization failed',
      message: initError?.message || 'Unknown error',
      stack: process.env.NODE_ENV !== 'production' ? initError?.stack : undefined,
    });
  }
  return app(req as any, res as any);
}
