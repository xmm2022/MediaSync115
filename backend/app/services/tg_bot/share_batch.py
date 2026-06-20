"""TG Bot 批量分享链接转存。"""

from __future__ import annotations

import logging
from html import escape

from telegram import Update
from telegram.constants import ParseMode
from telegram.ext import ContextTypes

from app.utils.share_link_parser import BatchShareParseResult, ParsedShareItem, parse_batch_share_text

logger = logging.getLogger(__name__)


def _default_folder_name(item: ParsedShareItem, index: int) -> str:
    title = str(item.title or "").strip()
    if title:
        return title
    return f"分享资源 {index}"


async def batch_transfer_115_shares(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    items: list[ParsedShareItem],
    *,
    progress_message_id: int | None = None,
) -> str:
    """批量转存 115 分享链接到默认目录，返回 HTML 汇总文本。"""
    from app.services.media_postprocess_service import media_postprocess_service
    from app.services.pan115_service import pan115_service
    from app.services.runtime_settings_service import runtime_settings_service

    if not items:
        return "未检测到可转存的 115 分享链接。"

    default_folder = runtime_settings_service.get_pan115_default_folder()
    parent_id = str(default_folder.get("folder_id") or "0").strip() or "0"
    parent_name = str(default_folder.get("folder_name") or "默认目录").strip()

    chat = update.effective_chat
    message = update.effective_message
    progress_chat_id = chat.id if chat else None
    progress_message_id_value = progress_message_id

    success_count = 0
    lines: list[str] = [
        f"<b>115 批量转存完成</b>（目标：{escape(parent_name)}）",
        "",
    ]

    for index, item in enumerate(items, start=1):
        folder_name = _default_folder_name(item, index)
        if progress_chat_id and progress_message_id_value:
            try:
                await context.bot.edit_message_text(
                    chat_id=progress_chat_id,
                    message_id=progress_message_id_value,
                    text=(
                        f"正在转存 ({index}/{len(items)}): "
                        f"<b>{escape(folder_name[:60])}</b> ..."
                    ),
                    parse_mode=ParseMode.HTML,
                )
            except Exception:
                pass

        try:
            result = await pan115_service.save_share_to_folder(
                share_url=item.share_url,
                folder_name=folder_name,
                parent_id=parent_id,
                receive_code=item.receive_code,
            )
            success = bool(result.get("success"))
            if success:
                success_count += 1
                detail = str(result.get("message") or "转存成功")
                lines.append(f"✅ <b>{escape(folder_name[:80])}</b> — {escape(detail)}")
            else:
                error = str(
                    result.get("error")
                    or result.get("message")
                    or "转存失败"
                )
                lines.append(
                    f"❌ <b>{escape(folder_name[:80])}</b> — {escape(error[:200])}"
                )
        except Exception as exc:
            logger.exception("TG batch transfer failed for %s", item.share_url)
            lines.append(
                f"❌ <b>{escape(folder_name[:80])}</b> — {escape(str(exc)[:200])}"
            )

    lines.append("")
    lines.append(
        f"成功 <b>{success_count}</b> / 共 <b>{len(items)}</b> 个 115 链接"
    )

    if success_count > 0:
        try:
            await media_postprocess_service.trigger_archive_after_transfer(
                trigger="tg_bot_batch_transfer"
            )
        except Exception:
            logger.exception("trigger_archive_after_transfer failed after TG batch transfer")

    summary = "\n".join(lines)
    if progress_chat_id and progress_message_id_value:
        try:
            await context.bot.edit_message_text(
                chat_id=progress_chat_id,
                message_id=progress_message_id_value,
                text=summary,
                parse_mode=ParseMode.HTML,
            )
        except Exception:
            if message:
                await message.reply_text(summary, parse_mode=ParseMode.HTML)
    elif message:
        await message.reply_text(summary, parse_mode=ParseMode.HTML)
    return summary


def build_batch_parse_reply(parsed: BatchShareParseResult) -> str | None:
    """根据解析结果生成夸克等非 115 链接提示。"""
    if not parsed.has_quark:
        return None
    lines = [
        "",
        f"<i>已跳过 {len(parsed.items_quark)} 个夸克链接（当前仅支持批量转存 115 分享）。</i>",
    ]
    for item in parsed.items_quark[:5]:
        label = escape(item.title or item.share_url)
        lines.append(f"• {label}")
    if len(parsed.items_quark) > 5:
        lines.append(f"• ... 另有 {len(parsed.items_quark) - 5} 个")
    return "\n".join(lines)


async def handle_share_batch_message(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    text: str,
) -> bool:
    """
    若消息含 115 分享链接则触发批量转存。

    Returns:
        是否已处理（True 时不应再走影视搜索）。
    """
    parsed = parse_batch_share_text(text)
    if not parsed.has_115:
        return False

    message = update.effective_message
    if not message:
        return False

    progress = await message.reply_text(
        f"检测到 <b>{len(parsed.items_115)}</b> 个 115 分享链接，开始批量转存...",
        parse_mode=ParseMode.HTML,
    )
    await batch_transfer_115_shares(
        update,
        context,
        parsed.items_115,
        progress_message_id=progress.message_id,
    )

    quark_hint = build_batch_parse_reply(parsed)
    if quark_hint:
        await message.reply_text(quark_hint, parse_mode=ParseMode.HTML)
    return True
