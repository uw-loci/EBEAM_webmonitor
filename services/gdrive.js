const fs = require('fs');
const https = require('https');
const { drive, FOLDER_ID, API_KEY, REVERSED_FILE_PATH } = require('../config');
const state = require('./state');

const RECENT_LOG_WINDOW_MS = 30 * 60 * 1000;
const MAX_SNIPPET_LINES = 10_000;
const FALLBACK_SNIPPET_LINES = 5_000;
const MAX_SNIPPET_BYTES = 2 * 1024 * 1024;

function normalizeTimestampCandidate(candidate) {
  if (!candidate) {
    return null;
  }

  const isoLikeMatch = candidate.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)$/
  );
  if (isoLikeMatch) {
    return `${isoLikeMatch[1]}T${isoLikeMatch[2]}`;
  }

  return candidate;
}

function parseDisplayLogTimestampMs(line) {
  if (typeof line !== 'string' || line.length === 0) {
    return null;
  }

  const patterns = [
    /\b(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\b/,
    /\b(\d{1,2}\/\d{1,2}\/\d{4}[ T]\d{1,2}:\d{2}:\d{2}(?:\s?(?:AM|PM))?)\b/i,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) {
      continue;
    }

    const parsed = Date.parse(normalizeTimestampCandidate(match[1]));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function createDisplayLogSnippetCollector(options = {}) {
  const recentWindowMs = options.recentWindowMs ?? RECENT_LOG_WINDOW_MS;
  const maxLines = options.maxLines ?? MAX_SNIPPET_LINES;
  const fallbackLines = options.fallbackLines ?? FALLBACK_SNIPPET_LINES;
  const maxBytes = options.maxBytes ?? MAX_SNIPPET_BYTES;

  const records = [];
  let totalBytes = 0;
  let newestTimestampMs = null;

  function removeFirstRecord() {
    if (records.length === 0) {
      return;
    }

    const removed = records.shift();
    totalBytes -= removed.byteLength;
  }

  function trimToRecentWindow() {
    if (newestTimestampMs == null) {
      return;
    }

    const oldestAllowedMs = newestTimestampMs - recentWindowMs;

    while (records.length > 0) {
      const firstTimestampMs = records[0].timestampMs;

      if (firstTimestampMs != null) {
        if (firstTimestampMs < oldestAllowedMs) {
          removeFirstRecord();
          continue;
        }
        break;
      }

      const nextTimestampIndex = records.findIndex((record, index) => index > 0 && record.timestampMs != null);
      if (nextTimestampIndex === -1) {
        break;
      }

      const nextTimestampMs = records[nextTimestampIndex].timestampMs;
      if (nextTimestampMs == null || nextTimestampMs < oldestAllowedMs) {
        removeFirstRecord();
        continue;
      }

      removeFirstRecord();
    }
  }

  function trimToSafetyCaps() {
    const preferredLineLimit = newestTimestampMs == null ? fallbackLines : maxLines;

    while (records.length > preferredLineLimit || totalBytes > maxBytes) {
      removeFirstRecord();
    }
  }

  return {
    appendLine(line) {
      const timestampMs = parseDisplayLogTimestampMs(line);
      if (timestampMs != null && (newestTimestampMs == null || timestampMs > newestTimestampMs)) {
        newestTimestampMs = timestampMs;
      }

      const byteLength = Buffer.byteLength(line, 'utf8') + 1;
      records.push({ line, timestampMs, byteLength });
      totalBytes += byteLength;

      trimToRecentWindow();
      trimToSafetyCaps();
    },
    finalize() {
      return {
        lines: records.map((record) => record.line).reverse(),
        byteLength: totalBytes,
        lineCount: records.length,
        newestTimestampMs,
      };
    },
  };
}

function collectRecentLogSnippet(lines, options = {}) {
  const collector = createDisplayLogSnippetCollector(options);
  for (const line of lines) {
    collector.appendLine(line);
  }
  return collector.finalize();
}

/**
 * Fetch the most recent plain-text log files from Google Drive.
 * Returns { displayFile } where displayFile may be null.
 */
async function getMostRecentFile() {
  try {
    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and mimeType='text/plain'`,
      orderBy: 'modifiedTime desc',
      pageSize: 5,
      fields: 'files(id, name, modifiedTime)',
    });

    const files = res.data.files;
    console.log("Latest files seen:", files.map(f => f.name));

    if (!files || files.length === 0) {
      throw new Error('No files found in the folder.');
    }

    const displayFile = files.find(f => f.name.startsWith('log_')) || null;
    return { displayFile };

  } catch (err) {
    console.error(`Google Drive API Error: ${err.message}`);
    return { displayFile: null };
  }
}

/**
 * Stream-downloads a text file from Google Drive and returns a bounded recent snippet.
 */
async function fetchRecentLogSnippet(fileId, options = {}) {
  let retries = 3;
  const logger = options.logger ?? console;
  const collectorOptions = {
    recentWindowMs: options.recentWindowMs,
    maxLines: options.maxLines,
    fallbackLines: options.fallbackLines,
    maxBytes: options.maxBytes,
  };

  while (retries > 0) {
    try {
      const response = await new Promise((resolve, reject) => {
        https
          .get(
            `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${API_KEY}`,
            { headers: { Accept: 'text/plain' } },
            res => {
              if (res.statusCode !== 200) {
                reject(new Error(`Google API Failed: ${res.statusCode}`));
                return;
              }
              resolve(res);
            }
          )
          .on('error', reject);
      });

      const collector = createDisplayLogSnippetCollector(collectorOptions);
      let currentLine = '';

      await new Promise((resolve, reject) => {
        response.on('data', chunk => {
          const chunkStr = chunk.toString('utf8');
          const chunkLines = (currentLine + chunkStr).split('\n');
          currentLine = chunkLines.pop();
          for (const line of chunkLines) {
            collector.appendLine(line);
          }
        });

        response.on('end', () => {
          if (currentLine) {
            collector.appendLine(currentLine);
          }
          resolve();
        });

        response.on('error', reject);
      });

      return collector.finalize();

    } catch (err) {
      retries--;
      logger.log(`Retry attempt ${4 - retries}: ${err.message}`);
      if (retries === 0) return false;
    }
  }
}

/**
 * Writes an array of lines to a local file using a writable stream.
 */
function writeToFile(lines) {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(REVERSED_FILE_PATH, { flags: 'w' });
    let i = 0;

    function writeNext() {
      let ok = true;
      while (i < lines.length && ok) {
        ok = writeStream.write(lines[i] + '\n');
        i++;
      }
      if (i < lines.length) {
        writeStream.once('drain', writeNext);
      } else {
        writeStream.end();
      }
    }

    writeStream.on('finish', async () => {
      console.log('Recent log snippet updated successfully.');
      resolve(true);
    });

    writeStream.on('error', (err) => {
      console.error("Write error:", err);
      reject(err);
    });

    writeNext();
  });
}

/**
 * Fetch display log from Google Drive, extract a bounded recent snippet, and write it to local file.
 */
async function fetchDisplayFileContents(options = {}) {
  const logger = options.logger ?? console;
  const stateRef = options.stateRef ?? state;
  const getMostRecentFileFn = options.getMostRecentFileFn ?? getMostRecentFile;
  const fetchRecentLogSnippetFn = options.fetchRecentLogSnippetFn ?? fetchRecentLogSnippet;
  const writeToFileFn = options.writeToFileFn ?? writeToFile;

  try {
    const { displayFile } = await getMostRecentFileFn();

    if (!displayFile) {
      logger.log("No display file found!");
      return false;
    }

    if (
      stateRef.displayLogFileId === displayFile.id &&
      stateRef.displayLogLastModified === displayFile.modifiedTime
    ) {
      logger.log('Display log unchanged, using cached recent snippet.');
      return true;
    }

    logger.log("Fetching new display log file...");
    let snippet = null;
    try {
      snippet = await fetchRecentLogSnippetFn(displayFile.id, options);
      if (!snippet || !Array.isArray(snippet.lines)) {
        logger.warn("Display log fetch failed or returned no lines. Skipping extraction.");
        return false;
      }
    } catch (e) {
      logger.error("Log file failed:", e);
      return false;
    }

    const writePromise = writeToFileFn(snippet.lines);
    const [writeResult] = await Promise.allSettled([writePromise]);

    if (writeResult.status === 'fulfilled') {
      logger.log("File write complete.");
      stateRef.displayLogLastModified = displayFile.modifiedTime;
      stateRef.displayLogFileId = displayFile.id;
      return true;
    } else {
      logger.error("File write failed:", writeResult.reason);
      return false;
    }
  } catch (err) {
    logger.error(`Error processing file: ${err.message}`);
    return false;
  }
}

module.exports = {
  RECENT_LOG_WINDOW_MS,
  MAX_SNIPPET_LINES,
  FALLBACK_SNIPPET_LINES,
  MAX_SNIPPET_BYTES,
  parseDisplayLogTimestampMs,
  createDisplayLogSnippetCollector,
  collectRecentLogSnippet,
  getMostRecentFile,
  fetchRecentLogSnippet,
  writeToFile,
  fetchDisplayFileContents,
};
