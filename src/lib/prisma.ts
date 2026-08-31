import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

// Log DATABASE_URL availability (mask password)
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('[Prisma] ERROR: DATABASE_URL is not set!');
} else {
  const masked = dbUrl.replace(/:([^@]+)@/, ':***@');
  console.log('[Prisma] DATABASE_URL found:', masked);
}

let prismaInstance: PrismaClient;
try {
  prismaInstance = global.prismaGlobal || new PrismaClient();
  console.log('[Prisma] PrismaClient instantiated successfully');
} catch (err) {
  console.error('[Prisma] FATAL: Failed to instantiate PrismaClient:', err);
  throw err;
}

export const prisma = prismaInstance;

if (process.env.NODE_ENV !== 'production') {
  global.prismaGlobal = prisma;
}

export default prisma;
