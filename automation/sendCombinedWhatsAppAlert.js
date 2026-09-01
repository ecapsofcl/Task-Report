// Sends ONE combined daily alert covering stale, overdue, and missing-due-date
// tasks via Interakt. Replaces the separate stale-only and overdue-only senders.
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY;
const ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER;
const ADMIN_COUNTRY_CODE = process.env.ADMIN_COUNTRY_CODE || '+91';
const COMBINED_PUBLIC_IMAGE_URL = process.env.COMBINED_PUBLIC_IMAGE_URL;
const COMBINED_WHATSAPP_TEMPLATE_NAME = process.env.COMBINED_WHATSAPP_TEMPLATE_NAME || 'combined_task_alert';

function parseNumbers(raw) {
  return (raw || '')
    .split(',')
    .map(function (n) { return n.trim(); })
    .filter(function (n) { return n.length > 0; });
}

async function sendToNumber(phoneNumber, summary) {
  // Template body placeholders, in order:
  // {{1}} Stale count, {{2}} Overdue count, {{3}} No Due Date count, {{4}} Total count
  const body = {
    countryCode: ADMIN_COUNTRY_CODE,
    phoneNumber: phoneNumber,
    type: 'Template',
    template: {
      name: COMBINED_WHATSAPP_TEMPLATE_NAME,
      languageCode: 'en',
      headerValues: [COMBINED_PUBLIC_IMAGE_URL],
      bodyValues: [
        String(summary.staleCount),
        String(summary.overdueCount),
        String(summary.noDueDateCount),
        String(summary.count)
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
  const summaryPath = path.join(__dirname, '..', 'alerts', 'combined-summary.json');
  if (!fs.existsSync(summaryPath)) {
    console.log('No combined-summary.json found, nothing to send.');
    return;
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  if (!summary.count || summary.count === 0) {
    console.log('No stale, overdue, or missing-due-date tasks, skipping WhatsApp send.');
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
        'Failed to send combined alert to ' + number + ':',
        err.response ? JSON.stringify(err.response.data) : err.message
      );
    }
  }

  if (failureCount > 0 && failureCount === numbers.length) {
    process.exit(1);
  }
}
main().catch(function (err) {
  console.error('Unexpected error sending combined alerts:', err.message);
  process.exit(1);
});
