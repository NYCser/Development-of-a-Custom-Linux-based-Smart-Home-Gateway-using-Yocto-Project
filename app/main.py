from flask import Flask
from flask_socketio import SocketIO

app = Flask(__name__)
app.config['SECRET_KEY'] = 'smarthome-gateway'

# Cho phép bất kỳ CORS nào để UI local file (http://127.0.0.1:5500) có thể truy cập API
socketio = SocketIO(app, cors_allowed_origins='*')
