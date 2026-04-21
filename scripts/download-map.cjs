const https = require('https');
const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'public', 'indonesia.geojson');

if (!fs.existsSync(path.join(process.cwd(), 'public'))) {
  fs.mkdirSync(path.join(process.cwd(), 'public'));
}

https.get('https://raw.githubusercontent.com/ansyyy/indonesia-geojson/master/indonesia-prov.geojson', (res) => {
  const file = fs.createWriteStream(target);
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('Downloaded map');
  });
});
