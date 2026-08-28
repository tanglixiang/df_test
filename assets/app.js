"use strict";

const API_URL = "https://api.zhihuifangdong.net/core/device/deviceIndexMoreMixedTwo";

const state = {
    data: null,
    deviceIndex: 0,
    range: "7d",
    chartView: "trend",
    aggregation: "raw",
    trendAggregation: "raw",
    consumptionAggregation: "day",
    showAllHistory: false,
    chart: null,
    chartObserver: null,
    realtimeController: null,
    realtimeRequestId: 0,
    realtimeTimer: null,
};

const elements = {
    deviceTabs: document.getElementById("device-tabs"),
    sourceStatus: document.getElementById("source-status"),
    sourceStatusText: document.getElementById("source-status-text"),
    generatedAt: document.getElementById("data-generated-at"),
    notice: document.getElementById("notice"),
    rangeControls: document.getElementById("range-controls"),
    chartViewControls: document.getElementById("chart-view-controls"),
    aggregationControls: document.getElementById("aggregation-controls"),
    trendTitle: document.getElementById("trend-title"),
    trendSubtitle: document.getElementById("trend-subtitle"),
    chart: document.getElementById("chart"),
    historyBody: document.getElementById("history-body"),
    historyEmpty: document.getElementById("history-empty"),
    historyCount: document.getElementById("history-count"),
    toggleHistory: document.getElementById("toggle-history"),
    themeToggle: document.getElementById("theme-toggle"),
    themeLabel: document.getElementById("theme-label"),
};

function parseDate(value) {
    if (!value) return null;
    const date = new Date(String(value).replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? null : date;
}

function numericValue(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits = 2) {
    const number = numericValue(value);
    if (number === null) return "--";
    return number.toLocaleString("zh-CN", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function formatDateTime(value, compact = false) {
    const date = parseDate(value);
    if (!date) return "--";
    const options = compact
        ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
        : { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
    return new Intl.DateTimeFormat("zh-CN", options).format(date).replaceAll("/", "-");
}

function formatDuration(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return "--";
    if (minutes < 60) return `${Math.round(minutes)} 分钟`;
    const hours = minutes / 60;
    if (hours < 24) return `${formatNumber(hours, hours < 10 ? 1 : 0)} 小时`;
    return `${formatNumber(hours / 24, 1)} 天`;
}

function currentDevice() {
    return state.data?.devices?.[state.deviceIndex] || null;
}

function sortedRecords(device = currentDevice()) {
    if (!device?.records) return [];
    return [...device.records]
        .filter((record) => parseDate(record.syncAt) && numericValue(record.residual) !== null && numericValue(record.used) !== null)
        .sort((a, b) => parseDate(a.syncAt) - parseDate(b.syncAt));
}

function startOfToday(reference = new Date()) {
    return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
}

function startOfWeek(reference = new Date()) {
    const result = startOfToday(reference);
    const weekday = result.getDay() || 7;
    result.setDate(result.getDate() - weekday + 1);
    return result;
}

function rangeStart(range) {
    const now = new Date();
    if (range === "today") return startOfToday(now);
    if (range === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (range === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return null;
}

function recordsInRange(records, range = state.range) {
    const start = rangeStart(range);
    if (!start) return records;
    return records.filter((record) => parseDate(record.syncAt) >= start);
}

function periodStart(value, aggregation) {
    const date = value instanceof Date ? new Date(value) : parseDate(value);
    if (!date) return null;
    const start = startOfToday(date);
    if (aggregation === "week") {
        const weekday = start.getDay() || 7;
        start.setDate(start.getDate() - weekday + 1);
    } else if (aggregation === "month") {
        start.setDate(1);
    }
    return start;
}

function nextPeriodStart(start, aggregation) {
    const next = new Date(start);
    if (aggregation === "month") next.setMonth(next.getMonth() + 1, 1);
    else next.setDate(next.getDate() + (aggregation === "week" ? 7 : 1));
    return next;
}

function formatDatePart(date) {
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
        .format(date)
        .replaceAll("/", "-");
}

function periodLabels(start, aggregation) {
    const end = new Date(nextPeriodStart(start, aggregation).getTime() - 1);
    if (aggregation === "month") {
        return {
            axis: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
            tooltip: `${start.getFullYear()} 年 ${start.getMonth() + 1} 月`,
        };
    }
    if (aggregation === "week") {
        return {
            axis: `${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")} 周`,
            tooltip: `${formatDatePart(start)} 至 ${formatDatePart(end)}`,
        };
    }
    return {
        axis: `${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
        tooltip: formatDatePart(start),
    };
}

function groupedPeriods(records, aggregation) {
    const groups = new Map();
    records.forEach((record) => {
        const start = periodStart(record.syncAt, aggregation);
        if (!start) return;
        const key = start.getTime();
        if (!groups.has(key)) {
            groups.set(key, {
                start,
                end: nextPeriodStart(start, aggregation),
                records: [],
                ...periodLabels(start, aggregation),
            });
        }
        groups.get(key).records.push(record);
    });
    return [...groups.values()].sort((a, b) => a.start - b.start);
}

function trendChartData(records) {
    const filtered = recordsInRange(records);
    if (state.aggregation === "raw") {
        return filtered.map((record) => ({
            record,
            axis: record.syncAt,
            tooltip: formatDateTime(record.syncAt),
        }));
    }
    return groupedPeriods(filtered, state.aggregation).map((period) => ({
        record: period.records.at(-1),
        axis: period.axis,
        tooltip: period.tooltip,
    }));
}

function consumptionChartData(records) {
    const filtered = recordsInRange(records);
    const visiblePeriods = groupedPeriods(filtered, state.aggregation);
    const now = new Date();

    return visiblePeriods.map((period) => {
        const periodRecords = records.filter((record) => {
            const time = parseDate(record.syncAt);
            return time >= period.start && time < period.end;
        });
        const baseline = records.filter((record) => parseDate(record.syncAt) <= period.start).at(-1);
        const first = periodRecords[0];
        const last = periodRecords.at(-1);
        const origin = baseline || first;
        const difference = origin && last ? Number(last.used) - Number(origin.used) : null;
        const usage = Number.isFinite(difference) && difference >= 0 && (baseline || origin !== last) ? difference : null;

        return {
            ...period,
            usage,
            observedFrom: origin?.syncAt || null,
            observedTo: last?.syncAt || null,
            partialStart: !baseline,
            ongoing: period.end > now,
        };
    });
}

function usageBetween(records, start, end = new Date()) {
    if (records.length < 2) return null;
    const beforeOrAtStart = records.filter((record) => parseDate(record.syncAt) <= start).at(-1);
    const inPeriod = records.filter((record) => {
        const time = parseDate(record.syncAt);
        return time >= start && time <= end;
    });
    const first = beforeOrAtStart || inPeriod[0];
    const last = inPeriod.at(-1);
    if (!first || !last) return null;
    const usage = Number(last.used) - Number(first.used);
    return Number.isFinite(usage) && usage >= 0 ? usage : null;
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

function setStatus(message, type = "ready") {
    elements.sourceStatusText.textContent = message;
    elements.sourceStatus.classList.toggle("is-ready", type === "ready");
    elements.sourceStatus.classList.toggle("is-error", type === "error");
}

function showNotice(message = "") {
    elements.notice.hidden = !message;
    elements.notice.textContent = message;
}

function renderDeviceTabs() {
    elements.deviceTabs.replaceChildren();
    const devices = state.data?.devices || [];

    devices.forEach((device, index) => {
        const records = sortedRecords(device);
        const latest = records.at(-1);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "device-tab";
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(index === state.deviceIndex));
        button.setAttribute("tabindex", index === state.deviceIndex ? "0" : "-1");
        button.dataset.index = String(index);

        const details = document.createElement("span");
        const name = document.createElement("span");
        const meta = document.createElement("span");
        const value = document.createElement("span");
        const unit = document.createElement("small");

        name.className = "device-tab__name";
        meta.className = "device-tab__meta";
        value.className = "device-tab__value";
        name.textContent = device.roomName || device.shortName || `设备 ${index + 1}`;
        meta.textContent = device.sn || "编号未知";
        value.textContent = formatNumber(device.realtime?.residual ?? latest?.residual, 2);
        unit.textContent = "度";
        value.appendChild(unit);
        details.append(name, meta);
        button.append(details, value);
        button.addEventListener("click", () => selectDevice(index));
        elements.deviceTabs.appendChild(button);
    });
}

function selectDevice(index) {
    if (!state.data?.devices?.[index]) return;
    state.deviceIndex = index;
    state.showAllHistory = false;
    elements.toggleHistory.setAttribute("aria-expanded", "false");
    elements.toggleHistory.textContent = "显示更多";
    renderDeviceTabs();
    renderDashboard();
    refreshRealtime();
}

function renderMetrics(records, device) {
    const latest = records.at(-1);
    const realtime = device.realtime || {};
    const now = new Date();
    const todayStart = startOfToday(now);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const yesterdaySameTime = new Date(yesterdayStart.getTime() + (now.getTime() - todayStart.getTime()));
    const todayUsage = usageBetween(records, todayStart, now);
    const yesterdayUsage = usageBetween(records, yesterdayStart, yesterdaySameTime);
    const weekUsage = usageBetween(records, startOfWeek(now), now);
    const residual = realtime.residual ?? latest?.residual;

    setText("metric-residual", formatNumber(residual, 2));
    setText("metric-today", formatNumber(todayUsage, 2));
    setText("metric-week", formatNumber(weekUsage, 2));
    setText("metric-power", formatNumber(realtime.power, 2));

    const reportTime = realtime.reportedAt || latest?.syncAt;
    setText("metric-residual-meta", reportTime ? `更新于 ${formatDateTime(reportTime, true)}` : "暂无上报记录");
    setText("metric-power-meta", numericValue(realtime.power) !== null ? "来自设备实时上报" : "实时参数暂不可用");

    if (todayUsage !== null && yesterdayUsage !== null) {
        const delta = todayUsage - yesterdayUsage;
        const direction = delta > 0.005 ? "多" : delta < -0.005 ? "少" : "持平";
        const detail = direction === "持平" ? "与昨日同期接近" : `比昨日同期${direction} ${formatNumber(Math.abs(delta), 2)} 度`;
        setText("metric-today-meta", detail);
    } else {
        setText("metric-today-meta", "按当天首条记录计算");
    }
}

function findLastRecharge(records) {
    for (let index = records.length - 1; index > 0; index -= 1) {
        const increase = Number(records[index].residual) - Number(records[index - 1].residual);
        if (increase >= 5) {
            return { record: records[index], amount: increase };
        }
    }
    return null;
}

function renderInsights(records) {
    const latest = records.at(-1);
    const previous = records.at(-2);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const usage = usageBetween(records, sevenDaysAgo, new Date());
    const periodRecords = records.filter((record) => parseDate(record.syncAt) >= sevenDaysAgo);
    const coverageStart = periodRecords[0] ? parseDate(periodRecords[0].syncAt) : null;
    const coverageDays = coverageStart ? Math.max(1, (Date.now() - coverageStart.getTime()) / (24 * 60 * 60 * 1000)) : 7;
    const dailyAverage = usage === null ? null : usage / Math.min(7, coverageDays);
    const residual = Number(currentDevice()?.realtime?.residual ?? latest?.residual);
    const estimatedDays = dailyAverage > 0.01 ? residual / dailyAverage : null;
    const recharge = findLastRecharge(records);
    const intervalMinutes = latest && previous
        ? (parseDate(latest.syncAt) - parseDate(previous.syncAt)) / 60000
        : null;

    setText("insight-daily-average", dailyAverage === null ? "数据不足" : `${formatNumber(dailyAverage, 2)} 度`);
    setText("insight-estimated-days", estimatedDays === null ? "数据不足" : `约 ${formatNumber(estimatedDays, estimatedDays < 10 ? 1 : 0)} 天`);
    setText(
        "insight-last-recharge",
        recharge ? `${formatDateTime(recharge.record.syncAt, true)}  +${formatNumber(recharge.amount, 1)} 度` : "未识别到充值",
    );
    setText("insight-report-interval", intervalMinutes === null ? "数据不足" : formatDuration(intervalMinutes));
}

function renderLive(device, records) {
    const realtime = device.realtime || {};
    const latest = records.at(-1);
    const sourceIsLive = realtime.source === "api";
    const sourceBadge = document.getElementById("live-source-badge");

    setText("live-voltage", formatNumber(realtime.voltage, 2));
    setText("live-current", formatNumber(realtime.current, 2));
    setText("live-power", formatNumber(realtime.power, 2));
    setText("live-used", formatNumber(realtime.used ?? latest?.used, 2));
    setText("live-reported-at", `最近上报: ${formatDateTime(realtime.reportedAt || latest?.syncAt)}`);
    sourceBadge.textContent = sourceIsLive ? "实时接口" : "历史缓存";
    sourceBadge.classList.toggle("is-live", sourceIsLive);
}

function renderHistory(records) {
    const filtered = recordsInRange(records);
    const visible = state.showAllHistory ? [...filtered].reverse() : [...filtered].slice(-10).reverse();
    elements.historyBody.replaceChildren();
    elements.historyEmpty.hidden = visible.length > 0;
    elements.historyBody.parentElement.hidden = visible.length === 0;

    visible.forEach((record) => {
        const originalIndex = records.indexOf(record);
        const previous = originalIndex > 0 ? records[originalIndex - 1] : null;
        const consumption = previous ? Number(record.used) - Number(previous.used) : null;
        const residualIncrease = previous ? Number(record.residual) - Number(previous.residual) : null;
        const row = document.createElement("tr");
        const values = [
            formatDateTime(record.syncAt),
            `${formatNumber(record.residual, 2)} 度`,
            `${formatNumber(record.used, 2)} 度`,
            residualIncrease >= 5
                ? `充值 +${formatNumber(residualIncrease, 2)} 度`
                : consumption === null || consumption < 0
                    ? "--"
                    : `${formatNumber(consumption, 2)} 度`,
        ];
        const labels = ["同步时间", "剩余电量", "累计用电", "本次消耗"];

        values.forEach((value, index) => {
            const cell = document.createElement("td");
            cell.dataset.label = labels[index];
            cell.textContent = value;
            if (index === 3) cell.className = residualIncrease >= 5 ? "recharge-value" : "consumption-value";
            row.appendChild(cell);
        });
        elements.historyBody.appendChild(row);
    });

    elements.historyCount.textContent = filtered.length
        ? `当前范围 ${filtered.length} 条记录${state.showAllHistory ? "，已全部显示" : "，显示最近 10 条"}`
        : "当前范围暂无记录";
    elements.toggleHistory.hidden = filtered.length <= 10;
}

function chartColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
        text: styles.getPropertyValue("--text-secondary").trim(),
        muted: styles.getPropertyValue("--text-muted").trim(),
        border: styles.getPropertyValue("--border").trim(),
        accent: styles.getPropertyValue("--accent").trim(),
        success: styles.getPropertyValue("--success").trim(),
        surface: styles.getPropertyValue("--surface").trim(),
    };
}

function renderChart(records) {
    const colors = chartColors();
    const isConsumption = state.chartView === "consumption";
    const data = isConsumption ? consumptionChartData(records) : trendChartData(records);

    if (!window.echarts) {
        elements.chart.innerHTML = '<div class="chart-placeholder">图表组件加载失败，请检查网络后刷新页面</div>';
        return;
    }

    if (!state.chart) {
        elements.chart.replaceChildren();
        state.chart = window.echarts.init(elements.chart);
        state.chartObserver = new ResizeObserver(() => state.chart?.resize());
        state.chartObserver.observe(elements.chart);
    }

    if (!data.length || (isConsumption && data.every((item) => item.usage === null))) {
        state.chart.clear();
        state.chart.setOption({
            title: {
                text: isConsumption ? "当前范围无法计算用量" : "当前范围暂无数据",
                subtext: isConsumption ? "至少需要两个累计用电采集点" : "请选择更长的时间范围",
                left: "center",
                top: "middle",
                textStyle: { color: colors.text, fontSize: 15, fontWeight: 600 },
                subtextStyle: { color: colors.muted, fontSize: 12 },
            },
        });
        return;
    }

    const isMobile = window.innerWidth <= 600;
    const animationDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 350;

    if (isConsumption) {
        state.chart.setOption({
            animationDuration,
            backgroundColor: "transparent",
            color: [colors.accent],
            tooltip: {
                trigger: "axis",
                axisPointer: { type: "shadow", shadowStyle: { color: colors.border, opacity: 0.26 } },
                backgroundColor: colors.surface,
                borderColor: colors.border,
                textStyle: { color: colors.text, fontSize: 12 },
                formatter(params) {
                    const item = data[params[0]?.dataIndex ?? 0];
                    if (!item) return "";
                    const status = item.ongoing ? "（进行中）" : item.partialStart ? "（数据覆盖不完整）" : "";
                    const lines = [item.tooltip + status];
                    lines.push(`${params[0]?.marker || ""}周期用电: ${formatNumber(item.usage, 2)} 度`);
                    if (item.observedFrom && item.observedTo) {
                        lines.push(`计算区间: ${formatDateTime(item.observedFrom, true)} 至 ${formatDateTime(item.observedTo, true)}`);
                    }
                    return lines.join("<br>");
                },
            },
            legend: { show: false },
            grid: {
                left: isMobile ? 4 : 6,
                right: isMobile ? 4 : 6,
                top: 28,
                bottom: 4,
                containLabel: true,
            },
            xAxis: {
                type: "category",
                data: data.map((item) => item.axis),
                axisLine: { lineStyle: { color: colors.border } },
                axisTick: { show: false },
                axisLabel: {
                    color: colors.muted,
                    fontSize: 10,
                    hideOverlap: true,
                    margin: 12,
                },
            },
            yAxis: {
                type: "value",
                name: "用电量（度）",
                min: 0,
                nameTextStyle: { color: colors.muted, fontSize: 10, padding: [0, 0, 0, 8] },
                axisLabel: { color: colors.muted, fontSize: 10 },
                splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
            },
            series: [{
                name: "周期用电",
                type: "bar",
                data: data.map((item) => item.usage),
                barMaxWidth: 42,
                itemStyle: {
                    color: colors.accent,
                    borderRadius: [6, 6, 2, 2],
                },
                emphasis: {
                    itemStyle: { color: colors.accent },
                },
            }],
        }, true);
        return;
    }

    const showSymbols = data.length <= 36;

    state.chart.setOption({
        animationDuration,
        backgroundColor: "transparent",
        color: [colors.accent, colors.success],
        tooltip: {
            trigger: "axis",
            backgroundColor: colors.surface,
            borderColor: colors.border,
            textStyle: { color: colors.text, fontSize: 12 },
            formatter(params) {
                const index = params[0]?.dataIndex ?? 0;
                const lines = [data[index]?.tooltip || ""];
                params.forEach((item) => lines.push(`${item.marker}${item.seriesName}: ${formatNumber(item.value, 2)} 度`));
                return lines.join("<br>");
            },
        },
        legend: {
            top: 0,
            left: 0,
            itemWidth: 18,
            itemHeight: 3,
            textStyle: { color: colors.text, fontSize: 11 },
        },
        grid: {
            left: isMobile ? 4 : 6,
            right: isMobile ? 4 : 6,
            top: 52,
            bottom: 4,
            containLabel: true,
        },
        xAxis: {
            type: "category",
            boundaryGap: false,
            data: data.map((item) => item.axis),
            axisLine: { lineStyle: { color: colors.border } },
            axisTick: { show: false },
            axisLabel: {
                color: colors.muted,
                fontSize: 10,
                hideOverlap: true,
                margin: 12,
                formatter(value) {
                    if (state.aggregation !== "raw") return value;
                    const date = parseDate(value);
                    if (!date) return "";
                    return state.range === "today"
                        ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)
                        : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date).replace("/", "-");
                },
            },
        },
        yAxis: [
            {
                type: "value",
                name: "剩余",
                nameTextStyle: { color: colors.muted, fontSize: 10 },
                axisLabel: { color: colors.muted, fontSize: 10 },
                splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
            },
            {
                type: "value",
                name: "累计",
                nameTextStyle: { color: colors.muted, fontSize: 10 },
                axisLabel: { color: colors.muted, fontSize: 10 },
                splitLine: { show: false },
            },
        ],
        series: [
            {
                name: "剩余电量",
                type: "line",
                yAxisIndex: 0,
                data: data.map((item) => Number(item.record.residual)),
                smooth: 0.18,
                showSymbol: showSymbols,
                symbolSize: 5,
                lineStyle: { width: 2.5 },
                areaStyle: { opacity: 0.09 },
                emphasis: { focus: "series" },
            },
            {
                name: "累计用电",
                type: "line",
                yAxisIndex: 1,
                data: data.map((item) => Number(item.record.used)),
                smooth: 0.18,
                showSymbol: showSymbols,
                symbolSize: 5,
                lineStyle: { width: 2 },
                emphasis: { focus: "series" },
            },
        ],
    }, true);
}

function aggregationName(aggregation) {
    return { raw: "原始记录", day: "每日", week: "每周", month: "每月" }[aggregation] || "";
}

function updateChartHeading(device) {
    const roomName = device.roomName || device.shortName;
    const isConsumption = state.chartView === "consumption";
    elements.trendTitle.textContent = isConsumption ? "用量变化" : "电量趋势";
    elements.trendSubtitle.textContent = isConsumption
        ? `${roomName}，${aggregationName(state.aggregation)}用电消耗`
        : state.aggregation === "raw"
            ? `${roomName}，剩余电量与累计用电`
            : `${roomName}，${aggregationName(state.aggregation)}期末电量`;
    elements.chart.setAttribute("aria-label", isConsumption ? "设备周期用电量柱状图" : "设备电量趋势折线图");
}

function renderDashboard() {
    const device = currentDevice();
    if (!device) return;
    const records = sortedRecords(device);
    renderMetrics(records, device);
    renderInsights(records);
    renderLive(device, records);
    renderHistory(records);
    updateChartHeading(device);
    renderChart(records);
}

async function refreshRealtime() {
    const device = currentDevice();
    if (!device?.sn) return;

    state.realtimeController?.abort();
    const controller = new AbortController();
    const requestId = ++state.realtimeRequestId;
    state.realtimeController = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    try {
        const url = `${API_URL}?keywords=${encodeURIComponent(device.sn)}&type=METER`;
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const item = payload?.data?.pmeterDetailFormList?.[0];
        if (!payload?.success || !item) throw new Error("接口未返回设备数据");
        if (requestId !== state.realtimeRequestId || currentDevice()?.sn !== device.sn) return;

        device.realtime = {
            residual: numericValue(item.residualElectricity),
            used: numericValue(item.electricEnergy),
            voltage: numericValue(item.voltage),
            current: numericValue(item.electricity),
            power: numericValue(item.capacity),
            reportedAt: item.gmtResidualElectricity,
            source: "api",
        };
        showNotice("");
        setStatus("实时数据已连接", "ready");
        renderDeviceTabs();
        renderDashboard();
    } catch (error) {
        if (requestId !== state.realtimeRequestId || currentDevice()?.sn !== device.sn) return;
        showNotice("实时接口暂不可用，当前页面已自动使用最近一次历史记录。");
        setStatus("正在显示历史缓存", "warning");
        device.realtime = { ...device.realtime, source: "history" };
        renderLive(device, sortedRecords(device));
    } finally {
        window.clearTimeout(timeout);
    }
}

async function loadDashboardData() {
    setStatus("正在读取数据", "loading");
    try {
        const response = await fetch(`dashboard-data.json?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.devices) || !data.devices.length) throw new Error("数据文件中没有设备");
        state.data = data;
        elements.generatedAt.textContent = `数据更新时间: ${formatDateTime(data.generatedAt)}`;
        renderDeviceTabs();
        renderDashboard();
        setStatus("历史数据已载入", "ready");
        refreshRealtime();
        state.realtimeTimer = window.setInterval(refreshRealtime, 30000);
    } catch (error) {
        setStatus("数据读取失败", "error");
        showNotice("无法读取仪表盘数据，请确认 dashboard-data.json 已生成并与页面放在同一目录。");
        document.querySelectorAll(".metric__value span, .live-grid dd span").forEach((element) => {
            element.textContent = "--";
        });
    }
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("energy-theme", theme);
    const nextIsDark = theme !== "dark";
    elements.themeLabel.textContent = nextIsDark ? "深色模式" : "浅色模式";
    elements.themeToggle.setAttribute("aria-label", nextIsDark ? "切换为深色模式" : "切换为浅色模式");
    if (state.chart) renderChart(sortedRecords());
}

function setupTheme() {
    const savedTheme = localStorage.getItem("energy-theme");
    const initialTheme = savedTheme === "light" || savedTheme === "dark"
        ? savedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyTheme(initialTheme);
    elements.themeToggle.addEventListener("click", () => {
        applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });
}

function setActiveControl(container, selector, activeValue) {
    container.querySelectorAll(selector).forEach((button) => {
        const value = button.dataset.view || button.dataset.aggregation || button.dataset.range;
        const active = value === activeValue;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

function syncAggregationControls() {
    const rawButton = elements.aggregationControls.querySelector('[data-aggregation="raw"]');
    rawButton.hidden = state.chartView === "consumption";
    setActiveControl(elements.aggregationControls, "button[data-aggregation]", state.aggregation);
}

elements.chartViewControls.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button || button.dataset.view === state.chartView) return;
    state.chartView = button.dataset.view;
    state.aggregation = state.chartView === "consumption" ? state.consumptionAggregation : state.trendAggregation;
    setActiveControl(elements.chartViewControls, "button[data-view]", state.chartView);
    syncAggregationControls();
    const device = currentDevice();
    if (device) {
        updateChartHeading(device);
        renderChart(sortedRecords(device));
    }
});

elements.aggregationControls.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-aggregation]");
    if (!button || button.hidden || button.dataset.aggregation === state.aggregation) return;
    state.aggregation = button.dataset.aggregation;
    if (state.chartView === "consumption") state.consumptionAggregation = state.aggregation;
    else state.trendAggregation = state.aggregation;
    syncAggregationControls();
    const device = currentDevice();
    if (device) {
        updateChartHeading(device);
        renderChart(sortedRecords(device));
    }
});

elements.rangeControls.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-range]");
    if (!button) return;
    state.range = button.dataset.range;
    state.showAllHistory = false;
    elements.toggleHistory.setAttribute("aria-expanded", "false");
    elements.toggleHistory.textContent = "显示更多";
    setActiveControl(elements.rangeControls, "button[data-range]", state.range);
    renderDashboard();
});

elements.toggleHistory.addEventListener("click", () => {
    state.showAllHistory = !state.showAllHistory;
    elements.toggleHistory.setAttribute("aria-expanded", String(state.showAllHistory));
    elements.toggleHistory.textContent = state.showAllHistory ? "收起记录" : "显示更多";
    renderHistory(sortedRecords());
});

elements.deviceTabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const count = state.data?.devices?.length || 0;
    if (!count) return;
    const nextIndex = (state.deviceIndex + direction + count) % count;
    selectDevice(nextIndex);
    elements.deviceTabs.querySelector(`[data-index="${nextIndex}"]`)?.focus();
});

setupTheme();
loadDashboardData();
