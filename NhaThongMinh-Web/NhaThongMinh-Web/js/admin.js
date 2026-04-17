import { 
    auth, 
    db, 
    onAuthStateChanged,
    collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc
} from "./firebase-config.js";
import roomService from "./roomService.js";

// ===== DOM ELEMENTS =====
const roomsGrid = document.getElementById('roomsGrid');

// Modal Elements
const editRoomModal = document.getElementById('editRoomModal');
const editRoomForm = document.getElementById('editRoomForm');
const editRoomName = document.getElementById('editRoomName');
const cancelEditRoom = document.getElementById('cancelEditRoom');

// Menu Elements
const hamburgerMenu = document.querySelector('.hamburger-menu');
const navMenu = document.querySelector('.nav-menu');
const navOverlay = document.querySelector('.nav-overlay');

// Notification Elements
const notifyBtn = document.querySelector('.notification-btn');
const notifyDropdown = document.querySelector('.notification-dropdown');
const notifyList = document.getElementById('notifyList');
const notifyBadge = document.getElementById('notifyBadge');
const markReadBtn = document.querySelector('.mark-read-btn');

// ===== GLOBAL STATE =====
let rooms = [];
let isInitialized = false;
let currentEditingRoomId = null;
let notifications = []; 

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            window.location.href = 'index.html';
        } else {
            console.log(' User logged in:', user.email);
            if (!isInitialized) {
                initializeApp();
            }
        }
    });
});

function initializeApp() {
    if (isInitialized) return;
    isInitialized = true;
    
    setupEventListeners();
    setupNotificationSystem();
    loadRooms();
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    // 1. Mobile Menu
    if (hamburgerMenu) hamburgerMenu.addEventListener('click', toggleMobileMenu);
    if (navOverlay) navOverlay.addEventListener('click', closeMobileMenu);

    // 2. Modal Edit Room
    if (editRoomForm) {
        editRoomForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newName = editRoomName.value.trim();
            if (newName && currentEditingRoomId) {
                await updateRoomName(currentEditingRoomId, newName);
                closeEditModal();
            }
        });
    }
    if (cancelEditRoom) cancelEditRoom.addEventListener('click', closeEditModal);
    document.querySelectorAll('.close').forEach(btn => btn.addEventListener('click', closeEditModal));
    window.addEventListener('click', (e) => { if (e.target === editRoomModal) closeEditModal(); });

    // 3. User Menu
    const userMenuBtn = document.querySelector('.user-menu');
    const dropdownMenu = document.querySelector('.dropdown-menu');
    if (userMenuBtn && dropdownMenu) {
        userMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('active');
            if(notifyDropdown) notifyDropdown.classList.remove('active');
        });
        window.addEventListener('click', () => {
            if (dropdownMenu.classList.contains('active')) dropdownMenu.classList.remove('active');
        });
        dropdownMenu.addEventListener('click', (e) => e.stopPropagation());
        
        const logoutBtn = dropdownMenu.querySelector('.logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                roomService.unsubscribeAll();
                auth.signOut().then(() => window.location.href = 'index.html');
            });
        }
    }
}

// ===== NOTIFICATION SYSTEM =====
function setupNotificationSystem() {
    console.log("🔔 Đang lắng nghe thông báo...");
    const q = query(collection(db, 'system_alerts'), orderBy('timestamp', 'desc'), limit(20));

    onSnapshot(q, (snapshot) => {
        notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderNotifications();
    }, (error) => console.error("Lỗi thông báo:", error));

    if (notifyBtn && notifyDropdown) {
        notifyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notifyDropdown.classList.toggle('active');
            const userMenu = document.querySelector('.dropdown-menu');
            if(userMenu) userMenu.classList.remove('active');
        });
        notifyDropdown.addEventListener('click', (e) => e.stopPropagation());
        window.addEventListener('click', () => notifyDropdown.classList.remove('active'));
    }

    if (markReadBtn) {
        markReadBtn.addEventListener('click', async () => {
            const unreadDocs = notifications.filter(n => !n.isResolved);
            unreadDocs.forEach(async (notify) => {
                try {
                    await updateDoc(doc(db, 'system_alerts', notify.id), { isResolved: true });
                } catch(e) {}
            });
        });
    }
}

function renderNotifications() {
    if (!notifyList) return;
    notifyList.innerHTML = '';

    const unreadItems = notifications.filter(n => !n.isResolved);
    const unreadCount = unreadItems.length;
    const hasDanger = unreadItems.some(n => n.level === 'critical');

    if (notifyBadge) {
        if (unreadCount > 0) {
            notifyBadge.style.display = 'flex';
            notifyBadge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            notifyBadge.classList.remove('badge-danger', 'badge-success');
            if (hasDanger) notifyBadge.classList.add('badge-danger');
            else notifyBadge.classList.add('badge-success');
        } else {
            notifyBadge.style.display = 'none';
        }
    }

    if (notifications.length === 0) {
        notifyList.innerHTML = '<div style="padding:20px;text-align:center;color:#888;font-size:0.9rem;">Chưa có thông báo nào</div>';
        return;
    }

    notifications.forEach(notify => {
        let iconClass = 'fa-info-circle';
        let bgClass = 'info';
        if (notify.type === 'fire') { iconClass = 'fa-fire'; bgClass = 'danger'; }
        else if (notify.type === 'gas') { iconClass = 'fa-burn'; bgClass = 'danger'; }
        else if (notify.type === 'intrusion') { iconClass = 'fa-user-secret'; bgClass = 'warning'; }
        else if (notify.type === 'system') { iconClass = 'fa-server'; bgClass = 'success'; }

        const timeAgo = getTimeAgo(notify.timestamp);
        const item = document.createElement('div');
        item.className = `notify-item ${!notify.isResolved ? 'unread' : ''}`;
        
        item.addEventListener('click', async () => {
            if (!notify.isResolved) {
                try { await updateDoc(doc(db, 'system_alerts', notify.id), { isResolved: true }); } catch(e) {}
            }
        });

        item.innerHTML = `
            <div class="notify-icon ${bgClass}"><i class="fas ${iconClass}"></i></div>
            <div class="notify-text">
                <span class="notify-title">${notify.type.toUpperCase()} ALERT</span>
                <span class="notify-desc">${notify.message}</span>
                <span class="notify-time">${timeAgo}</span>
            </div>
            ${!notify.isResolved ? '<span style="width:8px;height:8px;background:var(--primary-color);border-radius:50%;margin-top:5px;"></span>' : ''}
        `;
        notifyList.appendChild(item);
    });
}

function getTimeAgo(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate();
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return "Vừa xong";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    return `${Math.floor(hours / 24)} ngày trước`;
}

// ===== UI HELPER FUNCTIONS =====
function toggleMobileMenu() { hamburgerMenu.classList.toggle('active'); navMenu.classList.toggle('active'); navOverlay.classList.toggle('active'); document.body.style.overflow = navMenu.classList.contains('active') ? 'hidden' : ''; }
function closeMobileMenu() { hamburgerMenu.classList.remove('active'); navMenu.classList.remove('active'); navOverlay.classList.remove('active'); document.body.style.overflow = ''; }
function closeEditModal() { if(editRoomModal) { editRoomModal.style.display = 'none'; editRoomForm.reset(); } }

function openEditRoomModal(roomId) { 
    const room = rooms.find(r => r.id === roomId); 
    if(!room) return; 
    currentEditingRoomId = roomId; 
    if(editRoomName) editRoomName.value = room.name; 
    if(editRoomModal) editRoomModal.style.display = 'block'; 
}

async function updateRoomName(roomId, newName) { 
    try { await roomService.updateRoom(roomId, { name: newName }); await loadRooms(); } 
    catch(e) { alert('Lỗi cập nhật: ' + e.message); } 
}

async function viewRoomDetails(roomId) {
    try {
        const roomData = await roomService.getRoomDetails(roomId);
        if(!roomData || !roomData.roomType) { alert('Lỗi: Phòng thiếu roomType'); return; }
        let page = 'dashboard.html';
        const type = roomData.roomType.toUpperCase();
        if(type === 'LIVING_ROOM') page = 'dashboard-livingroom.html';
        else if(type === 'BEDROOM') page = 'dashboard-bedroom.html';
        else if(type === 'KITCHEN') page = 'dashboard-kitchen.html';
        window.location.href = `${page}?room=${roomId}`;
    } catch(e) { console.error(e); }
}

// ===== CORE LOGIC (LOAD ROOMS) =====
async function loadRooms() {
    try {
        const roomsData = await roomService.getRoomsFresh();
        rooms = roomsData;
        await renderRooms();
    } catch (error) {
        console.error('❌ Lỗi tải phòng:', error);
        if (roomsGrid) roomsGrid.innerHTML = `<p class="error-text">Lỗi kết nối: ${error.message}</p>`;
    }
}

async function renderRooms() {
    if (!roomsGrid) return;
    roomsGrid.innerHTML = '';
    
    if (rooms.length === 0) {
        showEmptyState();
        updateStats(0, 0);
        return;
    }
    
    let totalDevicesCount = 0;
    let activeDevicesCount = 0;

    const renderPromises = rooms.map(async (room) => {
        try {
            const devices = await roomService.getDevices(room.id);
            totalDevicesCount += devices.length;
            activeDevicesCount += devices.filter(d => d.isOn).length;
            roomsGrid.appendChild(createRoomCardElement(room, devices));
        } catch (error) {
            roomsGrid.appendChild(createRoomCardElement(room, []));
        }
    });
    
    await Promise.all(renderPromises);
    updateStats(totalDevicesCount, activeDevicesCount);
}

function showEmptyState() { roomsGrid.innerHTML = `<div class="empty-state"><div class="empty-icon">🏠</div><h3>Chưa có phòng</h3></div>`; }

function createRoomCardElement(room, devices) {
    const roomCard = document.createElement('div');
    roomCard.className = 'room-card';
    roomCard.setAttribute('data-room-id', room.id);
    
    let bgClass = 'bg-default';
    if (room.roomType) {
        const type = room.roomType.toUpperCase();
        if (type === 'LIVING_ROOM') bgClass = 'bg-living-room';
        else if (type === 'BEDROOM') bgClass = 'bg-bedroom';
        else if (type === 'KITCHEN') bgClass = 'bg-kitchen';
    }

    roomCard.innerHTML = `
        <div class="room-header-cover ${bgClass}">
            <div class="room-header-content">
                <div><h3>${room.name}</h3><span class="device-count">${devices.length} thiết bị</span></div>
                <button class="btn-icon edit-room" title="Đổi tên"><i class="fas fa-pen"></i></button>
            </div>
        </div>
        <div class="room-body">
            <div class="device-list">${renderDevicesList(devices)}</div>
            <div class="room-footer"><button class="btn btn-outline view-room" style="width:100%">Xem Chi Tiết</button></div>
        </div>
    `;
    
    roomCard.querySelector('.edit-room').addEventListener('click', (e) => { e.stopPropagation(); openEditRoomModal(room.id); });
    roomCard.querySelector('.view-room').addEventListener('click', () => viewRoomDetails(room.id));
    return roomCard;
}

function renderDevicesList(devices) {
    if (!devices || devices.length === 0) return `<div class="empty-devices"><p>Chưa có thiết bị</p></div>`;
    const displayDevices = devices.slice(0, 3);
    const remaining = devices.length - 3;
    let html = displayDevices.map(d => `
        <div class="device-item" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px dashed #eee;">
            <div class="device-info"><span class="device-name" style="font-weight:500;color:#333;">${d.name}</span></div>
            <div class="device-status"><span style="font-size:0.85rem;color:#666;background:#f1f2f6;padding:2px 8px;border-radius:12px;">${d.details || (d.isOn?'Đang bật':'Đã tắt')}</span></div>
        </div>
    `).join('');
    if (remaining > 0) html += `<div style="text-align:center;font-size:0.8rem;color:#888;margin-top:5px;">...và ${remaining} thiết bị khác</div>`;
    return html;
}

function updateStats(totalDevices = 0, activeDevices = 0) {
    const roomCountEl = document.getElementById('roomCount');
    const deviceCountEl = document.getElementById('deviceCount');
    const activeDeviceCountEl = document.getElementById('activeDeviceCount');
    if(roomCountEl) roomCountEl.textContent = rooms.length;
    if(deviceCountEl) deviceCountEl.textContent = totalDevices;
    if(activeDeviceCountEl) {
        if(activeDevices > 0) { activeDeviceCountEl.textContent = `${activeDevices} đang bật`; activeDeviceCountEl.style.color = 'var(--success-color)'; }
        else { activeDeviceCountEl.textContent = 'Không có'; activeDeviceCountEl.style.color = '#666'; }
    }
}