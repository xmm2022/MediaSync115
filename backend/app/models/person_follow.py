"""演职员关注模型。"""

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.timezone_utils import beijing_now


class PersonFollow(Base):
    """关注的演职员。"""

    __tablename__ = "person_follows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tmdb_person_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    profile_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    known_for_department: Mapped[str | None] = mapped_column(String(80), nullable=True)
    auto_subscribe_new_works: Mapped[bool] = mapped_column(Boolean, default=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=beijing_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=beijing_now, onupdate=beijing_now
    )

    credits: Mapped[list["PersonFollowCredit"]] = relationship(
        "PersonFollowCredit",
        back_populates="person_follow",
        cascade="all, delete-orphan",
    )


class PersonFollowCredit(Base):
    """已发现的演职员作品，用于检测新作。"""

    __tablename__ = "person_follow_credits"
    __table_args__ = (
        UniqueConstraint(
            "person_follow_id", "tmdb_id", "media_type", name="uq_person_follow_credit"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    person_follow_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("person_follows.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tmdb_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    media_type: Mapped[str] = mapped_column(String(10), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    poster_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    credit_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    discovered_at: Mapped[datetime] = mapped_column(DateTime, default=beijing_now)
    subscribed: Mapped[bool] = mapped_column(Boolean, default=False)

    person_follow: Mapped["PersonFollow"] = relationship(
        "PersonFollow", back_populates="credits"
    )
