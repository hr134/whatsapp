const socket = io();
let activeChatUserId = null;
let peer = null;
let currentCall = null;
let localStream = null;
let incomingCallIsVideo = true;
let currentCallPartnerId = null; // Track who we are in a call with
const currentUserId = window.currentUserId;

// Double checks SVG string for ticks
const checkmarkSVG = `<svg viewBox="0 0 16 11" class="tick-icon"><path d="M15.01 3.316l-2.38-2.38A1.54 1.54 0 0 0 11.52 1.05L5.79 6.78 2.29 3.29A1.55 1.55 0 0 0 .1 5.48l4.6 4.6a1.55 1.55 0 0 0 2.19 0l8.12-8.12a1.54 1.54 0 0 0 0-2.64z"></path></svg>`;
const doubleCheckmarkSVG = `<svg viewBox="0 0 16 15" class="tick-icon"><path d="M15.01 3.316l-2.38-2.38A1.54 1.54 0 0 0 11.52 1.05L5.79 6.78 2.29 3.29A1.55 1.55 0 0 0 .1 5.48l4.6 4.6a1.55 1.55 0 0 0 2.19 0l8.12-8.12a1.54 1.54 0 0 0 0-2.64z"></path><path d="M15.01 3.316l-2.38-2.38A1.54 1.54 0 0 0 11.52 1.05L5.79 6.78 2.29 3.29A1.55 1.55 0 0 0 .1 5.48l4.6 4.6a1.55 1.55 0 0 0 2.19 0l8.12-8.12a1.54 1.54 0 0 0 0-2.64z" transform="translate(4,4)"></path></svg>`;

// PeerJS Setup
peer = new Peer(undefined, {
    debug: 2
});

peer.on('open', (id) => {
    console.log('[PeerJS] My Peer ID: ' + id);
});

peer.on('error', (err) => {
    console.error('[PeerJS] Error:', err);
    alert("Call Error: " + err.type);
    endCallUI();
});

// Handling Incoming Calls (Receiver Side)
peer.on('call', (call) => {
    console.log('[PeerJS] Receiving call from:', call.peer);

    // UI Call Prompt
    document.getElementById('callModal').style.display = 'flex';
    document.getElementById('answerBtn').style.display = 'inline-block';

    if (incomingCallIsVideo) {
        document.getElementById('callStatus').innerText = "Incoming Video Call...";
        document.getElementById('remoteVideo').style.display = 'block';
        document.getElementById('localVideo').style.display = 'block';
    } else {
        document.getElementById('callStatus').innerText = "Incoming Voice Call...";
        document.getElementById('remoteVideo').style.display = 'none';
        document.getElementById('localVideo').style.display = 'none';
    }

    currentCall = call;

    call.on('stream', (remoteStream) => {
        console.log('[PeerJS] Receiver got remote stream');
        const video = document.getElementById('remoteVideo');
        video.srcObject = remoteStream;
        video.onloadedmetadata = () => video.play().catch(e => console.error(e));
        document.getElementById('callStatus').innerText = "Connected";
    });

    call.on('close', () => {
        console.log('[PeerJS] Call closed');
        endCallUI();
    });

    call.on('error', (err) => {
        console.error('[PeerJS] Call error:', err);
        endCallUI();
    });
});


// Socket Events
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('receive_message', (data) => {
    if (activeChatUserId &&
        ((data.sender_id === activeChatUserId && data.receiver_id === currentUserId) ||
            (data.sender_id === currentUserId && data.receiver_id === activeChatUserId))) {

        appendMessage(data);

        // If I received it just now, mark as read
        if (data.sender_id === activeChatUserId) {
            socket.emit('mark_read', { sender_id: activeChatUserId });
        }
    } else {
        loadUsers();
    }
});

socket.on('messages_read', (data) => {
    if (activeChatUserId === data.reader_id) {
        document.querySelectorAll('.tick-icon').forEach(el => el.classList.add('read'));
    }
});

socket.on('call_user', (data) => {
    console.log('[Socket] Received call_user signal:', data);
    const signal = data.signal;
    const fromId = data.from;

    if (signal.type === 'request_id') {
        currentCallPartnerId = fromId; // Set partner
        console.log('[Handshake] Sending my PeerID back to:', fromId);
        incomingCallIsVideo = signal.isVideo;

        socket.emit('call_user', {
            userToCall: fromId,
            signalData: { type: 'response_id', peerId: peer.id },
            from: currentUserId
        });

        // Update UI immediately 
        document.getElementById('callModal').style.display = 'flex';
        document.getElementById('answerBtn').style.display = 'inline-block';
        if (incomingCallIsVideo) {
            document.getElementById('callStatus').innerText = "Incoming Video Call...";
            document.getElementById('remoteVideo').style.display = 'block';
            document.getElementById('localVideo').style.display = 'block';
        } else {
            document.getElementById('callStatus').innerText = "Incoming Voice Call...";
            document.getElementById('remoteVideo').style.display = 'none';
            document.getElementById('localVideo').style.display = 'none';
        }
    }
    else if (signal.type === 'response_id') {
        const targetPeerId = signal.peerId;
        console.log('[Handshake] Got target PeerID:', targetPeerId);

        // Initiate the PeerJS call
        const call = peer.call(targetPeerId, localStream);
        setupCallEvent(call);
        document.getElementById('callStatus').innerText = "Ringing...";
    }
    else if (signal.type === 'end_call') {
        console.log('[Call] Received end_call signal');
        endCallUI();
    }
});


// --- UI Functions ---

async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        const userList = document.getElementById('user-list');
        userList.innerHTML = '';

        if (users.length === 0) {
            userList.innerHTML = '<div style="padding:20px;text-align:center;color:#8696a0;">No other users found.<br>Open a new window and register another user!</div>';
            return;
        }

        users.forEach(user => {
            const div = document.createElement('div');
            div.className = `user-item ${activeChatUserId === user.id ? 'active' : ''}`;
            div.onclick = () => selectUser(user);
            div.dataset.username = user.username.toLowerCase();

            let badge = '';
            if (user.unread > 0) {
                badge = `<div class="unread-badge">${user.unread}</div>`;
            }

            div.innerHTML = `
                <div class="user-info-left">
                    <div class="user-avatar" style="background-image: url('${user.avatar_url || 'https://www.w3schools.com/w3images/avatar2.png'}');"></div>
                    <div>
                        <div style="font-weight:500;">${user.username}</div>
                        <div style="font-size:12px;color:#667781;">${user.about || ''}</div>
                    </div>
                </div>
                ${badge}
            `;
            userList.appendChild(div);
        });

        filterUsers();

    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function ensureFeedbackElements() {
    let noResults = document.getElementById('no-search-results');
    if (!noResults) {
        noResults = document.createElement('div');
        noResults.id = 'no-search-results';
        noResults.style.padding = '20px';
        noResults.style.textAlign = 'center';
        noResults.style.color = '#8696a0';
        noResults.style.display = 'none';
        noResults.innerText = 'No chats found';
        document.getElementById('user-list').after(noResults);
    }
}

function filterUsers() {
    ensureFeedbackElements();
    const input = document.getElementById('user-search-input');
    if (!input) return;

    const filter = input.value.toLowerCase();
    const userNodes = document.querySelectorAll('.user-item');
    let hasVisible = false;

    userNodes.forEach(node => {
        const username = node.dataset.username || "";
        if (username.indexOf(filter) > -1) {
            node.style.display = "flex";
            hasVisible = true;
        } else {
            node.style.display = "none";
        }
    });

    const noResults = document.getElementById('no-search-results');
    if (!hasVisible && userNodes.length > 0) {
        noResults.style.display = 'block';
    } else {
        noResults.style.display = 'none';
    }
}

const searchInput = document.getElementById('user-search-input');
if (searchInput) {
    searchInput.addEventListener('input', filterUsers);
}

async function selectUser(user) {
    activeChatUserId = user.id;
    document.getElementById('chat-header').style.display = 'flex';
    document.getElementById('input-area').style.display = 'flex';
    document.getElementById('chat-title').innerText = user.username;
    document.getElementById('chat-avatar').style.backgroundImage = `url('${user.avatar_url || 'https://www.w3schools.com/w3images/avatar2.png'}')`;

    await loadMessages(user.id);

    socket.emit('mark_read', { sender_id: activeChatUserId });
    loadUsers();
}

async function loadMessages(otherUserId) {
    const response = await fetch(`/api/messages/${otherUserId}`);
    const messages = await response.json();
    const messagesArea = document.getElementById('messages-area');
    messagesArea.innerHTML = '';

    messages.forEach(msg => {
        appendMessage(msg);
    });
    scrollToBottom();
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content || !activeChatUserId) return;

    socket.emit('send_message', {
        receiver_id: activeChatUserId,
        content: content
    });

    input.value = '';
}

function appendMessage(msg) {
    const messagesArea = document.getElementById('messages-area');
    const div = document.createElement('div');
    const isSent = msg.sender_id === currentUserId;

    div.className = `message ${isSent ? 'sent' : 'received'}`;
    const date = new Date(msg.timestamp);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let tickHtml = '';
    if (isSent) {
        const tickClass = msg.is_read ? 'tick-icon read' : 'tick-icon';
        const doubleCheckmarkSVG = `<svg viewBox="0 0 16 15" class="${tickClass}" width="16" height="15"><path fill="currentColor" d="M15.01 3.316l-2.38-2.38A1.54 1.54 0 0 0 11.52 1.05L5.79 6.78 2.29 3.29A1.55 1.55 0 0 0 .1 5.48l4.6 4.6a1.55 1.55 0 0 0 2.19 0l8.12-8.12a1.54 1.54 0 0 0 0-2.64z"></path><path fill="currentColor" d="M15.01 3.316l-2.38-2.38A1.54 1.54 0 0 0 11.52 1.05L5.79 6.78 2.29 3.29A1.55 1.55 0 0 0 .1 5.48l4.6 4.6a1.55 1.55 0 0 0 2.19 0l8.12-8.12a1.54 1.54 0 0 0 0-2.64z" transform="translate(4,4)"></path></svg>`;
        tickHtml = doubleCheckmarkSVG;
    }

    div.innerHTML = `
        ${msg.content}
        <div class="message-meta">
            <span class="message-time">${timeStr}</span>
            ${tickHtml}
        </div>
    `;
    messagesArea.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    const messagesArea = document.getElementById('messages-area');
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function openProfileModal() {
    document.getElementById('profileModal').style.display = 'flex';
}
function closeProfileModal() {
    document.getElementById('profileModal').style.display = 'none';
}

function startCallHandshake(isVideo) {
    if (!activeChatUserId) return;
    currentCallPartnerId = activeChatUserId; // Set partner

    console.log('[Call] Starting call to:', activeChatUserId, 'Video:', isVideo);

    document.getElementById('callModal').style.display = 'flex';
    document.getElementById('callStatus').innerText = "Connecting...";
    document.getElementById('answerBtn').style.display = 'none';

    const remoteVideo = document.getElementById('remoteVideo');
    const localVideo = document.getElementById('localVideo');
    if (!isVideo) {
        remoteVideo.style.display = 'none';
        localVideo.style.display = 'none';
    } else {
        remoteVideo.style.display = 'block';
        localVideo.style.display = 'block';
    }

    navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true }).then(stream => {
        localStream = stream;

        if (isVideo) {
            localVideo.srcObject = stream;
            localVideo.onloadedmetadata = () => localVideo.play();
        }

        socket.emit('call_user', {
            userToCall: activeChatUserId,
            signalData: { type: 'request_id', isVideo: isVideo },
            from: currentUserId
        });

    }).catch(err => {
        console.error('[Call] Failed to get local stream:', err);
        alert("Could not access camera/microphone. Check permissions.");
        endCallUI();
    });
}

function answerCall() {
    if (!incomingCallIsVideo && !currentCall) return;
    if (!currentCall && incomingCallIsVideo) return;

    console.log('[Call] Answering with Video:', incomingCallIsVideo);

    navigator.mediaDevices.getUserMedia({ video: incomingCallIsVideo, audio: true }).then(stream => {
        localStream = stream;

        if (incomingCallIsVideo) {
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = stream;
            localVideo.onloadedmetadata = () => localVideo.play();
        }

        currentCall.answer(stream);

        document.getElementById('answerBtn').style.display = 'none';
        document.getElementById('callStatus').innerText = "Connected";

    }).catch(err => {
        console.error('[Call] Failed to get local stream for answer:', err);
        alert("Could not access camera/microphone.");
    });
}

function setupCallEvent(call) {
    currentCall = call;

    call.on('stream', (remoteStream) => {
        console.log('[PeerJS] Caller got remote stream');
        const video = document.getElementById('remoteVideo');
        video.srcObject = remoteStream;
        video.onloadedmetadata = () => video.play().catch(e => console.error(e));
        document.getElementById('callStatus').innerText = "Connected";
    });

    call.on('close', () => {
        console.log('[PeerJS] Call closed');
        endCallUI();
    });

    call.on('error', (err) => {
        console.error('[PeerJS] Call error inside setup:', err);
        endCallUI();
    });
}

function endCall() {
    console.log('[Call] Ending call');

    // Emit end_call signal to partner
    if (currentCallPartnerId) {
        console.log('[Call] Sending end_call signal to:', currentCallPartnerId);
        socket.emit('call_user', {
            userToCall: currentCallPartnerId,
            signalData: { type: 'end_call' },
            from: currentUserId
        });
    }

    if (currentCall) currentCall.close();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    endCallUI();
}

function endCallUI() {
    document.getElementById('callModal').style.display = 'none';
    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('localVideo').srcObject = null;
    currentCall = null;
    localStream = null;
    currentCallPartnerId = null;
}

window.startCall = startCallHandshake;

document.getElementById('message-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

loadUsers();
