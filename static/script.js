// GLOBAL VARIABLES
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const errorMessage = document.getElementById('errorMessage');
const welcomeCenter = document.getElementById('welcomeCenter');
const darkModeToggle = document.getElementById('darkModeToggle');
const historyList = document.getElementById('historyList');
const newChatBtn = document.getElementById('newChatBtn');

const loginModal = document.getElementById('loginModal');
const registerModal = document.getElementById('registerModal');
const settingsModal = document.getElementById('settingsModal');
const otpModal = document.getElementById('otpModal');
const sidebarLoginBtn = document.getElementById('sidebarLoginBtn');
const sidebarSettingsBtn = document.getElementById('sidebarSettingsBtn');
const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
const closeLogin = document.getElementById('closeLogin');
const closeRegister = document.getElementById('closeRegister');
const closeSettings = document.getElementById('closeSettings');
const switchToRegister = document.getElementById('switchToRegister');
const switchToLogin = document.getElementById('switchToLogin');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const otpForm = document.getElementById('otpForm');
const otpInput = document.getElementById('otpInput');
const otpEmail = document.getElementById('otpEmail');
const resendOtpBtn = document.getElementById('resendOtpBtn');
const sidebarAuthButtons = document.getElementById('sidebarAuthButtons');
const sidebarUserInfo = document.getElementById('sidebarUserInfo');
const sidebarUsername = document.getElementById('sidebarUsername');
const sidebarUserEmail = document.getElementById('sidebarUserEmail');
const sidebarUserInitial = document.getElementById('sidebarUserInitial');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const settingsUsername = document.getElementById('settingsUsername');
const settingsEmail = document.getElementById('settingsEmail');
const settingsVerified = document.getElementById('settingsVerified');
const messageLimitInfo = document.getElementById('messageLimitInfo');

let isChatStarted = false;
let currentChatId = null;
let chatSessions = {};
let isAuthenticated = false;
let currentUser = null;
let pendingUserId = null;
let remainingMessages = 0;
let dailyLimit = 0;

// HELPER FUNCTIONS
function showError(msg) {
    errorMessage.style.color = '#d32f2f';
    errorMessage.textContent = msg;
    setTimeout(() => { errorMessage.textContent = ''; }, 5000);
}

function showSuccess(msg) {
    errorMessage.style.color = '#4caf50';
    errorMessage.textContent = msg;
    setTimeout(() => { errorMessage.textContent = ''; errorMessage.style.color = '#d32f2f'; }, 3000);
}

function applyTheme(isDark) {
    document.body.classList.toggle('dark-mode', isDark);
    darkModeToggle.textContent = isDark ? '💡' : '🌙';
}

function loadTheme() {
    const theme = localStorage.getItem('theme');
    if (theme === 'dark') applyTheme(true);
    else if (theme === 'light') applyTheme(false);
    else applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(err => showError('Gagal copy'));
}

function addCopyButtons(container) {
    container.querySelectorAll('.ai-message pre code').forEach(code => {
        if (code.parentElement.querySelector('.copy-button')) return;
        const btn = document.createElement('button');
        btn.className = 'copy-button';
        btn.textContent = 'Copy';
        btn.onclick = () => {
            copyToClipboard(code.textContent);
            btn.textContent = 'Copied';
            setTimeout(() => btn.textContent = 'Copy', 2000);
        };
        code.parentElement.appendChild(btn);
    });
}

function addActionButtons(msgGroup) {
    if (msgGroup.querySelector('.message-actions')) return;
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    
    const regen = document.createElement('button');
    regen.className = 'action-btn regenerate-btn';
    regen.innerHTML = 'Retry';
    regen.title = 'Regenerate';
    regen.onclick = () => regenerateMessage();
    
    const copy = document.createElement('button');
    copy.className = 'action-btn copy-all-btn';
    copy.innerHTML = 'Copy';
    copy.title = 'Copy';
    copy.onclick = () => {
        const text = msgGroup.querySelector('.message-content').textContent;
        copyToClipboard(text);
        copy.innerHTML = '✓';
        setTimeout(() => copy.innerHTML = '📋', 2000);
    };
    
    actions.appendChild(regen);
    actions.appendChild(copy);
    msgGroup.appendChild(actions);
}

function addEditButton(msgGroup, messageIndex) {
    if (msgGroup.querySelector('.edit-btn')) return;
    
    const actions = msgGroup.querySelector('.message-actions') || document.createElement('div');
    if (!msgGroup.querySelector('.message-actions')) {
        actions.className = 'message-actions';
        msgGroup.appendChild(actions);
    }
    
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn edit-btn';
    editBtn.innerHTML = 'Edit message';
    editBtn.title = 'Edit Message';
    editBtn.onclick = () => editMessage(msgGroup, messageIndex);
    
    actions.insertBefore(editBtn, actions.firstChild);
}

function createStreamingMessage() {
    const group = document.createElement('div');
    group.className = 'message-group ai-message';
    group.innerHTML = `
        <div class="message-header">
            <div class="message-avatar ai-avatar"><img src="/static/img1.png" alt="AI"></div>
            <span class="message-name">Sparq</span>
        </div>
        <div class="message-content"></div>
    `;
    chatContainer.appendChild(group);
    document.querySelector('.chat-wrapper').scrollTop = 999999;
    return group;
}

// AUTH FUNCTIONS
async function checkAuthStatus() {
    try {
        const res = await fetch('/get_auth_status');
        const data = await res.json();
        if (data.authenticated) {
            isAuthenticated = true;
            currentUser = data.user;
            remainingMessages = data.user.remaining_messages;
            dailyLimit = data.user.daily_limit;
            updateUIForAuth(true);
            updateMessageLimitDisplay();
            await migrateLocalSessionsToServer();
            await loadChatSessionsFromServer();
        } else {
            isAuthenticated = false;
            currentUser = null;
            remainingMessages = data.guest_remaining;
            dailyLimit = data.guest_limit;
            updateUIForAuth(false);
            updateMessageLimitDisplay();
            loadChatSessionsFromLocalStorage();
        }
    } catch (err) {
        console.error('Auth check error:', err);
        isAuthenticated = false;
        updateUIForAuth(false);
        loadChatSessionsFromLocalStorage();
    }
}

function updateMessageLimitDisplay() {
    if (isAuthenticated) {
        const verifiedText = currentUser.is_verified ? '✓ Verified' : '⚠ Not Verified';
        messageLimitInfo.innerHTML = `${verifiedText} | ${remainingMessages}/${dailyLimit} messages left today`;
        messageLimitInfo.style.color = remainingMessages > 5 ? 'var(--color-hint)' : '#ff9800';
    } else {
        messageLimitInfo.innerHTML = `Guest | ${remainingMessages}/${dailyLimit} messages left today`;
        messageLimitInfo.style.color = remainingMessages > 3 ? 'var(--color-hint)' : '#ff9800';
    }
}

function updateUIForAuth(authed) {
    if (authed) {
        sidebarAuthButtons.style.display = 'none';
        sidebarUserInfo.style.display = 'block';
        sidebarUsername.textContent = currentUser.username;
        sidebarUserEmail.textContent = currentUser.email;
        sidebarUserInitial.textContent = currentUser.username.charAt(0).toUpperCase();
    } else {
        sidebarAuthButtons.style.display = 'block';
        sidebarUserInfo.style.display = 'none';
    }
}

function openModal(modal) { modal.style.display = 'block'; }
function closeModal(modal) { modal.style.display = 'none'; }

// MODAL EVENTS
sidebarLoginBtn.onclick = () => openModal(loginModal);
closeLogin.onclick = () => closeModal(loginModal);
closeRegister.onclick = () => closeModal(registerModal);
closeSettings.onclick = () => closeModal(settingsModal);

switchToRegister.onclick = (e) => {
    e.preventDefault();
    closeModal(loginModal);
    openModal(registerModal);
};

switchToLogin.onclick = (e) => {
    e.preventDefault();
    closeModal(registerModal);
    openModal(loginModal);
};

window.onclick = (e) => {
    if (e.target === loginModal) closeModal(loginModal);
    if (e.target === registerModal) closeModal(registerModal);
    if (e.target === settingsModal) closeModal(settingsModal);
    if (e.target === otpModal) closeModal(otpModal);
};

sidebarSettingsBtn.onclick = () => {
    if (isAuthenticated && currentUser) {
        settingsUsername.textContent = currentUser.username;
        settingsEmail.textContent = currentUser.email;
        settingsVerified.textContent = currentUser.is_verified ? '✓ Verified' : '⚠ Not Verified';
        settingsVerified.style.color = currentUser.is_verified ? '#4caf50' : '#ff9800';
        openModal(settingsModal);
    } else {
        showError('Login dulu');
    }
};

// AUTH HANDLERS
loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    try {
        const res = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        
        if (data.success) {
            closeModal(loginModal);
            showSuccess('Login berhasil!');
            isAuthenticated = true;
            currentUser = data.user;
            updateUIForAuth(true);
            loginForm.reset();
            await migrateLocalSessionsToServer();
            await loadChatSessionsFromServer();
        } else {
            showError(data.message);
        }
    } catch (err) {
        showError('Error login');
    }
};

registerForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    
    try {
        const res = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });
        const data = await res.json();
        
        if (data.success && data.requires_verification) {
            closeModal(registerModal);
            registerForm.reset();
            pendingUserId = data.user_id;
            otpEmail.textContent = email;
            otpInput.value = '';
            openModal(otpModal);
            otpInput.focus();
            showSuccess(data.message);
        } else {
            showError(data.message);
        }
    } catch (err) {
        showError('Error register');
    }
};

otpForm.onsubmit = async (e) => {
    e.preventDefault();
    const otpCode = otpInput.value.trim();
    
    if (otpCode.length !== 6) {
        showError('Kode OTP harus 6 digit');
        return;
    }
    
    try {
        const res = await fetch('/verify_otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: pendingUserId, otp_code: otpCode })
        });
        const data = await res.json();
        
        if (data.success) {
            closeModal(otpModal);
            showSuccess('Verifikasi berhasil!');
            isAuthenticated = true;
            currentUser = data.user;
            updateUIForAuth(true);
            await migrateLocalSessionsToServer();
            await loadChatSessionsFromServer();
            pendingUserId = null;
        } else {
            showError(data.message);
        }
    } catch (err) {
        showError('Error verifikasi OTP');
    }
};

resendOtpBtn.onclick = async () => {
    if (!pendingUserId) return;
    
    try {
        const res = await fetch('/resend_otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: pendingUserId })
        });
        const data = await res.json();
        
        if (data.success) {
            showSuccess(data.message);
            otpInput.value = '';
            otpInput.focus();
        } else {
            showError(data.message);
        }
    } catch (err) {
        showError('Error kirim ulang OTP');
    }
};

sidebarLogoutBtn.onclick = async () => {
    try {
        await fetch('/logout', { method: 'POST' });
        isAuthenticated = false;
        currentUser = null;
        updateUIForAuth(false);
        showSuccess('Logout berhasil');
        loadChatSessionsFromLocalStorage();
    } catch (err) {
        showError('Error logout');
    }
};

deleteAccountBtn.onclick = async () => {
    if (!confirm('⚠️ Yakin hapus akun?')) return;
    const confirm2 = prompt('Ketik "DELETE" untuk konfirmasi:');
    if (confirm2 !== 'DELETE') return;
    
    try {
        const res = await fetch('/delete_account', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            closeModal(settingsModal);
            showSuccess('Akun berhasil dihapus');
            isAuthenticated = false;
            currentUser = null;
            updateUIForAuth(false);
            chatSessions = {};
            startNewChat();
        }
    } catch (err) {
        showError('Error hapus akun');
    }
};

// MIGRATION
async function migrateLocalSessionsToServer() {
    if (!isAuthenticated) return;
    const local = localStorage.getItem('chatSessions');
    if (!local) return;
    
    try {
        const sessions = JSON.parse(local);
        if (Object.keys(sessions).length === 0) return;
        
        const res = await fetch('/migrate_sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessions })
        });
        const data = await res.json();
        
        if (data.success) {
            localStorage.removeItem('chatSessions');
            showSuccess(`${data.migrated} chat dimigrate`);
        }
    } catch (err) {
        console.error('Migrate error:', err);
    }
}

// CHAT SESSIONS
function loadChatSessionsFromLocalStorage() {
    const stored = localStorage.getItem('chatSessions');
    chatSessions = stored ? JSON.parse(stored) : {};
    
    if (Object.keys(chatSessions).length === 0) {
        startNewChat();
    } else {
        const ids = Object.keys(chatSessions).sort((a, b) => b - a);
        loadChat(ids[0]);
    }
}

function saveChatSessionsToLocalStorage() {
    localStorage.setItem('chatSessions', JSON.stringify(chatSessions));
}

async function loadChatSessionsFromServer() {
    if (!isAuthenticated) return;
    
    try {
        const res = await fetch('/get_history');
        const data = await res.json();
        chatSessions = data.sessions || {};
        
        if (Object.keys(chatSessions).length === 0) {
            startNewChat();
        } else {
            const ids = Object.keys(chatSessions).sort((a, b) => b - a);
            loadChat(ids[0]);
        }
    } catch (err) {
        showError('Gagal load history');
    }
}

async function saveChatSessionToServer(sid) {
    if (!isAuthenticated) {
        saveChatSessionsToLocalStorage();
        return;
    }
    
    const session = chatSessions[sid];
    if (!session) return;
    
    try {
        await fetch('/save_session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: sid,
                title: session.title,
                messages: session.messages,
                history: session.history
            })
        });
    } catch (err) {
        console.error('Save error:', err);
    }
}

function saveChatSessions() {
    if (isAuthenticated) {
        if (currentChatId) saveChatSessionToServer(currentChatId);
    } else {
        saveChatSessionsToLocalStorage();
    }
}

// CHAT FUNCTIONS
function addMessage(text, isUser, persist = true, addBtns = false, messageIndex = null) {
    const group = document.createElement('div');
    group.className = `message-group ${isUser ? 'user-message' : 'ai-message'}`;
    
    const avatar = isUser ? '👤' : '<img src="/static/img1.png" alt="AI">';
    const name = isUser ? 'You' : 'Sparq';
    
    group.innerHTML = `
        <div class="message-header">
            <div class="message-avatar ${isUser ? 'user-avatar' : 'ai-avatar'}">${avatar}</div>
            <span class="message-name">${name}</span>
        </div>
        <div class="message-content">${isUser || persist ? text : ''}</div>
    `;
    
    chatContainer.appendChild(group);
    
    if (!isUser && !persist) {
        const content = group.querySelector('.message-content');
        content.innerHTML = marked.parse(text);
        
        // Highlight ONLY code blocks (exclude math)
        content.querySelectorAll('pre code').forEach(block => {
            // Skip jika bukan code block (misal math block)
            const className = block.className || '';
            if (!className.includes('language-math') && !className.includes('math')) {
                if (typeof hljs !== 'undefined') hljs.highlightElement(block);
            }
        });
        
        addCopyButtons(group);
        
        // Render MathJax SETELAH DOM ready
        setTimeout(() => {
            if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
                MathJax.typesetPromise([content]).catch(err => {
                    console.warn('MathJax render error:', err);
                });
            }
        }, 100);
    }
    
    if (!isUser && addBtns) addActionButtons(group);
    
    if (isUser && messageIndex !== null) {
        addEditButton(group, messageIndex);
    }
    
    document.querySelector('.chat-wrapper').scrollTop = 999999;
    
    if (persist && isUser && currentChatId) {
        const session = chatSessions[currentChatId];
        session.messages.push({ text, isUser });
        session.history.push({ role: 'user', parts: [{ text }] });
        
        if (session.messages.length === 1) {
            session.title = text.substring(0, 30) + (text.length > 30 ? '...' : '');
            renderHistoryList();
        }
        saveChatSessions();
    }
}

async function editMessage(msgGroup, messageIndex) {
    const contentDiv = msgGroup.querySelector('.message-content');
    const originalText = contentDiv.textContent;
    
    contentDiv.innerHTML = `
        <textarea class="edit-textarea" style="width: 100%; min-height: 60px; padding: 10px; border: 1.5px solid var(--color-accent); border-radius: 6px; background: var(--color-bg-primary); color: var(--color-text-primary); font-family: inherit; font-size: 14px; resize: vertical;">${originalText}</textarea>
        <div style="margin-top: 10px; display: flex; gap: 8px;">
            <button class="action-btn save-edit-btn" style="background: var(--color-accent); color: white; border: none;">Save</button>
            <button class="action-btn cancel-edit-btn">Cancel</button>
        </div>
    `;
    
    const textarea = contentDiv.querySelector('.edit-textarea');
    const saveBtn = contentDiv.querySelector('.save-edit-btn');
    const cancelBtn = contentDiv.querySelector('.cancel-edit-btn');
    
    textarea.focus();
    
    cancelBtn.onclick = () => {
        contentDiv.textContent = originalText;
    };
    
    saveBtn.onclick = async () => {
        const newText = textarea.value.trim();
        if (!newText) {
            showError('Pesan tidak boleh kosong');
            return;
        }
        
        if (newText === originalText) {
            contentDiv.textContent = originalText;
            return;
        }
        
        contentDiv.textContent = newText;
        
        const allGroups = Array.from(chatContainer.querySelectorAll('.message-group'));
        const currentIndex = allGroups.indexOf(msgGroup);
        
        for (let i = allGroups.length - 1; i > currentIndex; i--) {
            allGroups[i].remove();
        }
        
        if (currentChatId) {
            const session = chatSessions[currentChatId];
            session.messages = session.messages.slice(0, messageIndex + 1);
            session.messages[messageIndex].text = newText;
            session.history = session.history.slice(0, (messageIndex + 1) * 2);
            session.history[messageIndex * 2] = { role: 'user', parts: [{ text: newText }] };
            saveChatSessions();
        }
        
        const streamGroup = createStreamingMessage();
        const aiContent = streamGroup.querySelector('.message-content');
        let fullText = '';
        
        try {
            const res = await fetch('/edit_message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message_index: messageIndex, new_text: newText })
            });
            
            if (!res.ok || !res.body) throw new Error('HTTP Error');
            
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let done = false;
            
            const textNode = document.createTextNode('');
            aiContent.appendChild(textNode);
            
            while (!done) {
                const { value, done: doneReading } = await reader.read();
                done = doneReading;
                
                if (value) {
                    const chunk = decoder.decode(value);
                    if (chunk.startsWith('ERROR_SERVER:')) throw new Error(chunk.replace('ERROR_SERVER: ', ''));
                    fullText += chunk;
                    textNode.textContent = fullText;
                    document.querySelector('.chat-wrapper').scrollTop = 999999;
                }
            }
            
            if (currentChatId && fullText) {
                const session = chatSessions[currentChatId];
                session.messages.push({ text: fullText, isUser: false });
                session.history.push({ role: 'model', parts: [{ text: fullText }] });
                saveChatSessions();
            }
            
            aiContent.removeChild(textNode);
            aiContent.innerHTML = marked.parse(fullText);
            
            // Highlight code
            aiContent.querySelectorAll('pre code').forEach(block => {
                if (typeof hljs !== 'undefined') hljs.highlightElement(block);
            });
            
            addCopyButtons(streamGroup);
            addActionButtons(streamGroup);
            
            // Render MathJax
            setTimeout(() => {
                if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
                    MathJax.typesetPromise([aiContent]).catch(err => {
                        console.warn('MathJax render error:', err);
                    });
                }
            }, 100);
            
            document.querySelector('.chat-wrapper').scrollTop = 999999;
            
            showSuccess('Pesan berhasil diedit');
            
        } catch (err) {
            showError('Error: ' + err.message);
            aiContent.textContent = 'Error: ' + err.message;
            aiContent.style.color = 'red';
        }
    };
}

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    
    if (!isChatStarted) {
        welcomeCenter.style.opacity = '0';
        setTimeout(() => welcomeCenter.classList.add('hidden'), 300);
        isChatStarted = true;
    }
    
    const session = chatSessions[currentChatId];
    const currentMessageIndex = session ? Math.floor(session.messages.length / 2) : 0;
    
    addMessage(text, true, true, false, currentMessageIndex);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;
    
    const streamGroup = createStreamingMessage();
    const aiContent = streamGroup.querySelector('.message-content');
    let fullText = '';
    
    try {
        const res = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        
        if (!res.ok || !res.body) throw new Error('HTTP Error');
        
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        
        const textNode = document.createTextNode('');
        aiContent.appendChild(textNode);
        
        while (!done) {
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            
            if (value) {
                const chunk = decoder.decode(value);
                if (chunk.startsWith('ERROR_SERVER:')) throw new Error(chunk.replace('ERROR_SERVER: ', ''));
                fullText += chunk;
                textNode.textContent = fullText;
                document.querySelector('.chat-wrapper').scrollTop = 999999;
            }
        }
        
        if (currentChatId && fullText) {
            const session = chatSessions[currentChatId];
            session.messages.push({ text: fullText, isUser: false });
            session.history.push({ role: 'model', parts: [{ text: fullText }] });
            saveChatSessions();
        }
        
        aiContent.removeChild(textNode);
        aiContent.innerHTML = marked.parse(fullText);
        
        // Highlight code blocks
        aiContent.querySelectorAll('pre code').forEach(block => {
            if (typeof hljs !== 'undefined') hljs.highlightElement(block);
        });
        
        addCopyButtons(streamGroup);
        addActionButtons(streamGroup);
        
        // Render MathJax setelah semua selesai
        setTimeout(() => {
            if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
                MathJax.typesetPromise([aiContent]).catch(err => {
                    console.warn('MathJax render error:', err);
                });
            }
        }, 100);
        
        document.querySelector('.chat-wrapper').scrollTop = 999999;
        
        // Update limit display
        remainingMessages--;
        updateMessageLimitDisplay();
        
    } catch (err) {
        showError('Error: ' + err.message);
        aiContent.textContent = 'Error: ' + err.message;
        aiContent.style.color = 'red';
    }
}

async function regenerateMessage() {
    if (!currentChatId) {
        showError('Tidak ada chat aktif');
        return;
    }
    
    const session = chatSessions[currentChatId];
    if (session.messages.length < 2) {
        showError('Tidak ada pesan untuk regenerate');
        return;
    }
    
    const lastMsg = session.messages[session.messages.length - 1];
    if (lastMsg.isUser) {
        showError('Pesan terakhir bukan dari AI');
        return;
    }
    
    await syncHistoryWithServer(session.history);
    await new Promise(r => setTimeout(r, 100));
    
    const userMsg = session.messages[session.messages.length - 2];
    
    const groups = chatContainer.querySelectorAll('.message-group');
    if (groups.length >= 2) {
        groups[groups.length - 1].remove();
        groups[groups.length - 2].remove();
    }
    
    session.messages.pop();
    session.messages.pop();
    session.history.pop();
    session.history.pop();
    saveChatSessions();
    
    addMessage(userMsg.text, true);
    
    const streamGroup = createStreamingMessage();
    const aiContent = streamGroup.querySelector('.message-content');
    let fullText = '';
    
    try {
        const res = await fetch('/regenerate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        
        if (!res.ok || !res.body) throw new Error('HTTP Error');
        
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        
        const textNode = document.createTextNode('');
        aiContent.appendChild(textNode);
        
        while (!done) {
            const { value, done: doneReading } = await reader.read();
            done = doneReading;
            
            if (value) {
                const chunk = decoder.decode(value);
                if (chunk.startsWith('ERROR_SERVER:')) throw new Error(chunk.replace('ERROR_SERVER: ', ''));
                fullText += chunk;
                textNode.textContent = fullText;
                document.querySelector('.chat-wrapper').scrollTop = 999999;
            }
        }
        
        if (currentChatId && fullText) {
            const session = chatSessions[currentChatId];
            session.messages.push({ text: fullText, isUser: false });
            session.history.push({ role: 'model', parts: [{ text: fullText }] });
            saveChatSessions();
        }
        
        aiContent.removeChild(textNode);
        aiContent.innerHTML = marked.parse(fullText);
        
        // Highlight code
        aiContent.querySelectorAll('pre code').forEach(block => {
            if (typeof hljs !== 'undefined') hljs.highlightElement(block);
        });
        
        addCopyButtons(streamGroup);
        addActionButtons(streamGroup);
        
        // Render MathJax
        setTimeout(() => {
            if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
                MathJax.typesetPromise([aiContent]).catch(err => {
                    console.warn('MathJax render error:', err);
                });
            }
        }, 100);
        
        document.querySelector('.chat-wrapper').scrollTop = 999999;
        
    } catch (err) {
        showError('Error: ' + err.message);
        aiContent.textContent = 'Error: ' + err.message;
        aiContent.style.color = 'red';
    }
}

// SIDEBAR
async function deleteChat(id) {
    if (!confirm('Hapus chat ini?')) return;
    
    if (isAuthenticated) {
        try {
            await fetch('/delete_session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
        } catch (err) {
            console.error('Delete error:', err);
        }
    }
    
    delete chatSessions[id];
    saveChatSessions();
    renderHistoryList();
    
    if (id === currentChatId || Object.keys(chatSessions).length === 0) {
        startNewChat();
    }
}

function loadChat(id) {
    if (currentChatId === id) return;
    
    currentChatId = id;
    const session = chatSessions[id];
    
    chatContainer.innerHTML = '';
    
    if (session.messages.length === 0) {
        chatContainer.appendChild(welcomeCenter);
        welcomeCenter.classList.remove('hidden');
        welcomeCenter.style.opacity = '1';
        isChatStarted = false;
    } else {
        session.messages.forEach((msg, i) => {
            const isLastAI = !msg.isUser && i === session.messages.length - 1;
            const userMessageIndex = msg.isUser ? Math.floor(i / 2) : null;
            addMessage(msg.text, msg.isUser, false, isLastAI, userMessageIndex);
        });
        isChatStarted = true;
        setTimeout(() => {
            document.querySelector('.chat-wrapper').scrollTop = 999999;
        }, 100);
    }
    
    renderHistoryList();
    syncHistoryWithServer(session.history);
}

async function startNewChat() {
    const newId = Date.now().toString();
    chatSessions[newId] = { title: 'New Chat', messages: [], history: [] };
    saveChatSessions();
    loadChat(newId);
    await syncHistoryWithServer([]);
}

async function syncHistoryWithServer(history) {
    try {
        await fetch('/sync_history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history })
        });
    } catch (err) {
        console.error('Sync error:', err);
    }
}

function renderHistoryList() {
    historyList.innerHTML = '';
    const ids = Object.keys(chatSessions).sort((a, b) => b - a);
    
    ids.forEach(id => {
        const session = chatSessions[id];
        const item = document.createElement('li');
        item.className = `history-item ${id === currentChatId ? 'active' : ''}`;
        
        const title = document.createElement('span');
        title.className = 'history-title';
        title.textContent = session.title;
        
        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.innerHTML = '×';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteChat(id);
        };
        
        item.appendChild(title);
        item.appendChild(delBtn);
        item.onclick = () => loadChat(id);
        historyList.appendChild(item);
    });
}

// INIT
document.addEventListener('DOMContentLoaded', async () => {
    loadTheme();
    
    darkModeToggle.onclick = () => {
        const isDark = document.body.classList.contains('dark-mode');
        applyTheme(!isDark);
        localStorage.setItem('theme', !isDark ? 'dark' : 'light');
    };
    
    // Check MathJax loaded
    console.log('[INIT] MathJax available:', typeof MathJax !== 'undefined');
    if (typeof MathJax !== 'undefined') {
        console.log('[INIT] MathJax version:', MathJax.version);
    }
    
    await checkAuthStatus();
    
    newChatBtn.onclick = startNewChat;
    
    messageInput.oninput = function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 200) + 'px';
        sendBtn.disabled = this.value.trim() === '';
    };
    
    sendBtn.onclick = sendMessage;
    
    messageInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!sendBtn.disabled) sendMessage();
        }
    };
    
    messageInput.focus();
});