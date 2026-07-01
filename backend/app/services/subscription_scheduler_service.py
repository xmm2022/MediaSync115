import json

from sqlalchemy import select

from app.core.database import async_session_maker
from app.models.scheduler_task import SchedulerTask
from app.models.watchlist import Watchlist
from app.scheduler import scheduler_manager
from app.services.runtime_settings_service import runtime_settings_service


class SubscriptionSchedulerService:
    async def ensure_subscription_tasks(self, *, run_immediately: bool = True) -> None:
        """确保统一的订阅定时任务存在。"""
        settings_data = runtime_settings_service.get_all()
        enabled = bool(settings_data.get("subscription_enabled", False))
        interval_hours = max(
            1,
            int(settings_data.get("subscription_interval_hours", 24) or 24),
        )
        interval_seconds = interval_hours * 3600
        job_key = "subscription.check"

        async with async_session_maker() as db:
            result = await db.execute(
                select(SchedulerTask)
                .where(SchedulerTask.job_key == job_key)
                .limit(1)
            )
            task = result.scalar_one_or_none()
            if not task:
                task = SchedulerTask(
                    name="订阅检查",
                    job_key=job_key,
                    trigger_type="interval",
                    cron_expr=None,
                    interval_seconds=interval_seconds,
                    kwargs_json=json.dumps({}, ensure_ascii=False),
                    enabled=enabled,
                    state="W" if enabled else "P",
                )
                db.add(task)
                await db.flush()
            else:
                task.name = "订阅检查"
                task.trigger_type = "interval"
                task.cron_expr = None
                task.interval_seconds = interval_seconds
                task.enabled = enabled
                task.state = "W" if enabled else "P"

            await db.flush()
            await scheduler_manager.update_dynamic_job(task)
            should_start = enabled
            should_remove = not enabled

            await db.commit()

            if should_start and run_immediately:
                await scheduler_manager.start(job_id=f"dynamic:{task.id}")
            elif should_remove:
                await scheduler_manager.remove_dynamic_job(task.id)

    async def ensure_chart_subscription_task(self, *, run_immediately: bool = True) -> None:
        """确保榜单订阅定时任务存在。"""
        settings_data = runtime_settings_service.get_all()
        enabled = bool(settings_data.get("chart_subscription_enabled", False))
        interval_hours = max(
            1,
            int(
                settings_data.get("chart_subscription_interval_hours", 24) or 24
            ),
        )
        interval_seconds = interval_hours * 3600
        job_key = "chart_subscription.sync"

        async with async_session_maker() as db:
            result = await db.execute(
                select(SchedulerTask).where(SchedulerTask.job_key == job_key).limit(1)
            )
            task = result.scalar_one_or_none()
            if not task:
                task = SchedulerTask(
                    name="榜单订阅同步",
                    job_key=job_key,
                    trigger_type="interval",
                    cron_expr=None,
                    interval_seconds=interval_seconds,
                    kwargs_json=json.dumps({}, ensure_ascii=False),
                    enabled=enabled,
                    state="W" if enabled else "P",
                )
                db.add(task)
                await db.flush()
            else:
                task.name = "榜单订阅同步"
                task.trigger_type = "interval"
                task.cron_expr = None
                task.interval_seconds = interval_seconds
                task.enabled = enabled
                task.state = "W" if enabled else "P"

            await db.flush()
            await scheduler_manager.update_dynamic_job(task)
            should_start = enabled
            should_remove = not enabled

            await db.commit()

            if should_start and run_immediately:
                await scheduler_manager.start(job_id=f"dynamic:{task.id}")
            elif should_remove:
                await scheduler_manager.remove_dynamic_job(task.id)

    async def ensure_person_follow_task(self, *, run_immediately: bool = True) -> None:
        """确保演职员关注同步定时任务存在。"""
        settings_data = runtime_settings_service.get_all()
        enabled = bool(settings_data.get("person_follow_enabled", False))
        interval_hours = max(
            1,
            int(settings_data.get("person_follow_interval_hours", 24) or 24),
        )
        interval_seconds = interval_hours * 3600
        job_key = "person_follow.sync"

        async with async_session_maker() as db:
            result = await db.execute(
                select(SchedulerTask).where(SchedulerTask.job_key == job_key).limit(1)
            )
            task = result.scalar_one_or_none()
            if not task:
                task = SchedulerTask(
                    name="演职员关注同步",
                    job_key=job_key,
                    trigger_type="interval",
                    cron_expr=None,
                    interval_seconds=interval_seconds,
                    kwargs_json=json.dumps({}, ensure_ascii=False),
                    enabled=enabled,
                    state="W" if enabled else "P",
                )
                db.add(task)
                await db.flush()
            else:
                task.name = "演职员关注同步"
                task.trigger_type = "interval"
                task.cron_expr = None
                task.interval_seconds = interval_seconds
                task.enabled = enabled
                task.state = "W" if enabled else "P"

            await db.flush()
            await scheduler_manager.update_dynamic_job(task)
            should_start = enabled
            should_remove = not enabled

            await db.commit()

            if should_start and run_immediately:
                await scheduler_manager.start(job_id=f"dynamic:{task.id}")
            elif should_remove:
                await scheduler_manager.remove_dynamic_job(task.id)

    async def ensure_watchlist_auto_fill_task(self, *, run_immediately: bool = False) -> None:
        """确保启用自动填充的片单会被周期任务处理。"""
        interval_seconds = 24 * 3600
        job_key = "watchlist.auto_fill"

        async with async_session_maker() as db:
            enabled_result = await db.execute(
                select(Watchlist.id)
                .where(Watchlist.auto_fill_enabled == True)  # noqa: E712
                .limit(1)
            )
            enabled = enabled_result.scalar_one_or_none() is not None
            result = await db.execute(
                select(SchedulerTask).where(SchedulerTask.job_key == job_key).limit(1)
            )
            task = result.scalar_one_or_none()
            if not task:
                task = SchedulerTask(
                    name="片单自动填充",
                    job_key=job_key,
                    trigger_type="interval",
                    cron_expr=None,
                    interval_seconds=interval_seconds,
                    kwargs_json=json.dumps({}, ensure_ascii=False),
                    enabled=enabled,
                    state="W" if enabled else "P",
                )
                db.add(task)
                await db.flush()
            else:
                task.name = "片单自动填充"
                task.trigger_type = "interval"
                task.cron_expr = None
                task.interval_seconds = interval_seconds
                task.enabled = enabled
                task.state = "W" if enabled else "P"

            await db.flush()
            await scheduler_manager.update_dynamic_job(task)
            should_start = enabled
            should_remove = not enabled

            await db.commit()

            if should_start and run_immediately:
                await scheduler_manager.start(job_id=f"dynamic:{task.id}")
            elif should_remove:
                await scheduler_manager.remove_dynamic_job(task.id)

    async def ensure_tg_index_incremental_task(self) -> None:
        """确保 TG 索引自动增量同步定时任务存在（interval 触发器，最小间隔 15 分钟）。"""
        settings_data = runtime_settings_service.get_all()
        enabled = bool(settings_data.get("tg_index_enabled", False))
        raw_minutes = int(settings_data.get("tg_incremental_interval_minutes", 30) or 30)
        minutes = max(15, raw_minutes)
        interval_seconds = minutes * 60
        job_key = "tg.index.incremental"

        async with async_session_maker() as db:
            result = await db.execute(
                select(SchedulerTask)
                .where(SchedulerTask.job_key == job_key)
                .limit(1)
            )
            task = result.scalar_one_or_none()
            if not task:
                task = SchedulerTask(
                    name="TG 索引增量同步",
                    job_key=job_key,
                    trigger_type="interval",
                    cron_expr=None,
                    interval_seconds=interval_seconds,
                    kwargs_json=json.dumps({}, ensure_ascii=False),
                    enabled=enabled,
                    state="W" if enabled else "P",
                )
                db.add(task)
                await db.flush()
            else:
                task.trigger_type = "interval"
                task.cron_expr = None
                task.interval_seconds = interval_seconds
                task.enabled = enabled
                task.state = "W" if enabled else "P"

            await db.flush()
            await scheduler_manager.update_dynamic_job(task)
            if not enabled:
                await scheduler_manager.remove_dynamic_job(task.id)

            await db.commit()


subscription_scheduler_service = SubscriptionSchedulerService()
