"""hacomono の予約操作 (Playwright)。

hacomono は Vue 製 SPA で店舗ごとに画面差分があるため、CSS セレクタ決め打ちではなく
「表示テキスト」ベースで枠を探す。初回は必ず DRY_RUN=1 + HEADLESS=0 で
実際の画面遷移を確認し、必要ならこのファイル冒頭の正規表現を調整すること。
"""
from __future__ import annotations

import enum
import logging
import re
import time
from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PWTimeout, sync_playwright

log = logging.getLogger("booker")

BASE_DIR = Path(__file__).resolve().parent
STATE_FILE = BASE_DIR / "storage_state.json"  # ログインセッションの保存先
SHOTS_DIR = BASE_DIR / "shots"

# 枠が埋まっている/押せない状態を表すテキスト(これを含む枠はスキップ)
UNAVAILABLE_RE = re.compile(r"(満員|満枠|受付終了|予約不可|キャンセル待ち|×)")
# 予約フローを進めるボタン
PROCEED_RE = re.compile(r"(予約する|予約へ進む|次へ|この内容で)")
# 最終確定ボタン(DRY_RUN 時はこれを押す直前で止まる)
FINAL_CONFIRM_RE = re.compile(r"(予約を確定|確定する|上記に同意して予約)")
# 予約完了の判定テキスト
SUCCESS_RE = re.compile(r"(予約が完了|予約を受け付け|予約完了)")


class Result(enum.Enum):
    SUCCESS = "success"
    NO_SLOT = "no_slot"
    DRY_RUN_STOP = "dry_run_stop"
    ERROR = "error"


def _shot(page: Page, name: str) -> None:
    SHOTS_DIR.mkdir(exist_ok=True)
    path = SHOTS_DIR / f"{time.strftime('%Y%m%d_%H%M%S')}_{name}.png"
    try:
        page.screenshot(path=str(path), full_page=True)
        log.info("screenshot: %s", path)
    except Exception:  # スクショ失敗で処理は止めない
        log.warning("screenshot failed: %s", name)


def _is_logged_in(page: Page) -> bool:
    # ログイン済みならメールアドレス入力欄は出ない
    return page.locator("input[type=password]").count() == 0


def _login(page: Page, cfg) -> None:
    page.goto(cfg.base_url + cfg.login_path, wait_until="networkidle")
    if _is_logged_in(page):
        log.info("already logged in (saved session)")
        return
    log.info("logging in as %s", cfg.email)
    page.locator("input[type=email], input[type=text]").first.fill(cfg.email)
    page.locator("input[type=password]").first.fill(cfg.password)
    page.get_by_role("button", name=re.compile(r"(ログイン|サインイン)")).first.click()
    page.wait_for_load_state("networkidle")
    if not _is_logged_in(page):
        _shot(page, "login_failed")
        raise RuntimeError("ログインに失敗しました。メール/パスワードか HACOMONO_LOGIN_PATH を確認してください")
    _shot(page, "login_ok")


def _find_open_slot(page: Page, target_times: list[str]):
    """スケジュール画面から予約可能な対象枠の locator を返す。無ければ None。"""
    candidates = page.locator("a, button, [role=button], [class*=lesson], [class*=slot], [class*=item]")
    n = candidates.count()
    time_res = [re.compile(rf"\b{re.escape(t)}\b") for t in target_times] if target_times else [re.compile(r"\d{1,2}:\d{2}")]
    for i in range(n):
        el = candidates.nth(i)
        try:
            text = el.inner_text(timeout=1000)
        except Exception:
            continue
        if not text or UNAVAILABLE_RE.search(text):
            continue
        if any(r.search(text) for r in time_res):
            if el.is_visible() and el.is_enabled():
                log.info("open slot found: %r", " ".join(text.split())[:80])
                return el
    return None


def attempt_booking(cfg) -> Result:
    """1回分の予約試行。成功したら Result.SUCCESS。"""
    schedule_url = f"{cfg.base_url}{cfg.schedule_path}?date_from={cfg.target_date}"
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=cfg.headless)
            ctx_kwargs = {"locale": "ja-JP"}
            if STATE_FILE.exists():
                ctx_kwargs["storage_state"] = str(STATE_FILE)
            context = browser.new_context(**ctx_kwargs)
            page = context.new_page()
            try:
                _login(page, cfg)
                context.storage_state(path=str(STATE_FILE))

                page.goto(schedule_url, wait_until="networkidle")
                slot = _find_open_slot(page, cfg.target_times)
                if slot is None:
                    log.info("no open slot for %s %s", cfg.target_date, cfg.target_times or "(any)")
                    return Result.NO_SLOT

                _shot(page, "slot_found")
                slot.click()
                page.wait_for_load_state("networkidle")

                # 確認画面を最大5ステップまで進める
                for _ in range(5):
                    if SUCCESS_RE.search(page.content()):
                        _shot(page, "booked")
                        log.info("BOOKED!")
                        return Result.SUCCESS

                    final_btn = page.get_by_role("button", name=FINAL_CONFIRM_RE)
                    if final_btn.count() > 0:
                        if cfg.dry_run:
                            _shot(page, "dry_run_before_confirm")
                            log.info("DRY_RUN: 確定ボタン直前で停止しました(shots/ を確認)")
                            return Result.DRY_RUN_STOP
                        final_btn.first.click()
                        page.wait_for_load_state("networkidle")
                        continue

                    proceed_btn = page.get_by_role("button", name=PROCEED_RE).or_(
                        page.get_by_role("link", name=PROCEED_RE)
                    )
                    if proceed_btn.count() > 0:
                        proceed_btn.first.click()
                        page.wait_for_load_state("networkidle")
                        continue

                    _shot(page, "unknown_screen")
                    log.warning("進めるボタンが見つかりません。shots/ の画像を見て正規表現を調整してください")
                    return Result.ERROR

                if SUCCESS_RE.search(page.content()):
                    _shot(page, "booked")
                    return Result.SUCCESS
                _shot(page, "flow_incomplete")
                return Result.ERROR
            finally:
                context.close()
                browser.close()
    except PWTimeout:
        log.exception("page timeout")
        return Result.ERROR
    except Exception:
        log.exception("booking attempt failed")
        return Result.ERROR
