import { 
    auth, db, onAuthStateChanged, collection, doc, setDoc, getDoc, 
    addDoc, deleteDoc, updateDoc, onSnapshot, serverTimestamp, query, orderBy 
} from "./firebase-config.js";

let currentUserId = null;

// Khởi tạo Auth
onAuthStateChanged(auth, (user) => {
    if (!user) window.location.href = 'index.html';
    else {
        currentUserId = user.uid;
        setupWifiListeners();
        setupRfidListeners();
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    auth.signOut().then(() => window.location.href = 'index.html');
});

/* ================= 1. XỬ LÝ WIFI (LOGIC QUÉT & KẾT NỐI) ================= */

function setupWifiListeners() {
    // A. Nghe trạng thái kết nối hiện tại (Giữ nguyên để biết Rasp đang nối mạng nào)
    onSnapshot(doc(db, 'system_status', 'wifi'), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const statusEl = document.getElementById('wifi-current-status');
            const ssidEl = document.getElementById('wifi-current-ssid');

            ssidEl.textContent = data.current_ssid || 'Chưa kết nối';
            
            if(data.status === 'connected') {
                statusEl.className = 'status-badge success';
                statusEl.textContent = 'Đã kết nối Internet';
            } else if (data.status === 'connecting') {
                statusEl.className = 'status-badge warning';
                statusEl.textContent = 'Đang kết nối...';
            } else {
                statusEl.className = 'status-badge error';
                statusEl.textContent = 'Mất kết nối';
            }
        }
    });

    // B. [MỚI] Nghe danh sách Wifi quét được từ Raspberry Pi (available_wifi)
    onSnapshot(doc(db, 'system_status', 'available_wifi'), (docSnap) => {
        const tbody = document.getElementById('wifiListBody');
        tbody.innerHTML = '';
        
        if (!docSnap.exists()) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 20px;">Chưa có dữ liệu quét. Hãy đợi Rasp khởi động...</td></tr>`;
            return;
        }

        const data = docSnap.data();
        const networks = data.networks || []; 
        const lastScan = data.last_scan ? data.last_scan.toDate().toLocaleTimeString('vi-VN') : '--';

        document.getElementById('lastScanTime').textContent = `Cập nhật lúc: ${lastScan}`;

        if (networks.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 20px;">Không tìm thấy mạng Wifi nào xung quanh.</td></tr>`;
            return;
        }

        // Render danh sách
        networks.forEach(net => {
            // Tính toán icon tín hiệu
            let signalIcon = '';
            let signalClass = '';
            // net.signal thường từ 0-100
            if (net.signal > 80) { signalIcon = 'fa-signal'; signalClass = 'text-success'; }
            else if (net.signal > 50) { signalIcon = 'fa-wifi'; signalClass = 'text-warning'; }
            else { signalIcon = 'fa-rss'; signalClass = 'text-danger'; }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:500;">${net.ssid}</td>
                <td><i class="fas ${signalIcon} ${signalClass}"></i> ${net.signal}%</td>
                <td style="text-align: right;">
                    <button class="btn btn-sm btn-primary" onclick="openWifiModal('${net.ssid}')">
                        <i class="fas fa-plug"></i> Chọn
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

// C. Xử lý Modal & Gửi lệnh kết nối
window.openWifiModal = (ssid) => {
    document.getElementById('targetSsidHidden').value = ssid;
    document.getElementById('targetSsidDisplay').textContent = ssid;
    document.getElementById('wifiPasswordInput').value = ''; // Xóa pass cũ
    document.getElementById('wifiConnectModal').style.display = 'block';
    document.getElementById('wifiPasswordInput').focus();
};

window.closeWifiModal = () => {
    document.getElementById('wifiConnectModal').style.display = 'none';
};

// Hàm gửi lệnh xuống Firebase khi nhấn "Kết nối" trong Modal
window.confirmConnectWifi = async () => {
    const ssid = document.getElementById('targetSsidHidden').value;
    const password = document.getElementById('wifiPasswordInput').value;

    if (!ssid) return;

    if(!confirm(`Gửi lệnh yêu cầu Rasp kết nối vào "${ssid}"?`)) return;

    try {
        // Ghi lệnh vào collection commands để Python bắt được
        await setDoc(doc(db, 'commands', 'wifi_setup'), {
            action: 'add_and_connect', // Action này để log cho vui, Python chủ yếu lấy ssid/pass
            ssid: ssid,
            password: password,
            timestamp: serverTimestamp(),
            status: 'pending' // Python sẽ bắt trạng thái này để xử lý
        });

        alert(`Đã gửi lệnh! Raspberry Pi sẽ thử kết nối trong giây lát.`);
        closeWifiModal();

    } catch (error) {
        console.error(error);
        alert('Lỗi: ' + error.message);
    }
};

/* ================= 2. XỬ LÝ RFID (GIỮ NGUYÊN) ================= */

let registerTimeout = null; 

function updateRegisterUi(isScanning) {
    const btn = document.getElementById('startScanBtn');
    const statusDiv = document.getElementById('scan-status');

    if (isScanning) {
        btn.classList.add('scanning-active');
        btn.classList.remove('btn-success');
        btn.classList.add('btn-danger');
        btn.innerHTML = '<i class="fas fa-stop-circle"></i> Hủy Đăng ký';
        statusDiv.style.display = 'block';
        statusDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang đợi quét Vân tay hoặc RFID tại Cửa...';
    } else {
        btn.classList.remove('scanning-active');
        btn.classList.remove('btn-danger');
        btn.classList.add('btn-success');
        btn.innerHTML = '<i class="fas fa-fingerprint"></i> Kích hoạt Đăng ký (RFID/Vân tay)';
        statusDiv.style.display = 'none';
        if (registerTimeout) clearTimeout(registerTimeout);
    }
}

document.getElementById('startScanBtn').addEventListener('click', async () => {
    const btn = document.getElementById('startScanBtn');
    const isScanning = btn.classList.contains('scanning-active');
    const commandRef = doc(db, 'commands', 'entrance_register');

    try {
        if (!isScanning) {
            await setDoc(commandRef, {
                action: 'start_register',
                target: 'entrance_slave',
                timestamp: serverTimestamp(),
                status: 'waiting'
            });
            updateRegisterUi(true);
            registerTimeout = setTimeout(async () => {
                alert("⏳ Hết thời gian đăng ký. Đã tự động tắt.");
                updateRegisterUi(false);
                await updateDoc(commandRef, { action: 'cancel_register', status: 'timeout', timestamp: serverTimestamp() });
            }, 60000);
        } else {
            await updateDoc(commandRef, {
                action: 'cancel_register', 
                timestamp: serverTimestamp(),
                status: 'cancelled'
            });
            updateRegisterUi(false);
        }
    } catch (error) {
        console.error(error);
        alert('Lỗi thao tác: ' + error.message);
        updateRegisterUi(false); 
    }
});

function setupRfidListeners() {
    onSnapshot(doc(db, 'commands', 'entrance_register'), (docSnapshot) => {
        if(docSnapshot.exists()) {
            const data = docSnapshot.data();
            if (data.status === 'success') {
                updateRegisterUi(false); 
                if (data.result_type === 'rfid') {
                    alert(`Đã nhận thẻ RFID mới! UID: ${data.value}.`);
                } else if (data.result_type === 'fingerprint') {
                    alert(`Đã đăng ký Vân tay mới! ID: ${data.value}.`);
                } else {
                    alert(`Đăng ký thành công! Dữ liệu: ${data.value}`);
                }
                updateDoc(docSnapshot.ref, { status: 'idle' });
            }
            else if (data.status === 'error') {
                updateRegisterUi(false);
                alert(`Lỗi từ thiết bị: ${data.message || 'Không xác định'}`);
                updateDoc(docSnapshot.ref, { status: 'idle' });
            }
        }
    });

    const q = query(collection(db, 'rfid_cards'), orderBy('createdAt', 'desc'));
    onSnapshot(q, (snapshot) => {
        const tbody = document.getElementById('rfidListBody');
        tbody.innerHTML = '';
        snapshot.forEach(doc => {
            const card = doc.data();
            const date = card.createdAt ? card.createdAt.toDate().toLocaleDateString('vi-VN') : 'N/A';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code style="background:#eee; padding:2px 5px; border-radius:4px;">${card.uid}</code></td>
                <td>${card.name || '<span style="color:#999; font-style:italic;">Chưa đặt tên</span>'}</td>
                <td>${date}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="openEditModal('${doc.id}', '${card.name || ''}')">
                        <i class="fas fa-edit"></i> Sửa tên
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteCard('${doc.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

// Logic Modal chung (Xử lý đóng khi click ra ngoài)
window.onclick = function(event) {
    const editModal = document.getElementById('editCardModal');
    const wifiModal = document.getElementById('wifiConnectModal');
    if (event.target == editModal) closeEditModal();
    if (event.target == wifiModal) closeWifiModal();
}

// Logic Sửa tên thẻ RFID
window.openEditModal = (docId, currentName) => {
    document.getElementById('editingCardId').value = docId;
    document.getElementById('cardNameInput').value = currentName;
    document.getElementById('editCardModal').style.display = 'block';
};
window.closeEditModal = () => { document.getElementById('editCardModal').style.display = 'none'; };
window.saveCardName = async () => {
    const docId = document.getElementById('editingCardId').value;
    const newName = document.getElementById('cardNameInput').value;
    if(newName) {
        await updateDoc(doc(db, 'rfid_cards', docId), { name: newName });
        closeEditModal();
    }
};
window.deleteCard = async (docId) => {
    if(confirm('Chặn quyền truy cập của thẻ này?')) {
        await deleteDoc(doc(db, 'rfid_cards', docId));
    }
};