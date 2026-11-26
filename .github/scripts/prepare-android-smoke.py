"""Let the emulator settle before Maestro takes over the installed app."""

import re
import subprocess
import time
from xml.etree import ElementTree

DUMP_PATH = "/sdcard/vozzify-smoke-hierarchy.xml"
APP_ACTIVITY = "com.vozzify.app.preview/.MainActivity"


def adb(*args):
    return subprocess.check_output(["adb", *args], timeout=6, text=True)


def launcher_close_button(hierarchy):
    # Start with the nearest common ancestor so another app's ANR cannot match.
    for panel in reversed(list(hierarchy.iter("node"))):
        titles = panel.findall(".//node[@resource-id='android:id/alertTitle']")
        if len(titles) != 1 or titles[0].get("text") != "Pixel Launcher isn't responding":
            continue
        button = panel.find(".//node[@resource-id='android:id/aerr_close']")
        if button is not None:
            return button
    return None


def dismiss_launcher_anr(hierarchy):
    button = launcher_close_button(hierarchy)
    if button is None:
        return False
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", button.get("bounds", ""))
    if not match:
        return False
    left, top, right, bottom = (int(value) for value in match.groups())
    adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
    print("Dismissed the emulator's Pixel Launcher ANR.")
    return True


def main():
    adb("shell", "am", "start", "-n", APP_ACTIVITY)
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        try:
            adb("shell", "uiautomator", "dump", DUMP_PATH)
            hierarchy = ElementTree.fromstring(adb("exec-out", "cat", DUMP_PATH))
            if dismiss_launcher_anr(hierarchy):
                adb("shell", "am", "start", "-n", APP_ACTIVITY)
                continue
            if any(
                node.get("resource-id", "").split("/")[-1] == "open-components"
                for node in hierarchy.iter("node")
            ):
                return
        except (ElementTree.ParseError, subprocess.SubprocessError):
            pass
        time.sleep(1)


if __name__ == "__main__":
    main()
