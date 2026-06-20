"""使用 auth_secret 派生密钥，对第三方凭据做可逆加密。"""

from __future__ import annotations

import base64
import hashlib
import os

from Crypto.Cipher import AES
from Crypto.Util.Padding import pad, unpad

_SALT = b"mediasync115-feiniu-v1"


def _derive_key(auth_secret: str) -> bytes:
    secret = str(auth_secret or "").strip() or "mediasync115-default-secret"
    return hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), _SALT, 100_000)[:32]


def encrypt_credential(plaintext: str, auth_secret: str) -> str:
    """加密凭据，返回 base64 字符串。"""
    text = str(plaintext or "").strip()
    if not text:
        return ""
    key = _derive_key(auth_secret)
    iv = os.urandom(16)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    ciphertext = cipher.encrypt(pad(text.encode("utf-8"), AES.block_size))
    return base64.b64encode(iv + ciphertext).decode("ascii")


def decrypt_credential(ciphertext: str, auth_secret: str) -> str:
    """解密凭据，失败时返回空字符串。"""
    encoded = str(ciphertext or "").strip()
    if not encoded:
        return ""
    try:
        raw = base64.b64decode(encoded)
        iv, ct = raw[:16], raw[16:]
        key = _derive_key(auth_secret)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        return unpad(cipher.decrypt(ct), AES.block_size).decode("utf-8")
    except Exception:
        return ""
