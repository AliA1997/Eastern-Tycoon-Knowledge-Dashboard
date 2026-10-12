// Server-sent events: pushes UI-queue status and reload signals to open pages.
export function createEventHub() {
  const clients = new Set();
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 25_000);
  heartbeat.unref();
  return {
    handle(req, res) {
      clients.add(res);
      req.on('close', () => clients.delete(res));
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
    },
    send(event, data) {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of clients) res.write(message);
    },
    close() {
      clearInterval(heartbeat);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
