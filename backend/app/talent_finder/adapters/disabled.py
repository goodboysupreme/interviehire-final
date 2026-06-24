"""DISABLED placeholders for restricted platforms.

LinkedIn, Internshala, Naukri, Indeed, etc. are NOT scraped. Their ToS prohibit
automated access / scraping, so these adapters are permanently disabled and exist
only to (a) show up in the admin source list as "requires permission" and (b)
document the ONLY compliant ways to ingest their data:

  • LinkedIn   → official Recruiter/Talent APIs, partner programs, or recruiter
                 CSV exports uploaded via UploadedCSVAdapter / ManualImportAdapter.
  • Internshala/Naukri/Indeed → official employer/job-board APIs (ApprovedAPIAdapter)
                 or user-provided exports.

A real integration must replace one of these with an ApprovedAPIAdapter wired to
the platform's OFFICIAL API under a signed agreement — never a stealth scraper.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from .base import SourceAdapter

_REQUIRES = "This source requires official API access, written permission, or a user-provided export. Direct scraping is not supported."


class _RestrictedPlaceholder(SourceAdapter):
    permission_mode = "requires_permission"
    is_enabled = False

    def validate_permissions(self) -> Tuple[bool, str]:
        return (False, _REQUIRES)

    def search_candidates(self, brief: Dict[str, Any]) -> List[Dict[str, Any]]:
        return []


class LinkedInAdapter(_RestrictedPlaceholder):
    source_name = "LinkedIn (requires official API / export)"
    source_type = "restricted"


class InternshalaAdapter(_RestrictedPlaceholder):
    source_name = "Internshala (requires official API / export)"
    source_type = "restricted"


class NaukriAdapter(_RestrictedPlaceholder):
    source_name = "Naukri (requires official API / export)"
    source_type = "restricted"


class IndeedAdapter(_RestrictedPlaceholder):
    source_name = "Indeed (requires official API / export)"
    source_type = "restricted"
