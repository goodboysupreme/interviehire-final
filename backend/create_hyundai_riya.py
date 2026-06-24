"""One-time, idempotent account bootstrap: org "Hyundai" + organiser "Riya".

Run from the backend/ directory with your DATABASE_URL configured in .env:

    python create_hyundai_riya.py

Safe to re-run — it creates the org/user if missing, otherwise updates Riya to
org_admin of Hyundai and resets her password. Does NOT delete anything.
"""

from app.database import SessionLocal, Base, engine
from app.models.user import User, UserStatus, UserType
from app.models.organisation import Organisation
from app.utils.auth import get_password_hash

ORG_NAME = "Hyundai"
USER_NAME = "Riya"
USER_EMAIL = "riya@hyundai.com"
USER_PASSWORD = "hellohyundai"


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        org = db.query(Organisation).filter(Organisation.org_name == ORG_NAME).first()
        if not org:
            org = Organisation(
                org_name=ORG_NAME,
                location="India",
                description="Hyundai hiring on IntervieHire.",
            )
            db.add(org)
            db.commit()
            db.refresh(org)
            print(f"Created organisation '{ORG_NAME}' ({org.id})")
        else:
            print(f"Organisation '{ORG_NAME}' already exists ({org.id})")

        user = db.query(User).filter(User.email == USER_EMAIL).first()
        if not user:
            user = User(
                name=USER_NAME,
                email=USER_EMAIL,
                designation="Org. Admin",
                user_type=UserType.org_admin,
                status=UserStatus.active,
                hashed_password=get_password_hash(USER_PASSWORD),
                organisation_id=org.id,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            print(f"Created organiser '{USER_NAME}' <{USER_EMAIL}> in '{ORG_NAME}'")
        else:
            user.name = USER_NAME
            user.user_type = UserType.org_admin
            user.status = UserStatus.active
            user.organisation_id = org.id
            user.hashed_password = get_password_hash(USER_PASSWORD)
            db.commit()
            print(f"Updated existing <{USER_EMAIL}> -> org_admin of '{ORG_NAME}' (password reset)")

        print("Done.")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()


if __name__ == "__main__":
    run()
