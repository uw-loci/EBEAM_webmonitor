const axios = require('axios');
//require('dotenv').config();

//const LOG_DATA_EXTRACTION_KEY = process.env.LOG_DATA_EXTRACTION_KEY;
const LOG_DATA_EXTRACTION_KEY = 'my-secret-key';

async function testLogDataExtraction() {
  try {
    const response = await axios.get("https://ebeam-webmonitor.onrender.com/log-data-extraction/data", {
      headers: {
        'x-api-key': LOG_DATA_EXTRACTION_KEY
      }
    });

    console.log('API Response:', response.data);
  } catch (error) {
    console.error('Error calling the API:', error.message);
    if (error.response) {
      console.error('Error Response Data:', error.response.data);
    }
  }
}

testLogDataExtraction();