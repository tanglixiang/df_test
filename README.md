# df_test 家庭用电看板

一个无需构建步骤的静态电量监控页面。Python 采集脚本定期读取两台电表的数据，保存去重后的 CSV 历史，并生成页面使用的 `dashboard-data.json`。

趋势图支持原始、按天、按周和按月查看，也可以切换为周期用电柱状图，对比不同时间段的实际消耗。

## 本地运行

```powershell
python -m pip install -r requirements.txt
python dl.py --rebuild-only
python -m http.server 8765
```

浏览器访问 `http://127.0.0.1:8765/`。

## 更新数据

```powershell
python dl.py
```

脚本会执行以下操作：

- 请求当前设备数据
- 按同步时间去重并排序历史记录
- 仅保留每个同步时间的最后一次采集记录
- 原子更新 CSV，避免中途写入损坏文件
- 生成页面直接读取的 `dashboard-data.json`

GitHub Actions 每 30 分钟运行一次，并且只提交 `device_data` 和 `dashboard-data.json`。

## 文件结构

- `index.html`：页面结构
- `assets/styles.css`：视觉系统与响应式布局
- `assets/app.js`：数据计算、设备切换、图表和实时接口降级
- `dl.py`：设备数据采集、去重与 JSON 生成
- `device_data/`：按设备保存的 CSV 历史
- `dashboard-data.json`：页面数据文件

## 隐私提醒

CSV 和 JSON 包含设备编号、房间名称与用电记录。如果仓库对外公开，请确认这些信息可以公开，或将仓库改为私有并对展示数据进行脱敏。
