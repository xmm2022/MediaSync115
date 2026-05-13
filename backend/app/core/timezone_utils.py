"""
北京时区工具模块

统一使用北京时间（Asia/Shanghai, UTC+8）处理所有时间相关逻辑。
"""

from datetime import datetime, timezone, timedelta

BEIJING_TZ = timezone(timedelta(hours=8), name="Asia/Shanghai")


def beijing_now() -> datetime:
    """返回当前北京时间（带时区信息）。"""
    return datetime.now(BEIJING_TZ)
