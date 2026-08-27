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

async function main() {
  const authClient = await getAuthClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const users = await readSheetValues(sheets, ADMIN_SHEET_ID, 'Users!A2:G');
  const monthYear = currentMonthYearLabel();
  const staleTasks = [];
  const overdueTasks = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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
      if (!taskText || taskStatus === 'Completed') continue;

      // Stale check: same status for 2+ days.
      if (statusUpdatedOn) {
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

      // Overdue check: due date has passed, OR no due date was ever set.
      if (!dueDate) {
        overdueTasks.push({
          fullName: fullName,
          taskText: taskText,
          dueDate: null,
          daysOverdue: null, // Signals "no due date" in the output.
          status: taskStatus
        });
      } else {
        const due = new Date(dueDate);
        if (!isNaN(due)) {
          due.setHours(0, 0, 0, 0);
          if (due <= today) {
            const daysOverdue = Math.floor((today - due) / 86400000);
            overdueTasks.push({
              fullName: fullName,
              taskText: taskText,
              dueDate: dueDate,
              daysOverdue: daysOverdue,
              status: taskStatus
            });
          }
        }
      }
    }
  }

  const alertsDir = path.join(__dirname, '..', 'alerts');
  fs.mkdirSync(alertsDir, { recursive: true });

  await writeStaleAlert(alertsDir, staleTasks);
  await writeOverdueAlert(alertsDir, overdueTasks);
}

async function writeStaleAlert(alertsDir, staleTasks) {
  const summary = {
    count: staleTasks.length,
    generatedAt: new Date().toISOString(),
    assignedDates: joinField(staleTasks.map(function (t) { return t.assignedDate; }), 300),
    tasks: joinField(staleTasks.map(function (t) { return t.taskText; }), 300),
    priorities: joinField(staleTasks.map(function (t) { return t.priority; }), 150),
    dueDates: joinField(staleTasks.map(function (t) { return t.dueDate; }), 300),
    statuses: joinField(staleTasks.map(function (t) { return t.status; }), 150),
    statusUpdatedOns: joinField(staleTasks.map(function (t) { return t.statusUpdatedOn; }), 300)
  };
  fs.writeFileSync(path.join(alertsDir, 'summary.json'), JSON.stringify(summary));

  if (staleTasks.length === 0) {
    console.log('No stale tasks found. Skipping stale image generation.');
    return;
  }

  const rowsHtml = staleTasks
    .map(function (t) {
      return (
        '<tr>' +
        '<td>' + (t.fullName || '-') + '</td>' +
        '<td>' + (t.taskText || '-') + '</td>' +
        '<td>' + (t.dueDate || '-') + '</td>' +
        '<td>' + (t.assignedDate || '-') + '</td>' +
        '<td>' + (t.status || '-') + '</td>' +
        '<td>' + (t.statusUpdatedOn || '-') + '</td>' +
        '</tr>'
      );
    })
    .join('');

  const html =
    '<html><head><style>' +
    'body{font-family:Arial,sans-serif;padding:20px;background:#fff;}' +
    'h2{color:#c0392b;} table{border-collapse:collapse;width:900px;}' +
    'th,td{border:1px solid #999;padding:8px;text-align:left;font-size:13px;}' +
    'th{background:#1a5276;color:#fff;}' +
    '</style></head><body>' +
    '<h2>Stale Task Alert (' + staleTasks.length + ' task(s) unchanged for 2+ days)</h2>' +
    '<table><tr><th>Owner</th><th>Task</th><th>Due Date</th><th>Assigned Date</th><th>Status</th><th>Status Updated On</th></tr>' +
    rowsHtml +
    '</table>' +
    '<p>Generated: ' + new Date().toString() + '</p>' +
    '</body></html>';

  await nodeHtmlToImage({
    output: path.join(alertsDir, 'latest-alert.png'),
    html: html,
    puppeteerArgs: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: {
        width: 1000,
        height: 800
      }
    }
  });

  console.log('Stale alert image generated with ' + staleTasks.length + ' stale task(s).');
}

async function writeOverdueAlert(alertsDir, overdueTasks) {
  const formatDateShort = function (d) {
    if (!d) return '-';
    const date = new Date(d);
    if (isNaN(date)) return String(d);
    return (date.getMonth() + 1) + '/' + date.getDate() + '/' + date.getFullYear();
  };

  const summary = {
    count: overdueTasks.length,
    generatedAt: new Date().toISOString(),
    owners: joinField(overdueTasks.map(function (t) { return t.fullName; }), 300),
    tasks: joinField(overdueTasks.map(function (t) { return t.taskText; }), 300),
    dueDates: joinField(overdueTasks.map(function (t) { return t.dueDate ? formatDateShort(t.dueDate) : 'Not set'; }), 300),
    daysOverdues: joinField(overdueTasks.map(function (t) { return t.daysOverdue === null ? 'No due date' : t.daysOverdue + ' day(s)'; }), 200),
    statuses: joinField(overdueTasks.map(function (t) { return t.status; }), 150)
  };
  fs.writeFileSync(path.join(alertsDir, 'overdue-summary.json'), JSON.stringify(summary));

  if (overdueTasks.length === 0) {
    console.log('No overdue tasks found. Skipping overdue image generation.');
    return;
  }

  const rowsHtml = overdueTasks
    .map(function (t) {
      return (
        '<tr>' +
        '<td>' + (t.fullName || '-') + '</td>' +
        '<td>' + (t.taskText || '-') + '</td>' +
        '<td>' + (t.dueDate ? formatDateShort(t.dueDate) : 'Not set') + '</td>' +
        '<td>' + (t.daysOverdue === null ? 'No due date' : t.daysOverdue + ' day(s)') + '</td>' +
        '<td>' + (t.status || '-') + '</td>' +
        '</tr>'
      );
    })
    .join('');

  const html =
    '<html><head><style>' +
    'body{font-family:Arial,sans-serif;padding:20px;background:#fff;}' +
    'h2{color:#c0392b;} table{border-collapse:collapse;width:800px;}' +
    'th,td{border:1px solid #999;padding:8px;text-align:left;font-size:13px;}' +
    'th{background:#8e2de2;color:#fff;}' +
    '</style></head><body>' +
    '<h2>Overdue &amp; Missing Due-Date Alert (' + overdueTasks.length + ' task(s))</h2>' +
    '<table><tr><th>Owner</th><th>Task</th><th>Due Date</th><th>Days Overdue</th><th>Status</th></tr>' +
    rowsHtml +
    '</table>' +
    '<p>Generated: ' + new Date().toString() + '</p>' +
    '</body></html>';

  await nodeHtmlToImage({
    output: path.join(alertsDir, 'overdue-alert.png'),
    html: html,
    puppeteerArgs: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: {
        width: 900,
        height: 800
      }
    }
  });

  console.log('Overdue alert image generated with ' + overdueTasks.length + ' overdue task(s).');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
