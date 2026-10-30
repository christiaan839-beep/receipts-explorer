"""serve.py: serves the site at the root, and nothing outside it, to this machine only."""

from __future__ import annotations

import http.client
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import serve
from app.pages import all_routes

ROOT = Path(__file__).resolve().parent.parent

# Paths that reach files outside what the site publishes, in the spellings that once got through.
ESCAPES = (
    "/static/%2e%2e/.env",
    "/static%2f..%2f.env",
    "/static/..%2f.env",
    "/static/%2e%2e/.git/config/",
    "/static/%2e%2e/.git/config",
    "/static/%2e%2e/app/content.py",
    "/static/../app/content.py",
    "/static/%2e%2e/%2e%2e/.env",
    "/%2e%2e/build.py",
    "/../serve.py",
    "/%2e%2e/serve.py",
    "/static/%2e%2e/package.json",
    "/static/%2e%2e/build/check.js",
    "//etc/hosts",
    "/static//etc/hosts",
    "/static/%2e%2e/%2e%2e/%2e%2e/etc/hosts",
    "/static/.%2e/LICENSE",
    "/static/.hidden",
)

# Paths that must never redirect off this server.
STRANGE = (
    "//evil.example",
    "//evil.example/",
    "//evil",
    "/%2F%2Fevil.example",
    "/%2F%2Fevil.example/",
    "/x%0d%0aSet-Cookie:%20a=b",
    "/x%0d%0aLocation:%20https://evil.example/",
    "/terms%0d%0aX-Injected:%201",
    "/terms%00",
    "/%0a",
)


class Server:
    def __init__(self, handler: type[serve.Handler]) -> None:
        self.httpd = serve.Server(("127.0.0.1", 0), handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()

    def get(self, path: str, host: str | None = None, method: str = "GET") -> tuple[int, http.client.HTTPMessage, bytes]:
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
            conn.putheader("Host", f"127.0.0.1:{self.port}" if host is None else host)
            conn.endheaders()
            response = conn.getresponse()
            return response.status, response.headers, response.read()
        finally:
            conn.close()


class Quiet(serve.Handler):
    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        pass


class Live(Quiet):
    dist = False


class Dist(Quiet):
    dist = True


class ServeTests(unittest.TestCase):
    """The tests both modes must pass; run only through the two classes below."""

    server: Server

    def assertSafe(self, path: str) -> None:  # noqa: N802
        status, headers, _ = self.server.get(path)
        self.assertIn(status, (301, 404), path)
        location = headers.get("Location")
        if location is not None:
            self.assertTrue(location.startswith("/"), (path, location))
            self.assertFalse(location.startswith("//"), (path, location))
        for name in headers:
            self.assertNotIn(name.lower(), ("set-cookie", "x-injected"), path)

    def test_nothing_outside_the_site_is_served(self) -> None:
        for path in ESCAPES:
            status, _, body = self.server.get(path)
            self.assertEqual(status, 404, path)
            self.assertIn(b"<!doctype html>", body.lower(), path)

    def test_strange_paths_never_redirect_elsewhere(self) -> None:
        for path in STRANGE:
            status, headers, _ = self.server.get(path)
            self.assertEqual(status, 404, path)
            self.assertIsNone(headers.get("Location"), path)
            self.assertSafe(path)

    def test_the_site_redirects_only_within_itself(self) -> None:
        for path, location in (
            ("/glossary", "/glossary/"),
            ("/how-it-works", "/how-it-works/"),
            ("/glossary/receipt", "/glossary/receipt/"),
        ):
            status, headers, _ = self.server.get(path)
            self.assertEqual((status, headers.get("Location")), (301, location), path)

    def test_the_root_is_the_check_page_not_a_redirect(self) -> None:
        status, headers, body = self.server.get("/")
        self.assertEqual(status, 200)
        self.assertIsNone(headers.get("Location"))
        self.assertIn(b"<h1>Check a receipt</h1>", body)

    def test_every_page_without_its_slash_redirects_to_the_page(self) -> None:
        for route in all_routes():
            if route == "/":
                continue
            status, headers, _ = self.server.get(route.rstrip("/"))
            self.assertEqual((status, headers.get("Location")), (301, route), route)

    def test_a_missing_path_is_not_found_rather_than_redirected(self) -> None:
        for path in (
            "/nope",
            "/glossary/nope",
            "/nope/",
            "/elsewhere/",
            "/nope.zz",
        ):
            status, headers, _ = self.server.get(path)
            self.assertEqual(status, 404, path)
            self.assertIsNone(headers.get("Location"), path)
            self.assertEqual(headers["Content-Type"], "text/html; charset=utf-8")

    def test_only_this_machine_s_names_are_answered(self) -> None:
        port = self.server.port
        for host in (f"127.0.0.1:{port}", f"localhost:{port}"):
            status, _, _ = self.server.get("/", host=host)
            self.assertEqual(status, 200, host)
        for host in (
            "attacker.example",
            f"attacker.example:{port}",
            "127.0.0.1",
            "localhost",
            f"127.0.0.1:{port + 1}",
            f"localhost.attacker.example:{port}",
            "",
        ):
            for path in ("/", "/static/styles.css", "/static/%2e%2e/.env", "/glossary/"):
                status, headers, body = self.server.get(path, host=host)
                self.assertEqual(status, 421, (host, path))
                self.assertIsNone(headers.get("Location"))
                self.assertNotIn(b"<html", body.lower())

    def test_each_file_has_its_type_and_no_sniffing(self) -> None:
        for path, ctype in (
            ("/", "text/html; charset=utf-8"),
            ("/index.html", "text/html; charset=utf-8"),
            ("/glossary/", "text/html; charset=utf-8"),
            ("/glossary/index.html", "text/html; charset=utf-8"),
            ("/static/styles.css", "text/css; charset=utf-8"),
            ("/static/check.js", "text/javascript; charset=utf-8"),
            ("/static/img/favicon.svg", "image/svg+xml"),
            ("/robots.txt", "text/plain; charset=utf-8"),
            ("/sitemap.xml", "application/xml; charset=utf-8"),
        ):
            status, headers, body = self.server.get(path)
            self.assertEqual((status, headers["Content-Type"]), (200, ctype), path)
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff", path)
            self.assertEqual(int(headers["Content-Length"]), len(body), path)
        for path, host in (("/nope/", None), ("/glossary", None), ("/", "attacker.example")):
            _, headers, _ = self.server.get(path, host=host)
            self.assertEqual(headers["X-Content-Type-Options"], "nosniff", path)

    def test_the_script_is_the_bundle(self) -> None:
        _, _, body = self.server.get("/static/check.js")
        self.assertEqual(body, (ROOT / "build" / "check.js").read_bytes())

    def test_head_sends_headers_only(self) -> None:
        _, _, body = self.server.get("/static/styles.css")
        with socket.create_connection(("127.0.0.1", self.server.port), timeout=10) as sock:
            sock.sendall(f"HEAD /static/styles.css HTTP/1.0\r\nHost: 127.0.0.1:{self.server.port}\r\n\r\n".encode("ascii"))
            raw = b""
            while chunk := sock.recv(65536):
                raw += chunk
        head, _, rest = raw.partition(b"\r\n\r\n")
        self.assertTrue(head.startswith(b"HTTP/1.0 200"), head)
        self.assertIn(f"Content-Length: {len(body)}".encode("ascii"), head)
        self.assertEqual(rest, b"")


class ServerTest(unittest.TestCase):
    def test_it_binds_without_looking_up_its_name(self) -> None:
        with mock.patch("socket.getfqdn", side_effect=AssertionError("looked up its name")):
            server = Server(Live)
        try:
            self.assertEqual((server.httpd.server_name, server.httpd.server_port), ("127.0.0.1", server.port))
            self.assertNotEqual(server.port, 0)
        finally:
            server.close()


class LiveServeTest(ServeTests):
    @classmethod
    def setUpClass(cls) -> None:
        # static/ as a copy, with a file only it has, a hidden file and a link out of it.
        cls.tmp = tempfile.TemporaryDirectory()
        cls.static = Path(cls.tmp.name) / "site-static"
        shutil.copytree(ROOT / "static", cls.static)
        (cls.static / "only-here.txt").write_text("only here\n", encoding="utf-8")
        (cls.static / ".hidden.txt").write_text("hidden\n", encoding="utf-8")
        (Path(cls.tmp.name) / "secret.txt").write_text("SECRET=1\n", encoding="utf-8")
        (cls.static / "link.txt").symlink_to(Path(cls.tmp.name) / "secret.txt")
        cls.server = Server(type("LiveAt", (Live,), {"static_dir": cls.static}))

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.close()
        cls.tmp.cleanup()

    def test_static_files_come_from_static(self) -> None:
        for rel in ("styles.css", "img/favicon.svg", "only-here.txt"):
            status, _, body = self.server.get("/static/" + rel)
            self.assertEqual((status, body), (200, (self.static / rel).read_bytes()), rel)

    def test_hidden_files_and_links_out_of_static_are_not_served(self) -> None:
        for rel in (".hidden.txt", "link.txt", "%2e%2e/secret.txt", "..%2fsecret.txt"):
            status, _, body = self.server.get("/static/" + rel)
            self.assertEqual(status, 404, rel)
            self.assertNotIn(b"SECRET", body)
            self.assertNotIn(b"hidden", body)

    def test_the_default_static_files_are_static(self) -> None:
        self.assertEqual(serve.Handler.static_dir, ROOT / "static")


class DistServeTest(ServeTests):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name) / "dist"
        subprocess.run([sys.executable, str(ROOT / "build.py"), "--out", str(cls.out)], check=True, capture_output=True)
        # A file beside the built site, which must stay out of reach.
        (Path(cls.tmp.name) / ".env").write_text("SECRET=1\n", encoding="utf-8")
        # Pages only this build has: one whose name needs quoting in a Location, one whose name would split headers.
        for name in ("a b", "x\r\nSet-Cookie: a=b", ".hidden-page"):
            (cls.out / name).mkdir()
            (cls.out / name / "index.html").write_text("<!doctype html><title>t</title>\n", encoding="utf-8")
        with (cls.out / "404.html").open("a", encoding="utf-8") as f:
            f.write("<!-- this build -->\n")
        handler = type("DistAt", (Dist,), {"dist_dir": cls.out})
        cls.server = Server(handler)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.close()
        cls.tmp.cleanup()

    def test_files_come_from_the_built_site(self) -> None:
        for rel in ("index.html", "glossary/index.html", "404.html", "static/styles.css", "robots.txt"):
            status, _, body = self.server.get("/" + rel)
            self.assertEqual((status, body), (200, (self.out / rel).read_bytes()), rel)

    def test_a_redirect_quotes_the_path(self) -> None:
        status, headers, _ = self.server.get("/a%20b")
        self.assertEqual((status, headers.get("Location")), (301, "/a%20b/"))
        status, _, _ = self.server.get("/a%20b/")
        self.assertEqual(status, 200)

    def test_a_hidden_directory_is_not_redirected_to(self) -> None:
        self.assertTrue((self.out / ".hidden-page" / "index.html").is_file())
        status, headers, _ = self.server.get("/.hidden-page")
        self.assertEqual(status, 404)
        self.assertIsNone(headers.get("Location"))

    def test_a_path_with_a_line_break_is_not_found_even_where_a_page_has_that_name(self) -> None:
        for path in ("/x%0d%0aSet-Cookie:%20a=b", "/x%0d%0aSet-Cookie:%20a=b/"):
            status, headers, _ = self.server.get(path)
            self.assertEqual(status, 404, path)
            self.assertIsNone(headers.get("Location"), path)
            self.assertIsNone(headers.get("Set-Cookie"), path)

    def test_not_found_is_the_built_404_page(self) -> None:
        status, _, body = self.server.get("/nope/")
        self.assertEqual((status, body), (404, (self.out / "404.html").read_bytes()))

    def test_the_default_site_is_dist(self) -> None:
        self.assertEqual(serve.Handler.dist_dir, ROOT / "dist")


del ServeTests

if __name__ == "__main__":
    unittest.main()
