// Sends the generated alert image + task details to one or more admin WhatsApp
// numbers via Interakt. Verified against Interakt's documented Send WhatsApp
// Template API (https://api.interakt.ai/v1/public/message/, Basic-auth with API key).
//
// ADMIN_WHATSAPP_NUMBER supports multiple recipients: separate numbers with commas,
// e.g. "9876543210,9123456789". All numbers must share the same ADMIN_COUNTRY_CODE.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY;
const ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER;
const ADMIN_COUNTRY_CODE = process.env.ADMIN_COUNTRY_CODE || '+91';
const PUBLIC_IMAGE_URL = process.env.PUBLIC_IMAGE_URL;
const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || 'task_stale_alert';

function parseNumbers(raw) {
  return (raw || '')
    .split(',')
    .map(function (n) { return n.trim(); })
    .filter(function (n) { return n.length > 0; });
}

async function sendToNumber(phoneNumber, summary) {
  // Template body placeholders, in order:
  // {{1}} Task Assigned Date, {{2}} Task, {{3}} Priority,
  // {{4}} Due Date, {{5}} Status, {{6}} Status Updated On
  const body = {
    countryCode: ADMIN_COUNTRY_CODE,
    phoneNumber: phoneNumber,
    type: 'Template',
    template: {
      name: WHATSAPP_TEMPLATE_NAME,
      languageCode: 'en',
      headerValues: [PUBLIC_IMAGE_URL],
      bodyValues: [
        summary.assignedDates,
        summary.tasks,
        summary.priorities,
        summary.dueDates,
        summary.statuses,
        summary.statusUpdatedOns
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
  const summaryPath = path.join(__dirname, '..', 'alerts', 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    console.log('No summary.json found, nothing to send.');
    return;
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  if (!summary.count || summary.count === 0) {
    console.log('No stale tasks, skipping WhatsApp send.');
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
        'Failed to send WhatsApp alert to ' + number + ':',
        err.response ? JSON.stringify(err.response.data) : err.message
      );
    }
  }

  if (failureCount > 0 && failureCount === numbers.length) {
    // All sends failed - exit with a non-zero code so the Action run shows as failed.
    process.exit(1);
  }
}
main().catch(function (err) {
  console.error('Unexpected error sending WhatsApp alerts:', err.message);
  process.exit(1);
});
