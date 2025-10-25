from flask import Flask, render_template, request, Response, stream_with_context, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from flask_mail import Mail, Message
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.security import generate_password_hash, check_password_hash
import google.generativeai as genai
import os
import json
import re
import random
from datetime import datetime, timedelta
from threading import Lock
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# =====================================================================
# KONFIGURASI
# =====================================================================
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'sparq-ai-secret-key-2024-change-this-in-production')

# MySQL Configuration
# Format: mysql+pymysql://username:password@host:port/database
MYSQL_USER = os.getenv("MYSQL_USER")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD")
MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
MYSQL_DB = os.getenv("MYSQL_DB", "sparq_ai")

app.config['SQLALCHEMY_DATABASE_URI'] = (
    f"mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}@{MYSQL_HOST}/{MYSQL_DB}"
)
print("DB URI:", app.config['SQLALCHEMY_DATABASE_URI'])

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_size': 10,
    'pool_recycle': 3600,
    'pool_pre_ping': True,  
}

MAIL_PASSWORD = os.getenv('A')
MAIL_USERNAME = os.getenv('B')
# Email Configuration
app.config['MAIL_SERVER'] = 'smtp.gmail.com'
app.config['MAIL_PORT'] = 587
app.config['MAIL_USE_TLS'] = True
app.config['MAIL_USERNAME'] = MAIL_USERNAME
app.config['MAIL_PASSWORD'] = MAIL_PASSWORD
app.config['MAIL_DEFAULT_SENDER'] = MAIL_USERNAME   

# Session configuration for better security
app.config['SESSION_COOKIE_SECURE'] = True # Set True in production with HTTPS
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

# Inisialisasi
db = SQLAlchemy(app)
login_manager = LoginManager(app)
mail = Mail(app)
limiter = Limiter(app=app, key_func=get_remote_address, default_limits=["200 per day", "50 per hour"])

# Gemini API
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', 'YOUR_API_KEY_HERE')
genai.configure(api_key=GEMINI_API_KEY)

# =====================================================================
# SESSION MANAGEMENT - ISOLATED PER USER
# =====================================================================
# Dictionary untuk menyimpan history per session
# Format: {session_id: {'history': [...], 'lock': Lock(), 'last_access': datetime}}
user_sessions = {}
sessions_lock = Lock()  # Lock untuk mengakses user_sessions dict

def get_user_session_id():
    """Get unique session identifier for current user/guest"""
    if current_user.is_authenticated:
        return f"user_{current_user.id}"
    else:
        # Untuk guest, gunakan Flask session
        if 'guest_id' not in session:
            session['guest_id'] = f"guest_{os.urandom(16).hex()}"
        return session['guest_id']

def get_or_create_session():
    """Get or create isolated session for current user"""
    session_id = get_user_session_id()
    
    with sessions_lock:
        if session_id not in user_sessions:
            user_sessions[session_id] = {
                'history': [],
                'lock': Lock(),
                'last_access': datetime.utcnow()
            }
        else:
            user_sessions[session_id]['last_access'] = datetime.utcnow()
        
        return user_sessions[session_id]

def cleanup_old_sessions():
    """Remove sessions older than 1 hour to prevent memory leak"""
    with sessions_lock:
        current_time = datetime.utcnow()
        to_remove = []
        
        for sess_id, sess_data in user_sessions.items():
            if (current_time - sess_data['last_access']) > timedelta(hours=1):
                to_remove.append(sess_id)
        
        for sess_id in to_remove:
            del user_sessions[sess_id]

# Guest message tracking (in-memory)
guest_messages = {}  # Format: {ip: {'count': int, 'date': date}}

def check_guest_limit(ip_address):
    """Check guest message limit (10 per day)"""
    today = datetime.utcnow().date()
    
    if ip_address not in guest_messages:
        guest_messages[ip_address] = {'count': 0, 'date': today}
    
    guest_data = guest_messages[ip_address]
    
    # Reset jika hari berbeda
    if guest_data['date'] != today:
        guest_data['count'] = 0
        guest_data['date'] = today
    
    if guest_data['count'] >= 10:
        return False, "Limit guest tercapai (10 pesan/hari). Silakan login untuk mengirim lebih banyak pesan."
    
    guest_data['count'] += 1
    return True, ""

def get_guest_remaining(ip_address):
    """Get remaining messages for guest"""
    today = datetime.utcnow().date()
    
    if ip_address not in guest_messages or guest_messages[ip_address]['date'] != today:
        return 10
    
    return max(0, 10 - guest_messages[ip_address]['count'])

# =====================================================================
# VALIDASI
# =====================================================================
def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(pattern, email):
        return False
    blacklist = ['test.com', 'fake.com', 'example.com']
    domain = email.split('@')[1].lower()
    return domain not in blacklist

def validate_username(username):
    return re.match(r'^[a-zA-Z0-9_]{3,20}$', username) is not None

def validate_password(password):
    if len(password) < 8:
        return False, "Password minimal 8 karakter"
    if not re.search(r'[A-Z]', password):
        return False, "Password harus ada huruf besar"
    if not re.search(r'[a-z]', password):
        return False, "Password harus ada huruf kecil"
    if not re.search(r'[0-9]', password):
        return False, "Password harus ada angka"
    return True, "Valid"

def generate_otp():
    return ''.join([str(random.randint(0, 9)) for _ in range(6)])

# =====================================================================
# MODELS
# =====================================================================
class User(UserMixin, db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(200), nullable=False)
    is_verified = db.Column(db.Boolean, default=False)
    otp_code = db.Column(db.String(6), nullable=True)
    otp_created_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Message limit tracking
    daily_message_count = db.Column(db.Integer, default=0)
    last_message_date = db.Column(db.Date, nullable=True)
    
    chat_sessions = db.relationship('ChatSession', backref='user', lazy=True, cascade='all, delete-orphan')
    
    def set_password(self, password):
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        return check_password_hash(self.password_hash, password)
    
    def generate_otp(self):
        self.otp_code = generate_otp()
        self.otp_created_at = datetime.utcnow()
        db.session.commit()
        return self.otp_code
    
    def verify_otp(self, code):
        if not self.otp_code or not self.otp_created_at:
            return False
        if datetime.utcnow() - self.otp_created_at > timedelta(minutes=10):
            return False
        if self.otp_code == code:
            self.is_verified = True
            self.otp_code = None
            self.otp_created_at = None
            db.session.commit()
            return True
        return False
    
    def get_daily_limit(self):
        """Get message limit based on verification status"""
        if self.is_verified:
            return 30
        else:
            return 18
    
    def check_message_limit(self):
        """Check if user can send message and update counter"""
        today = datetime.utcnow().date()
        
        # Reset counter jika hari berbeda
        if self.last_message_date != today:
            self.daily_message_count = 0
            self.last_message_date = today
        
        limit = self.get_daily_limit()
        
        if self.daily_message_count >= limit:
            return False, f"Limit harian tercapai ({limit} pesan/hari). Reset pada {self._get_reset_time()}"
        
        self.daily_message_count += 1
        db.session.commit()
        return True, ""
    
    def get_remaining_messages(self):
        """Get remaining messages for today"""
        today = datetime.utcnow().date()
        
        if self.last_message_date != today:
            return self.get_daily_limit()
        
        return max(0, self.get_daily_limit() - self.daily_message_count)
    
    def _get_reset_time(self):
        """Get time until counter resets"""
        now = datetime.utcnow()
        tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        delta = tomorrow - now
        hours = delta.seconds // 3600
        minutes = (delta.seconds % 3600) // 60
        return f"{hours} jam {minutes} menit lagi"

class ChatSession(db.Model):
    __tablename__ = 'chat_session'
    id = db.Column(db.String(50), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True, index=True)
    title = db.Column(db.String(200), default='Chat Baru')
    messages = db.Column(db.Text, nullable=False, default='[]')
    history = db.Column(db.Text, nullable=False, default='[]')
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# =====================================================================
# EMAIL
# =====================================================================
def send_otp_email(user, otp):
    html = f"""
    <html>
        <body style="font-family: Arial; padding: 20px; background: #f5f5f5;">
            <div style="max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px;">
                <h2 style="color: #cc785c; text-align: center;">Welcome to Sparq AI! 🎉</h2>
                <p>Hi <strong>{user.username}</strong>,</p>
                <p>Your verification code:</p>
                <div style="background: #f8f8f8; padding: 20px; margin: 30px 0; border-radius: 8px; text-align: center;">
                    <h1 style="color: #cc785c; font-size: 36px; letter-spacing: 8px; font-family: 'Courier New', monospace;">{otp}</h1>
                </div>
                <p style="color: #666;">This code expires in 10 minutes.</p>
            </div>
        </body>
    </html>
    """
    try:
        msg = Message("Your Verification Code - Sparq AI", recipients=[user.email], html=html)
        mail.send(msg)
        return True
    except Exception as e:
        print(f"[EMAIL ERROR] {e}")
        return False

# =====================================================================
# ROUTES
# =====================================================================
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/privacy')
def privacy():
    return render_template('privacy.html')

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/register', methods=['POST'])
@limiter.limit("5 per hour")
def register():
    try:
        data = request.json
        username = data.get('username', '').strip()
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        print(f"[REGISTER] Attempting to register: {username}, {email}")
        
        if not validate_username(username):
            return jsonify({'success': False, 'message': 'Username 3-20 karakter'}), 400
        
        if not validate_email(email):
            return jsonify({'success': False, 'message': 'Email tidak valid'}), 400
        
        is_valid, msg = validate_password(password)
        if not is_valid:
            return jsonify({'success': False, 'message': msg}), 400
        
        if User.query.filter_by(username=username).first():
            return jsonify({'success': False, 'message': 'Username sudah digunakan'}), 400
        
        if User.query.filter_by(email=email).first():
            return jsonify({'success': False, 'message': 'Email sudah terdaftar'}), 400
        
        # Buat user baru
        new_user = User(username=username, email=email, is_verified=False)
        new_user.set_password(password)
        
        print(f"[REGISTER] User object created, adding to DB...")
        db.session.add(new_user)
        db.session.commit()
        print(f"[REGISTER] User saved to DB with ID: {new_user.id}")
        
        # Generate OTP
        otp = new_user.generate_otp()
        print(f"[REGISTER] OTP generated: {otp}")
        
        # Kirim email
        email_sent = send_otp_email(new_user, otp)
        
        if email_sent:
            print(f"[REGISTER] Email sent successfully to {email}")
            return jsonify({
                'success': True,
                'message': 'Kode verifikasi dikirim ke email',
                'user_id': new_user.id,
                'requires_verification': True
            })
        else:
            print(f"[REGISTER WARNING] Email failed but registration success")
            return jsonify({
                'success': True,
                'message': 'Registrasi berhasil (Email gagal dikirim, OTP: ' + otp + ')',
                'user_id': new_user.id,
                'requires_verification': True
            })
            
    except Exception as e:
        db.session.rollback()
        print(f"[REGISTER ERROR] {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'Error: {str(e)}'}), 500

@app.route('/verify_otp', methods=['POST'])
@limiter.limit("10 per minute")
def verify_otp():
    try:
        data = request.json
        user_id = data.get('user_id')
        otp_code = data.get('otp_code', '').strip()
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({'success': False, 'message': 'User tidak ditemukan'}), 404
        
        if user.verify_otp(otp_code):
            login_user(user)
            return jsonify({
                'success': True,
                'message': 'Verifikasi berhasil',
                'user': {'id': user.id, 'username': user.username, 'email': user.email, 'is_verified': True}
            })
        else:
            return jsonify({'success': False, 'message': 'Kode OTP salah atau expired'}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/resend_otp', methods=['POST'])
@limiter.limit("3 per hour")
def resend_otp():
    try:
        data = request.json
        user_id = data.get('user_id')
        user = User.query.get(user_id)
        
        if not user:
            return jsonify({'success': False, 'message': 'User tidak ditemukan'}), 404
        
        otp = user.generate_otp()
        email_sent = send_otp_email(user, otp)
        
        print(f"[RESEND OTP] User: {user.username}, OTP: {otp}")
        
        if email_sent:
            return jsonify({'success': True, 'message': 'Kode OTP baru dikirim'})
        else:
            return jsonify({'success': False, 'message': 'Gagal kirim email'}), 500
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    try:
        data = request.json
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        user = User.query.filter_by(username=username).first()
        
        if not user or not user.check_password(password):
            return jsonify({'success': False, 'message': 'Username atau password salah'}), 401
        
        login_user(user)
        
        return jsonify({
            'success': True,
            'message': 'Login berhasil',
            'user': {'id': user.id, 'username': user.username, 'email': user.email, 'is_verified': user.is_verified}
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/logout', methods=['POST'])
@login_required
def logout():
    # Clear user session history
    session_id = get_user_session_id()
    with sessions_lock:
        if session_id in user_sessions:
            del user_sessions[session_id]
    
    logout_user()
    return jsonify({'success': True})

@app.route('/delete_account', methods=['POST'])
@login_required
def delete_account():
    try:
        # Clear user session history
        session_id = get_user_session_id()
        with sessions_lock:
            if session_id in user_sessions:
                del user_sessions[session_id]
        
        db.session.delete(current_user)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/get_auth_status')
def get_auth_status():
    if current_user.is_authenticated:
        return jsonify({
            'authenticated': True,
            'user': {
                'id': current_user.id,
                'username': current_user.username,
                'email': current_user.email,
                'is_verified': current_user.is_verified,
                'daily_limit': current_user.get_daily_limit(),
                'remaining_messages': current_user.get_remaining_messages()
            }
        })
    else:
        ip = get_remote_address()
        return jsonify({
            'authenticated': False,
            'user': None,
            'guest_limit': 10,
            'guest_remaining': get_guest_remaining(ip)
        })

@app.route('/get_history')
def get_history():
    if not current_user.is_authenticated:
        return jsonify({'sessions': {}})
    sessions = ChatSession.query.filter_by(user_id=current_user.id).all()
    result = {}
    for s in sessions:
        result[s.id] = {'title': s.title, 'messages': json.loads(s.messages), 'history': json.loads(s.history)}
    return jsonify({'sessions': result})

@app.route('/save_session', methods=['POST'])
def save_session():
    try:
        data = request.json
        sid = data.get('id')
        chat_session = ChatSession.query.get(sid)
        
        if chat_session:
            chat_session.title = data.get('title', 'Chat Baru')
            chat_session.messages = json.dumps(data.get('messages', []))
            chat_session.history = json.dumps(data.get('history', []))
            chat_session.updated_at = datetime.utcnow()
            if current_user.is_authenticated and not chat_session.user_id:
                chat_session.user_id = current_user.id
        else:
            chat_session = ChatSession(
                id=sid,
                user_id=current_user.id if current_user.is_authenticated else None,
                title=data.get('title', 'Chat Baru'),
                messages=json.dumps(data.get('messages', [])),
                history=json.dumps(data.get('history', []))
            )
            db.session.add(chat_session)
        
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False}), 500

@app.route('/migrate_sessions', methods=['POST'])
def migrate_sessions():
    if not current_user.is_authenticated:
        return jsonify({'success': False}), 401
    
    try:
        sessions_data = request.json.get('sessions', {})
        migrated = 0
        
        for sid, sdata in sessions_data.items():
            existing = ChatSession.query.get(sid)
            if existing:
                if not existing.user_id:
                    existing.user_id = current_user.id
                    migrated += 1
            else:
                new_s = ChatSession(
                    id=sid,
                    user_id=current_user.id,
                    title=sdata.get('title', 'Chat Baru'),
                    messages=json.dumps(sdata.get('messages', [])),
                    history=json.dumps(sdata.get('history', []))
                )
                db.session.add(new_s)
                migrated += 1
        
        db.session.commit()
        return jsonify({'success': True, 'migrated': migrated})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False}), 500

@app.route('/delete_session', methods=['POST'])
def delete_session():
    try:
        sid = request.json.get('id')
        s = ChatSession.query.get(sid)
        if s:
            db.session.delete(s)
            db.session.commit()
        return jsonify({'success': True})
    except:
        return jsonify({'success': False}), 500

@app.route('/sync_history', methods=['POST'])
def sync_history():
    """Sync history from frontend to backend session"""
    try:
        history = request.json.get('history', [])
        user_session = get_or_create_session()
        
        with user_session['lock']:
            user_session['history'] = history
        
        return jsonify({'status': 'success'})
    except Exception as e:
        print(f"[SYNC ERROR] {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/chat', methods=['POST'])
def chat():
    user_message = request.json.get('message', '')
    
    if not user_message:
        return Response("ERROR_SERVER: Pesan kosong", mimetype='text/plain')
    
    # Check message limit
    if current_user.is_authenticated:
        can_send, error_msg = current_user.check_message_limit()
        if not can_send:
            return Response(f"ERROR_SERVER: {error_msg}", mimetype='text/plain')
    else:
        ip = get_remote_address()
        can_send, error_msg = check_guest_limit(ip)
        if not can_send:
            return Response(f"ERROR_SERVER: {error_msg}", mimetype='text/plain')
    
    # Get isolated user session
    user_session = get_or_create_session()
    
    # Cleanup old sessions periodically
    cleanup_old_sessions()
    
    def generate():
        try:
            # Lock session untuk thread safety
            with user_session['lock']:
                # Tambahkan user message ke history
                user_session['history'].append({'role': 'user', 'parts': [{'text': user_message}]})
                
                # Create isolated model instance with current history
                chat = genai.GenerativeModel('gemini-2.0-flash-exp').start_chat(
                    history=user_session['history'][:-1]
                )
                
                response = chat.send_message(user_message, stream=True)
                full = ""
                
                for chunk in response:
                    if chunk.text:
                        full += chunk.text
                        yield chunk.text
                
                # Tambahkan response ke history
                user_session['history'].append({'role': 'model', 'parts': [{'text': full}]})
                
        except Exception as e:
            yield f"ERROR_SERVER: {str(e)}"
    
    return Response(stream_with_context(generate()), mimetype='text/plain')

@app.route('/regenerate', methods=['POST'])
def regenerate():
    user_session = get_or_create_session()
    
    with user_session['lock']:
        if len(user_session['history']) < 2:
            return Response("ERROR_SERVER: Tidak cukup pesan", mimetype='text/plain')
        
        last_user = user_session['history'][-2]['parts'][0]['text']
        user_session['history'] = user_session['history'][:-2]
    
    def generate():
        try:
            with user_session['lock']:
                chat = genai.GenerativeModel('gemini-2.0-flash-exp').start_chat(
                    history=user_session['history']
                )
                
                response = chat.send_message(last_user, stream=True)
                full = ""
                
                for chunk in response:
                    if chunk.text:
                        full += chunk.text
                        yield chunk.text
                
                user_session['history'].append({'role': 'user', 'parts': [{'text': last_user}]})
                user_session['history'].append({'role': 'model', 'parts': [{'text': full}]})
                
        except Exception as e:
            yield f"ERROR_SERVER: {str(e)}"
    
    return Response(stream_with_context(generate()), mimetype='text/plain')

@app.route('/edit_message', methods=['POST'])
def edit_message():
    try:
        data = request.json
        message_index = data.get('message_index')
        new_text = data.get('new_text', '').strip()
        
        if not new_text:
            return Response("ERROR_SERVER: Pesan kosong", mimetype='text/plain')
        
        user_session = get_or_create_session()
        
        with user_session['lock']:
            history_index = message_index * 2
            user_session['history'] = user_session['history'][:history_index]
            user_session['history'].append({'role': 'user', 'parts': [{'text': new_text}]})
        
        def generate():
            try:
                with user_session['lock']:
                    chat = genai.GenerativeModel('gemini-2.0-flash-exp').start_chat(
                        history=user_session['history'][:-1]
                    )
                    
                    response = chat.send_message(new_text, stream=True)
                    full = ""
                    
                    for chunk in response:
                        if chunk.text:
                            full += chunk.text
                            yield chunk.text
                    
                    user_session['history'].append({'role': 'model', 'parts': [{'text': full}]})
                    
            except Exception as e:
                yield f"ERROR_SERVER: {str(e)}"
        
        return Response(stream_with_context(generate()), mimetype='text/plain')
    except Exception as e:
        return Response(f"ERROR_SERVER: {str(e)}", mimetype='text/plain')

if __name__ == '__main__':
    with app.app_context():
        # Buat tabel kalau belum ada
        print("[DATABASE] Creating tables...")
        db.create_all()
        print("[DATABASE] Tables created successfully!")
    
    app.run(debug=False, port=5000, threaded=True)