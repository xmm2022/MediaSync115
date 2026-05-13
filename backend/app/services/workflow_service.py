import json
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.workflow import Workflow

from app.core.timezone_utils import beijing_now


class WorkflowService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_all(self) -> list[Workflow]:
        result = await self.db.execute(select(Workflow).order_by(Workflow.created_at.desc()))
        return result.scalars().all()

    async def get(self, workflow_id: int) -> Workflow | None:
        result = await self.db.execute(select(Workflow).where(Workflow.id == workflow_id))
        return result.scalar_one_or_none()

    async def get_by_name(self, name: str) -> Workflow | None:
        result = await self.db.execute(select(Workflow).where(Workflow.name == name))
        return result.scalar_one_or_none()

    async def list_enabled_timer_workflows(self) -> list[Workflow]:
        result = await self.db.execute(
            select(Workflow).where(
                Workflow.state == "W",
                Workflow.trigger_type == "timer",
            )
        )
        return result.scalars().all()

    async def list_enabled_event_workflows(self, event_type: str | None = None) -> list[Workflow]:
        query = select(Workflow).where(
            Workflow.state == "W",
            Workflow.trigger_type == "event",
        )
        if event_type:
            query = query.where(Workflow.event_type == event_type)
        result = await self.db.execute(query)
        return result.scalars().all()

    async def create(self, payload: dict[str, Any]) -> Workflow:
        workflow = Workflow(**payload)
        self.db.add(workflow)
        await self.db.commit()
        await self.db.refresh(workflow)
        return workflow

    async def update(self, workflow: Workflow, payload: dict[str, Any]) -> Workflow:
        for key, value in payload.items():
            setattr(workflow, key, value)
        workflow.updated_at = beijing_now()
        await self.db.commit()
        await self.db.refresh(workflow)
        return workflow

    async def delete(self, workflow: Workflow) -> None:
        await self.db.delete(workflow)
        await self.db.commit()

    async def mark_running(self, workflow_id: int, action_name: str | None = None) -> None:
        workflow = await self.get(workflow_id)
        if not workflow:
            return
        workflow.current_action = action_name
        workflow.last_run_at = beijing_now()
        workflow.run_count = int(workflow.run_count or 0) + 1
        await self.db.commit()

    async def mark_result(self, workflow_id: int, success: bool, message: str, action_name: str | None = None) -> None:
        workflow = await self.get(workflow_id)
        if not workflow:
            return
        workflow.current_action = action_name
        workflow.last_result = json.dumps(
            {
                "success": success,
                "message": message,
                "at": beijing_now().isoformat(),
            },
            ensure_ascii=False,
        )
        workflow.updated_at = beijing_now()
        await self.db.commit()

    @staticmethod
    def parse_json_field(raw: str | None, default: Any):
        if not raw:
            return default
        try:
            return json.loads(raw)
        except Exception:
            return default
