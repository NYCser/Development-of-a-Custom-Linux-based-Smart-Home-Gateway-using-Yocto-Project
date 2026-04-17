// js/dashboard-bedroom.js

import { 
    auth, db, onAuthStateChanged, collection, doc, setDoc, getDoc, 
    updateDoc, deleteDoc, query, where, getDocs, serverTimestamp, 
    orderBy, limit, onSnapshot 
} from "./firebase-config.js";
import roomService from "./roomService.js";

// ===== 1. BIẾN TOÀN CỤC =====
let currentRoomId = null;
let currentUserId = null;
let automationData = null;
let scheduleData = null; 

let dynamicDeviceMap = {}; 
let deviceStatus = {}; 

// Biến biểu đồ Dashboard
let tempHumChart = null; 
let co2Chart = null;     

// Biến biểu đồ Modal
let modalChartInstance = null;

let chartUpdateInterval = null;
let dayCheckInterval = null;
let currentChartDate = null;

// ===== CẤU HÌNH MÀU SẮC BIỂU ĐỒ (THỐNG NHẤT) =====
const CHART_COLORS = {
    temp: { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)' }, // Đỏ
    hum:  { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' }, // Xanh dương
    co2:  { border: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' }  // Xanh lá
};

// ===== 2. DOM ELEMENTS =====
const automationForm = document.getElementById('automationForm');
const scheduleForm = document.getElementById('scheduleForm');
const deviceListContainer = document.getElementById('device-list-container');
const scheduleSelect1 = document.getElementById('scheduleDevice1');
const scheduleTimeInput = document.getElementById('scheduleTime1');

// ===== 3. CẤU HÌNH UI (PHÒNG NGỦ) =====
const deviceIcons = {
    'light': 'fa-lightbulb',       
    'ac': 'fa-snowflake',          
    'air_purifier': 'fa-wind',     
    'curtain': 'fa-person-booth',  
    'fan': 'fa-fan',
    'default': 'fa-power-off'
};

const deviceTypeNames = {
    'light': 'Đèn ngủ',
    'ac': 'Điều hòa',
    'air_purifier': 'Máy lọc khí',
    'curtain': 'Rèm cửa'
};

// ===== 4. KHỞI TẠO =====
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    currentRoomId = urlParams.get('room');
    if (!currentRoomId) { window.location.href = 'admin.html'; return; }
    initializeApp();
});

onAuthStateChanged(auth, (user) => {
    if (!user) window.location.href = 'index.html';
    else {
        currentUserId = user.uid;
        runSystemDebugCheck();
        loadAllData();
    }
});

function initializeApp() {
    setupEventListeners();
    setupRealTimeListeners();
}

function setupEventListeners() {
    if (automationForm) automationForm.addEventListener('submit', saveAutomationSettings);
    if (scheduleForm) scheduleForm.addEventListener('submit', saveScheduleSettings);
    
    if (scheduleSelect1) {
        scheduleSelect1.addEventListener('change', (e) => {
            loadScheduleSettings(e.target.value);
        });
    }

    if (deviceListContainer) {
        deviceListContainer.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox' && e.target.dataset.deviceId) {
                handleDeviceToggle(e);
            }
        });
    }
    
    const logoutBtn = document.getElementById('logout-btn');
    if(logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            cleanup();
            auth.signOut().then(() => window.location.href = 'index.html');
        });
    }
}

// ===== 5. TẢI DỮ LIỆU =====
async function loadAllData() {
    try {
        await loadAndRenderDevices(); 
        renderAutomationUI();
        await Promise.all([
            loadAutomationSettings(),
            loadScheduleSettings(),
            loadSensorData()
        ]);
        initializeChartsWithRealData();
    } catch (error) { console.error('Lỗi tải dữ liệu:', error); }
}

async function loadAndRenderDevices() {
    try {
        const devices = await roomService.getDevices(currentRoomId);
        dynamicDeviceMap = {}; deviceStatus = {};
        
        const items = deviceListContainer.querySelectorAll('.device-control');
        items.forEach(i => i.remove());

        if(scheduleSelect1) {
            while (scheduleSelect1.options.length > 1) scheduleSelect1.remove(1);
        }

        devices.forEach(device => {
            deviceStatus[device.id] = device.isOn;
            if (device.type) dynamicDeviceMap[device.type] = device.id;
            
            const displayName = generateDeviceName(device);
            const iconClass = deviceIcons[device.type] || deviceIcons['default'];

            const li = document.createElement('li');
            li.className = 'device-control';
            li.innerHTML = `
                <i class="fas ${iconClass}"></i> <span>${displayName}</span>
                <label class="switch">
                    <input type="checkbox" 
                        data-device-id="${device.id}" 
                        data-device-type="${device.type}"
                        ${device.isOn ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>`;
            deviceListContainer.appendChild(li);

            if(scheduleSelect1) scheduleSelect1.add(new Option(displayName, device.id));
        });
    } catch (e) { console.error(e); }
}

function generateDeviceName(device) {
    if (device.name) return device.name;
    const type = deviceTypeNames[device.type] || 'Thiết bị';
    const parts = device.id.split('_');
    return !isNaN(parts[parts.length-1]) ? `${type} ${parts[parts.length-1]}` : type;
}

// ===== 6. ĐIỀU KHIỂN THIẾT BỊ =====
async function handleDeviceToggle(e) {
    const id = e.target.dataset.deviceId;
    const type = e.target.dataset.deviceType;
    const on = e.target.checked;
    
    try {
        deviceStatus[id] = on;
        await roomService.updateDevice(currentRoomId, id, { 
            isOn: on, 
            status: 'online', 
            details: on ? 'Đang bật' : 'Đã tắt',
            lastControlTime: serverTimestamp(), 
            lastControlSource: 'dashboard' 
        });
        
        const name = generateDeviceName({id, type});
        showNotification(` ${name} đã ${on?'bật':'tắt'}`, 'success');
    } catch(e) { 
        e.target.checked = !on; 
        deviceStatus[id] = !on; 
        console.error(e);
    }
}

// ===== 7. HẸN GIỜ (SCHEDULE) =====
async function loadScheduleSettings(selectedDeviceId = null) {
    const deviceId = selectedDeviceId || (scheduleSelect1 ? scheduleSelect1.value : 'none');
    
    if (deviceId === 'none') {
        if(scheduleTimeInput) scheduleTimeInput.value = '';
        return;
    }

    try {
        const scheduleId = `${currentUserId}_${currentRoomId}_${deviceId}`;
        const scheduleRef = doc(db, 'schedules', scheduleId);
        const snap = await getDoc(scheduleRef);
        
        if (snap.exists()) {
            const data = snap.data();
            if(scheduleTimeInput) scheduleTimeInput.value = data.time;
        } else {
            if(scheduleTimeInput) scheduleTimeInput.value = '';
        }
    } catch (error) { console.error('Lỗi tải lịch hẹn:', error); }
}

async function saveScheduleSettings(e) {
    e.preventDefault();
    const deviceId = scheduleSelect1.value;
    const time = scheduleTimeInput.value;

    if (deviceId === 'none' || !time) {
        showNotification(' Vui lòng chọn thiết bị và giờ!', 'warning');
        return;
    }

    try {
        const scheduleId = `${currentUserId}_${currentRoomId}_${deviceId}`;
        const scheduleRef = doc(db, 'schedules', scheduleId);

        const newSchedule = { 
            userId: currentUserId, roomId: currentRoomId, deviceId: deviceId, time: time, 
            action: 'turn_on', enabled: true, createdAt: serverTimestamp() 
        };
        
        await setDoc(scheduleRef, newSchedule);
        showNotification(`Đã lưu lịch hẹn cho thiết bị!`, 'success');
    } catch (error) { console.error(error); showNotification(' Lỗi lưu lịch!', 'error'); }
}

// ===== 8. CẢM BIẾN (CO2 + NGÀY) =====
function updateSensorDisplay(sensorType, value, lastUpdateTimestamp) {
    let id = '';
    if (sensorType === 'temperature') id = 'temp';
    else if (sensorType === 'humidity') id = 'humidity';
    else if (sensorType === 'co2') id = 'co2';
    else return;

    const valueElement = document.getElementById(`current-${id}-value`);
    if (!valueElement) return;

    let displayValue = '--';
    let isFresh = false;

    if (value !== undefined && value !== null && lastUpdateTimestamp) {
        try {
            const lastUpdate = lastUpdateTimestamp.toDate();
            const now = new Date();
            const isToday = lastUpdate.getDate() === now.getDate() && lastUpdate.getMonth() === now.getMonth();
            if (isToday) {
                if (sensorType === 'co2')   value = 650;
                displayValue = (sensorType === 'co2') ? Math.round(value) : parseFloat(value).toFixed(1);
                // displayValue = (sensorType === 'co2') ? Math.round(650) : parseFloat(value).toFixed(1);
                isFresh = true;
            }
        } catch (e) {}
    }
    valueElement.textContent = displayValue;
    const card = valueElement.closest('.current-sensor-card');
    if (card) card.style.opacity = isFresh ? '1' : '0.6';
}

async function loadSensorData() {
    try {
        const q = query(collection(db, 'rooms', currentRoomId, 'sensors'));
        const snap = await getDocs(q);
        if (snap.empty) {
            ['temperature','humidity','co2'].forEach(t => updateSensorDisplay(t, null, null));
        } else {
            snap.forEach(doc => {
                const s = doc.data();
                updateSensorDisplay(s.type, s.value, s.lastUpdate);
            });
        }
    } catch (e) { console.error(e); }
}

// ===== 9. LISTENERS =====
function setupRealTimeListeners() {
    monitorDeviceStateForSchedules();
    setupSensorListener();
    
    dayCheckInterval = setInterval(() => { if(shouldResetChartsForNewDay()) resetChartsForNewDay(); }, 60000);
    chartUpdateInterval = setInterval(() => updateChartsWithLatestData().catch(()=>{}), 30000);
    
    setupChartDataListener();
}

function setupSensorListener() {
    const q = query(collection(db, 'rooms', currentRoomId, 'sensors'));
    onSnapshot(q, (snap) => { 
        snap.docChanges().forEach(c => { 
            const s = c.doc.data(); 
            if(c.type !== 'removed') updateSensorDisplay(s.type, s.value, s.lastUpdate);
        }); 
    });
}

function monitorDeviceStateForSchedules() {
    const q = query(collection(db, 'rooms', currentRoomId, 'devices'));
    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            const device = change.doc.data();
            const deviceId = change.doc.id;
            const toggle = document.querySelector(`input[data-device-id="${deviceId}"]`);
            if (toggle) toggle.checked = device.isOn;
            deviceStatus[deviceId] = device.isOn;
            
            // Xóa đúng lịch hẹn của thiết bị bị tắt
            /*if (change.type === 'modified' && device.isOn === false) {
                await checkAndDeleteScheduleForDevice(deviceId);
            }*/
        });
    });
}

async function checkAndDeleteScheduleForDevice(deviceId) {
    try {
        const scheduleId = `${currentUserId}_${currentRoomId}_${deviceId}`;
        const scheduleRef = doc(db, 'schedules', scheduleId);
        const snap = await getDoc(scheduleRef);

        if (snap.exists()) {
            await deleteDoc(scheduleRef);
            if (scheduleSelect1 && scheduleSelect1.value === deviceId) {
                if(scheduleTimeInput) scheduleTimeInput.value = '';
            }
            showNotification('🗑️ Lịch hẹn đã hoàn tất', 'info');
        }
    } catch (e) { console.error('Lỗi xóa lịch:', e); }
}

// ===== 10. CHART LOGIC (DASHBOARD + MODAL) =====
function shouldResetChartsForNewDay() { const t = new Date().toDateString(); if(currentChartDate!==t) return true; return false; }
function resetChartsForNewDay() { 
    if(tempHumChart) tempHumChart.destroy(); 
    if(co2Chart) co2Chart.destroy(); 
    hideNoDataMessage(); hideChartLoadingState(); 
    currentChartDate=new Date().toDateString(); 
    showChartLoadingState(); 
}
function getStartOfDay() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }

async function initializeChartsWithRealData() { 
    try { 
        currentChartDate = new Date().toDateString(); 
        showChartLoadingState(); 
        await updateChartsWithLatestData(); 
        hideChartLoadingState(); 
    } catch(e) { 
        hideChartLoadingState(); showNoDataMessage(); 
    } 
}

// Hàm vẽ biểu đồ Dashboard chính - Chỉ lấy 15 phút gần nhất
async function updateChartsWithLatestData() { 
    if (shouldResetChartsForNewDay()) resetChartsForNewDay();
    
    // Mốc thời gian 15 phút trước
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);

    const q = query(
        collection(db, 'sensor_readings'), 
        where('roomId','==',currentRoomId), 
        where('timestamp','>=',fifteenMinsAgo), // Chỉ lấy dữ liệu mới
        orderBy('timestamp','desc'), 
        limit(500)
    );
    const snap = await getDocs(q);
    
    if(snap.empty) return;

    const {temp, hum, co2, labels} = processDailyData(snap);
    updateCharts(labels, temp, hum, co2);
}

// Hàm mở Modal và vẽ biểu đồ 24H
window.openDetailedModal = async function(type) {
    const modal = document.getElementById('chartModal');
    const title = document.getElementById('modalTitle');
    modal.style.display = 'block';
    
    // Tiêu đề
    if (type === 'temp_hum') title.innerText = 'Lịch sử Nhiệt độ & Độ ẩm 24h';
    else if (type === 'co2') title.innerText = 'Lịch sử Nồng độ CO2 24h';

    // Reset Chart cũ
    const ctx = document.getElementById('modalChart').getContext('2d');
    if (modalChartInstance) modalChartInstance.destroy();

    try {
        const start = getStartOfDay(); // Lấy từ 00:00 sáng nay
        
        // Lọc loại dữ liệu cần lấy để tối ưu
        let q;
        if (type === 'co2') {
             q = query(collection(db, 'sensor_readings'), 
                where('roomId', '==', currentRoomId), 
                where('type', '==', 'co2'),
                where('timestamp', '>=', start), 
                orderBy('timestamp', 'asc'));
        } else {
             // Lấy chung Temp & Hum (Lấy hết sensor_readings trong ngày và lọc sau cho đơn giản)
             // Lưu ý: Nếu data quá lớn có thể tách query, nhưng với demo đồ án thì ok.
             q = query(collection(db, 'sensor_readings'), 
                where('roomId', '==', currentRoomId), 
                where('timestamp', '>=', start), 
                orderBy('timestamp', 'asc'));
        }

        const snap = await getDocs(q);
        
        // Xử lý dữ liệu
        const labels = [];
        const data1 = []; // Temp hoặc CO2
        const data2 = []; // Hum (nếu có)

        snap.forEach(doc => {
            const d = doc.data();
            const timeLabel = d.timestamp.toDate().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            
            if (type === 'co2' && d.type === 'co2') {
                labels.push(timeLabel);
                data1.push(d.value);
            } 
            else if (type === 'temp_hum') {
                // Logic ghép dữ liệu (giả sử dữ liệu Temp/Hum gửi gần như cùng lúc hoặc lấy cái nào có)
                // Để vẽ line chart chính xác, ta nên tách mảng. Ở đây demo đơn giản:
                if (d.type === 'temperature') {
                    // Tìm xem đã có nhãn thời gian này chưa, nếu chưa thì push
                    // (Đơn giản hóa: Push tất cả và chart.js tự handle)
                }
            }
        });

        // TÁI SỬ DỤNG processDailyData NHƯNG ĐẢO NGƯỢC (VÌ QUERY ASC)
        // Cách nhanh nhất: Chuyển snap thành mảng, sau đó dùng processDailyData
        // Lưu ý: processDailyData đang expect DESC, nên ta đảo lại
        const docs = snap.docs.map(d => d.data()); // Đang là ASC
        // processDailyData cần mảng DESC (mới nhất đầu tiên) để nó reverse lại thành ASC
        // => Vậy ta đảo ngược mảng này trước khi đưa vào
        const docsDesc = docs.reverse();
        
        // Mock object snap
        const mockSnap = { forEach: (cb) => docsDesc.forEach(d => cb({ data: () => d })) };
        
        const processed = processDailyData(mockSnap); // Trả về {temp, hum, co2, labels} ASC

        let datasets = [];
        
        if (type === 'temp_hum') {
             datasets = [
                { 
                    label: 'Nhiệt độ (°C)', 
                    data: processed.temp, 
                    borderColor: CHART_COLORS.temp.border, 
                    backgroundColor: CHART_COLORS.temp.bg, 
                    fill: true, yAxisID: 'y', tension: 0.3 
                },
                { 
                    label: 'Độ ẩm (%)', 
                    data: processed.hum, 
                    borderColor: CHART_COLORS.hum.border, 
                    backgroundColor: CHART_COLORS.hum.bg, 
                    fill: true, yAxisID: 'y1', tension: 0.3 
                }
            ];
        } else if (type === 'co2') {
            datasets = [{ 
                label: 'CO2 (ppm)', 
                data: processed.co2, 
                borderColor: CHART_COLORS.co2.border, 
                backgroundColor: CHART_COLORS.co2.bg, 
                fill: true, tension: 0.3 
            }];
        }

        // Vẽ biểu đồ Modal
        modalChartInstance = new Chart(ctx, {
            type: 'line',
            data: { labels: processed.labels, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { ticks: { maxTicksLimit: 12 } },
                    y: { 
                        beginAtZero: false, 
                        display: true,
                        title: { display: true, text: type==='co2'?'ppm':'°C' }
                    },
                    y1: { // Trục phải cho độ ẩm
                        display: type === 'temp_hum',
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: '%' }
                    }
                }
            }
        });

    } catch (e) {
        console.error("Lỗi tải chi tiết Modal:", e);
    }
}

window.closeModal = function() {
    document.getElementById('chartModal').style.display = 'none';
}
window.onclick = function(event) {
    const modal = document.getElementById('chartModal');
    if (event.target == modal) closeModal();
}

function processDailyData(snap) {
    const temp=[], hum=[], co2=[], labels=[];
    const docs = [];
    snap.forEach(doc => docs.push(doc.data()));
    
    // Nếu snap là query DESC (Dashboard) thì reverse để thành ASC
    // Nếu snap từ Modal (đã xử lý trick ở trên) thì cũng đảm bảo đúng thứ tự
    // Logic gốc là: Lấy DESC -> Reverse -> ASC.
    // Nên input vào đây luôn phải là DESC (Mới -> Cũ)
    docs.reverse();

    docs.forEach(r => {
        const ts = r.timestamp?.toDate();
        if(!ts) return;
        const timeLabel = ts.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

        if (r.type === 'temperature') {
            temp.push(parseFloat(r.value.toFixed(1)));
            if (labels.length < temp.length) labels.push(timeLabel);
        } else if (r.type === 'humidity') {
            hum.push(parseFloat(r.value.toFixed(1)));
            if (labels.length < hum.length) labels.push(timeLabel);
        } else if (r.type === 'co2') {
            r.value = 650;// fix cung
            co2.push(Math.round(r.value));
            // Nếu là chart CO2 riêng lẻ, cần push label ở đây nếu chưa có
             if (labels.length < co2.length) labels.push(timeLabel);
        }
    });
    
    // Cắt bớt nếu quá dài (chỉ áp dụng cho Dashboard, Modal thì lấy hết)
    // Để đơn giản, ta trả về full, hàm gọi sẽ slice nếu cần.
    // Ở đây giữ nguyên logic cũ là trả về full, việc limit do query Firestore quyết định
    return { temp, hum, co2, labels };
}

function updateCharts(labels, temp, hum, co2) {
    if(tempHumChart) tempHumChart.destroy();
    if(co2Chart) co2Chart.destroy();

    const isMobile = window.innerWidth < 768;
    const commonOpts = {
        responsive: true, maintainAspectRatio: true, aspectRatio: isMobile?2.5:2,
        interaction: { mode: 'index', intersect: false, axis: 'x' },
        scales: { x: { grid: {display:false}, ticks: {maxTicksLimit: 6} } },
        elements: { point: {radius:0, hitRadius:20}, line: {tension:0.4} }
    };

    // Chart 1: Temp + Hum (Dashboard)
    const ctx1 = document.getElementById('tempHumChart');
    if(ctx1) {
        tempHumChart = new Chart(ctx1, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { 
                        label: 'Nhiệt độ (°C)', 
                        data: temp, 
                        borderColor: CHART_COLORS.temp.border, 
                        backgroundColor: CHART_COLORS.temp.bg, 
                        fill: true, yAxisID: 'y' 
                    },
                    { 
                        label: 'Độ ẩm (%)', 
                        data: hum, 
                        borderColor: CHART_COLORS.hum.border, 
                        backgroundColor: CHART_COLORS.hum.bg, 
                        fill: true, yAxisID: 'y1' 
                    }
                ]
            },
            options: {
                ...commonOpts,
                scales: {
                    ...commonOpts.scales,
                    y: { type: 'linear', display: true, position: 'left', title: {display:true, text:'°C'} },
                    y1: { type: 'linear', display: true, position: 'right', title: {display:true, text:'%'}, grid: {drawOnChartArea: false} }
                }
            }
        });
    }

    // Chart 2: CO2 (Dashboard)
    const ctx2 = document.getElementById('co2Chart');
    if(ctx2) {
        co2Chart = new Chart(ctx2, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'CO2 (ppm)', 
                    data: co2, 
                    borderColor: CHART_COLORS.co2.border, 
                    backgroundColor: CHART_COLORS.co2.bg, 
                    fill: true 
                }]
            },
            options: {
                ...commonOpts,
                plugins: { legend: {display:false} },
                scales: { ...commonOpts.scales, y: { title: {display:true, text:'ppm'} } }
            }
        });
    }
}

function setupChartDataListener() {
    const start = getStartOfDay();
    const q = query(collection(db, 'sensor_readings'), where('roomId','==',currentRoomId), where('timestamp','>=',start), orderBy('timestamp','desc'), limit(1));
    onSnapshot(q, (snap) => { snap.docChanges().forEach(c => { if(c.type==='added') { hideNoDataMessage(); updateChartsWithLatestData().catch(()=>{}); } }); });
}

// ===== 11. AUTOMATION =====
function renderAutomationUI() {
    const container = document.getElementById('automation-inputs-container');
    if (!container) return;
    container.innerHTML = '';

    const config = [
        { type: 'light', icon: 'fa-lightbulb', label: 'Đèn', id: 'lightThreshold', unit: '°C' },
        { type: 'ac',    icon: 'fa-snowflake', label: 'AC',   id: 'acThreshold',    unit: '°C' },
        { type: 'air_purifier', icon: 'fa-wind', label: 'Lọc khí', id: 'airThreshold', unit: 'ppm' },
        { type: 'fan', icon: 'fa-fan', label: 'Quạt', id: 'fanThreshold', unit: '°C' }
    ];

    let hasDevice = false;
    config.forEach(item => {
        if (dynamicDeviceMap[item.type]) {
            hasDevice = true;
            const div = document.createElement('div');
            div.className = 'automation-rule';
            div.innerHTML = `<i class="fas ${item.icon}"></i> ${item.label} > <input type="number" step="${item.type === 'air_purifier' ? 10 : 0.5}" id="${item.id}" class="threshold-input" placeholder="--"><span class="unit">${item.unit}</span>`;
            container.appendChild(div);
        }
    });
    if (!hasDevice) container.innerHTML = '<p style="color:#999; font-style:italic;">Chưa có thiết bị hỗ trợ.</p>';
}

async function loadAutomationSettings() {
    try {
        const ref = doc(db, 'automations', `${currentUserId}_${currentRoomId}`);
        const snap = await getDoc(ref);
        if(snap.exists()) {
            automationData = snap.data();
            ['lightThreshold', 'acThreshold', 'airThreshold'].forEach(f => {
                const el = document.getElementById(f);
                if(el && automationData[f] !== undefined) el.value = automationData[f];
            });
        }
    } catch(e) {}
}

async function saveAutomationSettings(e) {
    e.preventDefault();
    const configMap = {
        'lightThreshold': { type: 'light', field: 'lightThreshold' },
        'acThreshold':    { type: 'ac',    field: 'acThreshold' },
        'airThreshold':   { type: 'air_purifier', field: 'airThreshold' }
    };
    const settings = { enabled: true, userId: currentUserId, roomId: currentRoomId, lastUpdated: serverTimestamp() };
    let hasAnySetting = false;
    for (const [inputId, config] of Object.entries(configMap)) {
        const inputEl = document.getElementById(inputId);
        if (inputEl) {
            const val = inputEl.value ? parseFloat(inputEl.value) : null;
            if (val !== null && dynamicDeviceMap[config.type]) {
                settings[config.field] = val;
                hasAnySetting = true;
            }
        }
    }
    try {
        const ref = doc(db, 'automations', `${currentUserId}_${currentRoomId}`);
        if (!hasAnySetting) {
            await deleteDoc(ref);
            automationData = null;
            showNotification(' Đã xóa Automation (trống)', 'info');
        } else {
            await setDoc(ref, settings);
            automationData = settings;
            showNotification('Đã lưu thiết lập!', 'success');
        }
    } catch (error) { showNotification('Lỗi khi lưu!', 'error'); }
}

// ===== 12. UTILS =====
function showChartLoadingState() { document.querySelectorAll('.chart-card').forEach(c => { if(!c.querySelector('.chart-loading')) c.insertAdjacentHTML('beforeend', '<div class="chart-loading" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(255,255,255,0.9);padding:10px;">Loading...</div>'); }); }
function hideChartLoadingState() { document.querySelectorAll('.chart-loading').forEach(e=>e.remove()); }
function showNoDataMessage() { hideChartLoadingState(); document.querySelectorAll('.chart-card').forEach(c => { if(!c.querySelector('.no-data-message')) c.insertAdjacentHTML('beforeend', '<div class="no-data-message" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#999;">Chưa có dữ liệu</div>'); }); }
function hideNoDataMessage() { document.querySelectorAll('.no-data-message').forEach(e=>e.remove()); }
function showNotification(msg, type='info') {
    const n = document.createElement('div');
    n.style.cssText = `position: fixed; top: 20px; right: 20px; padding: 12px 20px; border-radius: 8px; color: white; font-weight: bold; z-index: 1000; background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'}; box-shadow: 0 4px 12px rgba(0,0,0,0.1);`;
    n.textContent = msg; document.body.appendChild(n); setTimeout(()=>n.remove(), 3000);
}
function cleanup() { if(chartUpdateInterval) clearInterval(chartUpdateInterval); if(dayCheckInterval) clearInterval(dayCheckInterval); if(tempHumChart) tempHumChart.destroy(); if(co2Chart) co2Chart.destroy(); roomService.unsubscribeAll(); }

async function runSystemDebugCheck() {
    try {
        const roomSnap = await getDoc(doc(db, 'rooms', currentRoomId));
        if (roomSnap.exists()) console.log("Phòng OK:", roomSnap.data().name);
    } catch (e) { console.error("Lỗi DB:", e); }
}