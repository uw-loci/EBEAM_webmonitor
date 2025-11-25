const fs = require('fs-extra');
const path = require('path');

class LogReverser {
  constructor(config) {
    this.config = config;
  }

  /**
   * Reverse lines in a buffer chunk
   * This handles the new chunk that was just downloaded
   * @param {Buffer} chunk - New chunk of data
   * @returns {string} Reversed lines as a string (newest first)
   */
  reverseChunk(chunk) {
    try {
      if (!chunk || chunk.length === 0) {
        console.warn('[LogReverser] Empty chunk provided to reverseChunk');
        return '';
      }

      const text = chunk.toString('utf8');
      const originalEndsWithNewline = text.endsWith('\n');
      const lines = text.split('\n');
      console.log(`[LogReverser] Reversing chunk: ${chunk.length} bytes, ${lines.length} lines, endsWithNewline: ${originalEndsWithNewline}`);
      
      // Filter out empty lines at the end (common when chunking)
      // But preserve them in the middle as they might be intentional
      const filteredLines = [];
      let trailingEmpty = true;
      
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].length > 0) {
          trailingEmpty = false;
        }
        if (!trailingEmpty || lines[i].length > 0) {
          filteredLines.push(lines[i]);
        }
      }
      
      // filteredLines is already in reverse order (newest first) because we iterated backwards
      // No need to reverse again - that would put it back to oldest first!
      
      // Only add trailing newline if the original chunk ended with one
      // This preserves the original file's newline behavior
      const result = filteredLines.length > 0
        ? filteredLines.join('\n') + (originalEndsWithNewline ? '\n' : '')
        : '';
      console.log(`[LogReverser] Reversed chunk: ${filteredLines.length} lines, ${result.length} bytes, resultEndsWithNewline: ${result.endsWith('\n')}`);
      return result;
    } catch (error) {
      console.error('[LogReverser] Error reversing chunk:', {
        message: error.message,
        chunkLength: chunk?.length,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Incrementally reverse a new chunk and prepend to reversed log file
   * @param {Buffer} newChunk - New chunk of data from download
   */
  async reverseAndPrepend(newChunk) {
    const startTime = Date.now();
    try {
      if (!newChunk || newChunk.length === 0) {
        console.log('[LogReverser] No chunk provided or chunk is empty, skipping reversal');
        return;
      }

      console.log(`[LogReverser] Starting reversal and prepend for ${newChunk.length} bytes`);
      
      // Reverse the new chunk
      const reverseStartTime = Date.now();
      const reversedChunk = this.reverseChunk(newChunk);
      const reverseDuration = Date.now() - reverseStartTime;
      console.log(`[LogReverser] Chunk reversal completed in ${reverseDuration}ms`);
      
      if (reversedChunk.length === 0) {
        console.log('[LogReverser] No content to reverse in new chunk (empty after processing)');
        return;
      }

      // Prepend to reversed log file
      const prependStartTime = Date.now();
      await this.prependToReversedFile(reversedChunk);
      const prependDuration = Date.now() - prependStartTime;
      
      const totalDuration = Date.now() - startTime;
      console.log(`[LogReverser] Successfully reversed and prepended ${reversedChunk.length} bytes to reversed log (total: ${totalDuration}ms, prepend: ${prependDuration}ms)`);
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      console.error('[LogReverser] Error reversing and prepending chunk:', {
        message: error.message,
        code: error.code,
        chunkLength: newChunk?.length,
        duration: totalDuration,
        reversedFile: this.config.reversedLogFile,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Prepend content to the reversed log file
   * @param {string} content - Content to prepend
   */
  async prependToReversedFile(content) {
    try {
      const filePath = this.config.reversedLogFile;
      const dirPath = path.dirname(filePath);
      
      console.log(`[LogReverser] Ensuring directory exists: ${dirPath}`);
      await fs.ensureDir(dirPath);
      
      let existingContent = '';
      let existingSize = 0;
      try {
        existingContent = await fs.readFile(filePath, 'utf8');
        existingSize = existingContent.length;
        console.log(`[LogReverser] Existing reversed file size: ${existingSize} bytes`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('[LogReverser] Error reading existing reversed file:', {
            message: error.message,
            code: error.code,
            filePath: filePath,
            stack: error.stack
          });
          throw error;
        }
        console.log(`[LogReverser] Reversed file does not exist, creating new: ${filePath}`);
      }
      
      // Handle prepending with proper newline management
      // We need to handle all cases:
      // 1. New content ends with \n, existing doesn't
      // 2. New content doesn't end with \n, existing does
      // 3. Neither ends with \n
      // 4. Both end with \n (avoid double newline)
      
      const newEndsWithNewline = content.endsWith('\n');
      const existingEndsWithNewline = existingContent.length > 0 && existingContent.endsWith('\n');
      
      let newContent;
      if (existingContent.length === 0) {
        // No existing content, just use new content as-is
        newContent = content;
      } else if (newEndsWithNewline && existingEndsWithNewline) {
        // Both end with \n - remove one to avoid double newline
        newContent = content.slice(0, -1) + '\n' + existingContent;
      } else if (newEndsWithNewline && !existingEndsWithNewline) {
        // New ends with \n, existing doesn't - join with newline
        newContent = content + existingContent;
      } else if (!newEndsWithNewline && existingEndsWithNewline) {
        // New doesn't end with \n, existing does - join with newline
        newContent = content + '\n' + existingContent;
      } else {
        // Neither ends with \n - join with newline
        newContent = content + '\n' + existingContent;
      }
      const newSize = newContent.length;
      console.log(`[LogReverser] Prepending ${content.length} bytes to reversed file (total will be ${newSize} bytes)`);
      
      await fs.writeFile(filePath, newContent);
      console.log(`[LogReverser] Successfully prepended to reversed file: ${filePath}`);
    } catch (error) {
      console.error('[LogReverser] Error prepending to reversed file:', {
        message: error.message,
        code: error.code,
        filePath: this.config.reversedLogFile,
        contentLength: content?.length,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get paginated lines from reversed log file
   * Since the file is already reversed (newest first), we can read from the top
   * @param {number} page - Page number (1-indexed)
   * @param {number} pageSize - Number of lines per page
   * @returns {Promise<{lines: string[], totalLines: number, hasMore: boolean}>}
   */
  async getPaginatedLines(page = 1, pageSize = 100) {
    const filePath = this.config.reversedLogFile;
    const startTime = Date.now();
    
    try {
      console.log(`[LogReverser] Getting paginated lines: page=${page}, pageSize=${pageSize}`);
      
      const readStartTime = Date.now();
      const content = await fs.readFile(filePath, 'utf8');
      const readDuration = Date.now() - readStartTime;
      console.log(`[LogReverser] File read completed in ${readDuration}ms (${content.length} bytes)`);
      
      const lines = content.split('\n');
      console.log(`[LogReverser] Split into ${lines.length} lines`);
      
      // Filter out empty lines at the end
      const filteredLines = lines.filter((line, index) => {
        // Keep all non-empty lines, and empty lines that aren't at the very end
        return line.length > 0 || index < lines.length - 1;
      });
      
      const totalLines = filteredLines.length;
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedLines = filteredLines.slice(startIndex, endIndex);
      const hasMore = endIndex < totalLines;
      
      const totalDuration = Date.now() - startTime;
      console.log(`[LogReverser] Pagination completed in ${totalDuration}ms - Returning ${paginatedLines.length} lines (page ${page} of ${Math.ceil(totalLines / pageSize)})`);
      
      return {
        lines: paginatedLines,
        totalLines: totalLines,
        hasMore: hasMore,
        page: page,
        pageSize: pageSize,
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet, return empty result
        console.log(`[LogReverser] Reversed file does not exist: ${filePath}, returning empty result`);
        return {
          lines: [],
          totalLines: 0,
          hasMore: false,
          page: page,
          pageSize: pageSize,
        };
      }
      const totalDuration = Date.now() - startTime;
      console.error('[LogReverser] Error getting paginated lines:', {
        message: error.message,
        code: error.code,
        filePath: filePath,
        page: page,
        pageSize: pageSize,
        duration: totalDuration,
        stack: error.stack
      });
      throw error;
    }
  }
}

module.exports = LogReverser;
