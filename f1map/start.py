#!/usr/bin/env python3
"""
Startup helper: shows the local-network URL and an ASCII QR code
so you can open F1 Race Map on your iPhone immediately.

Usage:
  python start.py           # auto-detects IP, port 8000
  python start.py --port 9000
"""
import argparse
import socket
import sys
import subprocess

def local_ip() -> str:
    """Best-effort local LAN IP (not localhost)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()

def qr_ascii(url: str) -> None:
    """Print ASCII QR code using qrcode library if available."""
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
    except ImportError:
        print("(pip install qrcode でQRコードを表示できます)")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    ip   = local_ip()
    url  = f"http://{ip}:{args.port}"

    print("=" * 50)
    print("  F1 Race Map")
    print("=" * 50)
    print(f"\n  ローカルネットワーク URL:")
    print(f"  {url}")
    print()
    print("  同じ Wi-Fi の iPhone/iPad からアクセスできます。")
    print("  Safari でこの URL を開いてください。\n")
    qr_ascii(url)
    print("\n  Ctrl+C で停止\n")
    print("=" * 50)

    import uvicorn
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from server import app
    uvicorn.run(app, host=args.host, port=args.port, timeout_keep_alive=600)

if __name__ == "__main__":
    main()
