import { Octokit } from '@octokit/rest';
import fetch from 'node-fetch';

if (!process.env.GITHUB_PAT) {  // GITHUB_PAT is the name you set in Render
  throw new Error('GitHub token not found in environment variables');
}

const octokit = new Octokit({
  auth: process.env.GITHUB_PAT
});

async function getGoogleDriveFile() {
  const response = await fetch("https://drive.google.com/uc?export=download&id=1-EUNY-noM9UhiIdNVP5Zu4O46-UkOY0u");
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }
  
  return await response.text();
}

async function createGithubFile(owner, repo, path, content) {
  try {
    const contentEncoded = Buffer.from(content).toString('base64');
    const response = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: 'Create new file from Google Drive',
      content: contentEncoded
    });

    console.log('File created successfully:', response.data.content.html_url);
    return response.data;
  } catch (error) {
    console.error('Error creating file:', error.message);
    throw error;
  }
}

// Usage
const GITHUB_OWNER = 'uw-loci';
const GITHUB_REPO = 'EBEAM_webmonitor';
const GITHUB_PATH = 'log_file.txt';

async function main() {
  try {
    const content = await getGoogleDriveFile();
    // const content = "Hello World"
    await createGithubFile(GITHUB_OWNER, GITHUB_REPO, GITHUB_PATH, content);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();