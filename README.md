# EBEAM_webmonitor
EBeam WebMonitor reports the status of all the subsystems of the 3-D metal printer. Using this web-hosted platform, we will be able to remotely monitor all the subsystems without the need to be present onsite (in the Wet Lab). 

The url for the website is: [ebeam-webmonitor.onrender.com/](https://ebeam-webmonitor.onrender.com/)

## Installation
1. Run the EBEAM-Dashboard
   
   Switch to the correct branch: `git checkout feature/create_global_dict`
   
   (i) Connect your laptop to Wi-Fi to ensure syncs happen properly.
   
   (ii) Follow the EBEAM-Dashboard documentation for:
      - Installing requirements
      - Setting up dependencies
      - Any additional environment configuration
     
   Note: The EBEAM-Dashboard is required for adding new subsystems to the global dict as we integrate them into the dashboard.

3. Start the Express.js Server & Web Monitor
   
   From the project root:
      (i) Express.js Server
   
          - `npm install`
          - `npm start`
   
      (ii) Webmonitor
          - `node index.js`

## Backend Logic

When you run the dashboard on the `feature/create_global_dict` branch, two files are generated:

1) WebMonitor Log File
   - Purpose: to track real-time updates from all subsystems – Interlocks, VTRX, Pressure Readings, CCS, and Beam Energy.
     (Note: the driver file for Beam Energy is maintained on a separate branch.)

2) System Log File
   - Purpose: to provide a complete view of the raw logs.
   - The View Box at the bottom of the dashboard displays these logs directly, allowing you to trace detailed patterns or troubleshoot issues that might not be fully captured by the UI.
   - While the UI elements are optimized for quick, real-time monitoring of subsystem health, the raw logs serve as a complementary source for deeper diagnostics.
     
## Features

1) Scalable Backend
   (i) Modular driver/subsystem design enables the WebMonitor to integrate new hardware subsystems (Interlocks, VTRX, CCS, Beam Energy, etc.) without major rewrites.
   (ii) Each subsystem logs independently but funnels into a consistent pipeline for UI rendering and API serving.

2) Efficient UI Updates
   (i) Differential Refreshes: UI elements auto-reload every 60 minutes without refreshing the entire dashboard.
   (ii) On-Demand Logs: Full log files are only fetched and displayed when the user clicks Expand, preventing rate-limit issues and avoiding unnecessary latency caused because of excessive               resource consumption on the backend side.

3) Async File Handling (Express.js)
   (i) getMostRecentFile: Fetches the latest WebMonitor and raw log files from Google Drive, populating the dataFile and displayFile references.
   (ii) fetchFileContents: Streams and parses large text files line-by-line. Used to power the log display on the web monitor.
   (iii) extractData: Parses JSON blocks from log files to extract experimental metrics (pressure, temperatures, interlocks, vacuum states, etc.), updating the in-memory data dictionary.
   (iv) fetchDisplayFileContents: Updates the UI log preview by pulling only the newest display logs, writing them to a reversed file buffer for frontend viewing.
   (v) fetchAndUpdateFile: Periodically checks for new log files, resets stale data if thresholds are exceeded, and refreshes the shared data object for API consumption.


## Logic for Updating the Interlocks Section
Please note the correspondence between each of the input and output Safety Terminal Data Flags (bit numbers) and their respective indicators. This same mapping is followed in the code, and is illustrated in the G9 Driver Schematic Diagram below (annotated in blue).

![Annotated Schematic Diagram](schematic_diagram.svg)

## How to deploy changes:
- Test code by running on replit
- Push code to github repo
- Wait for render autoupdate

## Overarching System Architecture:
1) Subsystem Data Source:
  - Data (e.g., voltages, currents, beam status) is collected in Python as a global dictionary.
  - Each update is passed to the WebMonitorLogger class.

2) Logger (Python):
   - Logs updates to a dedicated webmonitor log file and system log file.
   Note: Webmonitor log file contains data in json format for more robust transmission of data. Regex logic can break with minor changes in logs. System log files contain logs in its native               format for manual review via the web monitor.

3) Express.js Dashboard:
   - Periodically fetches the latest data from the log file.
   - Displays status on a real-time dashboard.
  
## Important 
If you create new folder directories for storing log files, make sure to update the `FOLDER_ID` value in Render’s environment variables so the WebMonitor can locate the correct Google Drive folder.

## Extending the Project
- Add new subsystems: Extend the Python dictionary keys and logger updates.
- Increase Uptime: Build a more robust system by separating the directories for both the log files. Failure to sync the displayFile must not affect the logFile and vice-versa.
  
## Hosting Information:
[render.com](https://render.com/) is the hosting service. Render automatically restarts the hosting server for each change to the git main branch.
render requires the following environment variables:
 - API_KEY: api key associated with the dashboard google account to access google drive resources.
            Need to create it in a google cloud platform project.
 - FOLDER_ID: folder id of the associated google drive logs folder
   

**Contributors**: Pratyush, Anurag, Arundhati



