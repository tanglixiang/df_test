import argparse
import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import requests


DEVICE_SNS = [
    "11190261518546",
    "11190261518547",
]

BASE_API_URL = "https://api.zhihuifangdong.net/core/device/deviceIndexMoreMixedTwo"
HEADERS = {"User-Agent": "Mozilla/5.0"}

ROOT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT_DIR / "device_data"
DASHBOARD_DATA_FILE = ROOT_DIR / "dashboard-data.json"

CSV_HEADERS = ["采集时间", "同步时间", "设备编号", "房间名称", "剩余电量", "已使用电量"]


def parse_number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def read_records(output_file: Path) -> list[dict[str, str]]:
    if not output_file.exists():
        return []

    with output_file.open("r", newline="", encoding="utf-8-sig") as csvfile:
        reader = csv.DictReader(csvfile)
        return [row for row in reader if row.get("同步时间")]


def normalize_records(records: list[dict[str, str]]) -> list[dict[str, str]]:
    """按同步时间去重并排序，同一同步时间保留最后一次采集记录。"""
    unique_records: dict[str, dict[str, str]] = {}
    for record in records:
        sync_time = record.get("同步时间", "").strip()
        if sync_time:
            unique_records[sync_time] = {
                header: str(record.get(header, "")).strip() for header in CSV_HEADERS
            }

    return [unique_records[key] for key in sorted(unique_records)]


def write_records(output_file: Path, records: list[dict[str, str]]) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    temporary_file = output_file.with_suffix(".csv.tmp")

    with temporary_file.open("w", newline="", encoding="utf-8-sig") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=CSV_HEADERS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(records)

    temporary_file.replace(output_file)


def fetch_device(sn: str, collected_at: str) -> tuple[list[dict[str, str]], dict[str, Any]]:
    response = requests.get(
        BASE_API_URL,
        params={"keywords": sn, "type": "METER"},
        headers=HEADERS,
        timeout=10,
    )
    response.raise_for_status()
    payload = response.json()

    if not payload.get("success"):
        raise RuntimeError(payload.get("message") or "接口返回失败")

    meter_list = payload.get("data", {}).get("pmeterDetailFormList") or []
    if not meter_list:
        raise RuntimeError("接口未返回设备数据")

    records: list[dict[str, str]] = []
    for meter in meter_list:
        records.append(
            {
                "采集时间": collected_at,
                "同步时间": str(meter.get("gmtResidualElectricity") or ""),
                "设备编号": str(meter.get("sn") or sn),
                "房间名称": str(meter.get("houseName") or "未命名房间"),
                "剩余电量": str(meter.get("residualElectricity") or ""),
                "已使用电量": str(meter.get("electricEnergy") or ""),
            }
        )

    current = meter_list[0]
    realtime = {
        "residual": parse_number(current.get("residualElectricity")),
        "used": parse_number(current.get("electricEnergy")),
        "voltage": parse_number(current.get("voltage")),
        "current": parse_number(current.get("electricity")),
        "power": parse_number(current.get("capacity")),
        "reportedAt": current.get("gmtResidualElectricity"),
        "source": "api",
    }
    return records, realtime


def records_for_dashboard(records: list[dict[str, str]]) -> list[dict[str, Any]]:
    result = []
    for record in records:
        residual = parse_number(record.get("剩余电量"))
        used = parse_number(record.get("已使用电量"))
        if residual is None or used is None:
            continue
        result.append(
            {
                "collectedAt": record.get("采集时间"),
                "syncAt": record.get("同步时间"),
                "residual": residual,
                "used": used,
            }
        )
    return result


def build_dashboard_data(realtime_by_device: dict[str, dict[str, Any]] | None = None) -> None:
    realtime_by_device = realtime_by_device or {}
    devices = []

    for index, sn in enumerate(DEVICE_SNS, start=1):
        output_file = OUTPUT_DIR / f"{sn}.csv"
        records = normalize_records(read_records(output_file))
        write_records(output_file, records)
        dashboard_records = records_for_dashboard(records)
        latest = dashboard_records[-1] if dashboard_records else None
        room_name = records[-1].get("房间名称") if records else f"设备 {index}"

        cached_realtime = realtime_by_device.get(sn)
        if not cached_realtime and latest:
            cached_realtime = {
                "residual": latest["residual"],
                "used": latest["used"],
                "voltage": None,
                "current": None,
                "power": None,
                "reportedAt": latest["syncAt"],
                "source": "history",
            }

        devices.append(
            {
                "sn": sn,
                "shortName": f"设备 {index}",
                "roomName": room_name or f"设备 {index}",
                "realtime": cached_realtime,
                "records": dashboard_records,
            }
        )

    payload = {
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "devices": devices,
    }
    temporary_file = DASHBOARD_DATA_FILE.with_suffix(".json.tmp")
    temporary_file.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary_file.replace(DASHBOARD_DATA_FILE)


def fetch_and_save() -> None:
    collected_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{collected_at}] 开始查询设备数据")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    realtime_by_device: dict[str, dict[str, Any]] = {}

    for sn in DEVICE_SNS:
        output_file = OUTPUT_DIR / f"{sn}.csv"
        existing_records = read_records(output_file)
        before_count = len(normalize_records(existing_records))

        try:
            new_records, realtime = fetch_device(sn, collected_at)
            normalized_records = normalize_records(existing_records + new_records)
            write_records(output_file, normalized_records)
            realtime_by_device[sn] = realtime
            added_count = len(normalized_records) - before_count
            print(f"  {sn}: 新增 {added_count} 条，当前 {len(normalized_records)} 条唯一记录")
        except (requests.RequestException, ValueError, RuntimeError) as error:
            normalized_records = normalize_records(existing_records)
            write_records(output_file, normalized_records)
            print(f"  {sn}: 获取失败，保留历史数据。原因: {error}")

    build_dashboard_data(realtime_by_device)
    print(f"仪表盘数据已更新: {DASHBOARD_DATA_FILE.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description="采集电表数据并生成仪表盘数据文件")
    parser.add_argument(
        "--rebuild-only",
        action="store_true",
        help="只清理历史重复记录并重建 dashboard-data.json，不请求接口",
    )
    args = parser.parse_args()

    if args.rebuild_only:
        build_dashboard_data()
        print("历史数据已去重，仪表盘数据已重建")
    else:
        fetch_and_save()


if __name__ == "__main__":
    main()
