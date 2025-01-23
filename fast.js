const Fastify = require("fastify");
const fetch = require("node-fetch");

const PORT = process.env.PORT || 3000;

const app = Fastify();

// Use your direct-download URL from Google Drive:
const FILE_URL =
  "https://drive.google.com/uc?export=download&id=1-EUNY-noM9UhiIdNVP5Zu4O46-UkOY0u";

// Pre-handler hook to track time
app.addHook("onRequest", (request, reply, done) => {
  request.startTime = Date.now();
  done();
});

app.addHook("onResponse", (request, reply, done) => {
  const duration = Date.now() - request.startTime;
  const durationSec = (duration / 1000).toFixed(2);
  console.log(`Request to ${request.url} took ${durationSec}ms`);
  done();
});

/**
 * Helper function to fetch the Drive file and reverse its line order.
 */
async function fetchReversedFileContents() {
  // Fetch the text from Google Drive
  const response = await fetch(FILE_URL);
  if (!response.ok) {
    throw new Error(`Drive fetch failed with status ${response.status}`);
  }

  // Original file contents (oldest line first)
  const fileContents = await response.text();

  // Split into lines
  let lines = fileContents.split("\n");

  // Reverse so the newest lines appear at the top
  lines.reverse();

  // Re-join into a single string
  const reversedContents = lines.join("\n");
  return reversedContents;
}

// Route to fetch file and display it in HTML
app.get("/", async (request, reply) => {
  try {
    // Fetch the file content
    const reversedLog = await fetchReversedFileContents(FILE_URL);

    // Respond with the file content inside a simple HTML structure
    return reply.type("text/html").send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Reversed Log Viewer</title>
      </head>
      <body>
        <h1>EBEAM Web Monitor</h1>
        <p>File URL: ${FILE_URL}</p>
        <pre style="white-space: pre-wrap; font-family: monospace;">
${reversedLog}
        </pre>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Error fetching the file:", err);
    return reply.code(500).send(`
      <html>
        <body>
          <h1>Error occurred while fetching the file.</h1>
        </body>
      </html>
    `);
  }
});

// Start the server
const start = async () => {
  try {
    await app.listen({ port: PORT });
    console.log("Server listening at http://localhost:3000");
  } catch (err) {
    console.log(err);
    process.exit(1);
  }
};

start();
