# EBEAM_webmonitor
Website for remote monitoring of ebeam experiment

The url for the website is: [ebeam-webmonitor.onrender.com/](https://ebeam-webmonitor.onrender.com/)

## How to deploy changes:
- Test code by running on replit
- Push code to github repo
- Wait for render autoupdate


## Processing Information:
Log file is fetched from a google drive logs folder through the google drive api. The most recently modified log file is fetched. Google drive account is synced to the control computer.

Log file is fetched every 60 seconds. We verify if any changes have been made through the file's modifiedTime value. Only read in the file contents if changes have been made in the last minute.

File contents are reversed by line and stored in a local log file in render's temporal file system. Local log file is destroyed every server restart.

Webpage autoupdates every minute to reflect any new logs.

## Hosting Information:
[render.com](https://render.com/) is the hosting service. Render automatically restarts the hosting server for each change to the git main branch.
render requires the following environment variables:
 - API_KEY: api key associated with the dashboard google account to access google drive resources.
            Need to create it in a google cloud platform project.
 - FOLDER_ID: folder id of the associated google drive logs folder

