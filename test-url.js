const https = require('https');
https.get('https://raw.githubusercontent.com/superpikar/indonesia-geojson/master/indonesia.json', (res) => {
  console.log('Status Code:', res.statusCode);
  res.resume(); // consume response data to free up memory
}).on('error', (e) => {
  console.error(e);
});