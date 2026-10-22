/**
 * Opens the HTTP port before running any remote cache-warming work.
 *
 * Render cannot route requests until the listen callback fires. Starting the
 * warmup from that callback keeps a slow Supabase or Google Drive request from
 * making the entire deployment appear offline.
 */
function startHttpServer({ app, port, warmup, logger = console }) {
  let settleInitialization;
  const initialization = new Promise((resolve) => {
    settleInitialization = resolve;
  });

  const server = app.listen(port, () => {
    logger.log(`Listening on ${port}`);

    Promise.resolve()
      .then(warmup)
      .then(
        (value) => settleInitialization({ status: 'fulfilled', value }),
        (reason) => {
          logger.error('Background startup failed:', reason);
          settleInitialization({ status: 'rejected', reason });
        }
      );
  });

  return { server, initialization };
}

module.exports = { startHttpServer };
