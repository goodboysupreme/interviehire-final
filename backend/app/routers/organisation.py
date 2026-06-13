from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional
import shutil, os

from app.database import get_db
from app.models.organisation import Organisation
from app.models.user import User, UserType
from app.schemas import OrganisationOut, OrganisationIn
from app.utils.auth import get_current_user, get_active_org_id

router = APIRouter()

UPLOAD_DIR = "uploads/logos"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.get("", response_model=OrganisationOut)
def get_organisation(
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        raise HTTPException(status_code=404, detail="No active organisation context.")

    org = db.query(Organisation).filter(Organisation.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organisation settings not set up yet")
    return org


@router.put("", response_model=OrganisationOut)
def upsert_organisation(
    data: OrganisationIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        # Create a new Organisation if they don't have one (alternative onboarding flow)
        org = Organisation(**data.model_dump())
        db.add(org)
        db.commit()
        db.refresh(org)
        
        current_user.organisation_id = org.id
        db.commit()
        return org

    org = db.query(Organisation).filter(Organisation.id == org_id).first()
    if org:
        for key, value in data.model_dump(exclude_unset=True).items():
            setattr(org, key, value)
    else:
        org = Organisation(id=org_id, **data.model_dump())
        db.add(org)
    db.commit()
    db.refresh(org)
    return org


@router.post("", response_model=OrganisationOut)
def upsert_organisation_post(
    data: OrganisationIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    return upsert_organisation(data, current_user, active_org_id, db)


@router.post("/logo")
def upload_logo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        raise HTTPException(status_code=400, detail="No active organisation context.")

    file_path = f"{UPLOAD_DIR}/{file.filename}"
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    org = db.query(Organisation).filter(Organisation.id == org_id).first()
    if org:
        org.logo_url = file_path
        db.commit()

    return {"logo_url": file_path}
