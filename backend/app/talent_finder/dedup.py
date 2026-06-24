"""Cross-source candidate deduplication — PURE (no DB) and unit-testable.

A merged candidate keeps the most complete field values and PRESERVES every
source it was found in (so source transparency survives the merge).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List


def _norm(s: Any) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip().lower())


def dedup_key(c: Dict[str, Any]) -> str:
    """Strongest available identity key: email → linkedin → name+company → name+location."""
    email = _norm(c.get("email"))
    if email:
        return f"email:{email}"
    li = _norm(c.get("linkedin_url"))
    if li:
        return f"li:{li.rstrip('/')}"
    name = _norm(c.get("full_name"))
    comp = _norm(c.get("current_company"))
    if name and comp:
        return f"nc:{name}|{comp}"
    loc = _norm(c.get("location"))
    return f"nl:{name}|{loc}"


def _merge_two(base: Dict[str, Any], other: Dict[str, Any]) -> Dict[str, Any]:
    """Fill empty fields in base from other; union list fields; preserve sources."""
    merged = dict(base)
    scalar_fields = [
        "full_name", "current_title", "current_company", "location", "email", "phone",
        "profile_url", "resume_url", "portfolio_url", "github_url", "linkedin_url",
        "availability_status", "salary_expectation", "notice_period", "years_of_experience",
    ]
    for f in scalar_fields:
        if not merged.get(f) and other.get(f):
            merged[f] = other[f]
    # union list fields (skills, education, previous_companies)
    for f in ("skills", "education", "previous_companies"):
        a = base.get(f) or []
        b = other.get(f) or []
        seen, out = set(), []
        for item in list(a) + list(b):
            k = _norm(item) if isinstance(item, str) else str(item)
            if k and k not in seen:
                seen.add(k)
                out.append(item)
        merged[f] = out
    # preserve all sources
    srcs = list(base.get("_sources") or [])
    for s in (other.get("_sources") or [{
        "source_name": other.get("source_name"), "source_type": other.get("source_type"),
        "source_permission_status": other.get("source_permission_status"),
        "profile_url": other.get("profile_url"),
    }]):
        srcs.append(s)
    merged["_sources"] = srcs
    return merged


def deduplicate(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Merge candidates that resolve to the same identity. Each result carries a
    `_sources` list of every source it came from."""
    by_key: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    for c in candidates:
        c = dict(c)
        if "_sources" not in c:
            c["_sources"] = [{
                "source_name": c.get("source_name"), "source_type": c.get("source_type"),
                "source_permission_status": c.get("source_permission_status"),
                "profile_url": c.get("profile_url"),
            }]
        k = dedup_key(c)
        c["dedup_key"] = k
        if k in by_key:
            by_key[k] = _merge_two(by_key[k], c)
            by_key[k]["dedup_key"] = k
        else:
            by_key[k] = c
            order.append(k)
    return [by_key[k] for k in order]
