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
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
  const joined = values
    .map(function (v) {
      return v === undefined || v === null || v === '' ? '-' : String(v);
    })
    .join('; ');
  if (maxLen && joined.length > maxLen) {
    return joined.slice(0, maxLen - 3) + '...';
  }
  return joined;
}

function formatDateShort(d) {
  if (!d) return 'Not set';
  const date = new Date(d);
  if (isNaN(date)) return String(d);
  return (date.getMonth() + 1) + '/' + date.getDate() + '/' + date.getFullYear();
}

async function main() {
  const authClient = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const users = await readSheetValues(sheets, ADMIN_SHEET_ID, 'Users!A2:G');
  const monthYear = currentMonthYearLabel();
  const issues = []; // Combined list: stale, overdue, and missing-due-date tasks.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const row of users) {
    const fullName = row[4];
    const taskSheetId = row[5];
    const status = row[6];
    if (status !== 'active' || !taskSheetId) continue;

    const rows = await readSheetValues(sheets, taskSheetId, monthYear + '!A2:H');
    for (const t of rows) {
      const taskText = t[2];
      const dueDate = t[4];
      const taskStatus = t[5];
      const statusUpdatedOn = t[6];
      if (!taskText || taskStatus === 'Completed') continue;

      // 1. Stale: same status for 2+ days.
      if (statusUpdatedOn) {
        const updatedDate = new Date(statusUpdatedOn);
        const daysSince = Math.floor((Date.now() - updatedDate.getTime()) / 86400000);
        if (daysSince >= STALE_DAYS_THRESHOLD) {
          issues.push({
            category: 'Stale',
            fullName: fullName,
            taskText: taskText,
            dueDate: dueDate,
            status: taskStatus,
            detail: daysSince + ' day(s) unchanged'
          });
        }
      }

      // 2. Missing due date entirely.
      if (!dueDate) {
        issues.push({
          category: 'No Due Date',
          fullName: fullName,
          taskText: taskText,
          dueDate: null,
          status: taskStatus,
          detail: 'No due date set'
        });
        continue; // Can't be "overdue" without a due date - skip check 3.
      }

      // 3. Overdue: due date has passed.
      const due = new Date(dueDate);
      if (!isNaN(due)) {
        due.setHours(0, 0, 0, 0);
        if (due <= today) {
          const daysOverdue = Math.floor((today - due) / 86400000);
          issues.push({
            category: 'Overdue',
            fullName: fullName,
            taskText: taskText,
            dueDate: dueDate,
            status: taskStatus,
            detail: daysOverdue + ' day(s) overdue'
          });
        }
      }
    }
  }

  const alertsDir = path.join(__dirname, '..', 'alerts');
  fs.mkdirSync(alertsDir, { recursive: true });

  const summary = {
    count: issues.length,
    generatedAt: new Date().toISOString(),
    categories: joinField(issues.map(function (i) { return i.category; }), 150),
    owners: joinField(issues.map(function (i) { return i.fullName; }), 300),
    tasks: joinField(issues.map(function (i) { return i.taskText; }), 300),
    dueDates: joinField(issues.map(function (i) { return formatDateShort(i.dueDate); }), 300),
    statuses: joinField(issues.map(function (i) { return i.status; }), 150),
    details: joinField(issues.map(function (i) { return i.detail; }), 300)
  };
  fs.writeFileSync(path.join(alertsDir, 'combined-summary.json'), JSON.stringify(summary));

  if (issues.length === 0) {
    console.log('No stale, overdue, or missing-due-date tasks found. Skipping image generation.');
    return;
  }

  const categoryColors = { 'Stale': '#e67e22', 'Overdue': '#c0392b', 'No Due Date': '#7f8c8d' };
  const rowsHtml = issues
    .map(function (i) {
      const color = categoryColors[i.category] || '#333';
      return (
        '<tr>' +
        '<td><span style="color:' + color + ';font-weight:bold;">' + i.category + '</span></td>' +
        '<td>' + (i.fullName || '-') + '</td>' +
        '<td>' + (i.taskText || '-') + '</td>' +
        '<td>' + formatDateShort(i.dueDate) + '</td>' +
        '<td>' + (i.status || '-') + '</td>' +
        '<td>' + i.detail + '</td>' +
        '</tr>'
      );
    })
    .join('');

  const html =
    '<html><head><style>' +
    'body{font-family:Arial,sans-serif;padding:20px;background:#fff;}' +
    'h2{color:#2c3e50;} table{border-collapse:collapse;width:950px;}' +
    'th,td{border:1px solid #999;padding:8px;text-align:left;font-size:13px;}' +
    'th{background:#2c3e50;color:#fff;}' +
    '</style></head><body>' +
    '<h2>Task Alerts (' + issues.length + ' item(s): stale, overdue, or missing due date)</h2>' +
    '<table><tr><th>Type</th><th>Owner</th><th>Task</th><th>Due Date</th><th>Status</th><th>Detail</th></tr>' +
    rowsHtml +
    '</table>' +
    '<p>Generated: ' + new Date().toString() + '</p>' +
    '</body></html>';

  await nodeHtmlToImage({
    output: path.join(alertsDir, 'combined-alert.png'),
    html: html,
    puppeteerArgs: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: {
        width: 1050,
        height: 800
      }
    }
  });

  console.log('Combined alert image generated with ' + issues.length + ' item(s).');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
