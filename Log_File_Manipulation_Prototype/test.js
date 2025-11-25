const fs = require("fs");
const path = require("path");

const KEYFILE_PATH = path.join(process.env.HOME, "ebeam-web-log-poc-a64b5e13f829.json");

console.log("Reading:", KEYFILE_PATH);

try {
  const raw = fs.readFileSync(KEYFILE_PATH, "utf8");
  const json = JSON.parse(raw);
  console.log("Key loaded successfully.");
  console.log("type:", json.type);
  console.log("client_email:", json.client_email);
  console.log("private_key begins with:", json.private_key?.substring(0, 30));
} catch (e) {
  console.error("FAILED TO LOAD KEY FILE:", e.message);
}
