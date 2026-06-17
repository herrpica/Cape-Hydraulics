// Minimal static file server for HydroStick.
// HydroStick is a pure browser app (no build step), but hosts like Railway
// detect package.json and expect a `start` command that binds to $PORT.
// This serves the repo's static files and honors the platform PORT/HOST.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

http
  .createServer((req, res) => {
    let urlPath = decodeURI(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    // Resolve within ROOT to prevent path traversal.
    const filePath = path.join(ROOT, path.normalize(urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.statusCode = 403;
      return res.end('forbidden');
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.statusCode = 404;
        return res.end('not found');
      }
      res.setHeader('Content-Type', TYPES[path.extname(filePath)] || 'application/octet-stream');
      res.end(data);
    });
  })
  .listen(PORT, HOST, () => console.log('HydroStick on http://' + HOST + ':' + PORT));
