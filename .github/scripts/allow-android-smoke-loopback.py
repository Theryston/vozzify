"""Allow cleartext to adb reverse on the generated CI APK only."""

from pathlib import Path
from xml.etree import ElementTree

ANDROID = "http://schemas.android.com/apk/res/android"
main = Path("apps/mobile/android/app/src/main")
manifest = main / "AndroidManifest.xml"
ElementTree.register_namespace("android", ANDROID)
tree = ElementTree.parse(manifest)
application = tree.find("application")
if application is None:
    raise RuntimeError("Android manifest does not contain an application")
application.set(f"{{{ANDROID}}}networkSecurityConfig", "@xml/maestro_network_security")
tree.write(manifest, encoding="utf-8", xml_declaration=True)

net_config = main / "res/xml/maestro_network_security.xml"
net_config.parent.mkdir(parents=True, exist_ok=True)
net_config.write_text(
    """<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
"""
)
