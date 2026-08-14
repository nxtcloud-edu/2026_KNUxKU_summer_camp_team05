import type { IncomingMessage, ServerResponse } from 'node:http';
import { appPromise } from '../server.js';

const ready = appPromise.then(async (app) => {
  await app.ready();
  return app;
});

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const app = await ready;
  const url = new URL(request.url ?? '/', 'http://internal');
  const path = url.searchParams.get('__path') ?? '';
  url.searchParams.delete('__path');
  const query = url.searchParams.toString();
  request.url = `/${path}${query.length === 0 ? '' : `?${query}`}`;
  app.server.emit('request', request, response);
}
