// Giả định bạn đã import db, query, onSnapshot từ firebase-config
let allNotifications = [];

function setupFullNotificationSystem() {
    const q = query(collection(db, 'system_alerts'), orderBy('timestamp', 'desc'));

    onSnapshot(q, (snapshot) => {
        allNotifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        applyFilters(); // Render lại khi có dữ liệu mới
    });

    // Sự kiện bộ lọc
    document.getElementById('filterType').addEventListener('change', applyFilters);
    document.getElementById('filterStatus').addEventListener('change', applyFilters);
    document.getElementById('searchInput').addEventListener('input', applyFilters);
}

function applyFilters() {
    const type = document.getElementById('filterType').value;
    const status = document.getElementById('filterStatus').value;
    const search = document.getElementById('searchInput').value.toLowerCase();

    let filtered = allNotifications.filter(n => {
        const matchesType = type === 'all' || n.type === type;
        const matchesStatus = status === 'all' || (status === 'unread' ? !n.isResolved : n.isResolved);
        const matchesSearch = n.message.toLowerCase().includes(search) || n.type.toLowerCase().includes(search);
        return matchesType && matchesStatus && matchesSearch;
    });

    renderFullList(filtered);
}

function renderFullList(data) {
    const container = document.getElementById('fullNotifyList');
    container.innerHTML = data.map(n => `
        <div class="full-notify-item ${!n.isResolved ? 'unread' : ''}" onclick="markAsRead('${n.id}')">
            <div class="notify-icon-large ${getBgClass(n.type)}">
                <i class="fas ${getIconClass(n.type)}"></i>
            </div>
            <div class="notify-content-main">
                <div class="notify-meta-top">
                    <span class="notify-category">${n.type.toUpperCase()} LOGS</span>
                    <span class="notify-status-label">${n.isResolved ? 'Thành công' : 'Chưa xử lý'}</span>
                </div>
                <span class="notify-title-text">${n.message.split('|')[0]}</span>
                <p class="notify-details-text">${n.message}</p>
                <div class="notify-timestamp-info">
                    ${getTimeString(n.timestamp)} | ${n.location || 'Hệ thống'} | IP: ${n.ip || '192.168.1.x'}
                </div>
            </div>
        </div>
    `).join('');
}

// Hàm bổ trợ để lấy icon và màu sắc giống admin.js của bạn
function getIconClass(type) {
    const icons = { fire: 'fa-fire', gas: 'fa-burn', intrusion: 'fa-user-secret', system: 'fa-server' };
    return icons[type] || 'fa-info-circle';
}

function getBgClass(type) {
    if (type === 'fire' || type === 'gas') return 'danger';
    if (type === 'intrusion') return 'warning';
    return 'success';
}

function getTimeString(ts) {
    if(!ts) return "---";
    const d = ts.toDate();
    return `${d.getHours()}:${d.getMinutes()} | ${d.toLocaleDateString('vi-VN')}`;
}