const { GoogleAuth } = require("google-auth-library");
const https = require("https");

const KEYFILE_PATH = "/Users/pratshan11/ebeam-web-log-poc-a64b5e13f829.json";
const FILE_ID = "113U8T4O7fN2onSeOTudNTQCxZ7g2Xjgd";

async function main() {
  const auth = new GoogleAuth({
    keyFile: KEYFILE_PATH,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  // Get authenticated client & token
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

  if (!token) {
    console.error("Failed to obtain access token.");
    return;
  }

  const options = {
    hostname: "www.googleapis.com",
    path: `/drive/v3/files/${FILE_ID}?alt=media`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  https.get(options, (res) => {
    let data = "";

    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      if (res.statusCode !== 200) {
        console.error("Drive response error:", data);
        return;
      }

      console.log("FILE CONTENT:\n--------------------\n");
      console.log(data);
    });
  }).on("error", (err) => {
    console.error("HTTPS request error:", err);
  });
}

main();
