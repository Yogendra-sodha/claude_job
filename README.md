# JobFlow — Persistence Upgrade

JobFlow has been upgraded from a static local file to a full-stack local application with true PostgreSQL persistence.

## Prerequisites
- Node.js (v18+)
- PostgreSQL (running locally on default port 5432)

## Setup

1. **Configure Database**: Open `.env` and enter your PostgreSQL `postgres` user password:
   ```env
   DB_PASSWORD=your_password
   ```
2. **Run Setup**: Double-click `setup.bat` to install dependencies and create the database.

## Starting the App

Double-click `start-jobflow.bat`. This will:
1. Start the local server
2. Automatically open your browser to `http://localhost:3000`
3. If this is your first time starting with the backend, it will detect your old browser data and migrate it to PostgreSQL!

## Chrome Extension (v2)

The new extension no longer requires copying and pasting JSON.

1. Open Chrome and go to `chrome://extensions/`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select the `extension` folder in this directory.
4. When you visit a job application page, you'll see a floating ⚡ button in the bottom right corner. Click it to automatically fill the form using data directly from your local server!
