from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from uuid import UUID
from typing import Optional, List

from app.database import get_db
from app.models.user import User, UserStatus, UserType
from app.models.organisation import Organisation
from app.utils.auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    get_active_org_id,
)

router = APIRouter()

class SignupIn(BaseModel):
    name: str
    email: EmailStr
    password: str

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class OnboardingIn(BaseModel):
    org_name: str
    domain: Optional[str] = None
    contact_email: Optional[str] = None
    website_link: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None

class SwitchContextIn(BaseModel):
    organisation_id: UUID

class UserProfileOut(BaseModel):
    id: UUID
    name: str
    email: str
    designation: Optional[str] = None
    user_type: UserType
    status: UserStatus
    organisation_id: Optional[UUID] = None
    organisation_name: Optional[str] = None
    onboarding_required: bool

    class Config:
        from_attributes = True


@router.post("/signup")
def signup(data: SignupIn, response: Response, db: Session = Depends(get_db)):
    # Check if user with this email already exists
    user = db.query(User).filter(User.email == data.email).first()
    
    if user:
        if user.status == UserStatus.invited:
            # Invited user accepts invite and registers
            user.name = data.name
            user.hashed_password = get_password_hash(data.password)
            user.status = UserStatus.active
            db.commit()
            db.refresh(user)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User with this email already exists."
            )
    else:
        # Brand new organisation signup
        user = User(
            name=data.name,
            email=data.email,
            hashed_password=get_password_hash(data.password),
            user_type=UserType.org_admin,
            status=UserStatus.active,
            organisation_id=None # Will be filled during onboarding
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # Log the user in by creating a JWT
    access_token = create_access_token(data={"sub": str(user.id)})
    response.set_cookie(
        key="token",
        value=access_token,
        httponly=True,
        max_age=7 * 24 * 60 * 60,  # 7 days
        samesite="lax",
        secure=False,
        path="/",
    )

    onboarding_required = user.organisation_id is None and user.user_type != UserType.super_admin

    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "user_type": user.user_type,
            "status": user.status,
            "organisation_id": user.organisation_id,
        },
        "onboarding_required": onboarding_required
    }


@router.post("/login")
def login(data: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password."
        )

    if not verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password."
        )

    if user.status == UserStatus.inactive:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has been deactivated."
        )

    # Log the user in by creating a JWT
    access_token = create_access_token(data={"sub": str(user.id)})
    response.set_cookie(
        key="token",
        value=access_token,
        httponly=True,
        max_age=7 * 24 * 60 * 60,  # 7 days
        samesite="lax",
        secure=False,
        path="/",
    )

    onboarding_required = user.organisation_id is None and user.user_type != UserType.super_admin

    # If super_admin, we can set their active_org_id cookie to the first org if not set
    if user.user_type == UserType.super_admin:
        first_org = db.query(Organisation).first()
        if first_org:
            response.set_cookie(
                key="active_org_id",
                value=str(first_org.id),
                httponly=True,
                max_age=7 * 24 * 60 * 60,
                samesite="lax",
                secure=False,
                path="/",
            )

    return {
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "user_type": user.user_type,
            "status": user.status,
            "organisation_id": user.organisation_id,
        },
        "onboarding_required": onboarding_required
    }


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(key="token", path="/")
    response.delete_cookie(key="active_org_id", path="/")
    return {"message": "Successfully logged out"}


@router.post("/onboarding")
def onboarding(data: OnboardingIn, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.organisation_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Organisation already set up."
        )

    # Create new Organisation
    org = Organisation(
        org_name=data.org_name,
        domain=data.domain,
        contact_email=data.contact_email or current_user.email,
        website_link=data.website_link,
        location=data.location,
        description=data.description,
    )
    db.add(org)
    db.commit()
    db.refresh(org)

    # Associate user with the new Organisation
    current_user.organisation_id = org.id
    db.commit()
    db.refresh(current_user)

    return {
        "user": {
            "id": current_user.id,
            "name": current_user.name,
            "email": current_user.email,
            "user_type": current_user.user_type,
            "status": current_user.status,
            "organisation_id": current_user.organisation_id,
        },
        "organisation": {
            "id": org.id,
            "org_name": org.org_name,
            "domain": org.domain,
        }
    }


@router.get("/me", response_model=UserProfileOut)
def get_me(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    org_name = None
    org_id = current_user.organisation_id

    if current_user.user_type == UserType.super_admin:
        # For super admin, fetch the org name of the active context
        active_org_id = get_active_org_id(request, current_user, db)
        if active_org_id:
            org = db.query(Organisation).filter(Organisation.id == active_org_id).first()
            if org:
                org_name = org.org_name
                org_id = org.id
    elif current_user.organisation_id:
        org = db.query(Organisation).filter(Organisation.id == current_user.organisation_id).first()
        if org:
            org_name = org.org_name

    onboarding_required = org_id is None and current_user.user_type != UserType.super_admin

    return UserProfileOut(
        id=current_user.id,
        name=current_user.name,
        email=current_user.email,
        designation=current_user.designation,
        user_type=current_user.user_type,
        status=current_user.status,
        organisation_id=org_id,
        organisation_name=org_name,
        onboarding_required=onboarding_required,
    )


@router.get("/organisations")
def list_organisations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.user_type != UserType.super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admins can list all organisations."
        )
    orgs = db.query(Organisation).all()
    return orgs


@router.post("/switch-context")
def switch_context(data: SwitchContextIn, response: Response, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.user_type != UserType.super_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admins can switch organisation context."
        )
    
    # Verify the organisation exists
    org = db.query(Organisation).filter(Organisation.id == data.organisation_id).first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organisation not found."
        )

    response.set_cookie(
        key="active_org_id",
        value=str(org.id),
        httponly=True,
        max_age=7 * 24 * 60 * 60,
        samesite="lax",
        secure=False,
        path="/",
    )

    return {"message": f"Switched context to organisation: {org.org_name}", "organisation_id": org.id, "organisation_name": org.org_name}
