"""Prepare an un-onboarded User on the disposable Android CI API."""

import json
import os
import re
import secrets
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

API = "http://127.0.0.1:3333/v1"


def wait_for_api():
    for _ in range(60):
        try:
            with urlopen(f"{API}/health/ready", timeout=2):
                return
        except URLError:
            time.sleep(1)
    raise RuntimeError("The Android smoke API did not become ready")


def auth_post(path, body):
    request = Request(
        f"{API}/auth/{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Accept-Language": "en"},
    )
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def emailed_code(log_path, email):
    marker = f"To: {email}\n"
    for _ in range(30):
        log = log_path.read_text()
        _, received, email_tail = log.partition(marker)
        match = re.search(r"^\d{6}$", email_tail[:800], re.MULTILINE)
        if received and match:
            return match[0]
        time.sleep(1)
    raise RuntimeError("The Android smoke verification email was not logged")


def main():
    email = f"smoke-{secrets.token_hex(8)}@example.test"
    password = secrets.token_hex(16)
    username = f"smoke_{secrets.token_hex(4)}"
    print(f"::add-mask::{password}")
    wait_for_api()
    auth_post("sign-up/email", {"email": email, "password": password, "name": "Maestro Fixture"})
    code = emailed_code(Path(sys.argv[1]), email)
    print(f"::add-mask::{code}")
    verified = auth_post("email-otp/verify-email", {"email": email, "otp": code})
    if not verified["user"]["emailVerified"] or verified["user"].get("username"):
        raise RuntimeError("Expected a verified Android smoke User awaiting Username setup")
    with Path(os.environ["GITHUB_ENV"]).open("a") as env:
        env.write(f"AUTH_EMAIL={email}\nAUTH_PASSWORD={password}\nAUTH_USERNAME={username}\n")


if __name__ == "__main__":
    main()
