"""WebSearchAdapter — general public-web candidate discovery via an official /
self-hosted search API. Works for ANY role (PM, sales, marketing, …) and is
tuned to return REAL PEOPLE, not articles / resume templates / job posts.

Multi-provider, auto-selected from env (first configured wins):
  • google_cse — Google Programmable Search JSON API. FREE 100 queries/day, no
      card. Needs GOOGLE_CSE_KEY + GOOGLE_CSE_ID.
  • searxng    — your own self-hosted SearXNG metasearch. FREE, unlimited, no
      account. Needs SEARXNG_URL (e.g. http://localhost:8080). JSON format on.
  • brave      — Brave Search API (paid/free-tier). Needs BRAVE_API_KEY.
  • duckduckgo — KEYLESS built-in fallback (no account, no env). Always available,
      so Talent Finder finds real candidates out of the box even with no provider
      configured (this is the default in production where the local SearXNG isn't
      reachable). Uses DuckDuckGo's public HTML/Lite results endpoints. Set
      TALENT_DISABLE_DDG=1 to turn this fallback off.

COMPLIANCE: returns only PUBLIC, already-indexed result snippets + links — the
same thing a recruiter sees searching. It does NOT fetch/scrape the linked pages
(never touches login-walled/ToS-restricted content) and harvests no contact PII
(public_allowed → normalizer drops email/phone). Results are LEADS to review.

ROBUSTNESS (why earlier results were junk): a raw web search for a role returns
mostly *content* — "15 sample resumes", Scribd uploads, course pages, job posts.
This adapter now (1) only keeps results on known PROFILE hosts (LinkedIn /in,
GitHub, dev.to, about.me, …), (2) hard-drops template / job-board / article /
course hosts, (3) rejects titles that read like an article rather than a person's
name, and (4) validates the extracted name actually looks like a human name.
For international reach it fans the query across target countries and, when asked,
biases toward students / recent-grads.
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import requests


# ── host policy ───────────────────────────────────────────────────────────────
# Hosts that overwhelmingly host an individual's public profile. value = a hint
# about what kind of profile / which canonical URL field to populate.
_PROFILE_HOSTS: Dict[str, str] = {
    "linkedin.com": "linkedin",       # only /in/ paths (member profiles) are kept
    "github.com": "github",
    "gitlab.com": "github",
    "dev.to": "portfolio",
    "medium.com": "portfolio",
    "about.me": "portfolio",
    "read.cv": "portfolio",
    "polywork.com": "portfolio",
    "behance.net": "portfolio",
    "dribbble.com": "portfolio",
    "stackoverflow.com": "portfolio",  # /users/ paths
    "kaggle.com": "portfolio",
    "wellfound.com": "portfolio",
    "angel.co": "portfolio",
    "devpost.com": "portfolio",
    "notion.site": "portfolio",
    "substack.com": "portfolio",
    "hashnode.dev": "portfolio",
    "bsky.app": "portfolio",
    "orcid.org": "portfolio",          # researchers / students
    "scholar.google.com": "portfolio",
}

# Hosts that are NEVER a candidate — resume-template sites, job boards, courses,
# slide/doc dumps, generic content. These were the source of the "Scribd /
# Resumly / 15 Samples" noise.
_BLOCK_HOSTS = {
    # resume builders / templates
    "resumly.ai", "zety.com", "novoresume.com", "resume.io", "kickresume.com",
    "enhancv.com", "livecareer.com", "hloom.com", "resumegenius.com", "myperfectresume.com",
    "resumebuilder.com", "jobscan.co", "vance.ai", "canva.com", "beamjobs.com",
    "resume.com", "cvmaker.com", "visualcv.com", "resumetemplates.com",
    # doc / slide dumps
    "scribd.com", "slideshare.net", "studocu.com", "coursehero.com", "academia.edu",
    "issuu.com", "pdfcoffee.com", "docplayer.net", "yumpu.com",
    # job boards / aggregators
    "indeed.com", "naukri.com", "glassdoor.com", "monster.com", "ziprecruiter.com",
    "simplyhired.com", "shine.com", "timesjobs.com", "foundit.in", "internshala.com",
    "lever.co", "greenhouse.io", "workable.com", "ashbyhq.com", "wellfound.com/jobs",
    # courses / content / encyclopedias
    "coursera.org", "udemy.com", "edx.org", "wikipedia.org", "youtube.com", "youtu.be",
    "pinterest.com", "quora.com", "reddit.com", "facebook.com", "amazon.com",
    "geeksforgeeks.org", "w3schools.com", "tutorialspoint.com", "medium.com/tag",
}

# Words that mark a result title as an ARTICLE / template / job post, not a person.
_ARTICLE_RE = re.compile(
    r"\b(resume|résumé|cv|template|sample|example|examples|format|guide|tutorial|"
    r"top\s*\d|best\s|how\s+to|tips|ideas|list|checklist|cheat\s*sheet|"
    r"jobs?|hiring|vacanc|career[s]?\b|salary|salaries|interview\s+questions|"
    r"course|courses|bootcamp|certification|roadmap|free\s+download|pdf|ppt|doc|"
    r"definition|meaning|what\s+is|skills\s+for|companies|employers)\b",
    re.I,
)
# A token that looks like a real name part: starts uppercase, letters only
# (allow accents, ., -, '), length 2-20. Rejects ALLCAPS shouty marketing tokens.
_NAME_TOKEN_RE = re.compile(r"^[A-ZÀ-Þ][A-Za-zÀ-ÿ.'\-]{1,19}$")


def _host(url: str) -> str:
    try:
        h = (urlparse(url).hostname or "").lower()
        return h[4:] if h.startswith("www.") else h
    except Exception:
        return ""


def _profile_kind(url: str) -> Optional[str]:
    """Return the profile kind if `url` is an allowed individual-profile page,
    else None. Enforces path rules for hosts that mix profiles with other content."""
    host = _host(url)
    if not host:
        return None
    # explicit blocks first (also catch subpaths like wellfound.com/jobs)
    full = host + (urlparse(url).path or "")
    if any(b in host or b in full for b in _BLOCK_HOSTS):
        return None
    # match host or parent domain (e.g. "uk.linkedin.com" → "linkedin.com")
    kind = None
    for ph, k in _PROFILE_HOSTS.items():
        if host == ph or host.endswith("." + ph):
            kind = k
            break
    if kind is None:
        return None
    path = (urlparse(url).path or "").lower().rstrip("/")
    # LinkedIn: only member profiles (/in/slug), never company/jobs/posts pages
    if kind == "linkedin":
        return "linkedin" if re.match(r"^/in/[^/]+$", path) else None
    if host.endswith("github.com"):
        # a user profile is github.com/<login> (one path segment), not a repo/org page
        segs = [s for s in path.split("/") if s]
        bad = {"orgs", "topics", "search", "marketplace", "sponsors", "about", "features", "explore"}
        return "github" if len(segs) == 1 and segs[0] not in bad else None
    if host.endswith("stackoverflow.com"):
        return "portfolio" if path.startswith("/users/") else None
    if host.endswith("medium.com"):
        # author pages are medium.com/@handle, not articles
        return "portfolio" if path.startswith("/@") else None
    return kind


def _looks_like_person_title(title: str) -> bool:
    if not title or _ARTICLE_RE.search(title):
        return False
    return True


def _extract_name(title: str) -> Optional[str]:
    """Pull a plausible human name out of a result title, or None."""
    if not title:
        return None
    # strip the platform suffix and any trailing site noise
    t = re.split(r"\s*[\|·–—]\s*", title)[0]
    t = re.sub(r"\s*[-–—:]\s*(LinkedIn|GitHub|GitLab|Medium|Dev|About|Portfolio|Resume|Profile|Kaggle|Behance|Dribbble).*$",
               "", t, flags=re.I).strip()
    # a leading "Name - role at company" form → take the name half
    m = re.match(r"^(.+?)\s+[-–—:]\s+.+$", t)
    if m and 1 <= len(m.group(1).split()) <= 4:
        t = m.group(1).strip()
    # GitHub often "login (Full Name)" or "Full Name (login)"
    pm = re.match(r"^(.+?)\s*\((.+?)\)\s*$", t)
    if pm:
        a, b = pm.group(1).strip(), pm.group(2).strip()
        t = a if len(a.split()) >= 2 else b
    tokens = t.split()
    if not (1 <= len(tokens) <= 4):
        return None
    real = [w for w in tokens if _NAME_TOKEN_RE.match(w)]
    if len(real) < max(1, len(tokens) - 1):   # tolerate one stray token
        return None
    name = " ".join(real)
    # a single token is only a name on dev hosts (github logins) — be conservative
    if len(real) < 2 and not re.search(r"[A-Za-z]{3,}", name):
        return None
    return name


def _role_company(title: str, snippet: str) -> Tuple[Optional[str], Optional[str]]:
    """Best-effort 'role at company' from the title/snippet (purely a hint)."""
    blob = title or ""
    m = re.search(r"[-–—:]\s*([^|·\-–—]+?)\s+at\s+([^|·\-–—]+)", blob, re.I)
    if m:
        return (m.group(1).strip()[:80], m.group(2).strip()[:80])
    m = re.search(r"\b([A-Za-z][A-Za-z /]+?(?:Engineer|Developer|Manager|Designer|Scientist|Analyst|Consultant|Intern|Student|Researcher))\b",
                  blob + " " + (snippet or ""), re.I)
    if m:
        return (m.group(1).strip()[:80], None)
    return (None, None)


class WebSearchAdapter:
    source_name = "Web Search"
    source_type = "web_search"
    permission_mode = "public_allowed"
    rate_limit_config = {"max_per_minute": 20, "concurrency": 1}

    # countries we fan out across when "international" is requested but no explicit
    # list is given — student-heavy destinations + large talent markets.
    DEFAULT_INTL_COUNTRIES = [
        "United States", "Canada", "United Kingdom", "Germany", "Australia",
        "Netherlands", "Ireland", "Singapore", "India",
    ]

    def __init__(self, ctx):
        self.ctx = ctx
        self._cfg = (getattr(ctx, "payload", {}) or {}).get("config") or {}
        self.provider, self._creds = self._resolve_provider()
        self.is_enabled = self.provider is not None
        self.source_name = "Web Search" + (f" ({self.provider})" if self.provider else "")

    def _env(self, k):
        return self._cfg.get(k) or os.getenv(k)

    def _resolve_provider(self) -> Tuple[Any, Dict[str, Any]]:
        if self._env("GOOGLE_CSE_KEY") and self._env("GOOGLE_CSE_ID"):
            return ("google_cse", {"key": self._env("GOOGLE_CSE_KEY"), "cx": self._env("GOOGLE_CSE_ID")})
        if self._env("SEARXNG_URL"):
            return ("searxng", {"url": self._env("SEARXNG_URL").rstrip("/")})
        if self._env("BRAVE_API_KEY"):
            return ("brave", {"key": self._env("BRAVE_API_KEY")})
        # Keyless built-in fallback so sourcing works everywhere with zero setup.
        if not self._env("TALENT_DISABLE_DDG"):
            return ("duckduckgo", {})
        return (None, {})

    def validate_permissions(self) -> Tuple[bool, str]:
        if not self.provider:
            return (False, "Web Search is turned off (TALENT_DISABLE_DDG set and no other provider). "
                           "Set GOOGLE_CSE_KEY+GOOGLE_CSE_ID (free 100/day), SEARXNG_URL (self-hosted), "
                           "or BRAVE_API_KEY, or unset TALENT_DISABLE_DDG to use the free DuckDuckGo fallback. "
                           "Public search results only — no login-walled scraping.")
        return (True, "ok")

    # ── query planning ────────────────────────────────────────────────────────
    _NOISE = '-template -sample -examples -"how to" -jobs -hiring -course -salary'

    def _skills_str(self, brief: Dict[str, Any], n: int = 3) -> str:
        return " ".join(str(s) for s in (brief.get("must_have_skills") or [])[:n])

    def _student_clause(self, brief: Dict[str, Any]) -> str:
        return '(student OR "recent graduate" OR "new grad" OR intern OR undergraduate)' \
            if brief.get("student_focus") else ""

    def _locations(self, brief: Dict[str, Any]) -> List[Optional[str]]:
        """Which location terms to fan the search across."""
        if brief.get("include_international"):
            countries = [str(c).strip() for c in (brief.get("target_countries") or []) if str(c).strip()]
            locs: List[Optional[str]] = countries or list(self.DEFAULT_INTL_COUNTRIES)
            if brief.get("location"):
                locs = [brief["location"]] + [l for l in locs if l != brief["location"]]
            return locs[:5]
        return [brief.get("location")]

    def _plan_queries(self, brief: Dict[str, Any]) -> List[str]:
        title = str(brief.get("title") or "").strip()
        title_q = f'"{title}"' if title else "developer"
        student = self._student_clause(brief)
        # DuckDuckGo (the keyless default) returns NOTHING for long, over-constrained
        # queries, so keep DDG queries lean — role + location + site filter, at most
        # one skill. Skill matching still happens later in fit-scoring, so recall is
        # what matters here. API providers (Google/Brave/SearXNG) get the richer form.
        ddg = (self.provider == "duckduckgo")
        skills = self._skills_str(brief, 1 if ddg else 3)
        queries: List[str] = []
        for loc in self._locations(brief):
            loc_q = f'"{loc}"' if loc else ""
            # LinkedIn member profiles — the densest source of real people for any role.
            queries.append(" ".join(filter(None, [title_q, ("" if ddg else skills), loc_q, student, "site:linkedin.com/in"])))
            # GitHub user profiles (devs); pair the strongest skill (or role) with location.
            queries.append(" ".join(filter(None, [(skills or title_q), loc_q, student, "site:github.com"])))
            # portfolio / personal sites
            if ddg:
                queries.append(" ".join(filter(None, [title_q, loc_q, student, '(portfolio OR "about me")'])))
            else:
                queries.append(" ".join(filter(None, [title_q, skills, loc_q, student,
                                                      '(portfolio OR "about me" OR site:about.me OR site:read.cv)',
                                                      self._NOISE])))
        # de-dup identical queries, cap the fan-out to stay within rate limits
        # (DDG is more aggressively rate-limited, so fan out less).
        seen, out = set(), []
        for q in queries:
            q = re.sub(r"\s+", " ", q).strip()
            if q and q not in seen:
                seen.add(q)
                out.append(q)
        return out[: (4 if ddg else 6)]

    # ── provider call ─────────────────────────────────────────────────────────
    def _raw_results(self, q: str) -> List[Dict[str, str]]:
        try:
            if self.provider == "google_cse":
                r = requests.get("https://www.googleapis.com/customsearch/v1",
                                 params={"key": self._creds["key"], "cx": self._creds["cx"], "q": q, "num": 10},
                                 timeout=15)
                r.raise_for_status()
                return [{"title": i.get("title", ""), "url": i.get("link", ""), "description": i.get("snippet", "")}
                        for i in (r.json().get("items") or [])]
            if self.provider == "searxng":
                r = requests.get(f"{self._creds['url']}/search",
                                 params={"q": q, "format": "json"},
                                 headers={"User-Agent": "IntervieHire-TalentFinder"}, timeout=15)
                r.raise_for_status()
                return [{"title": i.get("title", ""), "url": i.get("url", ""), "description": i.get("content", "")}
                        for i in (r.json().get("results") or [])][:20]
            if self.provider == "brave":
                r = requests.get(os.getenv("BRAVE_SEARCH_ENDPOINT") or "https://api.search.brave.com/res/v1/web/search",
                                 params={"q": q, "count": 20},
                                 headers={"X-Subscription-Token": self._creds["key"], "Accept": "application/json"},
                                 timeout=15)
                r.raise_for_status()
                return [{"title": i.get("title", ""), "url": i.get("url", ""), "description": i.get("description", "")}
                        for i in (((r.json() or {}).get("web") or {}).get("results") or [])]
            if self.provider == "duckduckgo":
                return self._ddg_results(q)
        except Exception:
            return []
        return []

    # ── DuckDuckGo keyless results (public HTML / Lite endpoints) ───────────────
    _DDG_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
               "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

    def _ddg_clean_url(self, href: str) -> Optional[str]:
        """Resolve a DDG result href (often a /l/?uddg= redirect) to the real URL."""
        from urllib.parse import unquote, parse_qs
        if not href:
            return None
        if href.startswith("//"):
            href = "https:" + href
        if "duckduckgo.com/l/" in href:
            try:
                qs = parse_qs(urlparse(href).query)
                if qs.get("uddg"):
                    return unquote(qs["uddg"][0])
            except Exception:
                return None
        return href if href.startswith("http") else None

    def _ddg_results(self, q: str) -> List[Dict[str, str]]:
        import html as _html
        import time
        headers = {"User-Agent": self._DDG_UA, "Accept-Language": "en-US,en;q=0.9"}
        html_text = ""
        # html endpoint is richer (has snippets); lite is a resilient fallback. DDG
        # rate-limits/returns empty under automation, so retry once with a backoff.
        endpoints = ("https://html.duckduckgo.com/html/", "https://lite.duckduckgo.com/lite/")
        for attempt in range(2):
            for endpoint in endpoints:
                try:
                    resp = requests.post(endpoint, data={"q": q, "kl": "us-en"}, headers=headers, timeout=15)
                    resp.raise_for_status()
                    if resp.text and ("result__a" in resp.text or "result-link" in resp.text):
                        html_text = resp.text
                        break
                except Exception:
                    continue
            if html_text:
                break
            time.sleep(1.5)  # backoff before the retry pass
        if not html_text:
            return []
        out: List[Dict[str, str]] = []
        # html.duckduckgo.com markup: <a class="result__a" href="...">title</a>
        for m in re.finditer(r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
                             html_text, re.I | re.S):
            url = self._ddg_clean_url(_html.unescape(m.group(1)))
            title = _html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip()
            if url and title:
                out.append({"title": title, "url": url, "description": ""})
        # lite.duckduckgo.com markup: <a class="result-link" href="...">title</a>
        if not out:
            for m in re.finditer(r'<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
                                 html_text, re.I | re.S):
                url = self._ddg_clean_url(_html.unescape(m.group(1)))
                title = _html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip()
                if url and title:
                    out.append({"title": title, "url": url, "description": ""})
        # attach snippets in result order (best-effort)
        snippets = [_html.unescape(re.sub(r"<[^>]+>", "", s)).strip()
                    for s in re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', html_text, re.I | re.S)]
        for i, o in enumerate(out):
            if i < len(snippets):
                o["description"] = snippets[i]
        return out[:25]

    # ── result → candidate ────────────────────────────────────────────────────
    def _to_candidate(self, res: Dict[str, str], loc_hint: Optional[str], brief: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        url = res.get("url") or ""
        kind = _profile_kind(url)
        if not kind:                                   # not a real profile host → drop
            return None
        title = res.get("title") or ""
        snippet = res.get("description") or ""
        if not _looks_like_person_title(title):        # article/template/job → drop
            return None
        name = _extract_name(title)
        if not name:                                   # no plausible human name → drop
            return None
        role, company = _role_company(title, snippet)
        # location: prefer one mentioned in the snippet, else the query's country
        loc = None
        lm = re.search(r"\b(?:based in|located in|from)\s+([A-Z][A-Za-z .,'-]{2,40})", snippet)
        if lm:
            loc = lm.group(1).strip()
        cand: Dict[str, Any] = {
            "full_name": name,
            "current_title": role,
            "current_company": company,
            "location": loc or loc_hint,
            "profile_url": url,
            "resume_text": snippet,
            "skills": [s for s in (brief.get("must_have_skills") or []) + (brief.get("good_to_have_skills") or [])
                       if str(s).lower() in (title + " " + snippet).lower()],
        }
        if kind == "github":
            cand["github_url"] = url
        elif kind == "linkedin":
            cand["linkedin_url"] = url     # lead only; normalize keeps no contact PII for public source
        else:
            cand["portfolio_url"] = url
        if brief.get("student_focus"):
            cand["availability_status"] = "open"   # students/new-grads are actively looking
        return cand

    def search_candidates(self, brief: Dict[str, Any]) -> List[Dict[str, Any]]:
        if not self.provider:
            return []
        locs = self._locations(brief)
        queries = self._plan_queries(brief)
        # remember which country each query targeted (parallel to the plan order)
        out: List[Dict[str, Any]] = []
        seen_urls: set = set()
        # map each query back to a loc hint: queries are emitted per-loc in groups,
        # so recompute the hint from the query text where possible.
        import time
        for qi, q in enumerate(queries):
            # Pace DuckDuckGo requests so we don't trip its rate limiter mid-search.
            if self.provider == "duckduckgo" and qi > 0:
                time.sleep(1.2)
            loc_hint = next((l for l in locs if l and f'"{l}"' in q), brief.get("location"))
            for res in self._raw_results(q):
                u = (res.get("url") or "").rstrip("/").lower()
                if not u or u in seen_urls:
                    continue
                cand = self._to_candidate(res, loc_hint, brief)
                if cand:
                    seen_urls.add(u)
                    out.append(cand)
            if len(out) >= int(brief.get("_web_cap") or 60):
                break
        return out

    def normalize(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        from .base import normalize_common
        return normalize_common(raw, self.source_name, self.source_type, self.permission_mode)

    def run(self, brief: Dict[str, Any]):
        ok, reason = self.validate_permissions()
        if not ok:
            return ([], reason)
        try:
            raw = self.search_candidates(brief) or []
            cands = [self.normalize(r) for r in raw if r.get("full_name")]
            if not cands:
                return ([], "no profile-page matches (try broadening skills/location or enabling international)")
            return (cands, "ok")
        except Exception as exc:  # noqa
            return ([], f"{self.source_name} error: {exc}")
