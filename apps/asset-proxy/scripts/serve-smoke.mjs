import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const smokeDirectory = new URL('../smoke/', import.meta.url);

createServer(async (request, response) => {
  const path = request.url === '/captions.vtt' ? 'captions.vtt' : 'index.html';
  const body = await readFile(new URL(path, smokeDirectory));
  response.writeHead(200, {
    'Content-Type': path.endsWith('.vtt')
      ? 'text/vtt; charset=utf-8'
      : 'text/html; charset=utf-8',
  });
  response.end(body);
}).listen(8788, '127.0.0.1');
