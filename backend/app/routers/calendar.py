import json
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CalendarPost
from app.services.action_board import generate_post_details

_DETAILS_REGEN_DAYS = 7

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


class CalendarPostCreate(BaseModel):
    title: str = Field(max_length=200)
    date: date
    time_slot: Optional[str] = None
    content_type: str
    status: str = "Idea"
    hook: Optional[str] = None
    notes: Optional[str] = None


class CalendarPostUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    date: Optional[date] = None
    time_slot: Optional[str] = None
    content_type: Optional[str] = None
    status: Optional[str] = None
    hook: Optional[str] = None
    notes: Optional[str] = None
    opening_script: Optional[str] = None
    products_to_mention: Optional[str] = None   # JSON array string
    hashtags: Optional[str] = None               # JSON array string
    recommended_duration: Optional[str] = None


class GenerateDetailsBody(BaseModel):
    post_idea: str
    hook: str = ""
    content_angle: str = ""
    post_id: Optional[int] = None   # if provided, enables DB caching and rate limiting
    force: bool = False             # if True, bypasses cache (subject to rate limit)


def _row_to_dict(p: CalendarPost) -> dict:
    return {
        "id": p.id,
        "title": p.title,
        "date": p.date.isoformat(),
        "time_slot": p.time_slot,
        "content_type": p.content_type,
        "status": p.status,
        "hook": p.hook,
        "notes": p.notes,
        "opening_script": p.opening_script,
        "products_to_mention": p.products_to_mention,
        "hashtags": p.hashtags,
        "recommended_duration": p.recommended_duration,
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat(),
    }


@router.get("")
def list_calendar_posts(db: Session = Depends(get_db)):
    posts = db.query(CalendarPost).order_by(CalendarPost.date.asc()).all()
    return [_row_to_dict(p) for p in posts]


@router.post("", status_code=201)
def create_calendar_post(body: CalendarPostCreate, db: Session = Depends(get_db)):
    post = CalendarPost(
        title=body.title,
        date=body.date,
        time_slot=body.time_slot,
        content_type=body.content_type,
        status=body.status,
        hook=body.hook,
        notes=body.notes,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return _row_to_dict(post)


@router.put("/{post_id}")
def update_calendar_post(post_id: int, body: CalendarPostUpdate, db: Session = Depends(get_db)):
    post = db.query(CalendarPost).filter(CalendarPost.id == post_id).first()
    if post is None:
        raise HTTPException(status_code=404, detail="Calendar post not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(post, field, value)
    post.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(post)
    return _row_to_dict(post)


@router.delete("/{post_id}", status_code=204)
def delete_calendar_post(post_id: int, db: Session = Depends(get_db)):
    post = db.query(CalendarPost).filter(CalendarPost.id == post_id).first()
    if post is None:
        raise HTTPException(status_code=404, detail="Calendar post not found")
    db.delete(post)
    db.commit()


def _post_to_details(post: CalendarPost) -> dict:
    """Return the cached details stored on a CalendarPost record."""
    return {
        "opening_script":       post.opening_script or "",
        "products_to_mention":  json.loads(post.products_to_mention) if post.products_to_mention else [],
        "hashtags":             json.loads(post.hashtags) if post.hashtags else [],
        "recommended_duration": post.recommended_duration or "",
    }


@router.post("/generate-details")
async def generate_details(body: GenerateDetailsBody, db: Session = Depends(get_db)):
    """Generate post details via Claude.

    If post_id is provided:
    - Returns cached details if the post already has them (no API call) unless force=True.
    - force=True regenerates but is rate-limited to once per {_DETAILS_REGEN_DAYS} days per post.
    - Generated details are saved back to the CalendarPost record.
    """
    post: Optional[CalendarPost] = None
    if body.post_id is not None:
        post = db.query(CalendarPost).filter(CalendarPost.id == body.post_id).first()
        if post is None:
            raise HTTPException(status_code=404, detail="Calendar post not found")

        # Return cached details unless force=True
        if post.opening_script and not body.force:
            return _post_to_details(post)

        # Rate limit: max 1 regen per post per week
        if body.force and post.details_generated_at:
            cooldown = timedelta(days=_DETAILS_REGEN_DAYS)
            next_allowed = post.details_generated_at + cooldown
            if datetime.utcnow() < next_allowed:
                days_left = (next_allowed - datetime.utcnow()).days + 1
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": (
                            f"Details were already generated for this post. "
                            f"You can regenerate again in {days_left} day{'s' if days_left != 1 else ''}."
                        ),
                        "next_allowed_at": next_allowed.isoformat(),
                    },
                )

    try:
        result = await generate_post_details(body.post_idea, body.hook, body.content_angle)

        # Save generated details back to the CalendarPost record
        if post is not None:
            post.opening_script       = result.get("opening_script", "")
            post.products_to_mention  = json.dumps(result.get("products_to_mention", []))
            post.hashtags             = json.dumps(result.get("hashtags", []))
            post.recommended_duration = result.get("recommended_duration", "")
            post.details_generated_at = datetime.utcnow()
            post.updated_at           = datetime.utcnow()
            db.commit()

        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to generate post details") from exc
