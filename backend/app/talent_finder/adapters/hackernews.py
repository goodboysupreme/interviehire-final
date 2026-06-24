"""HackerNewsAdapter — REAL candidates from the monthly "Ask HN: Who wants to be
hired?" threads, via the OFFICIAL Algolia HN Search API (free, keyless, no blocking).

Why this source: people post in these threads precisely BECAUSE they want to be
contacted by employers — they self-publish location, remote preference, skills,
and often a résumé link and email. That makes it a high-signal, fully-consensual,
keyless alternative to LinkedIn/Naukri. The Algolia API is an official JSON API
(unlike scraping a search engine), so it is reliable from server IPs too.

Tech-leaning (it's HN) but covers SWE, data, ML, devops, design, PM, etc. Pairs
with the GitHub adapter (devs) and the keyless web-search fallback (any role).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

import requests

from .base import SourceAdapter

HN_API = "https://hn.algolia.com/api/v1"
HN_USER = "https://news.ycombinator.com/user?id="


def _strip_html(s: str) -> str:
    if not s:
        return ""
    import html as _html
    s = re.sub(r"<a\b[^>]*>(.*?)</a>", r"\1", s, flags=re.I | re.S)
    s = s.replace("<p>", "\n").replace("</p>", "\n")
    s = re.sub(r"<[^>]+>", " ", s)
    s = _html.unescape(s)
    return re.sub(r"[ \t]+", " ", s).strip()


class HackerNewsAdapter(SourceAdapter):
    source_name = "Hacker News (Who wants to be hired)"
    source_type = "hackernews"
    permission_mode = "public_allowed"   # self-published for hiring; we still keep email out of the PII field
    is_enabled = True
    rate_limit_config = {"max_per_minute": 30, "concurrency": 1}

    def validate_permissions(self) -> Tuple[bool, str]:
        return (True, "ok")

    # ── thread discovery ───────────────────────────────────────────────────────
    def _recent_threads(self, n: int = 3) -> List[str]:
        try:
            r = requests.get(f"{HN_API}/search_by_date",
                             params={"query": "Ask HN: Who wants to be hired?", "tags": "story", "hitsPerPage": 12},
                             headers={"User-Agent": "IntervieHire-TalentFinder"}, timeout=15)
            r.raise_for_status()
            hits = (r.json() or {}).get("hits", [])
        except Exception:
            return []
        out = []
        for h in hits:
            title = (h.get("title") or "").lower()
            if "who wants to be hired" in title and h.get("objectID"):
                out.append(h["objectID"])
            if len(out) >= n:
                break
        return out

    def _thread_comments(self, story_id: str) -> List[Dict[str, Any]]:
        try:
            r = requests.get(f"{HN_API}/items/{story_id}",
                             headers={"User-Agent": "IntervieHire-TalentFinder"}, timeout=20)
            r.raise_for_status()
            return (r.json() or {}).get("children") or []
        except Exception:
            return []

    # ── comment → candidate ────────────────────────────────────────────────────
    @staticmethod
    def _field(text: str, names: str):
        m = re.search(rf"^\s*(?:{names})\s*[:\-]\s*(.+)$", text, re.I | re.M)
        return m.group(1).strip()[:200] if m else None

    def _parse_comment(self, text: str, author: str, brief: Dict[str, Any]) -> Dict[str, Any]:
        location = self._field(text, r"Location|Based in")
        remote = self._field(text, r"Remote")
        tech = self._field(text, r"Technologies|Tech|Skills|Stack|Languages")
        name = self._field(text, r"Name")
        resume = None
        rm = re.search(r"(https?://\S+(?:resume|cv|portfolio|github|gitlab|read\.cv|about\.me)\S*)", text, re.I)
        if rm:
            resume = rm.group(1).rstrip(").,")

        wanted = [str(s) for s in (brief.get("must_have_skills") or []) + (brief.get("good_to_have_skills") or [])]
        low = text.lower()
        matched = [s for s in wanted if s.lower() in low]
        skills = matched or ([t.strip() for t in re.split(r"[,/|]", tech) if t.strip()][:10] if tech else [])

        availability = "open"
        if remote and re.search(r"\bonly\b|\bremote only\b", remote, re.I):
            availability = "open"

        return {
            "full_name": (name or author or "HN candidate"),
            "current_title": brief.get("title"),
            "location": location,
            "skills": skills,
            "availability_status": availability,
            "resume_url": resume if (resume and "resume" in (resume or "").lower() or "cv" in (resume or "").lower()) else None,
            "portfolio_url": resume,
            "profile_url": (HN_USER + author) if author else None,
            # The comment (with the email/résumé the person published for hiring) is
            # kept in resume_text so recruiters can act on it; public_allowed → the
            # normalizer keeps it out of the structured email/phone fields.
            "resume_text": text[:1500],
        }

    def search_candidates(self, brief: Dict[str, Any]) -> List[Dict[str, Any]]:
        wanted = [s.lower() for s in (brief.get("must_have_skills") or []) + (brief.get("good_to_have_skills") or [])]
        title = str(brief.get("title") or "").lower().strip()
        title_tokens = [t for t in re.split(r"\W+", title) if len(t) > 2]
        loc_pref = str(brief.get("location") or "").lower().strip()
        cap = int(brief.get("_web_cap") or 40)

        out: List[Dict[str, Any]] = []
        seen_authors: set = set()
        for sid in self._recent_threads(3):
            for c in self._thread_comments(sid):
                if len(out) >= cap:
                    break
                author = c.get("author")
                if not author or author.lower() in seen_authors:
                    continue
                text = _strip_html(c.get("text") or "")
                if len(text) < 40:
                    continue
                low = text.lower()
                # Relevance: a wanted skill, or a role-title token, appears in the post.
                relevant = (not wanted and not title_tokens)
                if wanted and any(w in low for w in wanted):
                    relevant = True
                if title_tokens and any(t in low for t in title_tokens):
                    relevant = True
                if not relevant:
                    continue
                # Optional location bias (soft): if a location was given, prefer posts
                # that mention it, but don't hard-drop (HN posts vary in format).
                if loc_pref and loc_pref not in low and "remote" not in low:
                    # keep only if it strongly matches skills/title
                    if not (wanted and sum(w in low for w in wanted) >= 2):
                        continue
                seen_authors.add(author.lower())
                out.append(self._parse_comment(text, author, brief))
            if len(out) >= cap:
                break
        return out
