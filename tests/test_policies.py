"""The policies and security.txt: what they say holds for the code, and security.txt parses and is not expired."""

from __future__ import annotations

import html
import re
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.content import ADVISORY_REPOS, REPOS, SITE
from app.layout import CSP
from app.pages import all_routes, render_not_found, render_route
from app.policies import security_txt

ROOT = Path(__file__).resolve().parent.parent
ASSETS = {"styles": "sha384-styles", "script": "sha384-script"}
PAGES = {route: render_route(route, ASSETS) or "" for route in all_routes()}
PAGES["/404.html"] = render_not_found(ASSETS)

# RFC 9116 section 2.5: the fields it defines. Contact and Expires are required.
FIELDS = {"acknowledgments", "canonical", "contact", "encryption", "expires", "hiring", "policy", "preferred-languages", "csaf"}


def parse_security_txt(text: str) -> dict[str, list[str]]:
    """Fields of a security.txt (RFC 9116 section 4), lower-cased; raises ValueError on a line it does not allow."""
    if not text.endswith("\n"):
        raise ValueError("does not end with a line break")
    fields: dict[str, list[str]] = {}
    for line in text.splitlines():
        if line == "" or line.startswith("#"):
            continue
        m = re.fullmatch(r"([A-Za-z0-9-]+): (\S.*)", line)
        if m is None:
            raise ValueError(f"not a field: {line!r}")
        fields.setdefault(m.group(1).lower(), []).append(m.group(2))
    return fields


def text(page: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", page)))


class SecurityTxtTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fields = parse_security_txt(security_txt())

    def test_it_has_the_fields_rfc_9116_requires_and_only_known_ones(self) -> None:
        self.assertLessEqual(set(self.fields), FIELDS)
        self.assertEqual(
            self.fields["contact"],
            [f"{REPOS['receipts-explorer']}/security/advisories/new", f"mailto:{SITE['email']}"],
        )
        self.assertEqual(len(self.fields["expires"]), 1)
        self.assertEqual(self.fields["preferred-languages"], ["en"])
        self.assertEqual(self.fields["canonical"], ["https://verify.sovereignmatrix.co.za/.well-known/security.txt"])
        self.assertEqual(self.fields["policy"], ["https://verify.sovereignmatrix.co.za/security/"])
        self.assertIn("/security/", all_routes())
        for uri in self.fields["contact"] + self.fields["canonical"] + self.fields["policy"]:
            self.assertTrue(uri.startswith(("https://", "mailto:")), uri)

    def test_it_is_not_expired_and_not_set_too_far_ahead(self) -> None:
        expires = datetime.fromisoformat(self.fields["expires"][0].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        # RFC 9116 2.5.5: less than a year ahead is recommended. Renew it when 30 days are left.
        self.assertGreater(expires - now, timedelta(days=30), "security.txt expires within 30 days: renew SECURITY_TXT_EXPIRES")
        self.assertLess(expires - now, timedelta(days=366))

    def test_the_parser_refuses_what_rfc_9116_does(self) -> None:
        for bad in ("Contact: x", "Contact:x\n", "Contact x\n", " Contact: x\n"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                parse_security_txt(bad)

    def test_deploy_uploads_hidden_files(self) -> None:
        # upload-pages-artifact v5 leaves out .well-known/ unless include-hidden-files is true.
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text(encoding="utf-8")
        step = workflow[workflow.index("actions/upload-pages-artifact@") :]
        step = step[: step.index("\n  deploy:")]
        self.assertRegex(step, r"\n\s+include-hidden-files: true\n")


class PrivacyTest(unittest.TestCase):
    page = text(PAGES["/privacy/"])

    def test_the_site_stores_nothing_and_sets_no_cookie(self) -> None:
        # What the privacy policy says, held to the code the browser runs.
        self.assertIn("No cookies, no storage, no analytics.", self.page)
        for path in sorted((ROOT / "src").rglob("*.ts")):
            source = path.read_text(encoding="utf-8")
            for word in ("localStorage", "sessionStorage", "indexedDB", "document.cookie", "serviceWorker", "sendBeacon", "caches."):
                self.assertNotIn(word, source, f"{path.name} uses {word}")

    def test_only_the_log_is_ever_asked_for_anything(self) -> None:
        fetching = [p.name for p in sorted((ROOT / "src").rglob("*.ts")) if re.search(r"\bfetch\(", p.read_text(encoding="utf-8"))]
        self.assertEqual(fetching, ["log-client.ts"])
        directives = dict(d.split(" ", 1) for d in CSP.split("; "))
        for name in ("script-src", "style-src", "img-src"):
            self.assertNotIn("http", directives[name], name)

    def test_it_names_the_operator_the_information_officer_and_both_routes_of_complaint(self) -> None:
        for words in (
            "Sovereign Matrix runs this site",
            "Information Officer (POPIA): Sovereign Matrix",
            SITE["email"],
            "Information Regulator",
            "section 74 of POPIA",
            "article 77 of the GDPR",
            "IP address is logged",
            "GitHub General Privacy Statement",
        ):
            self.assertIn(words, self.page)
        for href in ("https://inforegulator.org.za/complaints/", "https://www.edpb.europa.eu/", "https://docs.github.com/en/site-policy/"):
            self.assertIn(href, PAGES["/privacy/"])


class TermsAndSecurityTest(unittest.TestCase):
    def test_the_terms_say_south_african_law_as_is_and_not_advice(self) -> None:
        page = text(PAGES["/terms/"])
        for words in ("law of the Republic of South Africa", "provided as is", "without warranty", "does not give legal, compliance"):
            self.assertIn(words, page)

    def test_the_security_page_links_private_reporting_on_each_repository_that_has_it(self) -> None:
        page = PAGES["/security/"]
        for repo in ADVISORY_REPOS:
            self.assertIn(f'href="{REPOS[repo]}/security/advisories/new"', page)
        self.assertNotIn("sovereign-agents/security/advisories", page)
        self.assertIn(f"mailto:{SITE['email']}", page)
        self.assertIn('href="/.well-known/security.txt"', page)


class ClaimsTest(unittest.TestCase):
    def test_no_page_promises_compliance_or_a_guarantee(self) -> None:
        for route, page in PAGES.items():
            words = text(page)
            with self.subTest(route=route):
                for m in re.finditer(r"(?i)\b(compliant|compliance|guarantee\w*|tamper-?proof|certif\w+)\b", words):
                    before = words[max(0, m.start() - 60) : m.start()].lower()
                    self.assertRegex(before, r"\b(not|no|nothing|without|does not)\b", f"{route}: …{before}{m.group(0)}")


if __name__ == "__main__":
    unittest.main()
