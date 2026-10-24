#!/usr/bin/env python3
"""The development server, in the standard library only.

Usage:  python3 serve.py [port]           render pages live from app/ (default port 8000)
        python3 serve.py --dist [port]    serve the built dist/, as GitHub Pages does

Both serve the site under /receipts-explorer/, as GitHub Pages does, and
answer unknown paths with the 404 page. Live mode reads static/ and
build/check.js (run npm run bundle first) on every request.
"""

from __future__ import annotations

import posixpath
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from app.assets import SCRIPT, hashes  # noqa: E402
from app.content import SITE  # noqa: E402
from app.pages import render_not_found, render_route  # noqa: E402
from build import DIST, robots, sitemap  # noqa: E402

BASE = SITE["base_path"]
TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".html": "text/html; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
}


def inside(base: Path, rel: str) -> Path | None:
    """`rel` under `base`, or None if it escapes `base` or is not a file."""
    path = (base / rel).resolve()
    if base.resolve() not in path.parents or not path.is_file():
        return None
    return path


class Handler(BaseHTTPRequestHandler):
    server_version = "receipts-explorer-dev"
    dist = False

    def _send(self, body: bytes | str, status: int = 200, ctype: str = "text/html; charset=utf-8", location: str = "") -> None:
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        if location:
            self.send_header("Location", location)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        path = unquote(urlparse(self.path).path)
        if path in ("/", BASE):
            return self._send("", status=301, location=BASE + "/")
        if not path.endswith("/") and "." not in posixpath.basename(path):
            return self._send("", status=301, location=path + "/")
        if not path.startswith(BASE + "/"):
            return self._not_found()
        rel = path[len(BASE) + 1 :]
        if self.dist:
            return self._file(DIST, rel + "index.html" if rel == "" or rel.endswith("/") else rel)
        if rel == "robots.txt":
            return self._send(robots(), ctype=TYPES[".txt"])
        if rel == "sitemap.xml":
            return self._send(sitemap(), ctype=TYPES[".xml"])
        if rel == "static/check.js":
            return self._send(SCRIPT.read_bytes(), ctype=TYPES[".js"])
        if rel.startswith("static/"):
            return self._file(ROOT, rel)
        html = render_route("/" + rel, hashes())
        if html is None:
            return self._not_found()
        return self._send(html)

    def _file(self, base: Path, rel: str) -> None:
        path = inside(base, rel)
        if path is None:
            return self._not_found()
        ext = posixpath.splitext(path.name)[1]
        return self._send(path.read_bytes(), ctype=TYPES.get(ext, "application/octet-stream"))

    def _not_found(self) -> None:
        if self.dist:
            return self._send((DIST / "404.html").read_bytes(), status=404)
        return self._send(render_not_found(hashes()), status=404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        sys.stderr.write("  " + (format % args) + "\n")


def main() -> None:
    args = sys.argv[1:]
    Handler.dist = "--dist" in args
    ports = [a for a in args if a != "--dist"]
    port = int(ports[0]) if ports else 8000
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    mode = "dist/" if Handler.dist else "live render"
    print(f"receipts-explorer ({mode}) -> http://127.0.0.1:{port}{BASE}/   (Ctrl+C to stop)", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()


if __name__ == "__main__":
    main()
