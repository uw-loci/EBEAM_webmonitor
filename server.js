const express = require('express');
const app = express();
const api = require('./log_data_extraction'); // Import your API router
const path = require('path');

const port = 3000; // Choose a port for your local server

app.use('/log-data-extraction', api); // Mount the API at /log-data-extraction

app.listen(port, () => {
  console.log(`Local server listening on port ${port}`);
});

// **Important:** Ensure your log_data_extraction.js is in the same directory,
// and you have the 'test_logs' directory with 'sample_logs.txt' as described before.