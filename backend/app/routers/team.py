from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional

from app.database import get_db
from app.models.user import User, UserStatus, UserType
from app.schemas import TeamListOut, UserOut, InviteMemberIn, UpdateMemberIn
from app.utils.auth import get_current_user, get_active_org_id

router = APIRouter()


@router.get("", response_model=TeamListOut)
def get_team(
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        return TeamListOut(members=[], total=0, active=0, invited=0, inactive=0)

    members = db.query(User).filter(User.organisation_id == org_id).all()
    return TeamListOut(
        members=members,
        total=len(members),
        active=sum(1 for m in members if m.status == UserStatus.active),
        invited=sum(1 for m in members if m.status == UserStatus.invited),
        inactive=sum(1 for m in members if m.status == UserStatus.inactive),
    )


@router.post("/invite", response_model=UserOut)
def invite_member(
    data: InviteMemberIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot invite users without an active organisation."
        )

    # Check if user already exists
    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="User with this email already exists")

    new_user = User(
        name=data.name,
        email=data.email,
        designation=data.designation,
        user_type=data.user_type,
        status=UserStatus.invited,
        organisation_id=org_id
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@router.patch("/{user_id}", response_model=UserOut)
def update_member(
    user_id: UUID,
    data: UpdateMemberIn,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        raise HTTPException(status_code=400, detail="Action not allowed")

    user = db.query(User).filter(User.id == user_id, User.organisation_id == org_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found in your organisation")

    fields = data.model_dump(exclude_unset=True)
    for key, value in fields.items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}")
def remove_member(
    user_id: UUID,
    current_user: User = Depends(get_current_user),
    active_org_id: Optional[UUID] = Depends(get_active_org_id),
    db: Session = Depends(get_db)
):
    org_id = active_org_id if current_user.user_type == UserType.super_admin else current_user.organisation_id
    if not org_id:
        raise HTTPException(status_code=400, detail="Action not allowed")

    user = db.query(User).filter(User.id == user_id, User.organisation_id == org_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found in your organisation")

    db.delete(user)
    db.commit()
    return {"message": "Member removed"}