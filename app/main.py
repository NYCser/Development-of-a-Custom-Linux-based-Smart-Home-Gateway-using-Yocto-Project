from flask import Flask
from flask_socketio import SocketIO

app = Flask(__name__)
app.config['SECRET_KEY'] = 'smarthome-gateway'

# Khởi tạo SocketIO với quyền truy cập CORS rộng rãi cho realtime dashboard
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')