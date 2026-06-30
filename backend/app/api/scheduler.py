import json
from typing import Any, Optional

from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.scheduler_task import SchedulerTask
from app.scheduler import scheduler_manager
from app.services.job_registry import job_registry
from app.services.operation_log_service import operation_log_service

router = APIRouter(prefix="/scheduler", tags=["scheduler"])


class SchedulerTaskCreate(BaseModel):
    name: str
    job_key: str
    trigger_type: str = "cron"
    cron_expr: Optional[str] = None
    interval_seconds: Optional[int] = None
    kwargs: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class SchedulerTaskUpdate(BaseModel):
    name: Optional[str] = None
    job_key: Optional[str] = None
    trigger_type: Optional[str] = None
    cron_expr: Optional[str] = None
    interval_seconds: Optional[int] = None
    kwargs: Optional[dict[str, Any]] = None
    enabled: Optional[bool] = None


def _validate_dynamic_task_schedule(
    *,
    trigger_type: str | None,
    cron_expr: str | None,
    interval_seconds: int | None,
    enabled: bool,
) -> None:
    if not enabled:
        return

    normalized = str(trigger_type or "cron").strip().lower()
    if normalized == "interval":
        if int(interval_seconds or 0) <= 0:
            raise HTTPException(status_code=400, detail="启用的间隔任务必须填写大于 0 的间隔秒数")
        return

    if normalized == "cron":
        expr = str(cron_expr or "").strip()
        if not expr:
            raise HTTPException(status_code=400, detail="启用的 cron 任务必须填写 cron 表达式")
        try:
            CronTrigger.from_crontab(expr)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"无效的 cron 表达式: {exc}") from exc
        return

    raise HTTPException(status_code=400, detail=f"不支持的触发类型: {trigger_type}")


@router.get("/job-keys")
async def list_job_keys():
    return {"items": job_registry.list_keys()}


@router.get("/jobs")
async def list_scheduler_jobs():
    return {"items": scheduler_manager.list_jobs()}


@router.post("/run/{job_id}")
async def run_scheduler_job(job_id: str, force: bool = False, db: AsyncSession = Depends(get_db)):
    if job_id.startswith("dynamic:"):
        raw_task_id = job_id.removeprefix("dynamic:")
        try:
            task_id = int(raw_task_id)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid dynamic task id: {raw_task_id}")
        task = await db.get(SchedulerTask, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        await scheduler_manager.update_dynamic_job(task)

    await operation_log_service.log_background_event(
        source_type="api", module="scheduler",
        action="scheduler.job.run_manual", status="info",
        message=f"手动执行定时任务：{job_id}（force={force}）",
        extra={"job_id": job_id, "force": force},
    )
    result = await scheduler_manager.run_now(job_id, force=force)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message") or "run failed")
    return result


@router.get("/tasks")
async def list_dynamic_tasks(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SchedulerTask).order_by(SchedulerTask.created_at.desc()))
    return result.scalars().all()


@router.post("/tasks")
async def create_dynamic_task(payload: SchedulerTaskCreate, db: AsyncSession = Depends(get_db)):
    if not job_registry.get(payload.job_key):
        raise HTTPException(status_code=400, detail=f"Unknown job_key: {payload.job_key}")
    _validate_dynamic_task_schedule(
        trigger_type=payload.trigger_type,
        cron_expr=payload.cron_expr,
        interval_seconds=payload.interval_seconds,
        enabled=payload.enabled,
    )

    task = SchedulerTask(
        name=payload.name,
        job_key=payload.job_key,
        trigger_type=payload.trigger_type,
        cron_expr=payload.cron_expr,
        interval_seconds=payload.interval_seconds,
        kwargs_json=json.dumps(payload.kwargs or {}, ensure_ascii=False),
        enabled=payload.enabled,
        state="W" if payload.enabled else "P",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    await scheduler_manager.update_dynamic_job(task)
    await operation_log_service.log_background_event(
        source_type="api", module="scheduler",
        action="scheduler.task.create", status="success",
        message=f"创建定时任务：{task.name}（{task.job_key}，{'启用' if task.enabled else '暂停'}）",
        extra={"task_id": task.id, "job_key": task.job_key, "enabled": task.enabled},
    )
    return task


@router.put("/tasks/{task_id}")
async def update_dynamic_task(task_id: int, payload: SchedulerTaskUpdate, db: AsyncSession = Depends(get_db)):
    task = await db.get(SchedulerTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    data = payload.model_dump(exclude_unset=True)
    if "job_key" in data and data["job_key"] and not job_registry.get(data["job_key"]):
        raise HTTPException(status_code=400, detail=f"Unknown job_key: {data['job_key']}")

    _validate_dynamic_task_schedule(
        trigger_type=data.get("trigger_type", task.trigger_type),
        cron_expr=data.get("cron_expr", task.cron_expr),
        interval_seconds=data.get("interval_seconds", task.interval_seconds),
        enabled=bool(data.get("enabled", task.enabled)),
    )

    if "kwargs" in data:
        task.kwargs_json = json.dumps(data.pop("kwargs") or {}, ensure_ascii=False)

    for key, value in data.items():
        setattr(task, key, value)

    if task.enabled and task.state == "P":
        task.state = "W"
    if not task.enabled:
        task.state = "P"

    await db.commit()
    await db.refresh(task)

    await scheduler_manager.update_dynamic_job(task)
    if not task.enabled:
        await scheduler_manager.remove_dynamic_job(task.id)
    await operation_log_service.log_background_event(
        source_type="api", module="scheduler",
        action="scheduler.task.update", status="success",
        message=f"更新定时任务：{task.name}（{task.job_key}）",
        extra={"task_id": task.id, "job_key": task.job_key, "updated_fields": list(data.keys())},
    )
    return task


@router.post("/tasks/{task_id}/enable")
async def enable_dynamic_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(SchedulerTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    _validate_dynamic_task_schedule(
        trigger_type=task.trigger_type,
        cron_expr=task.cron_expr,
        interval_seconds=task.interval_seconds,
        enabled=True,
    )
    task.enabled = True
    task.state = "W"
    await db.commit()
    await db.refresh(task)
    await scheduler_manager.update_dynamic_job(task)
    await operation_log_service.log_background_event(
        source_type="api", module="scheduler",
        action="scheduler.task.enable", status="success",
        message=f"启用定时任务：{task.name}（{task.job_key}）",
        extra={"task_id": task.id, "job_key": task.job_key},
    )
    return {"success": True}


@router.post("/tasks/{task_id}/pause")
async def pause_dynamic_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(SchedulerTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.enabled = False
    task.state = "P"
    await db.commit()
    await db.refresh(task)
    await scheduler_manager.remove_dynamic_job(task.id)
    await operation_log_service.log_background_event(
        source_type="api", module="scheduler",
        action="scheduler.task.pause", status="success",
        message=f"暂停定时任务：{task.name}（{task.job_key}）",
        extra={"task_id": task.id, "job_key": task.job_key},
    )
    return {"success": True}


@router.delete("/tasks/{task_id}")
async def delete_dynamic_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(SchedulerTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task_name = task.name
    task_job_key = task.job_key
    await db.delete(task)
    await db.commit()
    await scheduler_manager.remove_dynamic_job(task_id)
    await operation_log_service.log_background_event(
        source_type="api", module="scheduler",
        action="scheduler.task.delete", status="success",
        message=f"删除定时任务：{task_name}（{task_job_key}）",
        extra={"task_id": task_id, "job_key": task_job_key},
    )
    return {"success": True}
