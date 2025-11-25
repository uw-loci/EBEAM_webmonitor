/* global process */
const { GoogleAuth } = require("google-auth-library");
const { docs_v1 } = require("@googleapis/docs");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Immediate logging to verify script execution
console.log("[INIT] Script starting...");
console.log("[INIT] Node version:", process.version);
console.log("[INIT] Current directory:", process.cwd());
console.log("[INIT] Imports successful");

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error("[FATAL] Uncaught Exception:", error);
  console.error("[FATAL] Stack:", error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error("[FATAL] Unhandled Rejection at:", promise);
  console.error("[FATAL] Reason:", reason);
  process.exit(1);
});

// -------------------------
// Helper function to expand ~ in paths
// -------------------------
function expandPath(filePath) {
  if (filePath.startsWith("~")) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

// -------------------------
// Load Service Account Key
// -------------------------
console.log("[INIT] Expanding key file path...");
const keyFilePath = expandPath("~/.ssh/ebeam-web-log-poc-a64b5e13f829.json");
console.log("[AUTH] Initializing Google Auth...");
console.log("[AUTH] Key file path:", keyFilePath);

// Check if key file exists
if (!fs.existsSync(keyFilePath)) {
  console.error("[AUTH] ERROR: Key file does not exist at:", keyFilePath);
  process.exit(1);
}
console.log("[AUTH] ✓ Key file found");

const auth = new GoogleAuth({
  keyFile: keyFilePath,
  scopes: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/documents.readonly"
  ],
});

// -------------------------
// Main Function
// -------------------------
async function readGoogleDoc(docId) {
  console.log("\n[MAIN] Starting readGoogleDoc function...");
  console.log("[MAIN] Document ID:", docId);

  try {
    // Ensure auth is ready and get the client
    console.log("[AUTH] Getting auth client...");
    const authClient = await auth.getClient();
    console.log("[AUTH] ✓ Auth client obtained");
    
    // Request an access token to ensure authentication is complete
    await authClient.getAccessToken();
    console.log("[AUTH] ✓ Access token obtained");

    // Create Docs API client
    // For @googleapis/docs, try passing the auth client directly
    console.log("[API] Creating Docs API client...");
    const docs = new docs_v1.Docs({ auth: authClient });
    console.log("[API] ✓ Docs API client created");

    // Retrieve document
    console.log("[API] Fetching document from Google Docs API...");
    const res = await docs.documents.get({
      documentId: docId,
    });
    console.log("[API] ✓ Document retrieved successfully");
    console.log("[API] Response status:", res.status);
    console.log("[API] Document title:", res.data.title || "N/A");

    const body = res.data.body;
    if (!body) {
      console.error("[ERROR] No body found in document response");
      console.log("[DEBUG] Response data keys:", Object.keys(res.data));
      return;
    }

    const content = body.content;
    if (!content || !Array.isArray(content)) {
      console.error("[ERROR] No content array found in document body");
      console.log("[DEBUG] Body keys:", Object.keys(body));
      return;
    }

    console.log("[PARSE] Parsing document content...");
    console.log("[PARSE] Number of content elements:", content.length);

    let text = "";
    let paragraphCount = 0;
    let elementCount = 0;

    // Extract plain text from document structure
    for (let i = 0; i < content.length; i++) {
      const element = content[i];
      elementCount++;
      
      // Log element type for debugging
      if (i < 5) { // Log first 5 elements for debugging
        console.log(`[PARSE] Element ${i} type:`, Object.keys(element).filter(k => k !== 'startIndex' && k !== 'endIndex'));
      }

      const para = element.paragraph;
      if (!para) {
        // Check for other element types
        if (element.table) {
          console.log(`[PARSE] Element ${i} is a table (skipping)`);
        } else if (element.sectionBreak) {
          console.log(`[PARSE] Element ${i} is a section break (skipping)`);
        } else if (element.tableOfContents) {
          console.log(`[PARSE] Element ${i} is a table of contents (skipping)`);
        }
        continue;
      }

      paragraphCount++;
      if (!para.elements || !Array.isArray(para.elements)) {
        console.log(`[PARSE] Paragraph ${paragraphCount} has no elements array`);
        continue;
      }

      for (const run of para.elements) {
        if (run.textRun && run.textRun.content) {
          text += run.textRun.content;
        }
      }
    }

    console.log("[PARSE] ✓ Parsing complete");
    console.log("[PARSE] Total elements processed:", elementCount);
    console.log("[PARSE] Paragraphs found:", paragraphCount);
    console.log("[PARSE] Extracted text length:", text.length, "characters");

    if (text.trim().length === 0) {
      console.warn("[WARNING] No text content extracted from document!");
      console.log("[DEBUG] Full response structure (first 3 elements):");
      console.log(JSON.stringify(content.slice(0, 3), null, 2));
    } else {
      console.log("\n[OUTPUT] Google Doc Content:\n");
      console.log(text);
      console.log("\n[OUTPUT] End of content\n");
    }
  } catch (error) {
    console.error("\n[ERROR] Error reading Google Doc:");
    console.error("[ERROR] Message:", error.message);
    console.error("[ERROR] Code:", error.code || "N/A");
    if (error.response) {
      console.error("[ERROR] Status:", error.response.status);
      console.error("[ERROR] Status Text:", error.response.statusText);
      console.error("[ERROR] Response Data:", JSON.stringify(error.response.data, null, 2));
    }
    console.error("[ERROR] Stack:", error.stack);
    throw error; // Re-throw to see full error
  }
}

// -------------------------
// Run Example
// -------------------------
const GOOGLE_DOC_ID = "1zqJYZiGDL35Dwx6Th8nvXRMbxKm8KHtfrLsf65HBH8I";
console.log("=".repeat(60));
console.log("Google Docs Reader - Starting");
console.log("=".repeat(60));

readGoogleDoc(GOOGLE_DOC_ID)
  .then(() => {
    console.log("\n[SUCCESS] Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n[FAILURE] Script failed with error:", error.message);
    process.exit(1);
  });


console.log("Hello World");