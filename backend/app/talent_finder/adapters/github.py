"""GitHubAdapter — REAL web sourcing via GitHub's OFFICIAL Search API.

This is genuine web discovery (it returns real people from public GitHub
profiles), done COMPLIANTLY: it uses the documented REST API, sends a proper
User-Agent, respects GitHub's rate limits, and reads only PUBLIC profile data.
It is NOT a scraper — no HTML scraping, no auth/anti-bot bypass.

Works keyless at GitHub's low anonymous rate; set GITHUB_TOKEN for 5000 req/hr.
Because profiles are public, contact info is NOT harvested (permission_mode
= public_allowed → normalize drops email/phone).
"""
from __future__ import annotations

import os
import re
import time
from typing import Any, Dict, List, Tuple

import requests

from .base import SourceAdapter

GITHUB_API = "https://api.github.com"
KNOWN_LANGS = {
    "python", "javascript", "typescript", "java", "go", "rust", "ruby", "php",
    "c++", "c", "c#", "swift", "kotlin", "scala", "dart", "elixir", "r", "shell",
}
MAX_PROFILE_LOOKUPS = 8  # per query — cap to stay well within rate limits
MAX_TOTAL = 20           # across all (international) queries

# Student-heavy / large dev markets to fan across when "international" is set.
DEFAULT_INTL_COUNTRIES = [
    "United States", "Canada", "United Kingdom", "Germany", "Australia",
    "Netherlands", "Ireland", "Singapore", "India",
]


class GitHubAdapter(SourceAdapter):
    source_name = "GitHub (public API)"
    source_type = "github"
    permission_mode = "public_allowed"
    is_enabled = True
    rate_limit_config = {"max_per_minute": 10, "concurrency": 1, "respect_api_limits": True}

    def _headers(self) -> Dict[str, str]:
        h = {"Accept": "application/vnd.github+json", "User-Agent": "IntervieHire-TalentFinder"}
        tok = os.getenv("GITHUB_TOKEN")
        if tok:
            h["Authorization"] = f"Bearer {tok}"
        return h

    def validate_permissions(self) -> Tuple[bool, str]:
        # Always allowed (public official API). A token only raises the rate limit.
        return (True, "ok")

    def _locations(self, brief: Dict[str, Any]) -> List[str]:
        if brief.get("include_international"):
            countries = [str(c).strip() for c in (brief.get("target_countries") or []) if str(c).strip()]
            locs = countries or list(DEFAULT_INTL_COUNTRIES)
            if brief.get("location"):
                locs = [brief["location"]] + [l for l in locs if l != brief["location"]]
            return locs[:4]
        loc = (brief.get("location") or "").strip()
        return [loc] if loc else [""]

    def _build_query(self, brief: Dict[str, Any], loc: str) -> str:
        parts: List[str] = []
        if loc:
            parts.append(f'location:"{loc}"')
        skills = (brief.get("must_have_skills") or []) + (brief.get("good_to_have_skills") or [])
        langs = [s for s in skills if str(s).lower() in KNOWN_LANGS]
        if langs:
            parts.append(f"language:{langs[0]}")
        text = " ".join(str(s) for s in skills if str(s).lower() not in KNOWN_LANGS)[:60]
        if text.strip():
            parts.append(text.strip())
        if brief.get("student_focus"):
            parts.append("student")   # GitHub free-text matches bios/usernames
        q = " ".join(parts).strip()
        return q or (brief.get("title") or "developer")

    def search_candidates(self, brief: Dict[str, Any]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        seen_logins: set = set()
        skills_blob = [str(s) for s in (brief.get("must_have_skills") or []) + (brief.get("good_to_have_skills") or [])]
        student = bool(brief.get("student_focus"))
        for loc in self._locations(brief):
            if len(out) >= MAX_TOTAL:
                break
            q = self._build_query(brief, loc)
            try:
                r = requests.get(f"{GITHUB_API}/search/users",
                                 params={"q": q, "per_page": MAX_PROFILE_LOOKUPS},
                                 headers=self._headers(), timeout=15)
                if r.status_code == 403:
                    break  # rate-limited (anonymous) — fail soft, keep other sources
                r.raise_for_status()
                items = (r.json() or {}).get("items", [])[:MAX_PROFILE_LOOKUPS]
            except Exception:
                continue

            for it in items:
                login = it.get("login")
                if not login or login.lower() in seen_logins:
                    continue
                seen_logins.add(login.lower())
                prof = self._fetch_profile(login)
                if not prof:
                    continue
                # Skip organisation/bot accounts — we want individual candidates.
                if str(prof.get("type") or "").lower() != "user":
                    continue
                bio = (prof.get("bio") or "")
                found = [s for s in skills_blob if s.lower() in bio.lower()]
                langs = [s for s in skills_blob if str(s).lower() in KNOWN_LANGS]
                is_student = student or bool(re.search(r"\b(student|undergrad|grad student|b\.?tech|m\.?tech|university|college)\b", bio, re.I))
                out.append({
                    "full_name": prof.get("name") or login,
                    "current_company": (prof.get("company") or "").lstrip("@") or None,
                    "current_title": ("Student / new grad" if is_student and not bio else (bio.split(".")[0][:80] if bio else None)),
                    "location": prof.get("location") or (loc or None),
                    "profile_url": prof.get("html_url"),
                    "github_url": prof.get("html_url"),
                    "portfolio_url": prof.get("blog") or None,
                    "skills": list(dict.fromkeys(found + langs)),
                    "availability_status": "open" if (prof.get("hireable") or is_student) else "unknown",
                    "resume_text": bio,
                    # public source → no email/phone harvested (normalize_common enforces this too)
                })
                if len(out) >= MAX_TOTAL:
                    break
                time.sleep(0.2)  # gentle pacing
        return out

    def _fetch_profile(self, login: str) -> Dict[str, Any]:
        try:
            r = requests.get(f"{GITHUB_API}/users/{login}", headers=self._headers(), timeout=15)
            if r.ok:
                return r.json() or {}
        except Exception:
            pass
        return {}
