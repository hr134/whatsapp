from flask import Flask, render_template, request, session, redirect, url_for, jsonify
from extensions import db, socketio
from models import User, Message
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!' # Change this in production
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///whatsapp.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)
socketio.init_app(app)

@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('index.html', user_id=session['user_id'], username=session.get('username'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        # Simple auth for demo
        user = User.query.filter_by(username=username).first()
        if user and user.password == password:
            session['user_id'] = user.id
            session['username'] = user.username
            return redirect(url_for('index'))
        else:
            return "Invalid credentials"
    return render_template('auth.html')

@app.route('/register', methods=['POST'])
def register():
    username = request.form.get('username')
    password = request.form.get('password')
    if User.query.filter_by(username=username).first():
        return "User already exists"
    
    new_user = User(username=username, password=password)
    db.session.add(new_user)
    db.session.commit()
    session['user_id'] = new_user.id
    session['username'] = new_user.username
    return redirect(url_for('index'))

@app.route('/logout')
def logout():
    session.pop('user_id', None)
    session.pop('username', None)
    return redirect(url_for('login'))

@app.route('/edit_profile', methods=['POST'])
def edit_profile():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    
    user = User.query.get(session['user_id'])
    user.about = request.form.get('about', user.about)
    # user.avatar_url = ... (Implement file upload if needed, simpler to just use text for now or random)
    db.session.commit()
    return redirect(url_for('index'))

@app.route('/api/users')
def get_users():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    current_user_id = session['user_id']
    users = User.query.filter(User.id != current_user_id).all()
    
    # Calculate unread counts
    users_data = []
    for u in users:
        unread_count = Message.query.filter_by(sender_id=u.id, receiver_id=current_user_id, is_read=False).count()
        u_dict = u.to_dict()
        u_dict['unread'] = unread_count
        users_data.append(u_dict)
        
    return jsonify(users_data)

@app.route('/api/messages/<int:other_user_id>')
def get_messages(other_user_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401
    
    current_user_id = session['user_id']
    
    messages = Message.query.filter(
        ((Message.sender_id == current_user_id) & (Message.receiver_id == other_user_id)) |
        ((Message.sender_id == other_user_id) & (Message.receiver_id == current_user_id))
    ).order_by(Message.timestamp.asc()).all()
    
    # Mark as read
    Message.query.filter_by(sender_id=other_user_id, receiver_id=current_user_id, is_read=False).update({'is_read': True})
    db.session.commit()
    
    return jsonify([m.to_dict() for m in messages])

# SocketIO Events
@socketio.on('connect')
def handle_connect():
    if 'user_id' in session:
        # Join a room specific to this user so we can send private messages/calls
        from flask_socketio import join_room
        join_room(f"user_{session['user_id']}")
        print(f"User {session['user_id']} connected and joined room user_{session['user_id']}")

@socketio.on('send_message')
def handle_send_message(data):
    sender_id = session.get('user_id')
    if not sender_id:
        return
    
    receiver_id = data.get('receiver_id')
    content = data.get('content')
    
    new_message = Message(sender_id=sender_id, receiver_id=receiver_id, content=content)
    db.session.add(new_message)
    db.session.commit()
    
    # Emit to receiver specific room
    socketio.emit('receive_message', new_message.to_dict(), room=f"user_{receiver_id}")
    # Emit back to sender (to show in their view)
    socketio.emit('receive_message', new_message.to_dict(), room=f"user_{sender_id}")

@socketio.on('mark_read')
def handle_mark_read(data):
    # When user opens chat, they tell server they read messages from X
    sender_id = data.get('sender_id') # The person who SENT the messages
    receiver_id = session.get('user_id') # The person READING now
    
    if not sender_id or not receiver_id:
        return

    # Update DB
    Message.query.filter_by(sender_id=sender_id, receiver_id=receiver_id, is_read=False).update({'is_read': True})
    db.session.commit()
    
    # Notify the ORIGINAL sender that their messages are read
    socketio.emit('messages_read', {'reader_id': receiver_id, 'sender_id': sender_id}, room=f"user_{sender_id}")

# WebRTC Signaling
@socketio.on('call_user')
def handle_call_user(data):
    # data: { userToCall: id, signalData: ..., from: id }
    target_id = data.get('userToCall')
    socketio.emit('call_user', {
        'signal': data.get('signalData'), 
        'from': data.get('from'),
        'from_username': session.get('username')
    }, room=f"user_{target_id}")

@socketio.on('answer_call')
def handle_answer_call(data):
    # data: { to: id, signal: ... }
    target_id = data.get('to')
    socketio.emit('call_accepted', data.get('signal'), room=f"user_{target_id}")

if __name__ == '__main__':
    import os
    with app.app_context():
        db.create_all()
    port = int(os.environ.get("PORT", 5001))
    socketio.run(app, debug=True, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)
