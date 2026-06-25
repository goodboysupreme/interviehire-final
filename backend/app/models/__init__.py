from app.models.user import User, UserStatus, UserType
from app.models.organisation import Organisation
from app.models.job import Job, JobStatus, JobCollaborator
from app.models.applicant import Applicant, InterviewStatus, CheatProbability, ApplicantSource
from app.models.ai_integration import Company, Candidate, JobRole, Question, InterviewSession, ProctoringLog
from app.models.interview_report import InterviewReport
# Talent Finder (AI sourcing) tables — imported so Base.metadata.create_all
# registers them at startup. Additive; does not touch the interview pipeline.
from app.talent_finder import models as talent_finder_models  # noqa
from app.models.user_preferences import UserPreferences