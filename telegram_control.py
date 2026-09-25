# language: Python, file: telegram_control.py, runtime: 3.11+
# *يجب ضبط TELEGRAM_BOT_TOKEN و ADMIN_ID في ملف .env قبل التشغيل*
# *pm2 يقرأ stdout — لا تستخدم print مع flush=False أو لن تظهر السجلات*

import asyncio
import json
import os
import re
import shlex
import subprocess
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

# ============================================================
# CONFIG
# ============================================================

load_dotenv(Path("/home/daytona/.env"))

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
ADMIN_ID = int(os.environ["ADMIN_ID"])

WHATSAPP_DIR = Path("/home/daytona/german-whatsapp-bot")
LOG_DIR = Path("/home/daytona/logs")
LOG_DIR.mkdir(parents=True, exist_ok=True)

WHATSAPP_PM2_NAME = "whatsapp-bot"
CONTROL_PM2_NAME = "telegram-control"

# الأوامر المسموح بها في /shell — whitelist صارم
SHELL_WHITELIST = {
    "ls", "pwd", "df", "free", "uptime", "whoami",
    "git", "npm", "node", "pm2", "cat", "tail", "head",
}

# حد أقصى لعدد أسطر السجل المعروضة
MAX_LOG_LINES = 200
# حد أقصى لطول الرسالة الواحدة على تيليجرام
TELEGRAM_MSG_LIMIT = 4000


# ============================================================
# HELPERS
# ============================================================

def is_admin(user_id: int) -> bool:
    return user_id == ADMIN_ID


def run_cmd(cmd: list[str], cwd: Optional[Path] = None, timeout: int = 30) -> tuple[int, str, str]:
    """تنفيذ أمر مع timeout وحماية من التعليق."""
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        return -1, "", f"انتهت المهلة ({timeout}ث)"
    except FileNotFoundError as e:
        return -2, "", f"الأمر غير موجود: {e}"
    except Exception as e:
        return -3, "", f"خطأ: {e}"


def split_message(text: str, limit: int = TELEGRAM_MSG_LIMIT) -> list[str]:
    """تقسيم رسالة طويلة إلى أجزاء."""
    if len(text) <= limit:
        return [text]
    parts = []
    while text:
        parts.append(text[:limit])
        text = text[limit:]
    return parts


def pm2_status() -> dict:
    """قراءة حالة كل العمليات من pm2 بصيغة JSON."""
    code, out, err = run_cmd(["pm2", "jlist"])
    if code != 0:
        return {"error": err or "pm2 غير متاح"}
    try:
        return {"processes": json.loads(out)}
    except json.JSONDecodeError as e:
        return {"error": f"فشل تحليل JSON: {e}"}


def find_process(name: str) -> Optional[dict]:
    """البحث عن عملية بالاسم في pm2."""
    status = pm2_status()
    if "error" in status:
        return None
    for proc in status.get("processes", []):
        if proc.get("name") == name:
            return proc
    return None


def format_uptime(ms: int) -> str:
    """تحويل مدة التشغيل إلى نص مقروء."""
    if ms <= 0:
        return "—"
    td = timedelta(milliseconds=ms)
    days = td.days
    hours, rem = divmod(td.seconds, 3600)
    minutes, _ = divmod(rem, 60)
    parts = []
    if days:
        parts.append(f"{days}ي")
    if hours:
        parts.append(f"{hours}س")
    if minutes or not parts:
        parts.append(f"{minutes}د")
    return " ".join(parts)


def format_bytes(b: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if b < 1024:
            return f"{b:.1f}{unit}"
        b /= 1024
    return f"{b:.1f}TB"


# ============================================================
# AUTH GUARD
# ============================================================

async def guard(update: Update) -> bool:
    """يتحقق من أن المرسل هو الأدمن. يرفض بصمت إذا لا."""
    user = update.effective_user
    if not user or not is_admin(user.id):
        # رفض صامت — لا نكشف وجود البوت للغرباء
        return False
    return True


# ============================================================
# COMMANDS
# ============================================================

async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    await update.message.reply_text(
        f"👋 *لوحة تحكم بوت الواتساب*\n\n"
        f"الساندبوكس: `{os.uname().nodename}`\n"
        f"الأدمن: `{ADMIN_ID}`\n\n"
        f"اكتب /help لعرض الأوامر.",
        parse_mode=ParseMode.MARKDOWN,
    )


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    text = (
        "📖 *الأوامر المتاحة*\n\n"
        "*الحالة والمراقبة:*\n"
        "`/status` — حالة كل العمليات\n"
        "`/uptime` — مدة تشغيل الساندبوكس\n"
        "`/disk` — مساحة القرص\n"
        "`/mem` — استهلاك الذاكرة\n\n"
        "*التحكم بالبوت:*\n"
        "`/start_bot` — تشغيل بوت الواتساب\n"
        "`/stop_bot` — إيقاف بوت الواتساب\n"
        "`/restart_bot` — إعادة تشغيل البوت\n"
        "`/restart_all` — إعادة تشغيل كل شيء\n\n"
        "*السجلات:*\n"
        "`/logs [n]` — آخر n سطر (افتراضي 50)\n"
        "`/errors [n]` — آخر أخطاء\n"
        "`/clear_logs` — تفريغ السجلات\n\n"
        "*الكود:*\n"
        "`/pull` — سحب آخر تحديثات git\n"
        "`/install` — npm install\n"
        "`/deploy` — pull + install + restart\n\n"
        "*الواتساب:*\n"
        "`/qr` — عرض آخر QR code\n"
        "`/send <رقم> <رسالة>` — إرسال رسالة\n\n"
        "*متقدم:*\n"
        "`/shell <أمر>` — تنفيذ أمر مسموح\n"
    )
    await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)


async def cmd_status(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return

    status = pm2_status()
    if "error" in status:
        await update.message.reply_text(f"❌ {status['error']}")
        return

    lines = ["📊 *حالة العمليات*\n"]
    for proc in status.get("processes", []):
        name = proc.get("name", "?")
        env = proc.get("pm2_env", {})
        state = env.get("status", "?")
        restarts = env.get("restart_time", 0)
        uptime = env.get("pm_uptime", 0)
        elapsed = int(datetime.now().timestamp() * 1000) - uptime if uptime else 0

        icon = "🟢" if state == "online" else "🔴" if state == "errored" else "🟡"
        lines.append(
            f"{icon} *{name}*\n"
            f"  الحالة: `{state}`\n"
            f"  مدة التشغيل: `{format_uptime(elapsed)}`\n"
            f"  إعادات: `{restarts}`\n"
            f"  PID: `{proc.get('pid', '—')}`"
        )

    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)


async def cmd_uptime(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    code, out, _ = run_cmd(["uptime", "-p"])
    boot = run_cmd(["uptime", "-s"])[1]
    text = (
        f"⏱ *مدة تشغيل الساندبوكس*\n\n"
        f"`{out.strip()}`\n"
        f"منذ: `{boot.strip()}`"
    )
    await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)


async def cmd_disk(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    code, out, _ = run_cmd(["df", "-h", "/"])
    await update.message.reply_text(f"```\n{out}\n```", parse_mode=ParseMode.MARKDOWN)


async def cmd_mem(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    code, out, _ = run_cmd(["free", "-h"])
    await update.message.reply_text(f"```\n{out}\n```", parse_mode=ParseMode.MARKDOWN)


async def _pm2_action(update: Update, action: str, process_name: str, label: str):
    if not await guard(update):
        return

    msg = await update.message.reply_text(f"⏳ {label}...")
    code, out, err = run_cmd(["pm2", action, process_name], timeout=60)

    if code == 0:
        await msg.edit_text(f"✅ {label} — نجح\n```\n{out.strip()[:500]}\n```",
                            parse_mode=ParseMode.MARKDOWN)
    else:
        await msg.edit_text(f"❌ {label} — فشل\n```\n{(err or out).strip()[:500]}\n```",
                            parse_mode=ParseMode.MARKDOWN)


async def cmd_start_bot(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await _pm2_action(update, "start", WHATSAPP_PM2_NAME, "تشغيل بوت الواتساب")


async def cmd_stop_bot(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await _pm2_action(update, "stop", WHATSAPP_PM2_NAME, "إيقاف بوت الواتساب")


async def cmd_restart_bot(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await _pm2_action(update, "restart", WHATSAPP_PM2_NAME, "إعادة تشغيل بوت الواتساب")


async def cmd_restart_all(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    msg = await update.message.reply_text("⏳ إعادة تشغيل كل العمليات...")
    code, out, err = run_cmd(["pm2", "restart", "all"], timeout=60)
    if code == 0:
        await msg.edit_text("✅ إعادة تشغيل الكل — نجحت")
    else:
        await msg.edit_text(f"❌ فشل\n```\n{(err or out)[:500]}\n```",
                            parse_mode=ParseMode.MARKDOWN)


async def _tail_log(update: Update, log_file: Path, n: int, label: str):
    if not log_file.exists():
        await update.message.reply_text(f"❌ ملف السجل غير موجود: `{log_file}`",
                                        parse_mode=ParseMode.MARKDOWN)
        return
    code, out, err = run_cmd(["tail", "-n", str(n), str(log_file)])
    if code != 0:
        await update.message.reply_text(f"❌ فشل قراءة السجل: {err}")
        return

    header = f"📜 *{label}* (آخر {n} سطر)\n\n```\n"
    body = out[-3500:] if len(out) > 3500 else out
    text = header + body + "\n```"

    for chunk in split_message(text):
        await update.message.reply_text(chunk, parse_mode=ParseMode.MARKDOWN)


async def cmd_logs(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    n = 50
    if ctx.args:
        try:
            n = min(int(ctx.args[0]), MAX_LOG_LINES)
        except ValueError:
            pass
    await _tail_log(update, LOG_DIR / "whatsapp-out.log", n, "سجل بوت الواتساب")


async def cmd_errors(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    n = 50
    if ctx.args:
        try:
            n = min(int(ctx.args[0]), MAX_LOG_LINES)
        except ValueError:
            pass
    await _tail_log(update, LOG_DIR / "whatsapp-error.log", n, "أخطاء بوت الواتساب")


async def cmd_clear_logs(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    for name in ("whatsapp-out.log", "whatsapp-error.log"):
        f = LOG_DIR / name
        if f.exists():
            f.write_text("")
    await update.message.reply_text("🗑 تم تفريغ السجلات")


async def cmd_pull(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    msg = await update.message.reply_text("⏳ git pull...")
    code, out, err = run_cmd(["git", "pull"], cwd=WHATSAPP_DIR, timeout=60)
    text = (out + err)[:3500]
    if code == 0:
        await msg.edit_text(f"✅ git pull نجح\n```\n{text}\n```",
                            parse_mode=ParseMode.MARKDOWN)
    else:
        await msg.edit_text(f"❌ git pull فشل\n```\n{text}\n```",
                            parse_mode=ParseMode.MARKDOWN)


async def cmd_install(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    msg = await update.message.reply_text("⏳ npm install... (قد يستغرق دقائق)")
    code, out, err = run_cmd(["npm", "install"], cwd=WHATSAPP_DIR, timeout=300)
    text = (out + err)[-3000:]
    if code == 0:
        await msg.edit_text(f"✅ npm install نجح\n```\n{text}\n```",
                            parse_mode=ParseMode.MARKDOWN)
    else:
        await msg.edit_text(f"❌ npm install فشل\n```\n{text}\n```",
                            parse_mode=ParseMode.MARKDOWN)


async def cmd_deploy(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    msg = await update.message.reply_text("🚀 نشر كامل: pull → install → restart\n\n[1/3] git pull...")

    code, out, err = run_cmd(["git", "pull"], cwd=WHATSAPP_DIR, timeout=60)
    if code != 0:
        await msg.edit_text(f"❌ فشل في git pull\n```\n{(out+err)[:2000]}\n```",
                            parse_mode=ParseMode.MARKDOWN)
        return
    pull_out = out

    await msg.edit_text("[2/3] npm install...")
    code, out, err = run_cmd(["npm", "install"], cwd=WHATSAPP_DIR, timeout=300)
    if code != 0:
        await msg.edit_text(f"❌ فشل في npm install\n```\n{(out+err)[:2000]}\n```",
                            parse_mode=ParseMode.MARKDOWN)
        return

    await msg.edit_text("[3/3] pm2 restart...")
    code, out, err = run_cmd(["pm2", "restart", WHATSAPP_PM2_NAME], timeout=60)
    if code != 0:
        await msg.edit_text(f"❌ فشل في pm2 restart\n```\n{(out+err)[:2000]}\n```",
                            parse_mode=ParseMode.MARKDOWN)
        return

    await msg.edit_text(
        f"✅ *نشر كامل — نجح*\n\n"
        f"*git pull:*\n```\n{pull_out[:1000]}\n```",
        parse_mode=ParseMode.MARKDOWN,
    )


async def cmd_qr(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    # QR يظهر عادة في logs عند بدء الجلسة أو انتهائها
    log_file = LOG_DIR / "whatsapp-out.log"
    if not log_file.exists():
        await update.message.reply_text("❌ لا يوجد سجل")
        return

    code, out, _ = run_cmd(["tail", "-n", "500", str(log_file)])
    # ابحث عن آخر QR — يظهر عادة بصيغة نصية طويلة أو كـ data URL
    # Baileys يطبع QR في terminal؛ في السجل سنبحث عن آخر سطر يحتوي "QR"
    lines = out.splitlines()
    qr_lines = [l for l in lines if "QR" in l or "qr" in l]
    if not qr_lines:
        await update.message.reply_text(
            "⚠️ لا يوجد QR في السجل الحديث.\n"
            "قد يكون البوت متصلًا بالفعل، أو الجلسة سليمة."
        )
        return

    text = "🔐 *آخر أسطر QR:*\n\n```\n" + "\n".join(qr_lines[-30:]) + "\n```"
    for chunk in split_message(text):
        await update.message.reply_text(chunk, parse_mode=ParseMode.MARKDOWN)


async def cmd_send(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    if len(ctx.args) < 2:
        await update.message.reply_text("الاستخدام: `/send <رقم> <رسالة>`",
                                        parse_mode=ParseMode.MARKDOWN)
        return

    number = ctx.args[0].strip()
    message = " ".join(ctx.args[1:])

    # التحقق من صيغة الرقم
    if not re.fullmatch(r"\d{8,15}", number):
        await update.message.reply_text("❌ رقم غير صالح — يجب أن يكون 8-15 رقمًا")
        return

    # البوت يعرض عادة endpoint للإرسال على المنفذ 10000
    import httpx
    url = f"http://localhost:10000/send"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, json={"number": number, "message": message})
            if r.status_code == 200:
                await update.message.reply_text(f"✅ أُرسلت إلى `{number}`",
                                                parse_mode=ParseMode.MARKDOWN)
            else:
                await update.message.reply_text(
                    f"❌ فشل الإرسال — كود {r.status_code}\n```\n{r.text[:500]}\n```",
                    parse_mode=ParseMode.MARKDOWN,
                )
    except httpx.HTTPError as e:
        await update.message.reply_text(
            f"❌ لا يمكن الاتصال ببوت الواتساب على المنفذ 10000\n`{e}`",
            parse_mode=ParseMode.MARKDOWN,
        )


async def cmd_shell(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await guard(update):
        return
    if not ctx.args:
        await update.message.reply_text("الاستخدام: `/shell <أمر>`",
                                        parse_mode=ParseMode.MARKDOWN)
        return

    try:
        parts = shlex.split(" ".join(ctx.args))
    except ValueError as e:
        await update.message.reply_text(f"❌ خطأ في التحليل: {e}")
        return

    if not parts or parts[0] not in SHELL_WHITELIST:
        await update.message.reply_text(
            f"❌ الأمر `{parts[0] if parts else '?'}` غير مسموح.\n"
            f"المسموح: `{', '.join(sorted(SHELL_WHITELIST))}`",
            parse_mode=ParseMode.MARKDOWN,
        )
        return

    code, out, err = run_cmd(parts, cwd=WHATSAPP_DIR, timeout=30)
    text = f"$ {' '.join(parts)}\n\n{out}\n{err}".strip()
    text = text[:3500]
    await update.message.reply_text(f"```\n{text}\n```", parse_mode=ParseMode.MARKDOWN)


# ============================================================
# MAIN
# ============================================================

def main():
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CommandHandler("uptime", cmd_uptime))
    app.add_handler(CommandHandler("disk", cmd_disk))
    app.add_handler(CommandHandler("mem", cmd_mem))

    app.add_handler(CommandHandler("start_bot", cmd_start_bot))
    app.add_handler(CommandHandler("stop_bot", cmd_stop_bot))
    app.add_handler(CommandHandler("restart_bot", cmd_restart_bot))
    app.add_handler(CommandHandler("restart_all", cmd_restart_all))

    app.add_handler(CommandHandler("logs", cmd_logs))
    app.add_handler(CommandHandler("errors", cmd_errors))
    app.add_handler(CommandHandler("clear_logs", cmd_clear_logs))

    app.add_handler(CommandHandler("pull", cmd_pull))
    app.add_handler(CommandHandler("install", cmd_install))
    app.add_handler(CommandHandler("deploy", cmd_deploy))

    app.add_handler(CommandHandler("qr", cmd_qr))
    app.add_handler(CommandHandler("send", cmd_send))

    app.add_handler(CommandHandler("shell", cmd_shell))

    print("Telegram control bot starting...", flush=True)
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()