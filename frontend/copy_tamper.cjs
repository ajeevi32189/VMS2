const fs = require('fs');
const src = fs.readFileSync('src/Component/Pages/Analytics/AbandonedObject.jsx', 'utf8');
let dst = src
  .replace(/AbandonedObject/g, 'TamperDetection')
  .replace(/Abandoned Object/g, 'Tamper Detection')
  .replace(/abandoned object/g, 'tamper detection')
  .replace(/isAbandonedAlert/g, 'isTamperAlert')
  .replace(/isAbandoned/g, 'isTamper')
  .replace(/abandonedAlertsOnly/g, 'tamperAlertsOnly')
  .replace(/allAbandonedAlerts/g, 'allTamperAlerts')
  .replace(/"abandoned"/g, '"tamper"')
  .replace(/📦/g, '⚠️');
fs.writeFileSync('src/Component/Pages/Analytics/TamperDetection.jsx', dst);
console.log('Done');
