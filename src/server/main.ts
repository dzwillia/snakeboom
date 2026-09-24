import { startServer } from './index';

const port = Number(process.env.PORT ?? 3001);
const server = await startServer({
  port,
  allowedOrigin: process.env.ALLOWED_ORIGIN || undefined,
  version: process.env.APP_VERSION ?? 'dev',
  lagMs: Number(process.env.RELAY_LAG_MS ?? 0) || 0,
});

const shutdown = () => {
  server.close().then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
