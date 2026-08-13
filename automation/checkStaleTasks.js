const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const nodeHtmlToImage = require('node-html-to-image');
const ADMIN_SHEET_ID = process.env.ADMIN_SHEET_ID;
const STALE_DAYS_THRESHOLD = 2;
async function getAuthClient() {
  const credentialsJson = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8');
  const credentials = JSON.parse(credentialsJson);
  const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  return auth.getClient();
}
function currentMonthYearLabel() {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = new Date();
  return months[now.getMonth()] + '-' + String(now.getFullYear()).slice(-2);
}
async function readSheetValues(sheets, spreadsheetId, range) {
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId, range: range });
    return res.data.values || [];
  } catch (err) {
    console.warn('Could not read ' + spreadsheetId + ' ' + range + ': ' + err.message);
    return [];
  }
}
function joinField(values, maxLen) {
  const joined = values.map(function(v) { return (v === undefined || v === null || v === '') ? '-' : String(v); }).join('; ');
  if (maxLen && joined.length > maxLen) {
    return joined.slice(0, maxLen - 3) + '...';
  }
  return joined;
}
async function main() {
  const authClient = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const users = await readSheetValues(sheets, ADMIN_SHEET_ID, 'Users!A2:G');
  const monthYear = currentMonthYearLabel();
  const staleTasks = [];
  for (const row of users) {
    const fullName = row[4];
    const taskSheetId = row[5];
    const status = row[6];
    if (status !== 'active' || !taskSheetId) continue;
    const rows = await readSheetValues(sheets, taskSheetId, monthYear + '!A2:H');
    for (const t of rows) {
      const assignedDate = t[1];
      const taskText = t[2];
      const priority = t[3];
      const dueDate = t[4];
      const taskStatus = t[5];
      const statusUpdatedOn = t[6];
      if (!taskText || taskStatus === 'Completed' || !statusUpdatedOn) continue;
      const updatedDate = new Date(statusUpdatedOn);
      const daysSince = Math.floor((Date.now() - updatedDate.getTime()) / 86400000);
      if (daysSince >= STALE_DAYS_THRESHOLD) {
        staleTasks.push({
          fullName: fullName,
          assignedDate: assignedDate,
          taskText: taskText,
          priority: priority,
          dueDate: dueDate,
          status: taskStatus,
          statusUpdatedOn: statusUpdatedOn,
          daysSince: daysSince
        });
      }
    }
  }
  const alertsDir = path.join(__dirname, '..', 'alerts');
  fs.mkdirSync(alertsDir, { recursive: true });

  const summary = {
    count: staleTasks.length,
    generatedAt: new Date().toISOString(),
    assignedDates: joinField(staleTasks.map(function(t) { return t.assignedDate; }), 300),
    tasks: joinField(staleTasks.map(function(t) { return t.taskText; }), 300),
    priorities: joinField(staleTasks.map(fun
