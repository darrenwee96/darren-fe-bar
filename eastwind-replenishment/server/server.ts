import { createApp, analytics, genie, lakebase, server } from '@databricks/appkit';
import { setupReplenishmentRoutes } from './routes/replenishment-routes';

await createApp({
  plugins: [analytics(), lakebase(), genie(), server()],
  async onPluginsReady(appkit) {
    await setupReplenishmentRoutes(appkit);
  },
});
