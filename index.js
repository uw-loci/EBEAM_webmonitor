const express = require('express');
const puppeteer = require('puppeteer');

const FOLDER_URL = 'https://drive.google.com/drive/folders/1-1PKnmvtWe6ErDyhP2MXGGy60sm2hz84';
const PORT = process.env.PORT || 3000;
const app = express();

/**
 * Helper function to scrape files from the Google Drive folder using Puppeteer.
 */
async function scrapeGoogleDriveFolder() {
  try {
    // Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: true, // Run in headless mode
      args: ['--no-sandbox', '--disable-setuid-sandbox'], // Necessary for some environments
    });
    const page = await browser.newPage();

    // Go to the folder URL
    await page.goto(FOLDER_URL, { waitUntil: 'networkidle2' });

    // Wait for the files to load (targeting elements in the page)
    await page.waitForSelector('div[aria-label="Files"]');

    // Extract file links and names
    const files = await page.evaluate(() => {
      const fileElements = document.querySelectorAll('div[role="listitem"] a');
      const fileList = [];

      fileElements.forEach((el) => {
        const name = el.textContent.trim();
        const link = el.href;
        if (link.includes('uc?id=')) {
          fileList.push({ name, url: link });
        }
      });

      return fileList;
    });

    await browser.close();

    if (files.length === 0) {
      throw new Error('No downloadable files found in the folder.');
    }

    return files;
  } catch (err) {
    throw new Error(`Error scraping folder: ${err.message}`);
  }
}

/**
 * Fetch and reverse the contents of the most recent file.
 */
async function fetchReversedFileContents() {
  try {
    const files = await scrapeGoogleDriveFolder();

    // Assume the first file is the most recent (Google Drive default sorting)
    const mostRecentFile = files[0];
    console.log(`Fetching file: ${mostRecentFile.name}`);

    // Fetch the file's content
    const response = await fetch(mostRecentFile.url);
    const fileContents = await response.text();

    // Split and reverse lines
    const lines = fileContents.split('\n').reverse();
    return { fileName: mostRecentFile.name, reversedContents: lines.join('\n') };
  } catch (err) {
    throw new Error(`Error processing file: ${err.message}`);
  }
}

/**
 * GET / : Displays an HTML page with reversed log lines.
 */
app.get('/', async (req, res) => {
  try {
    const { fileName, reversedContents } = await fetchReversedFileContents();

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Reversed Log Viewer</title>
      </head>
      <body>
        <h1>Reversed Log Viewer</h1>
        <p>Most Recent File: ${fileName}</p>
        <pre style="white-space: pre-wrap; font-family: monospace;">
${reversedContents}
        </pre>
      </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error: ${err.message}`);
  }
});

/**
 * GET /raw : Returns just the reversed text (newest at top).
 */
app.get('/raw', async (req, res) => {
  try {
    const { reversedContents } = await fetchReversedFileContents();
    res.type('text/plain').send(reversedContents);
  } catch (err) {
    console.error(err);
    res.status(500).send(`Error: ${err.message}`);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
