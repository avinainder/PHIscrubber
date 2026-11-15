"""Static dev server with caching disabled.

Plain `python3 -m http.server` sends only Last-Modified, which lets browsers
heuristically cache ES modules and serve stale code after edits.
"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    ThreadingHTTPServer(('', 8742), NoCacheHandler).serve_forever()
