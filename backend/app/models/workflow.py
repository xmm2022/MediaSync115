from datetime import datetime
from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

from app.core.timezone_utils import beijing_now


class Workflow(Base):
    __tablename__ = "workflows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    timer: Mapped[str | None] = mapped_column(String(120), nullable=True)
    trigger_type: Mapped[str] = mapped_column(String(20), default="timer")
    event_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    event_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    actions: Mapped[str | None] = mapped_column(Text, nullable=True)
    flows: Mapped[str | None] = mapped_column(Text, nullable=True)
    context: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str] = mapped_column(String(20), default="P")
    run_count: Mapped[int] = mapped_column(Integer, default=0)
    current_action: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=beijing_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=beijing_now, onupdate=beijing_now)
