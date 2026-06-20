import asyncio
import logging
from typing import Any

from telegram import Bot
from telegram.error import NetworkError, TelegramError, TimedOut
from telegram.ext import Application

logger = logging.getLogger(__name__)

TG_BOT_START_TIMEOUT_SECONDS = 25.0
TG_BOT_STOP_TIMEOUT_SECONDS = 15.0


def _normalize_notify_chat_id(raw: Any) -> int | None:
    """将配置中的 Chat ID 转为整数（群组常为负数）。"""
    try:
        return int(str(raw).strip())
    except Exception:
        return None


class TgBotService:
    def __init__(self) -> None:
        self._app: Application | None = None
        self._running = False
        self._lock = asyncio.Lock()
        self._last_error: str = ""

    @property
    def running(self) -> bool:
        return self._running

    @property
    def last_error(self) -> str:
        return self._last_error

    def _resolve_telegram_proxy(self) -> str | None:
        from app.utils.proxy import proxy_manager

        return proxy_manager.get_effective_https_proxy()

    def _build_httpx_request(self, proxy_url: str | None = None) -> "HTTPXRequest":
        """构建 Telegram HTTP 客户端，禁用系统环境代理避免 Docker 注入无效 HTTP_PROXY。"""
        from telegram.request import HTTPXRequest

        return HTTPXRequest(
            proxy=proxy_url,
            connect_timeout=10.0,
            read_timeout=30.0,
            httpx_kwargs={"trust_env": False},
        )

    def _build_application(self, token: str) -> Application:
        from .handlers import register_handlers

        proxy_url = self._resolve_telegram_proxy()
        request = self._build_httpx_request(proxy_url)
        if proxy_url:
            logger.info("TG Bot 使用代理: %s", proxy_url)
        else:
            logger.info("TG Bot 使用直连（已忽略系统环境变量 HTTP_PROXY）")
        builder = (
            Application.builder()
            .token(token)
            .request(request)
            .get_updates_request(request)
        )
        app = builder.build()
        cfg = self._get_settings()
        register_handlers(app, cfg["allowed_users"])
        return app

    def _build_standalone_bot(self, token: str) -> Bot:
        proxy_url = self._resolve_telegram_proxy()
        return Bot(token, request=self._build_httpx_request(proxy_url))

    @property
    def bot(self) -> Bot | None:
        return self._app.bot if self._app else None

    def _get_settings(self) -> dict[str, Any]:
        from app.services.runtime_settings_service import runtime_settings_service
        return {
            "token": runtime_settings_service.get("tg_bot_token", ""),
            "enabled": runtime_settings_service.get("tg_bot_enabled", False),
            "allowed_users": runtime_settings_service.get("tg_bot_allowed_users", []),
            "notify_chat_ids": runtime_settings_service.get("tg_bot_notify_chat_ids", []),
        }

    async def _shutdown_app(self, app: Application) -> None:
        try:
            if getattr(app, "updater", None) and app.updater.running:
                await app.updater.stop()
        except Exception:
            logger.exception("Error stopping TG Bot updater")
        try:
            await app.stop()
        except RuntimeError:
            pass
        try:
            await app.shutdown()
        except Exception:
            logger.exception("Error shutting down TG Bot application")

    async def start(self) -> None:
        async with self._lock:
            if self._running:
                return

            cfg = self._get_settings()
            if not cfg["enabled"] or not cfg["token"]:
                logger.info("TG Bot is disabled or token is empty, skipping start")
                return

            partial_app: Application | None = None
            try:
                partial_app = self._build_application(cfg["token"])
                self._app = partial_app

                await asyncio.wait_for(
                    self._finish_start(partial_app),
                    timeout=TG_BOT_START_TIMEOUT_SECONDS,
                )
                self._running = True
                self._last_error = ""
                logger.info("TG Bot started successfully")
            except (asyncio.TimeoutError, TimedOut):
                await self._abort_start(
                    partial_app,
                    "TG Bot 启动超时，请检查 Token 与访问 Telegram 的网络，或在设置中配置可用代理后重启 Bot",
                )
            except NetworkError as exc:
                await self._abort_start(
                    partial_app,
                    f"TG Bot 无法连接 Telegram API：{exc}。如在 Docker/国内环境，请在「代理设置」中配置可访问 Telegram 的 HTTPS 代理",
                )
            except TelegramError:
                await self._abort_start(
                    partial_app,
                    "TG Bot 启动失败（Token 无效或 Telegram API 异常），请检查 Bot Token",
                )
            except Exception:
                await self._abort_start(
                    partial_app,
                    "TG Bot 启动出现未知错误，请查看服务日志",
                    exc_info=True,
                )

    async def _abort_start(
        self,
        partial_app: Application | None,
        message: str,
        *args: Any,
        exc_info: bool = False,
    ) -> None:
        if exc_info:
            logger.exception(message, *args)
        elif args:
            logger.error(message, *args)
        else:
            logger.error(message)
        self._last_error = str(message)
        if partial_app is not None:
            await self._shutdown_app(partial_app)
        self._app = None
        self._running = False

    async def _finish_start(self, app: Application) -> None:
        await app.initialize()
        await app.start()
        await app.updater.start_polling(drop_pending_updates=True)

    async def stop(self) -> None:
        async with self._lock:
            if not self._running and not self._app:
                return

            app = self._app
            self._app = None
            self._running = False
            if not app:
                return

            try:
                await asyncio.wait_for(
                    self._shutdown_app(app),
                    timeout=TG_BOT_STOP_TIMEOUT_SECONDS,
                )
                self._last_error = ""
                logger.info("TG Bot stopped")
            except asyncio.TimeoutError:
                logger.error("TG Bot stop timed out, state cleared")
            except Exception:
                logger.exception("Error stopping TG Bot")

    async def restart(self) -> None:
        await self.stop()
        await self.start()

    async def send_notification(self, text: str, parse_mode: str = "HTML") -> None:
        cfg = self._get_settings()
        if not cfg["enabled"] or not cfg["token"]:
            return

        chat_ids = cfg.get("notify_chat_ids") or []
        if not chat_ids:
            logger.debug("TG Bot notify skipped: notify_chat_ids empty")
            return

        normalized_ids = []
        for raw in chat_ids:
            cid = _normalize_notify_chat_id(raw)
            if cid is not None:
                normalized_ids.append(cid)
        if not normalized_ids:
            logger.debug("TG Bot notify skipped: no valid chat ids")
            return

        async def _deliver(bot: Bot) -> None:
            for chat_id in normalized_ids:
                try:
                    await bot.send_message(
                        chat_id=chat_id,
                        text=text,
                        parse_mode=parse_mode,
                    )
                except Exception:
                    logger.warning(
                        "Failed to send notification to chat %s", chat_id, exc_info=True
                    )

        if self._running and self._app and self._app.bot:
            await _deliver(self._app.bot)
            return

        try:
            bot = self._build_standalone_bot(cfg["token"])
            async with bot:
                await _deliver(bot)
        except Exception:
            logger.warning(
                "TG Bot notify failed (standalone client, polling may be down)",
                exc_info=True,
            )

    def status(self) -> dict[str, Any]:
        cfg = self._get_settings()
        return {
            "enabled": cfg["enabled"],
            "running": self._running,
            "has_token": bool(cfg["token"]),
            "notify_chat_ids": cfg.get("notify_chat_ids", []),
            "allowed_users": cfg.get("allowed_users", []),
            "last_error": self._last_error,
            "using_proxy": bool(self._resolve_telegram_proxy()),
        }


tg_bot_service = TgBotService()
