const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;

const LOG_DATA_EXTRACTION_KEY = 'my-secret-key'; // Replace with your key

// Load and mount the API router
const logDataExtractionRouter = require('./log_data_extraction');
app.use('/log-data-extraction', logDataExtractionRouter);

// Function to call the local API
const callApi = async () => {
  try {
    const response = await axios.get('http://localhost:3000/log-data-extraction/data', {
      headers: {
        'x-api-key': LOG_DATA_EXTRACTION_KEY
      }
    });
    console.log('API response:', response.data);
  } catch (error) {
    console.error('API call failed:', error.message);
  }
};

// Start server and set up periodic API call
app.listen(port, () => {
  console.log(`Local server listening at http://localhost:${port}`);

  // Call API immediately, then every 60 seconds
  callApi();
  setInterval(callApi, 60000);
});
