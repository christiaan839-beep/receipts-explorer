#!/usr/bin/env python3
"""The development server, in the standard library only.

Usage:  python3 serve.py [port]           render pages live from app/ (default port 8000)
        python3 serve.py --dist [port]    serve the built dist/, as GitHub Pages does

Both serve the site at the root, /, as GitHub Pages does, and
answer unknown paths with the 404 page. Live mode reads static/ and
build/check.js (run npm run bundle first) on every request.

The server listens on 127.0.0.1 only, and answers only requests addressed
to 127.0.0.1:<port> or localhost:<port>, so a web page cannot reach it
through a name of its own (DNS rebinding). It serves nothing outside
static/ and build/check.js (live) or dist/ (--dist), and no hidden file.
"""

from __future__ import annotations

import posixpath
import socketserver
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from app.assets import SCRIPT, hashes  # noqa: E402
from app.content import SITE  # noqa: E402
from app.pages import render_not_found, render_route  # noqa: E402
from build import DIST, robots, sitemap  # noqa: E402

BASE = SITE["base_path"]
STATIC = ROOT / "static"
HOSTS = ("127.0.0.1", "localhost")
TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".html": "text/html; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
}


def inside(base: Path, rel: str) -> Path | None:
    """The file `rel` names under `base`, or None if it is hidden, escapes `base` or is not a file."""
    if any(part.startswith(".") for part in rel.split("/")):
        return None
    try:
        root = base.resolve()
        path = (root / rel).resolve()
        if root not in path.parents or not path.is_file():
            return None
    except (OSError, ValueError):
        return None
    return path


class Server(ThreadingHTTPServer):
    """A ThreadingHTTPServer that does not look up its own name, which can take half a minute."""

    def server_bind(self) -> None:
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name, self.server_port = str(host), int(port)


class Handler(BaseHTTPRequestHandler):
    server_version = "receipts-explorer-dev"
    dist = False
    dist_dir = DIST
    static_dir = STATIC

    def _send(self, body: bytes | str, status: int = 200, ctype: str = "text/html; charset=utf-8", location: str = "") -> None:
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        if location:
            self.send_header("Location", location)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        port = self.server.server_address[1]
        if self.headers.get("Host", "") not in {f"{host}:{port}" for host in HOSTS}:
            return self._send("Misdirected request: use 127.0.0.1 or localhost, with the port.\n", status=421, ctype=TYPES[".txt"])
        path = unquote(urlparse(self.path).path)
        if any(c in path for c in "\r\n\0"):
            return self._not_found()
        if BASE and path in ("/", BASE):
            return self._send("", status=301, location=BASE + "/")
        if not path.startswith(BASE + "/"):
            return self._not_found()
        rel = path[len(BASE) + 1 :]
        if rel and not rel.endswith("/") and "." not in posixpath.basename(rel):
            if self._find(rel + "/") is None:
                return self._not_found()
            return self._send("", status=301, location=quote(path) + "/")
        found = self._find(rel)
        if found is None:
            return self._not_found()
        body, ctype = found
        return self._send(body, ctype=ctype)

    def _find(self, rel: str) -> tuple[bytes | str, str] | None:
        """The body and type of the file or page at `rel` (under the base path), or None."""
        if rel == "" or rel.endswith("/"):
            rel += "index.html"
        if self.dist:
            return self._file(self.dist_dir, rel)
        if rel == "robots.txt":
            return robots(), TYPES[".txt"]
        if rel == "sitemap.xml":
            return sitemap(), TYPES[".xml"]
        if rel == "static/check.js":
            return SCRIPT.read_bytes(), TYPES[".js"]
        if rel.startswith("static/"):
            return self._file(self.static_dir, rel[len("static/") :])
        if rel == "index.html" or rel.endswith("/index.html"):
            html = render_route("/" + rel[: -len("index.html")], hashes())
            return None if html is None else (html, TYPES[".html"])
        return None

    def _file(self, base: Path, rel: str) -> tuple[bytes, str] | None:
        path = inside(base, rel)
        if path is None:
            return None
        ext = posixpath.splitext(path.name)[1]
        return path.read_bytes(), TYPES.get(ext, "application/octet-stream")

    def _not_found(self) -> None:
        if self.dist:
            return self._send((self.dist_dir / "404.html").read_bytes(), status=404)
        return self._send(render_not_found(hashes()), status=404)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        sys.stderr.write("  " + (format % args) + "\n")


def main() -> None:
    args = sys.argv[1:]
    Handler.dist = "--dist" in args
    ports = [a for a in args if a != "--dist"]
    port = int(ports[0]) if ports else 8000
    httpd = Server(("127.0.0.1", port), Handler)
    mode = "dist/" if Handler.dist else "live render"
    print(f"receipts-explorer ({mode}) -> http://127.0.0.1:{port}{BASE}/   (Ctrl+C to stop)", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.server_close()


if __name__ == "__main__":
    main()
