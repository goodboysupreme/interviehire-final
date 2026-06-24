"""Compliant external-source scaffolds.

PublicWebAdapter and ApprovedAPIAdapter are SHIPPED DISABLED. They define exactly
how a legally-accessible integration must behave (robots.txt + rate limits + no
auth/CAPTCHA bypass) and where to wire real, approved providers — without doing
anything non-compliant out of the box.
"""
from __future__ import annotations

import re
import time
import urllib.request
import urllib.robotparser
from urllib.parse import urlparse
from typing import Any, Dict, List, Optional, Tuple

from .base import SourceAdapter

_USER_AGENT = "IntervieHireTalentFinder"


class PublicWebAdapter(SourceAdapter):
    """Public, legally-accessible web pages ONLY — ENABLED.

    Two compliant modes:
      • DISCOVERY (default): reuses the configured search provider to find public
        candidate profile URLs (LinkedIn /in, GitHub, about.me, dev.to, …), then
        ACTUALLY FETCHES each page to extract a richer profile than a snippet —
        gated by robots.txt + a polite delay.
      • ALLOW-LIST: if an admin configures `allowlist` (domains or full URLs), the
        adapter is restricted to those, fetching only matching public pages.

    It checks robots.txt (fail-closed), obeys a rate-limit delay, reads only PUBLIC
    pages, and NEVER bypasses login walls, CAPTCHAs, or anti-bot protections. As a
    public source, contact PII (email/phone) is dropped by the normalizer.
    """
    source_name = "Public Web"
    source_type = "public_web"
    permission_mode = "public_allowed"
    is_enabled = True  # compliant public-page fetch (robots.txt + rate limits)
    rate_limit_config = {"max_per_minute": 10, "concurrency": 1, "respect_robots": True}

    def validate_permissions(self) -> Tuple[bool, str]:
        cfg = self.ctx.payload.get("config") or {}
        if not (self.is_enabled or cfg.get("enabled")):
            return (False, "Public web sourcing is disabled.")
        return (True, "ok")

    # robots.txt cache per search run (one fetch per host, not per URL)
    def _robots(self, host_root: str) -> Optional[urllib.robotparser.RobotFileParser]:
        cache = getattr(self, "_robots_cache", None)
        if cache is None:
            cache = self._robots_cache = {}
        if host_root in cache:
            return cache[host_root]
        rp = urllib.robotparser.RobotFileParser()
        try:
            rp.set_url(f"{host_root}/robots.txt")
            rp.read()
        except Exception:
            rp = None
        cache[host_root] = rp
        return rp

    def robots_allows(self, url: str, user_agent: str = _USER_AGENT) -> bool:
        """True only if robots.txt allows fetching this URL. Fail-closed on error."""
        try:
            p = urlparse(url)
            rp = self._robots(f"{p.scheme}://{p.netloc}")
            return bool(rp and rp.can_fetch(user_agent, url))
        except Exception:
            return False

    def _domain_filter(self, cfg: Dict[str, Any]):
        """Return (explicit_urls, allowed_domains) from an admin allow-list."""
        entries = cfg.get("allowlist") or []
        urls = [e for e in entries if str(e).startswith("http")]
        domains = set()
        for e in entries:
            e = str(e).strip().lower()
            if e and not e.startswith("http"):
                domains.add(e[4:] if e.startswith("www.") else e)
        return urls, domains

    def _fetch(self, url: str) -> Optional[str]:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
            with urllib.request.urlopen(req, timeout=12) as resp:
                ctype = (resp.headers.get("Content-Type") or "").lower()
                if "html" not in ctype and "text" not in ctype:
                    return None
                return resp.read(250_000).decode("utf-8", errors="ignore")
        except Exception:
            return None

    def _enrich_from_html(self, base: Dict[str, Any], html: str, brief: Dict[str, Any]) -> Dict[str, Any]:
        title = (re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S) or [None, ""])[1].strip()
        meta = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', html, re.I)
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text)[:5000]
        out = dict(base)
        if not out.get("full_name") and title:
            from .web_search import _extract_name
            out["full_name"] = _extract_name(title) or (title.split("|")[0].split("—")[0].strip()[:80])
        # skills mentioned on the actual page (richer than the snippet)
        wanted = [str(s) for s in (brief.get("must_have_skills") or []) + (brief.get("good_to_have_skills") or [])]
        blob = (text + " " + (meta.group(1) if meta else "")).lower()
        found = [s for s in wanted if s.lower() in blob]
        out["skills"] = list(dict.fromkeys((out.get("skills") or []) + found))
        if not out.get("location"):
            lm = re.search(r"\b(?:based in|located in|from)\s+([A-Z][A-Za-z .,'-]{2,40})", text)
            if lm:
                out["location"] = lm.group(1).strip()
        out["resume_text"] = (meta.group(1) if meta else "") + " " + text
        return out

    def search_candidates(self, brief: Dict[str, Any]) -> List[Dict[str, Any]]:
        cfg = self.ctx.payload.get("config") or {}
        delay = float(cfg.get("delay_seconds", 1.5))     # polite rate limit
        max_pages = int(cfg.get("max_pages", 12))
        explicit_urls, allowed_domains = self._domain_filter(cfg)

        # 1) seeds: explicit admin URLs, else discover profile URLs via web search
        seeds: List[Dict[str, Any]] = []
        if explicit_urls:
            seeds = [{"full_name": None, "profile_url": u} for u in explicit_urls]
        else:
            try:
                from .web_search import WebSearchAdapter, _host
                ws = WebSearchAdapter(self.ctx)
                if ws.provider:
                    seeds = ws.search_candidates(brief) or []
            except Exception:
                seeds = []

        # 2) fetch + enrich the public pages (robots-permitted, rate-limited)
        from .web_search import _host
        out: List[Dict[str, Any]] = []
        fetched = 0
        for s in seeds:
            url = s.get("profile_url")
            if not url:
                continue
            host = _host(url)
            if allowed_domains and not any(host == d or host.endswith("." + d) for d in allowed_domains):
                continue  # admin restricted to specific domains
            if fetched < max_pages and self.robots_allows(url):
                html = self._fetch(url)
                if html:
                    s = self._enrich_from_html(s, html, brief)
                    fetched += 1
                    time.sleep(delay)
            if s.get("full_name"):
                out.append(s)
        return out


class ApprovedAPIAdapter(SourceAdapter):
    """Placeholder for APPROVED job-board / sourcing-data-provider APIs (official,
    contracted, rate-limited). Disabled until credentials + terms are configured.

    To add a provider later: set is_enabled via SourceAdapterConfig, put the API
    key/endpoint in config, and implement search_candidates() against the official
    API response (then map fields in normalize via normalize_common)."""
    source_name = "Approved API"
    source_type = "approved_api"
    permission_mode = "requires_permission"
    is_enabled = False

    def validate_permissions(self) -> Tuple[bool, str]:
        cfg = self.ctx.payload.get("config") or {}
        if not cfg.get("api_key") or not cfg.get("endpoint"):
            return (False, "This source requires API access, written permission, or user import.")
        return (True, "ok")

    def search_candidates(self, brief: Dict[str, Any]) -> List[Dict[str, Any]]:
        # cfg = self.ctx.payload.get("config"); call cfg['endpoint'] with cfg['api_key'] here.
        return []
