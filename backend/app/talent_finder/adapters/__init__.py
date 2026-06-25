"""Adapter registry — maps a source_type to its adapter class and builds the set
of adapters for a search. New (approved) sources are added here once implemented.
"""
from __future__ import annotations

from typing import Any, Dict, List

from .base import SourceAdapter, AdapterContext
from .internal import InternalCandidateAdapter, ResumeDatabaseAdapter
from .imports import UploadedCSVAdapter, ManualImportAdapter
from .web import PublicWebAdapter, ApprovedAPIAdapter
from .github import GitHubAdapter
from .hackernews import HackerNewsAdapter
from .web_search import WebSearchAdapter
from .disabled import LinkedInAdapter, InternshalaAdapter, NaukriAdapter, IndeedAdapter

# source_type -> adapter class
REGISTRY: Dict[str, type] = {
    "internal_db": InternalCandidateAdapter,
    "resume_db": ResumeDatabaseAdapter,
    "uploaded_csv": UploadedCSVAdapter,
    "manual_import": ManualImportAdapter,
    "github": GitHubAdapter,            # REAL web sourcing via GitHub's official API (devs)
    "hackernews": HackerNewsAdapter,    # REAL candidates seeking work — official Algolia HN API (keyless)
    "web_search": WebSearchAdapter,     # general public-web discovery (DuckDuckGo keyless fallback / Google CSE / SearXNG / Brave)
    "public_web": PublicWebAdapter,
    "approved_api": ApprovedAPIAdapter,
    # restricted placeholders (always disabled — compliant ingest = official API / export):
    "linkedin": LinkedInAdapter,
    "internshala": InternshalaAdapter,
    "naukri": NaukriAdapter,
    "indeed": IndeedAdapter,
}

# What the admin source panel lists (with live enabled/permission status).
def list_sources(ctx: AdapterContext) -> List[Dict[str, Any]]:
    out = []
    for stype, cls in REGISTRY.items():
        a = cls(ctx)
        ok, reason = a.validate_permissions()
        out.append({
            "source_type": stype,
            "source_name": a.source_name,
            "permission_mode": a.permission_mode,
            "is_enabled": a.is_enabled,
            "available": ok,
            "note": None if ok else reason,
            "rate_limit": a.rate_limit_config,
        })
    return out


def build_adapters(source_types: List[str], ctx: AdapterContext) -> List[SourceAdapter]:
    adapters = []
    for stype in source_types or []:
        cls = REGISTRY.get(stype)
        if cls:
            adapters.append(cls(ctx))
    return adapters
