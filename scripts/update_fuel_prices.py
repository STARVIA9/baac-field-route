#!/usr/bin/env python3
"""Fetch fuel prices from Bangchak API and write to public/fuel-prices.json.
If prices changed, return non-zero to signal commit needed.
Usage: python3 update_fuel_prices.py [--force]
"""

import json, sys, os, urllib.request

API_URL = "https://oil-price.bangchak.co.th/apioilprice2/th"

# Map Bangchak oil names → our vehicle keys
OIL_MAP = {
    "ดีเซล B20": "pickup",          # กระบะ
    "แก๊สโซฮอล์ 91 S EVO": "car",   # รถเก๋ง (ใช้ 91)
    "แก๊สโซฮอล์ 95 S EVO": "motorcycle",  # มอเตอร์ไซค์
}

FORCE = "--force" in sys.argv

def fetch():
    req = urllib.request.Request(API_URL, headers={"User-Agent": "BAAC-Field-Route/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())

def extract(data):
    result = {"updated": "", "fuels": {}}
    for item in data:
        result["updated"] = item.get("OilDateNow", "")
        oils = json.loads(item.get("OilList", "[]"))
        for o in oils:
            key = OIL_MAP.get(o.get("OilName", ""))
            if key:
                result["fuels"][key] = {
                    "name": o["OilName"],
                    "price": o["PriceToday"],
                    "price_tomorrow": o["PriceTomorrow"],
                    "diff": o["PriceDifTomorrow"],
                }
    return result

def write(path, data):
    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_dir = os.path.dirname(script_dir)  # one level up from scripts/
    output = os.path.join(repo_dir, "public", "fuel-prices.json")

    # Load existing
    old = {}
    if os.path.exists(output):
        with open(output) as f:
            old = json.load(f)

    data = fetch()
    new = extract(data)

    if not new["fuels"]:
        print("❌ No fuels extracted from API", file=sys.stderr)
        sys.exit(1)

    # Compare (ignore date diff)
    old_fuels = old.get("fuels", {})
    changed = (
        FORCE
        or old_fuels != new["fuels"]
        or not os.path.exists(output)
    )

    print(f"📅 {new['updated']}")
    for k, v in new["fuels"].items():
        marker = " ✨ NEW" if old_fuels.get(k, {}).get("price") != v["price"] else ""
        print(f"  {v['name']:25s}  {v['price']:.2f} ฿{marker}")

    if changed:
        write(output, new)
        print(f"✅ Written to {os.path.relpath(output, repo_dir)}")
        sys.exit(0)  # success = changed, caller can commit
    else:
        print("💤 No price change — skipped")
        sys.exit(2)  # code 2 = no change

if __name__ == "__main__":
    main()
