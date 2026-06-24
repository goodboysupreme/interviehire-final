"""User-provided import adapters — the compliant way to bring in external data:
recruiter-exported CSVs and manually pasted profile lists/URLs. The recruiter is
the data source of record (consent/permission is theirs to assert).
"""
from __future__ import annotations

from typing import Any, Dict, List

from .base import SourceAdapter


class UploadedCSVAdapter(SourceAdapter):
    """Candidates from a recruiter-uploaded CSV / exported list. Rows are parsed
    upstream (POST /import/csv) and handed in via ctx.payload['csv_rows']."""
    source_name = "Uploaded CSV"
    source_type = "uploaded_csv"
    permission_mode = "user_provided"
    is_enabled = True

    def search_candidates(self, brief: Dict[str, Any]) -> List[Dict[str, Any]]:
        return list(self.ctx.payload.get("csv_rows") or [])


class ManualImportAdapter(SourceAdapter):
    """Candidates the recruiter pasted directly — either full rows or just profile
    URLs (e.g. a recruiter-exported list). Provided via ctx.payload['manual_profiles']."""
    source_name = "Manual Import"
    source_type = "manual_import"
    permission_mode = "user_provided"
    is_enabled = True

    def search_candidates(self, brief: Dict[str, Any]) -> List[Dict[str, Any]]:
        items = self.ctx.payload.get("manual_profiles") or []
        out: List[Dict[str, Any]] = []
        for it in items:
            if isinstance(it, str):
                url = it.strip()
                if not url:
                    continue
                # bare URL → minimal profile; recruiter enriches later
                name = url.rstrip("/").split("/")[-1].replace("-", " ").replace("_", " ").title() or "Imported Profile"
                out.append({"full_name": name, "profile_url": url})
            elif isinstance(it, dict):
                out.append(it)
        return out
