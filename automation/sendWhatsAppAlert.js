// Sends the generated alert image + task details to the admin's WhatsApp via Interakt.
// Verified against Interakt's documented Send WhatsApp Template API
// (https://api.interakt.ai/v1/public/message/, Basic-auth with API key).
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY;
const ADMIN_WHATSAPP_NUMBER = process.env.ADMIN_WHATSAPP_NUMBER;
const ADMIN_COUNTRY_CODE = process.env.ADMIN_COUNTRY_CODE || '+91';
const PUBLIC_IMAGE_URL = process.env.PUBLIC_IMAGE_URL;
const WHATSAPP_TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || 'task_stale_alert';

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

  // Template body placeholders, in order:
  // {{1}} Task Assigned Date, {{2}} Task, {{3}} Priority,
  // {{4}} Due Date, {{5}} Status, {{6}} Status Updated On
  const body = {
    countryCode: ADMIN_COUNTRY_CODE,
    phoneNumber: ADMIN_WHATSAPP_NUMBER,
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
  console.log('Interakt response:', res.status, JSON.stringify(res.data));
}
main().catch(function(err) {
  console.error('Failed to send WhatsApp alert:', err.response ? JSON.stringify(err.response.data) : err.message);
  process.exit(1);
});
