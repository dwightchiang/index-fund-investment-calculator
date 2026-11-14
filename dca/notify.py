"""消息推送：控制台 / 企业微信 / 钉钉 / Server酱 / 邮件。"""
from __future__ import annotations

import json
import smtplib
from email.header import Header
from email.mime.text import MIMEText

from .config import NotifyCfg

import requests


def send(cfg: NotifyCfg, title: str, content_md: str, content_text: str) -> None:
    channel = (cfg.channel or "console").lower()
    if channel in ("", "console"):
        return
    if not cfg.webhook and channel in ("wecom", "dingtalk", "serverchan"):
        print(f"[notify] {channel} 未配置 webhook，跳过推送")
        return

    if channel == "wecom":
        _wecom(cfg.webhook, content_md)
    elif channel == "dingtalk":
        _dingtalk(cfg.webhook, title, content_md)
    elif channel == "serverchan":
        _serverchan(cfg.webhook, title, content_md)
    elif channel == "email":
        _email(cfg, title, content_text)
    else:
        print(f"[notify] 未知渠道 {channel}，按 console 处理")


def _wecom(webhook: str, md: str) -> None:
    payload = {"msgtype": "markdown", "markdown": {"content": md[:4000]}}
    r = requests.post(webhook, json=payload, timeout=15)
    print("[notify] 企业微信", r.status_code, r.text[:120])


def _dingtalk(webhook: str, title: str, md: str) -> None:
    payload = {"msgtype": "markdown", "markdown": {"title": title, "text": md[:4000]}}
    r = requests.post(webhook, json=payload, timeout=15)
    print("[notify] 钉钉", r.status_code, r.text[:120])


def _serverchan(key: str, title: str, md: str) -> None:
    url = f"https://sctapi.ftqq.com/{key}.send"
    r = requests.post(url, data={"title": title, "desp": md[:30000]}, timeout=15)
    print("[notify] Server酱", r.status_code, r.text[:120])


def _email(cfg: NotifyCfg, title: str, text: str) -> None:
    msg = MIMEText(text, "plain", "utf-8")
    msg["Subject"] = Header(title, "utf-8")
    msg["From"] = cfg.smtp_user
    msg["To"] = cfg.smtp_to
    with smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=20) as s:
        s.login(cfg.smtp_user, cfg.smtp_pass)
        s.sendmail(cfg.smtp_user, [x.strip() for x in cfg.smtp_to.split(",")], msg.as_string())
    print("[notify] 邮件已发送 ->", cfg.smtp_to)
