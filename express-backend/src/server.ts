import { loadEnv } from './config/env';
import { createApp } from './app';

/**
 * Boot entry point. Same discipline as the NestJS side's `main.ts`: validate the
 * environment FIRST and refuse to start with a broken one — `loadEnv()` throws with
 * every problem named at once (see config/env.ts) rather than crashing once per
 * missing variable across several restarts.
 */
function main(): void {
  const env = loadEnv();
  const app = createApp(env);

  app.listen(env.port, () => {
    console.log(`[express-backend] listening on :${env.port} (${env.nodeEnv})`);
  });
}

main();
