"""
Quick test script to verify the Gmail OTP sender credentials.
Reads OTP_GMAIL_SENDER and OTP_GMAIL_APP_PASSWORD from .env and sends a test email.
"""

import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

# Load .env manually (no dotenv dependency needed)
env_path = Path(__file__).parent.parent / ".env"
for line in env_path.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())

sender_email = os.getenv("OTP_GMAIL_SENDER", "").strip()
app_password = os.getenv("OTP_GMAIL_APP_PASSWORD", "").strip()
recipient = sender_email  # send to self as a test

print(f"Sender : {sender_email}")
print(f"Password set: {'yes' if app_password else 'NO'}")
print(f"Sending test email to: {recipient} ...")

msg = MIMEMultipart("alternative")
msg["Subject"] = "✅ Volunteer System – Email Test"
msg["From"] = sender_email
msg["To"] = recipient
msg.attach(MIMEText("This is a test email from the Volunteer System backend. If you received this, the Gmail credentials are working correctly!", "plain"))

try:
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(sender_email, app_password)
        server.sendmail(sender_email, recipient, msg.as_string())
    print("\nSUCCESS! Test email sent. Check your inbox at:", recipient)
except Exception as e:
    print(f"\nFAILED: {e}")
