/**
 * CommonJS entry point for Phusion Passenger.
 *
 * Passenger's node-loader uses require(), which cannot load ES Modules directly.
 * This CJS wrapper uses dynamic import() (valid in all CommonJS modules) to
 * load the ESM app.js, which in turn starts the Express server.
 */
import('./app.js').catch(function (err) {
  console.error('[startup] Failed to start app:', err);
  process.exit(1);
});
