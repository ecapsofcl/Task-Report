// Sends the daily overdue-task alert image + details to one or more admin
// WhatsApp numbers via Interakt. Same numbers/country code as the stale-task
// alert (ADMIN_WHATSAPP_NUMBER, ADMIN_COUNTRY_CODE), but a separate template
// and separate image, since the fields differ.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY;
const ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER;
const ADMIN_COUNTRY_CODE = process.env.ADMIN_COUNTRY_CODE || '+91';
const OVERDUE_PUBLIC_IMAGE_URL = process.env.OVERDUE_PUBLIC_IMAGE_URL;
const OVERDUE_WHATSAPP_TEMPLATE_NAME = process.env.OVERDUE_WHATSAPP_TEMPLATE_NAME || 'overdue_task_alert';

function parseNumbers(raw) {
  return (raw || '')
    .split(',')
    .map(function (n) { return n.trim(); })
    .filter(function (n) { return n.length > 0; });
}

async function sendToNumber(phoneNumber, summary) {
  // Template body placeholders, in order:
  // {{1}} Owner, {{2}} Task, {{3}} Due Date, {{4}} Days Overdue, {{5}} Status
  const body = {
    countryCode: ADMIN_COUNTRY_CODE,
    phoneNumber: phoneNumber,
    type: 'Template',
    template: {
      name: OVERDUE_WHATSAPP_TEMPLATE_NAME,
      languageCode: 'en',
      headerValues: [OVERDUE_PUBLIC_IMAGE_URL],
      bodyValues: [
        summary.owners,
        summary.tasks,
        summary.dueDates,
        summary.daysOverdues,
        summary.statuses
      ]
    }
  };

  const res = await axios.post('https://api.interakt.ai/v1/public/message/', body, {
    headers: {
      Authorization: 'Basic ' + INTERAKT_API_KEY,
      'Content-Type': 'application/json'
    }
  });
  console.log('Interakt response for ' + phoneNumber + ':', res.status, JSON.stringify(res.data));
}

async function main() {
  const summaryPath = path.join(__dirname, '..', 'alerts', 'overdue-summary.json');
  if (!fs.existsSync(summaryPath)) {
    console.log('No overdue-summary.json found, nothing to send.');
    return;
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  if (!summary.count || summary.count === 0) {
    console.log('No overdue tasks, skipping WhatsApp send.');
    return;
  }

  const numbers = parseNumbers(ADMIN_WHATSAPP_NUMBER);
  if (numbers.length === 0) {
    console.log('No WhatsApp numbers configured, skipping send.');
    return;
  }

  let failureCount = 0;
  for (const number of numbers) {
    try {
      await sendToNumber(number, summary);
    } catch (err) {
      failureCount++;
      console.error(
        'Failed to send overdue alert to ' + number + ':',
        err.response ? JSON.stringify(err.response.data) : err.message
      );
    }
  }

  if (failureCount > 0 && failureCount === numbers.length) {
    process.exit(1);
  }
}
main().catch(function (err) {
  console.error('Unexpected error sending overdue alerts:', err.message);
  process.exit(1);
});
