#!/usr/bin/env python3
"""注入 carplay-audio entitlement 并重新打包 ipa，供 TrollStore 安装。

优先使用 Azule（Windows 推荐，自动处理 ldid 与打包）；
若没有 Azule 则回退到 ldid（Mac 推荐）。
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile


def find_app_dir(payload):
    for name in os.listdir(payload):
        if name.endswith(".app"):
            return os.path.join(payload, name)
    return None


def have_tool(name):
    return shutil.which(name) is not None


def run(cmd):
    print(">>", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    default_ents = os.path.join(
        script_dir, "ios", "LxMusicMobile", "LxMusicMobile.entitlements"
    )

    parser = argparse.ArgumentParser(
        description="CarPlay entitlement 注入 + 重签一键脚本"
    )
    parser.add_argument("-i", "--input", required=True, help="Xcode 导出的 ipa")
    parser.add_argument("-e", "--entitlements", default=default_ents)
    parser.add_argument("-o", "--output", default="LxMusicMobile-carplay.ipa")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        sys.exit(f"输入 ipa 不存在: {args.input}")
    if not os.path.exists(args.entitlements):
        sys.exit(f"entitlements 不存在: {args.entitlements}")

    # 优先 Azule（Windows 推荐，自动处理 ldid / 打包）
    if have_tool("azule"):
        print("[使用 Azule] 注入 entitlements 并重新打包 ...")
        run(["azule", "-i", args.input, "-e", args.entitlements, "-o", args.output])
        print(f"完成 -> {args.output}")
        return

    # 其次 ldid
    if not have_tool("ldid"):
        sys.exit(
            "未找到 azule 或 ldid。\n"
            "  Windows: pip install azule\n"
            "  Mac:     brew install ldid\n"
            "然后重试。"
        )

    print("[使用 ldid] 解压 ipa ...")
    tmp = tempfile.mkdtemp(prefix="carplay_")
    payload = os.path.join(tmp, "Payload")
    os.makedirs(payload)
    with zipfile.ZipFile(args.input) as z:
        z.extractall(tmp)

    app = find_app_dir(payload)
    if not app:
        shutil.rmtree(tmp)
        sys.exit("ipa 中未找到 .app")

    print("ldid 重签 ...")
    run(["ldid", "-S" + args.entitlements, app])

    print("重新打包 ...")
    if os.path.exists(args.output):
        os.remove(args.output)
    cwd = os.getcwd()
    os.chdir(tmp)
    if have_tool("zip"):
        run(["zip", "-r", os.path.abspath(args.output), "Payload"])
    else:
        with zipfile.ZipFile(
            os.path.abspath(args.output), "w", zipfile.ZIP_DEFLATED
        ) as z:
            for root, _, files in os.walk("Payload"):
                for f in files:
                    p = os.path.join(root, f)
                    z.write(p, p)
    os.chdir(cwd)
    shutil.rmtree(tmp)
    print(f"完成 -> {args.output}")


if __name__ == "__main__":
    main()
