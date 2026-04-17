// js/roomService.js
import { auth, db } from './firebase-config.js';
import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDocs,
  query, 
  where,
  orderBy,
  onSnapshot,
  serverTimestamp, 
  getDoc,
  setDoc 
} from "./firebase-config.js";

class RoomService {
  constructor() {
    this.auth = auth;
    this.db = db;
    this.activeListeners = new Map();
  }

  // Lấy user ID hiện tại
  getCurrentUserId() {
    const user = this.auth.currentUser;
    if (!user) return null; 
    return user.uid;
  }

  // ===== REFERENCE GETTERS =====
  getRoomsRef() { return collection(this.db, 'rooms'); }
  getRoomRef(roomId) { return doc(this.db, 'rooms', roomId); }
  getRoomDevicesRef(roomId) { return collection(this.db, 'rooms', roomId, 'devices'); }
  getRoomSensorsRef(roomId) { return collection(this.db, 'rooms', roomId, 'sensors'); }

  // ===== ROOM OPERATIONS =====

  async getRoomDetails(roomId) {
    try {
      const roomDoc = await getDoc(this.getRoomRef(roomId));
      return roomDoc.exists() ? { id: roomDoc.id, ...roomDoc.data() } : null;
    } catch (error) {
      console.error("Error getting room details:", error);
      throw error;
    }
  }

  // Lấy danh sách phòng (Fresh)
  async getRoomsFresh() {
    try {
      const userId = this.getCurrentUserId();
      if (!userId) return [];

      // [CẬP NHẬT] Thêm orderBy để sắp xếp phòng theo thứ tự tạo
      // Lưu ý: Các document phòng trên Firebase PHẢI có trường 'createdAt' (Timestamp)
      const q = query(
        this.getRoomsRef(), 
        where("userId", "==", userId)
        // orderBy("createdAt", "asc")  // Tạm thời bỏ để test, thêm lại sau
      );
      
      const querySnapshot = await getDocs(q);
      
      const rooms = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        rooms.push({
          id: doc.id,
          ...data
        });
      });
      console.log(' Fresh rooms loaded:', rooms.length);
      return rooms;
    } catch (error) {
      console.error('Error getting fresh rooms: ', error);
      throw error;
    }
  }

  async updateRoom(roomId, roomData) {
    try {
      await updateDoc(this.getRoomRef(roomId), { ...roomData, updatedAt: serverTimestamp() });
    } catch (error) { console.error('Error updating room:', error); throw error; }
  }

  // ===== DEVICE OPERATIONS =====

  // Lấy devices (Đã bỏ orderBy để tránh lỗi ẩn thiết bị nhập tay thiếu createdAt)
  async getDevices(roomId) {
    try {
      const q = query(this.getRoomDevicesRef(roomId)); 
      
      const querySnapshot = await getDocs(q);
      const devices = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        devices.push({
          id: doc.id,
          name: data.name || 'Thiết bị',
          type: data.type || 'unknown',
          status: data.status || 'offline',
          isOn: data.isOn || false,
          details: data.details || '',
          icon: data.icon || ''
        });
      });
      return devices;
    } catch (error) {
      console.error('Error getting devices: ', error);
      throw error;
    }
  }

  async updateDevice(roomId, deviceId, deviceData) {
    try {
      const deviceRef = doc(this.getRoomDevicesRef(roomId), deviceId);
      await updateDoc(deviceRef, {
        ...deviceData,
        updatedAt: serverTimestamp() // Rasp sẽ dựa vào cái này để biết lệnh mới
      });
    } catch (error) { console.error('Error updating device:', error); throw error; }
  }

  async addDevice(roomId, deviceData) {
    try {
      const data = { ...deviceData, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      const docRef = await addDoc(this.getRoomDevicesRef(roomId), data);
      await this.updateRoomDeviceCount(roomId);
      return docRef.id;
    } catch (error) { console.error('Error adding device:', error); throw error; }
  }

  // ===== SENSOR OPERATIONS =====
  async getSensorsSnapshot(roomId) {
    try {
        const q = query(this.getRoomSensorsRef(roomId));
        const snapshot = await getDocs(q);
        const sensors = {};
        snapshot.forEach(doc => {
            sensors[doc.data().type] = doc.data().value;
        });
        return sensors;
    } catch (error) { console.error('Error getting sensors:', error); return {}; }
  }

  // ===== UTILITY METHODS =====
  
  async updateRoomDeviceCount(roomId) {
    try {
      const devices = await this.getDevices(roomId);
      await updateDoc(this.getRoomRef(roomId), { 
          deviceCount: devices.length,
          updatedAt: serverTimestamp()
      });
    } catch (error) { console.error('Update count error:', error); }
  }

  unsubscribeAll() {
    this.activeListeners.forEach(unsub => unsub());
    this.activeListeners.clear();
  }

  // ===== AUTOMATION & SCHEDULE =====
  async saveAutomation(userId, roomId, settings) {
      try {
          // Lưu vào collection root: automations
          const docId = `${userId}_${roomId}`;
          const automationRef = doc(this.db, 'automations', docId);
          await setDoc(automationRef, {
              ...settings,
              userId,
              roomId,
              updatedAt: serverTimestamp()
          }, { merge: true });
          console.log("Automation saved to Root Collection");
      } catch (error) { console.error("Error saving automation:", error); throw error; }
  }
}

const roomServiceInstance = new RoomService();
export default roomServiceInstance;