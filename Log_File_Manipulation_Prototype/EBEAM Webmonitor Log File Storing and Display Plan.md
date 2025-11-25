## **Goal**

Build a pipeline that efficiently:

1. Downloads large, continuously growing log files from Google Drive.

2. Updates the local copy incrementally (only new bytes).

3. Maintains both a **normal** and **reversed** version locally.

4. Serves the reversed logs to a web client with fast, paginated access.

---

## **System Overview**

Google Drive (Log File)  
        ↓ (Range Download)  
Local Cache: live\_log.txt  
        ↓ (Incremental Reversal)  
Local View: live\_log\_reversed.txt  
        ↓  
Node.js (Express) → Frontend (paginated newest-first logs)

---

## **Step-by-Step Plan**

### **Step 1\. Accessing Google Drive**

Use the **Google Drive API** via the `googleapis` library.

We call:

* `drive.files.get({ fileId, fields: 'size' })` → to check remote file size.

* `drive.files.get({ fileId, alt: 'media' })` → with a `Range` header to download new bytes only.

---

### **Step 2\. Local File Management**

Maintain two local files:

| File | Purpose |
| ----- | ----- |
| `live_log.txt` | Exact mirror of the Drive log. Used for tracking byte offset. |
| `live_log_reversed.txt` | Reversed version (newest → oldest) for fast display. |

Both files are updated incrementally and no full reloads as doing that every minute would be extremely inefficient.

---

### **Step 3\. Incremental Download**

Every minute:

1. Check Drive file size.  
2. Compare with local file size.  
3. If larger (meaning new log lines added), fetch the range of new bytes using: `Range: bytes=<localSize>`  
4. Append the new bytes to `live_log.txt`.

**Result:** Only new log entries are fetched and stored locally.

---

### **Step 4\. Incremental Reversal**

After downloading a new chunk:

1. Reverse only the new portion (using `reverse-line-reader` or equivalent library).

2. Prepend the reversed chunk to `live_log_reversed.txt`.

This ensures the reversed file always starts with the latest logs.

**Benefit:** No need to reprocess thousands of existing lines.  
**Time complexity:** `O(size_of_new_chunk)`, not `O(size_of_total_log)`.

