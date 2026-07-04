import requests
import schedule
import time
import csv
import os
from datetime import datetime

# ================= 配置区域 =================
DEVICE_SNS = [
    "11190261518546",
    "11190261518547"
]

BASE_API_URL = "https://api.zhihuifangdong.net/core/device/deviceIndexMoreMixedTwo"
HEADERS = {
    "User-Agent": "Mozilla/5.0",
}

# 输出目录配置 (如果不存在会自动创建)
OUTPUT_DIR = "device_data"

# CSV 表头定义
CSV_HEADERS = ["采集时间", "同步时间", "设备编号", "房间名称", "剩余电量", "已使用电量"]
# ===========================================

def fetch_and_save():
    """核心函数：循环请求多个设备接口，每个设备的数据独立保存到一个CSV文件中"""
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{current_time}] 开始批量查询...")
    
    # 确保输出目录存在
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"ℹ️ 已创建输出目录: {OUTPUT_DIR}")

    for sn in DEVICE_SNS:
        api_url = f"{BASE_API_URL}?keywords={sn}&type=METER"
        print(f"  - 正在查询设备: {sn}")
        
        try:
            response = requests.get(api_url, headers=HEADERS, timeout=10)
            response.raise_for_status()
            
            try:
                data = response.json()
            except ValueError:
                print(f"    ❌ 响应不是有效的 JSON 格式。响应内容: {response.text[:200]}...")
                continue
            
            if not data.get("success"):
                print(f"    ❌ 接口返回失败: {data.get('message')}")
                continue
            
            meter_list = data.get("data", {}).get("pmeterDetailFormList", [])
            if not meter_list:
                print(f"    ⚠️ 未获取到设备 {sn} 的数据，跳过。")
                continue
            
            # 提取所需字段
            records = []
            for meter in meter_list:
                records.append([
                    current_time,
                    meter.get("gmtResidualElectricity"),
                    meter.get("sn"),
                    meter.get("houseName"),
                    meter.get("residualElectricity"),
                    meter.get("electricEnergy")
                ])
            
            # --- 独立写入该设备的 CSV 文件 ---
            # 文件名格式: 设备编号.csv
            output_file = os.path.join(OUTPUT_DIR, f"{sn}.csv")
            file_exists = os.path.exists(output_file)
            
            try:
                # 使用 'a' (append) 模式打开文件
                with open(output_file, 'a', newline='', encoding='utf-8-sig') as csvfile:
                    writer = csv.writer(csvfile)
                    
                    # 如果文件是新建的，先写入表头
                    if not file_exists:
                        writer.writerow(CSV_HEADERS)
                        print(f"    📝 发现新设备，已创建文件: {output_file}")
                    
                    # 批量写入本次获取的数据
                    writer.writerows(records)
                
                print(f"    ✅ 成功获取 {len(records)} 条数据，已追加到 {sn}.csv")
            except Exception as e:
                print(f"    ❌ 写入设备 {sn} 的文件失败: {e}")

        except requests.exceptions.RequestException as e:
            print(f"    ❌ 网络请求异常: {e}")
        except Exception as e:
            print(f"    ❌ 数据处理异常: {e}")

    print("\n🎉 本次批量查询任务已完成！")

def run_hourly():
    """定时任务：在每小时的第 0 分 0 秒执行"""
    print("⏰ 整点定时任务已触发！")
    fetch_and_save()

if __name__ == "__main__":
    print("程序已启动，等待整点触发... (按 Ctrl+C 停止)")
    fetch_and_save()
    
    # schedule.every().hour.at(":00").do(run_hourly)
    
    # while True:
    #     schedule.run_pending()
    #     time.sleep(1)
