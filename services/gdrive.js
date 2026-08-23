const fs = require('fs');
const https = require('https');
const { FOLDER_ID, API_KEY, REVERSED_FILE_PATH } = require('../config');
const state = require('./state');

const RECENT_LOG_WINDOW_MS = 30 * 60 * 1000;
const MAX_SNIPPET_LINES = 10_000;
const FALLBACK_SNIPPET_LINES = 5_000;
const MAX_SNIPPET_BYTES = 2 * 1024 * 1024;
// Fetch enough tail data to fill the snippet even when the byte range starts
// in the middle of a line. This keeps each refresh independent of total file
// size as the experiment log grows over multiple days.
const MAX_DOWNLOAD_TAIL_BYTES = MAX_SNIPPET_BYTES * 2;

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

  let records = [];
  let firstRecordIndex = 0;
  let totalBytes = 0;
  let newestTimestampMs = null;

  function getRecordCount() {
    return records.length - firstRecordIndex;
  }

  function compactRecordsIfNeeded() {
    if (firstRecordIndex >= 4_096 && firstRecordIndex * 2 >= records.length) {
      records = records.slice(firstRecordIndex);
      firstRecordIndex = 0;
    }
  }

  function removeFirstRecord() {
    if (getRecordCount() === 0) {
      return;
    }

    const removed = records[firstRecordIndex];
    records[firstRecordIndex] = null;
    firstRecordIndex++;
    totalBytes -= removed.byteLength;
    compactRecordsIfNeeded();
  }

  function trimToRecentWindow() {
    if (newestTimestampMs == null) {
      return;
    }

    const oldestAllowedMs = newestTimestampMs - recentWindowMs;

    while (getRecordCount() > 0) {
      const firstTimestampMs = records[firstRecordIndex].timestampMs;

      if (firstTimestampMs != null) {
        if (firstTimestampMs < oldestAllowedMs) {
          removeFirstRecord();
          continue;
        }
        break;
      }

      const nextTimestampIndex = records.findIndex(
        (record, index) => index > firstRecordIndex && record?.timestampMs != null
      );
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

    while (getRecordCount() > preferredLineLimit || totalBytes > maxBytes) {
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
      const retainedRecords = records.slice(firstRecordIndex);
      return {
        lines: retainedRecords.map((record) => record.line).reverse(),
        byteLength: totalBytes,
        lineCount: retainedRecords.length,
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

function buildDriveListUrl({ folderId = FOLDER_ID, apiKey = API_KEY } = {}) {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', `'${folderId}' in parents and mimeType='text/plain'`);
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('pageSize', '5');
  url.searchParams.set('fields', 'files(id,name,modifiedTime,size)');
  return url.toString();
}

function buildDriveDownloadRequest(fileId, options = {}) {
  const apiKey = options.apiKey ?? API_KEY;
  const maxDownloadBytes = options.maxDownloadBytes ?? MAX_DOWNLOAD_TAIL_BYTES;
  const fileSize = Number(options.fileSize);
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`
  );
  url.searchParams.set('alt', 'media');
  url.searchParams.set('key', apiKey);

  const headers = { Accept: 'text/plain' };
  let rangeRequested = false;

  if (
    Number.isFinite(fileSize) &&
    fileSize > maxDownloadBytes &&
    Number.isFinite(maxDownloadBytes) &&
    maxDownloadBytes > 0
  ) {
    const rangeStart = Math.max(0, Math.floor(fileSize - maxDownloadBytes));
    headers.Range = `bytes=${rangeStart}-`;
    rangeRequested = true;
  }

  return {
    url: url.toString(),
    headers,
    rangeRequested,
  };
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Accept: 'application/json' } }, res => {
        let body = '';
        res.setEncoding('utf8');

        res.on('data', chunk => {
          body += chunk;
        });

        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Google API Failed: ${res.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(new Error(`Invalid Google API JSON: ${err.message}`));
          }
        });
      })
      .on('error', reject);
  });
}

async function listDriveTextFiles(options = {}) {
  const requestJsonFn = options.requestJsonFn ?? fetchJson;
  const data = await requestJsonFn(buildDriveListUrl(options));
  if (!Array.isArray(data?.files)) {
    throw new Error('Invalid Google Drive response: missing files array');
  }
  return data.files;
}

/**
 * Fetch the most recent plain-text log files from Google Drive.
 * Returns { displayFile } where displayFile may be null.
 */
async function getMostRecentFile(options = {}) {
  const logger = options.logger ?? console;
  const listDriveTextFilesFn = options.listDriveTextFilesFn ?? listDriveTextFiles;

  try {
    const files = await listDriveTextFilesFn(options);
    logger.log("Latest files seen:", files.map(f => f.name));

    if (!files || files.length === 0) {
      throw new Error('No files found in the folder.');
    }

    const displayFile = files.find(f => f.name.startsWith('log_')) || null;
    return { displayFile };

  } catch (err) {
    logger.error(`Google Drive API Error: ${err.message}`);
    return { displayFile: null };
  }
}

/**
 * Stream-downloads a text file from Google Drive and returns a bounded recent snippet.
 */
async function fetchRecentLogSnippet(fileId, options = {}) {
  let retries = 3;
  const logger = options.logger ?? console;
  const httpsGetFn = options.httpsGetFn ?? https.get;
  const collectorOptions = {
    recentWindowMs: options.recentWindowMs,
    maxLines: options.maxLines,
    fallbackLines: options.fallbackLines,
    maxBytes: options.maxBytes,
  };

  while (retries > 0) {
    try {
      const request = buildDriveDownloadRequest(fileId, options);
      const response = await new Promise((resolve, reject) => {
        httpsGetFn(request.url, { headers: request.headers }, res => {
          const expectedStatus = request.rangeRequested ? 206 : 200;
          if (res.statusCode !== expectedStatus) {
            res.resume?.();
            reject(new Error(
              request.rangeRequested && res.statusCode === 200
                ? 'Google API ignored the bounded byte-range request'
                : `Google API Failed: ${res.statusCode}`
            ));
            return;
          }
          resolve(res);
        })
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
      logger.log(`Retry attempt ${3 - retries}: ${err.message}`);
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
      snippet = await fetchRecentLogSnippetFn(displayFile.id, {
        ...options,
        fileSize: displayFile.size,
      });
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
  MAX_DOWNLOAD_TAIL_BYTES,
  parseDisplayLogTimestampMs,
  createDisplayLogSnippetCollector,
  collectRecentLogSnippet,
  buildDriveListUrl,
  buildDriveDownloadRequest,
  listDriveTextFiles,
  getMostRecentFile,
  fetchRecentLogSnippet,
  writeToFile,
  fetchDisplayFileContents,
};
