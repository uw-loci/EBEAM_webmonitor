# EBEAM_webmonitor
Website for remote monitoring of ebeam experiment

![E-beam Monitor Flowchart](webmonitorFlowchart_v2.drawio.svg)

The url for the website is: [ebeam-webmonitor.onrender.com/](https://ebeam-webmonitor.onrender.com/)

## Logic for Updating the Interlocks Section
Please note the correspondence between each of the input and output Safety Terminal Data Flags and the respective indicators. The same mapping is used in the code, as illustrated in the following G9 Driver Schematic Diagram:

![Annotated Schematic Diagram](schematic_diagram.svg)

## How to deploy changes:
- Test code by running on replit
- Push code to github repo
- Wait for render autoupdate


## Processing Information:
Log file is fetched from a google drive logs folder through the google drive api. The most recently modified log file is fetched. Google drive account is synced to the control computer.

Log file is fetched every 60 seconds. We verify if any changes have been made through the file's modifiedTime value. Only read in the file contents if changes have been made in the last minute.

File contents are reversed by line and stored in a local log file in render's temporal file system. Local log file is destroyed every server restart.

Webpage autoupdates every minute to reflect any new logs.



## Logic for Updating Numerical Readings on the Dashboard

1. **Live Polling**  
   The dashboard polls for updates every 1 minute while the experiment is running  
   (i.e., as long as the log file on Google Drive continues to receive new updates).

2. **Experiment Inactivity**  
   If the log file is **not modified for 15 consecutive minutes**, the experiment is considered **inactive**, and the dashboard displays:  
   `"Experiment is not running"`  
   This is determined by comparing the current time to the `modifiedTime` of the most recently fetched log file.

3. **Temperature Readings is set to `'--'` if**  
   Temperature readings are shown as `'--'` in the following cases:
   - If the **PMON subsystem was never connected**, in which case the `DEBUG: PMON temps:` log line shows `None` for temperature values.
   - If the **PMON is disconnected during an active experiment**, and the log explicitly shows the temperature readings as `'DISCONNECTED'`.
   - If the **experiment has stopped**, and the log file is no longer being updated (i.e., stale), we discard the temperature readings **15 minutes after exiting** the EBEAM dashboard.

4. **Pressure is set to `'--'` if**:
   - No valid pressure reading has been received in the **last 2 minutes** (tracked via `lastPressureTimestamp`).
   - The **experiment has been stopped** and the log file is stale. Like with temperatures, pressure readings are discarded **15 minutes after exiting** the dashboard.


## Hosting Information:
[render.com](https://render.com/) is the hosting service. Render automatically restarts the hosting server for each change to the git main branch.
render requires the following environment variables:
 - API_KEY: api key associated with the dashboard google account to access google drive resources.
            Need to create it in a google cloud platform project.
 - FOLDER_ID: folder id of the associated google drive logs folder

