"""Gmail の IMAP IDLE でキャンセル通知メールを待ち受け、着信を即時トリガーにする。

Google アカウントで 2 段階認証を有効にし「アプリパスワード」を発行しておくこと。
通常の Google パスワードでは IMAP 認証できない。
"""
from __future__ import annotations

import logging
import threading
import time

from imapclient import IMAPClient

log = logging.getLogger("gmail")

IDLE_TIMEOUT = 240  # Gmail は約29分で IDLE を切るので余裕を持って張り直す


def _matches(subject: str, sender: str, keywords: list[str]) -> bool:
    hay = f"{subject} {sender}".lower()
    return any(k.lower() in hay for k in keywords)


def _check_unseen(client: IMAPClient, keywords: list[str]) -> bool:
    uids = client.search(["UNSEEN"])
    if not uids:
        return False
    hit = False
    for uid, data in client.fetch(uids, ["ENVELOPE"]).items():
        env = data[b"ENVELOPE"]
        subject = (env.subject or b"").decode("utf-8", "replace")
        sender = ""
        if env.from_:
            f = env.from_[0]
            sender = f"{(f.mailbox or b'').decode('utf-8', 'replace')}@{(f.host or b'').decode('utf-8', 'replace')}"
        if _matches(subject, sender, keywords):
            log.info("trigger mail: from=%s subject=%s", sender, subject)
            client.add_flags([uid], [b"\\Seen"])  # 同じメールで再発火しない
            hit = True
    return hit


def watch(address: str, app_password: str, keywords: list[str], trigger: threading.Event, stop: threading.Event) -> None:
    """バックグラウンドスレッドで動かす。トリガーメール着信で trigger.set() する。"""
    while not stop.is_set():
        try:
            with IMAPClient("imap.gmail.com", ssl=True) as client:
                client.login(address, app_password)
                client.select_folder("INBOX")
                log.info("Gmail watch started (keywords=%s)", keywords)
                if _check_unseen(client, keywords):  # 起動前に届いていた分
                    trigger.set()
                while not stop.is_set():
                    client.idle()
                    responses = client.idle_check(timeout=IDLE_TIMEOUT)
                    client.idle_done()
                    if responses and _check_unseen(client, keywords):
                        trigger.set()
        except Exception:
            log.exception("Gmail watch error; reconnecting in 30s")
            time.sleep(30)


def start(address: str, app_password: str, keywords: list[str], trigger: threading.Event, stop: threading.Event) -> threading.Thread:
    t = threading.Thread(target=watch, args=(address, app_password, keywords, trigger, stop), daemon=True)
    t.start()
    return t
