"""メインエントリ。

  python watcher.py

- POLL_INTERVAL_SEC ごとにスケジュールページを確認して空きがあれば予約
- Gmail 設定があればキャンセル通知メール着信で即座に予約を試行(IMAP IDLE)
- 予約成功で自分宛てに通知メールを送って終了
"""
from __future__ import annotations

import logging
import os
import smtplib
import threading
from dataclasses import dataclass, field
from email.mime.text import MIMEText
from email.header import Header
from pathlib import Path

from dotenv import load_dotenv

import gmail_trigger
from booker import Result, attempt_booking

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(), logging.FileHandler(Path(__file__).parent / "watcher.log", encoding="utf-8")],
)
log = logging.getLogger("watcher")


@dataclass
class Config:
    base_url: str
    email: str
    password: str
    login_path: str
    schedule_path: str
    target_date: str
    target_times: list[str]
    dry_run: bool
    headless: bool
    poll_interval: int
    gmail_address: str
    gmail_app_password: str
    gmail_match: list[str] = field(default_factory=list)
    notify_email: bool = True


def load_config() -> Config:
    load_dotenv(Path(__file__).parent / ".env")
    req = lambda k: os.environ.get(k) or (_ for _ in ()).throw(SystemExit(f".env に {k} を設定してください"))
    csv = lambda k, d="": [s.strip() for s in os.environ.get(k, d).split(",") if s.strip()]
    return Config(
        base_url=req("HACOMONO_BASE_URL").rstrip("/"),
        email=req("HACOMONO_EMAIL"),
        password=req("HACOMONO_PASSWORD"),
        login_path=os.environ.get("HACOMONO_LOGIN_PATH", "/login"),
        schedule_path=req("TARGET_SCHEDULE_PATH"),
        target_date=req("TARGET_DATE"),
        target_times=csv("TARGET_TIMES"),
        dry_run=os.environ.get("DRY_RUN", "1") != "0",
        headless=os.environ.get("HEADLESS", "1") != "0",
        poll_interval=int(os.environ.get("POLL_INTERVAL_SEC", "60")),
        gmail_address=os.environ.get("GMAIL_ADDRESS", ""),
        gmail_app_password=os.environ.get("GMAIL_APP_PASSWORD", ""),
        gmail_match=csv("GMAIL_MATCH", "hacomono,キャンセル"),
        notify_email=os.environ.get("NOTIFY_EMAIL", "1") != "0",
    )


def send_self_mail(cfg: Config, subject: str, body: str) -> None:
    if not (cfg.notify_email and cfg.gmail_address and cfg.gmail_app_password):
        return
    try:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = Header(subject, "utf-8")
        msg["From"] = msg["To"] = cfg.gmail_address
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(cfg.gmail_address, cfg.gmail_app_password)
            smtp.send_message(msg)
        log.info("notification mail sent")
    except Exception:
        log.exception("failed to send notification mail")


def main() -> None:
    cfg = load_config()
    log.info(
        "watching %s%s date=%s times=%s dry_run=%s poll=%ss",
        cfg.base_url, cfg.schedule_path, cfg.target_date, cfg.target_times or "(any)", cfg.dry_run, cfg.poll_interval,
    )

    trigger = threading.Event()
    stop = threading.Event()
    if cfg.gmail_address and cfg.gmail_app_password:
        gmail_trigger.start(cfg.gmail_address, cfg.gmail_app_password, cfg.gmail_match, trigger, stop)
    else:
        log.info("Gmail trigger disabled (GMAIL_ADDRESS / GMAIL_APP_PASSWORD 未設定) — ポーリングのみで動作")

    try:
        while True:
            result = attempt_booking(cfg)
            if result is Result.SUCCESS:
                msg = f"{cfg.target_date} {','.join(cfg.target_times) or ''} の予約が取れました。マイページで確認してください。"
                log.info(msg)
                send_self_mail(cfg, "【自動予約】予約成功", msg)
                break
            if result is Result.DRY_RUN_STOP:
                log.info("DRY_RUN で停止しました。shots/ を確認し、問題なければ .env の DRY_RUN=0 で再実行してください")
                break
            # NO_SLOT / ERROR → 次のトリガーかポーリング間隔まで待つ
            triggered = trigger.wait(timeout=cfg.poll_interval)
            trigger.clear()
            if triggered:
                log.info("triggered by Gmail — checking immediately")
    except KeyboardInterrupt:
        log.info("stopped by user")
    finally:
        stop.set()


if __name__ == "__main__":
    main()
