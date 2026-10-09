#!/usr/bin/env python3
"""Install/run a macOS user LaunchAgent for one existing Cloudflare A record.

Uses Python's standard library and system curl. Credentials never enter argv,
shell evaluation, HTTP redirects, or logs. Does not change DuckDNS services.
"""
import argparse
import datetime
import getpass
import ipaddress
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import sys
import tempfile
from urllib.parse import urlencode

LABEL = "com.dondok.cloudflare-ddns"
API = "https://api.cloudflare.com/client/v4"
HEX_ID = re.compile(r"[a-f0-9]{32}")


class SetupError(Exception):
    pass


def validate(config):
    if not isinstance(config, dict) or set(config) != {"zone_id", "record_name", "api_token"}:
        raise SetupError("Config must contain zone_id, record_name and api_token only")
    if not all(isinstance(value, str) for value in config.values()):
        raise SetupError("Config values must be strings")
    if not HEX_ID.fullmatch(config["zone_id"]):
        raise SetupError("Invalid zone ID")
    name = config["record_name"]
    if len(name) > 253 or "." not in name or not all(
        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
        for label in name.split(".")
    ):
        raise SetupError("Record name must be a complete lowercase DNS hostname")
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,256}", config["api_token"]):
        raise SetupError("Invalid API token format")
    return config


def read_config(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) & 0o077):
            raise SetupError("Config must be an owner-only regular file (chmod 600)")
        return validate(json.load(stream))


def fetch(url, token=None, payload=None):
    # -q must be first: ignore user .curlrc (which could enable verbose logging).
    command = ["/usr/bin/curl", "-q", "--silent", "--fail", "--proto", "=https",
               "--connect-timeout", "10", "--max-time", "30", "--config", "-"]
    lines = ["url = " + json.dumps(url)]
    if token is None:
        command.append("--ipv4")
    else:
        lines.append("header = " + json.dumps("Authorization: Bearer " + token))
    if payload is not None:
        lines.extend(['request = "PATCH"', 'header = "Content-Type: application/json"',
                      "data = " + json.dumps(json.dumps(payload))])
    result = subprocess.run(command, input="\n".join(lines) + "\n", text=True,
                            capture_output=True, timeout=35)
    if result.returncode:
        # Never echo curl output or remote error bodies (may contain credentials).
        raise SetupError("Cloudflare API request failed" if token else "Public IPv4 lookup failed")
    return result.stdout


def api(config, suffix, payload=None):
    response = json.loads(fetch(API + "/zones/" + config["zone_id"] + suffix,
                                config["api_token"], payload))
    if not isinstance(response, dict) or response.get("success") is not True:
        raise SetupError("Cloudflare rejected the request; check token scope and zone ID")
    return response


def update(config, force=False):
    ip = ipaddress.IPv4Address(fetch("https://api.ipify.org").strip())
    if not ip.is_global or ip.is_multicast:
        raise SetupError("IP lookup did not return a public unicast IPv4")
    query = urlencode({"type": "A", "name": config["record_name"], "per_page": 2})
    response = api(config, "/dns_records?" + query)
    records = response.get("result")
    if not isinstance(records, list) or len(records) != 1:
        raise SetupError("Exactly one existing A record is required; no records were changed")
    record = records[0]
    if (record.get("type") != "A" or record.get("name") != config["record_name"]
            or not HEX_ID.fullmatch(str(record.get("id", "")))):
        raise SetupError("Unexpected DNS record; no records were changed")
    if record.get("content") == str(ip) and not force:
        return "unchanged"
    # PATCH content only: preserve proxy status, TTL, comments and tags.
    result = api(config, "/dns_records/" + record["id"], {"content": str(ip)}).get("result", {})
    if (result.get("id") != record["id"] or result.get("name") != config["record_name"]
            or result.get("type") != "A" or result.get("content") != str(ip)):
        raise SetupError("Cloudflare did not confirm the requested update")
    return "updated"


def report(status):
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    print("Cloudflare DDNS " + status + " at=" + timestamp, flush=True)


def private_dir(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink() or path.stat().st_uid != os.getuid():
        raise SetupError("Installation directory must be owned by the current user and not linked")
    path.chmod(0o700)


def write_private(path, data):
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def launch_agent(python, script, config, logs):
    return {
        "Label": LABEL,
        "ProgramArguments": [python, str(script), "update", "--config", str(config)],
        "StartInterval": 300, "RunAtLoad": True, "ProcessType": "Background", "Umask": 63,
        "StandardOutPath": str(logs / "cloudflare-ddns.log"),
        "StandardErrorPath": str(logs / "cloudflare-ddns-error.log"),
    }


def install(replace=False):
    if sys.platform != "darwin" or os.getuid() == 0 or not sys.stdin.isatty():
        raise SetupError("Run install in the Mac mini user's interactive terminal without sudo")
    home = Path.home()
    config_path = home / ".config/dondok/cloudflare-ddns.json"
    script = home / ".local/share/dondok/cloudflare_ddns.py"
    plist = home / "Library/LaunchAgents" / (LABEL + ".plist")
    logs = home / "Library/Logs/dondok"
    targets = (config_path, script, plist)
    if any(path.is_symlink() for path in targets):
        raise SetupError("Installation targets must not be symbolic links")
    if not replace and any(path.exists() for path in targets):
        raise SetupError("Existing installation found; use install --replace to reinstall/rotate the token")
    config = validate({
        "record_name": input("DNS record hostname (for example money.example.com): ").strip().lower(),
        "zone_id": input("Cloudflare Zone ID: ").strip(),
        "api_token": getpass.getpass("Cloudflare API token (hidden): ").strip(),
    })
    # Even if IP is unchanged, prove DNS Edit permission before scheduling.
    report(update(config, force=True))
    source = Path(__file__).read_bytes()
    for directory in (config_path.parent, script.parent, plist.parent, logs):
        private_dir(directory)
    write_private(config_path, (json.dumps(config) + "\n").encode())
    write_private(script, source)
    write_private(plist, plistlib.dumps(launch_agent(sys.executable, script, config_path, logs)))
    target = "gui/" + str(os.getuid())
    subprocess.run(["/bin/launchctl", "bootout", target + "/" + LABEL], capture_output=True)
    result = subprocess.run(["/bin/launchctl", "bootstrap", target, str(plist)], capture_output=True)
    if result.returncode:
        raise SetupError("Files saved, but LaunchAgent registration failed; retry install --replace in a logged-in GUI session")
    print("Cloudflare DDNS installed: every 300 seconds while this user is logged in. DuckDNS is unchanged.")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    setup = commands.add_parser("install")
    setup.add_argument("--replace", action="store_true")
    run = commands.add_parser("update")
    run.add_argument("--config", type=Path, default=Path.home() / ".config/dondok/cloudflare-ddns.json")
    args = parser.parse_args()
    try:
        if args.command == "install":
            install(args.replace)
        else:
            report(update(read_config(args.config)))
    except SetupError as error:
        print("ERROR: " + str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError):
        print("ERROR: DDNS failed; check private config, network and API response format", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("Cancelled", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
