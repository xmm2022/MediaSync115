"""115 扫码登录可选设备（与 p115client.login_qrcode_scan_result 兼容）。"""

from __future__ import annotations

from typing import Any, TypedDict

_DEFAULT_APP = "alipaymini"


class _Pan115QrLoginAppDef(TypedDict):
    value: str
    label: str
    recommended: bool
    hint: str


# 仅保留社区与 p115client 文档中确认可用的 app，排除 web/desktop（易触发 IP 风控）、
# bios/bandroid/bipad 等未知别名，以及已下架的 Windows/Mac/Linux 独立客户端。
PAN115_QR_LOGIN_APP_DEFS: tuple[_Pan115QrLoginAppDef, ...] = (
    {
        "value": "alipaymini",
        "label": "支付宝小程序",
        "recommended": True,
        "hint": "推荐：用支付宝扫二维码，不影响手机 115 App 已登录会话",
    },
    {
        "value": "wechatmini",
        "label": "微信小程序",
        "recommended": True,
        "hint": "推荐：用微信扫二维码，不影响手机 115 App 已登录会话",
    },
    {
        "value": "android",
        "label": "115 安卓客户端",
        "recommended": False,
        "hint": "请用 115 安卓 App 扫码；确认后可能挤掉该 App 原登录",
    },
    {
        "value": "ios",
        "label": "115 iOS 客户端",
        "recommended": False,
        "hint": "请用 115 iPhone App 扫码；确认后可能挤掉该 App 原登录",
    },
    {
        "value": "ipad",
        "label": "115 iPad 客户端",
        "recommended": False,
        "hint": "请用 115 iPad App 扫码；确认后可能挤掉该 App 原登录",
    },
    {
        "value": "tv",
        "label": "115 安卓电视",
        "recommended": False,
        "hint": "请用 115 电视端扫码确认",
    },
    {
        "value": "apple_tv",
        "label": "115 苹果电视",
        "recommended": False,
        "hint": "请用 115 Apple TV 端扫码确认",
    },
    {
        "value": "harmony",
        "label": "115 鸿蒙客户端",
        "recommended": False,
        "hint": "请用 115 鸿蒙 App 扫码确认",
    },
    {
        "value": "qandroid",
        "label": "115 管理（安卓）",
        "recommended": False,
        "hint": "请用 115 管理安卓版扫码确认",
    },
    {
        "value": "qios",
        "label": "115 管理（iOS）",
        "recommended": False,
        "hint": "请用 115 管理 iOS 版扫码确认",
    },
    {
        "value": "qipad",
        "label": "115 管理（iPad）",
        "recommended": False,
        "hint": "请用 115 管理 iPad 版扫码确认",
    },
)

PAN115_QR_LOGIN_ALLOWED_APPS = frozenset(
    item["value"] for item in PAN115_QR_LOGIN_APP_DEFS
)


def normalize_pan115_qr_login_app(app: str | None) -> str:
    """将前端传入的 app 规范为允许值，非法时回退默认。"""
    normalized = str(app or "").strip()
    if normalized in PAN115_QR_LOGIN_ALLOWED_APPS:
        return normalized
    return _DEFAULT_APP


def list_pan115_qr_login_app_options() -> list[dict[str, Any]]:
    """返回设置页下拉选项。"""
    items: list[dict[str, Any]] = []
    for item in PAN115_QR_LOGIN_APP_DEFS:
        label = item["label"]
        if item["recommended"]:
            label = f"{label}（推荐）"
        items.append(
            {
                "value": item["value"],
                "label": label,
                "recommended": item["recommended"],
                "hint": item["hint"],
            }
        )
    return items
